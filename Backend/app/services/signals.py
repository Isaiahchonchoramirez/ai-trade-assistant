"""The composite signal engine.

Seven independent factors each score the market from -1 (bearish) to +1
(bullish). They are combined by weight into a composite from -100 to +100,
which maps to an action.

Scoring is fully vectorised: `score_frame` produces a score for *every* bar in
the series at once. The live signal is simply the last row of that frame, and
the backtest walks the same frame. There is therefore no way for the two to
disagree, and — because every input indicator is causal — no lookahead.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd

from . import indicators as ind

# Factor weights, summing to 100. The composite is a weighted sum of factor
# scores, so these are directly the maximum points each factor can contribute.
WEIGHTS: dict[str, float] = {
    "trend_structure": 22.0,
    "macd_momentum": 16.0,
    "ma_crossover": 14.0,
    "rsi": 14.0,
    "trend_strength": 12.0,
    "volume_flow": 12.0,
    "bollinger": 10.0,
}

FACTOR_LABELS: dict[str, str] = {
    "trend_structure": "Trend structure",
    "macd_momentum": "MACD momentum",
    "ma_crossover": "Moving-average cross",
    "rsi": "RSI",
    "trend_strength": "Trend strength (ADX)",
    "volume_flow": "Volume & money flow",
    "bollinger": "Bollinger position",
}

# Composite thresholds for each action.
STRONG = 45.0
MILD = 18.0


def _tanh(x: pd.Series) -> pd.Series:
    return pd.Series(np.tanh(x.to_numpy(dtype=float)), index=x.index)


def _clip(s: pd.Series, lo: float = -1.0, hi: float = 1.0) -> pd.Series:
    return s.clip(lower=lo, upper=hi)


# --------------------------------------------------------------------------
# Factors
# --------------------------------------------------------------------------


def _trend_structure(df: pd.DataFrame) -> pd.Series:
    """Where price sits relative to its 50- and 200-period averages.

    Contributions are re-normalised over whichever averages exist, so a young
    series without a 200-period average still scores on what it has.
    """
    close = df["close"]
    parts, weights = [], []

    for col, w in (("sma50", 0.35), ("sma200", 0.35)):
        avail = df[col].notna()
        parts.append(np.where(avail, np.sign(close - df[col]) * w, 0.0))
        weights.append(np.where(avail, w, 0.0))

    cross_avail = df["sma50"].notna() & df["sma200"].notna()
    parts.append(np.where(cross_avail, np.sign(df["sma50"] - df["sma200"]) * 0.30, 0.0))
    weights.append(np.where(cross_avail, 0.30, 0.0))

    total = np.sum(parts, axis=0)
    norm = np.sum(weights, axis=0)
    score = np.divide(total, norm, out=np.zeros_like(total), where=norm > 0)
    return pd.Series(score, index=df.index)


def _macd_momentum(df: pd.DataFrame) -> pd.Series:
    """MACD histogram as a share of price, plus credit for it expanding."""
    hist_pct = df["macd_hist"] / df["close"].replace(0, np.nan) * 100
    base = _tanh(hist_pct / 0.4)
    expanding = np.sign(df["macd_hist"].diff().fillna(0.0)) * 0.25
    return _clip(base + expanding).fillna(0.0)


def _ma_crossover(df: pd.DataFrame) -> pd.Series:
    """Gap between the fast and slow EMA, as a share of price."""
    gap_pct = (df["ema12"] - df["ema26"]) / df["close"].replace(0, np.nan) * 100
    return _clip(_tanh(gap_pct)).fillna(0.0)


def _rsi(df: pd.DataFrame) -> pd.Series:
    """Momentum from RSI, fading it back at genuine extremes.

    Below 75 this reads as pure momentum. Past that, an overbought tape is
    treated as increasingly stretched rather than increasingly strong — and
    symmetrically for oversold.
    """
    r = df["rsi"]
    base = _clip((r - 50) / 25)
    stretched = np.where(r > 75, -(r - 75) / 25 * 1.2, 0.0) + np.where(
        r < 25, (25 - r) / 25 * 1.2, 0.0
    )
    return _clip(base + pd.Series(stretched, index=df.index)).fillna(0.0)


def _trend_strength(df: pd.DataFrame) -> pd.Series:
    """Directional-movement gap, scaled by how trending the tape is."""
    direction = _clip((df["plus_di"] - df["minus_di"]) / 25)
    strength = _clip(df["adx"] / 30, 0.0, 1.2)
    return _clip(direction * strength).fillna(0.0)


def _volume_flow(df: pd.DataFrame) -> pd.Series:
    """Is volume confirming the move? On-balance volume slope plus money flow."""
    slope = df["obv"].diff(5) / (df["vol_sma"].replace(0, np.nan) * 5)
    obv_score = _clip(_tanh(slope * 1.5))
    mfi_score = _clip((df["mfi"] - 50) / 30)
    return _clip((obv_score.fillna(0.0) + mfi_score.fillna(0.0)) / 2)


def _bollinger(df: pd.DataFrame) -> pd.Series:
    """Mean reversion: rich at the top of the band, cheap at the bottom.

    Deliberately contrarian — the trend factors already reward strength, and
    this is what stops the composite from chasing a fully extended move.
    """
    return _clip(-(df["bb_pct"] - 0.5) * 2.2).fillna(0.0)


FACTOR_FNS = {
    "trend_structure": _trend_structure,
    "macd_momentum": _macd_momentum,
    "ma_crossover": _ma_crossover,
    "rsi": _rsi,
    "trend_strength": _trend_strength,
    "volume_flow": _volume_flow,
    "bollinger": _bollinger,
}


# --------------------------------------------------------------------------
# Composite
# --------------------------------------------------------------------------


def score_frame(df: pd.DataFrame) -> pd.DataFrame:
    """Per-bar factor scores, composite (-100..100), confidence (0..100)."""
    scores = pd.DataFrame(index=df.index)
    for name, fn in FACTOR_FNS.items():
        scores[name] = fn(df).replace([np.inf, -np.inf], 0.0).fillna(0.0)

    composite = sum(scores[name] * w for name, w in WEIGHTS.items())
    scores["composite"] = composite

    # Confidence blends conviction (how far from neutral) with consensus (how
    # much of the factor weight agrees with the composite's direction).
    sign = np.sign(composite)
    agreeing = sum(
        np.where(np.sign(scores[name]) == sign, WEIGHTS[name] * scores[name].abs(), 0.0)
        for name in WEIGHTS
    )
    total_w = sum(WEIGHTS.values())
    consensus = pd.Series(agreeing / total_w, index=df.index)
    conviction = (composite.abs() / 60).clip(upper=1.0)
    scores["confidence"] = ((0.45 * conviction + 0.55 * consensus) * 100).clip(0, 100)

    return scores


def action_for(composite: float) -> str:
    if composite >= STRONG:
        return "STRONG_BUY"
    if composite >= MILD:
        return "BUY"
    if composite <= -STRONG:
        return "STRONG_SELL"
    if composite <= -MILD:
        return "SELL"
    return "HOLD"


def regime_for(row: pd.Series) -> str:
    """Plain-language description of the market state."""
    adx_v = row.get("adx")
    trending = adx_v is not None and not pd.isna(adx_v) and adx_v >= 25
    close, s50, s200 = row.get("close"), row.get("sma50"), row.get("sma200")

    if pd.isna(s50):
        return "Insufficient history"
    above50 = close > s50
    above200 = (not pd.isna(s200)) and close > s200

    if above50 and above200:
        return "Strong uptrend" if trending else "Uptrend"
    if not above50 and not above200 and not pd.isna(s200):
        return "Strong downtrend" if trending else "Downtrend"
    return "Choppy / transitioning" if not trending else "Trend turning"


# --------------------------------------------------------------------------
# Human-readable factor breakdown
# --------------------------------------------------------------------------


def _fmt(value: Any, digits: int = 2) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return "n/a"
    return f"{float(value):,.{digits}f}"


def _factor_reason(name: str, row: pd.Series, score: float) -> str:
    close = row["close"]
    if name == "trend_structure":
        bits = []
        if not pd.isna(row["sma50"]):
            bits.append(f"price {'above' if close > row['sma50'] else 'below'} the 50-period average")
        if not pd.isna(row["sma200"]):
            bits.append(f"{'above' if close > row['sma200'] else 'below'} the 200")
            if not pd.isna(row["sma50"]):
                bits.append(
                    "50 over 200 (golden-cross structure)"
                    if row["sma50"] > row["sma200"]
                    else "50 under 200 (death-cross structure)"
                )
        return "; ".join(bits).capitalize() if bits else "Not enough history to judge structure."
    if name == "macd_momentum":
        state = "positive and widening" if score > 0.4 else "positive" if score > 0 else "negative"
        return f"MACD histogram is {state} at {_fmt(row['macd_hist'], 3)}."
    if name == "ma_crossover":
        rel = "above" if row["ema12"] > row["ema26"] else "below"
        gap = abs(row["ema12"] - row["ema26"]) / close * 100 if close else 0
        return f"12-period EMA sits {rel} the 26 by {_fmt(gap)}% of price."
    if name == "rsi":
        r = row["rsi"]
        if pd.isna(r):
            return "RSI not yet available."
        if r > 75:
            return f"RSI {_fmt(r, 1)} — overbought, momentum strong but stretched."
        if r < 25:
            return f"RSI {_fmt(r, 1)} — oversold, prone to a bounce."
        return f"RSI {_fmt(r, 1)} — {'bullish' if r > 50 else 'bearish'} side of neutral."
    if name == "trend_strength":
        a = row["adx"]
        if pd.isna(a):
            return "ADX not yet available."
        quality = "strong" if a >= 25 else "weak" if a < 20 else "moderate"
        lead = "buyers" if row["plus_di"] > row["minus_di"] else "sellers"
        return f"ADX {_fmt(a, 1)} — {quality} trend, {lead} in control."
    if name == "volume_flow":
        conf = "confirming" if score > 0.15 else "diverging from" if score < -0.15 else "neutral on"
        return f"On-balance volume is {conf} price; MFI {_fmt(row['mfi'], 1)}."
    if name == "bollinger":
        pct = row["bb_pct"]
        if pd.isna(pct):
            return "Bollinger bands not yet available."
        if pct > 0.9:
            return "Price is riding the upper band — extended."
        if pct < 0.1:
            return "Price is pinned to the lower band — washed out."
        return f"Price sits at {_fmt(pct * 100, 0)}% of the band range."
    return ""


@dataclass
class Levels:
    entry: float
    stop: float
    targets: list[float]
    risk_per_share: float
    reward_to_risk: float
    support: list[float] = field(default_factory=list)
    resistance: list[float] = field(default_factory=list)


def compute_levels(df: pd.DataFrame, action: str) -> Levels:
    """Entry, protective stop and profit targets, sized off recent volatility.

    The stop is placed 1.8 ATR away — far enough that ordinary noise will not
    trigger it — then pulled to just beyond the nearest swing level when one
    sits in a sensible range.
    """
    row = df.iloc[-1]
    entry = float(row["close"])
    atr_v = float(row["atr"]) if not pd.isna(row["atr"]) else entry * 0.02
    atr_v = max(atr_v, entry * 0.002)

    supports, resistances = ind.swing_levels(df["high"], df["low"], df["close"])
    bearish = action in ("SELL", "STRONG_SELL")

    if bearish:
        stop = entry + 1.8 * atr_v
        for r in resistances:
            if entry + 1.0 * atr_v <= r <= entry + 3.0 * atr_v:
                stop = r + 0.25 * atr_v
                break
        risk = stop - entry
        targets = [entry - 1.5 * risk, entry - 2.5 * risk]
    else:
        stop = entry - 1.8 * atr_v
        for s in supports:
            if entry - 3.0 * atr_v <= s <= entry - 1.0 * atr_v:
                stop = s - 0.25 * atr_v
                break
        risk = entry - stop
        targets = [entry + 1.5 * risk, entry + 2.5 * risk]

    return Levels(
        entry=round(entry, 4),
        stop=round(stop, 4),
        targets=[round(t, 4) for t in targets],
        risk_per_share=round(abs(risk), 4),
        reward_to_risk=2.5,
        support=[round(s, 4) for s in supports],
        resistance=[round(r, 4) for r in resistances],
    )


def _headline(action: str, symbol: str, regime: str, confidence: float) -> str:
    conf = "high" if confidence >= 70 else "moderate" if confidence >= 45 else "low"
    phrases = {
        "STRONG_BUY": f"{symbol} is in a {regime.lower()} with broad agreement across factors — a strong accumulation setup with {conf} confidence.",
        "BUY": f"{symbol} leans constructive within a {regime.lower()}; a measured entry is reasonable at {conf} confidence.",
        "HOLD": f"{symbol} is mixed — the factors are pulling against each other. Sitting out costs nothing here.",
        "SELL": f"{symbol} is deteriorating within a {regime.lower()}; trimming exposure is the lower-risk path at {conf} confidence.",
        "STRONG_SELL": f"{symbol} is breaking down with factors aligned to the downside — {conf}-confidence exit signal.",
    }
    return phrases[action]


def analyse(df: pd.DataFrame, symbol: str) -> dict[str, Any]:
    """Full live analysis for the most recent bar of an indicator-laden frame."""
    scores = score_frame(df)
    last_s = scores.iloc[-1]
    last = df.iloc[-1]

    composite = float(last_s["composite"])
    action = action_for(composite)
    confidence = float(last_s["confidence"])
    regime = regime_for(last)

    factors = []
    for name, weight in WEIGHTS.items():
        s = float(last_s[name])
        factors.append(
            {
                "key": name,
                "label": FACTOR_LABELS[name],
                "score": round(s, 3),
                "weight": weight,
                "contribution": round(s * weight, 2),
                "stance": "bullish" if s > 0.15 else "bearish" if s < -0.15 else "neutral",
                "reason": _factor_reason(name, last, s),
            }
        )
    factors.sort(key=lambda f: abs(f["contribution"]), reverse=True)

    levels = compute_levels(df, action)

    return {
        "symbol": symbol,
        "action": action,
        "composite": round(composite, 2),
        "confidence": round(confidence, 1),
        "regime": regime,
        "headline": _headline(action, symbol, regime, confidence),
        "factors": factors,
        "levels": {
            "entry": levels.entry,
            "stop": levels.stop,
            "targets": levels.targets,
            "risk_per_share": levels.risk_per_share,
            "reward_to_risk": levels.reward_to_risk,
            "support": levels.support,
            "resistance": levels.resistance,
        },
        "snapshot": {
            "close": round(float(last["close"]), 4),
            "rsi": None if pd.isna(last["rsi"]) else round(float(last["rsi"]), 2),
            "macd": None if pd.isna(last["macd"]) else round(float(last["macd"]), 4),
            "macd_signal": None if pd.isna(last["macd_signal"]) else round(float(last["macd_signal"]), 4),
            "macd_hist": None if pd.isna(last["macd_hist"]) else round(float(last["macd_hist"]), 4),
            "adx": None if pd.isna(last["adx"]) else round(float(last["adx"]), 2),
            "atr": None if pd.isna(last["atr"]) else round(float(last["atr"]), 4),
            "atr_pct": None if pd.isna(last["atr_pct"]) else round(float(last["atr_pct"]), 2),
            "volatility": None if pd.isna(last["volatility"]) else round(float(last["volatility"]), 2),
            "sma20": None if pd.isna(last["sma20"]) else round(float(last["sma20"]), 4),
            "sma50": None if pd.isna(last["sma50"]) else round(float(last["sma50"]), 4),
            "sma200": None if pd.isna(last["sma200"]) else round(float(last["sma200"]), 4),
            "bb_pct": None if pd.isna(last["bb_pct"]) else round(float(last["bb_pct"]), 3),
            "mfi": None if pd.isna(last["mfi"]) else round(float(last["mfi"]), 2),
            "vol_ratio": None if pd.isna(last["vol_ratio"]) else round(float(last["vol_ratio"]), 2),
        },
    }
