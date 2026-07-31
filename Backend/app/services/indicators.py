"""Technical indicator math.

Every function here is *causal*: the value at row `i` depends only on rows
`<= i`. That property is what lets the signal engine reuse the exact same code
for the live read-out and for the backtest without leaking future information.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# --------------------------------------------------------------------------
# Moving averages
# --------------------------------------------------------------------------


def sma(series: pd.Series, length: int) -> pd.Series:
    return series.rolling(length, min_periods=length).mean()


def ema(series: pd.Series, length: int) -> pd.Series:
    return series.ewm(span=length, adjust=False, min_periods=length).mean()


def wilder(series: pd.Series, length: int) -> pd.Series:
    """Wilder's smoothing — the averaging used by RSI, ATR and ADX."""
    return series.ewm(alpha=1 / length, adjust=False, min_periods=length).mean()


# --------------------------------------------------------------------------
# Momentum
# --------------------------------------------------------------------------


def rsi(close: pd.Series, length: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = wilder(gain, length)
    avg_loss = wilder(loss, length)
    rs = avg_gain / avg_loss.replace(0, np.nan)
    out = 100 - (100 / (1 + rs))
    # A flat-to-up run has zero average loss, which is RSI 100 by definition.
    return out.where(avg_loss != 0, 100.0).where(avg_gain.notna())


def macd(
    close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9
) -> tuple[pd.Series, pd.Series, pd.Series]:
    line = ema(close, fast) - ema(close, slow)
    sig = line.ewm(span=signal, adjust=False, min_periods=signal).mean()
    return line, sig, line - sig


def stochastic(
    high: pd.Series, low: pd.Series, close: pd.Series, length: int = 14, smooth: int = 3
) -> tuple[pd.Series, pd.Series]:
    lowest = low.rolling(length, min_periods=length).min()
    highest = high.rolling(length, min_periods=length).max()
    span = (highest - lowest).replace(0, np.nan)
    k = 100 * (close - lowest) / span
    return k, k.rolling(smooth, min_periods=smooth).mean()


def roc(close: pd.Series, length: int) -> pd.Series:
    """Rate of change, in percent."""
    return close.pct_change(length) * 100


# --------------------------------------------------------------------------
# Volatility
# --------------------------------------------------------------------------


def true_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    prev = close.shift(1)
    return pd.concat(
        [high - low, (high - prev).abs(), (low - prev).abs()], axis=1
    ).max(axis=1)


def atr(high: pd.Series, low: pd.Series, close: pd.Series, length: int = 14) -> pd.Series:
    return wilder(true_range(high, low, close), length)


def bollinger(
    close: pd.Series, length: int = 20, mult: float = 2.0
) -> tuple[pd.Series, pd.Series, pd.Series]:
    mid = sma(close, length)
    sd = close.rolling(length, min_periods=length).std(ddof=0)
    return mid + mult * sd, mid, mid - mult * sd


def realized_volatility(close: pd.Series, length: int = 20, periods: int = 252) -> pd.Series:
    """Annualised standard deviation of log returns, in percent."""
    log_ret = np.log(close / close.shift(1))
    return log_ret.rolling(length, min_periods=length).std(ddof=0) * np.sqrt(periods) * 100


# --------------------------------------------------------------------------
# Trend strength
# --------------------------------------------------------------------------


def adx(
    high: pd.Series, low: pd.Series, close: pd.Series, length: int = 14
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Returns (adx, +DI, -DI)."""
    up = high.diff()
    down = -low.diff()
    plus_dm = pd.Series(np.where((up > down) & (up > 0), up, 0.0), index=high.index)
    minus_dm = pd.Series(np.where((down > up) & (down > 0), down, 0.0), index=high.index)

    tr_n = wilder(true_range(high, low, close), length)
    safe_tr = tr_n.replace(0, np.nan)
    plus_di = 100 * wilder(plus_dm, length) / safe_tr
    minus_di = 100 * wilder(minus_dm, length) / safe_tr

    denom = (plus_di + minus_di).replace(0, np.nan)
    dx = 100 * (plus_di - minus_di).abs() / denom
    return wilder(dx, length), plus_di, minus_di


# --------------------------------------------------------------------------
# Volume
# --------------------------------------------------------------------------


def obv(close: pd.Series, volume: pd.Series) -> pd.Series:
    direction = np.sign(close.diff().fillna(0.0))
    return (direction * volume.fillna(0.0)).cumsum()


def money_flow_index(
    high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series, length: int = 14
) -> pd.Series:
    typical = (high + low + close) / 3
    raw = typical * volume
    rising = typical.diff() > 0
    pos = raw.where(rising, 0.0).rolling(length, min_periods=length).sum()
    neg = raw.where(~rising, 0.0).rolling(length, min_periods=length).sum()
    ratio = pos / neg.replace(0, np.nan)
    return (100 - 100 / (1 + ratio)).where(neg != 0, 100.0)


# --------------------------------------------------------------------------
# Support / resistance
# --------------------------------------------------------------------------


def swing_levels(
    high: pd.Series, low: pd.Series, close: pd.Series, lookback: int = 60, count: int = 3
) -> tuple[list[float], list[float]]:
    """Recent pivot highs/lows that price has not yet invalidated.

    Returns (supports, resistances) sorted by distance from the last close.
    """
    window = 5
    recent_high = high.tail(lookback)
    recent_low = low.tail(lookback)
    if len(recent_high) < window * 2 + 1:
        return [], []

    price = float(close.iloc[-1])
    pivots_hi = [
        float(recent_high.iloc[i])
        for i in range(window, len(recent_high) - window)
        if recent_high.iloc[i] == recent_high.iloc[i - window : i + window + 1].max()
    ]
    pivots_lo = [
        float(recent_low.iloc[i])
        for i in range(window, len(recent_low) - window)
        if recent_low.iloc[i] == recent_low.iloc[i - window : i + window + 1].min()
    ]

    def cluster(values: list[float]) -> list[float]:
        """Merge levels that sit within 1% of each other."""
        merged: list[float] = []
        for v in sorted(values):
            if merged and abs(v - merged[-1]) / max(merged[-1], 1e-9) < 0.01:
                merged[-1] = (merged[-1] + v) / 2
            else:
                merged.append(v)
        return merged

    supports = [v for v in cluster(pivots_lo) if v < price]
    resistances = [v for v in cluster(pivots_hi) if v > price]
    supports.sort(key=lambda v: price - v)
    resistances.sort(key=lambda v: v - price)
    return supports[:count], resistances[:count]


# --------------------------------------------------------------------------
# Bulk computation
# --------------------------------------------------------------------------


def compute_all(df: pd.DataFrame) -> pd.DataFrame:
    """Attach every indicator this app uses as columns on a copy of `df`.

    `df` must carry lowercase open/high/low/close/volume columns.
    """
    out = df.copy()
    close, high, low, vol = out["close"], out["high"], out["low"], out["volume"]

    out["sma20"] = sma(close, 20)
    out["sma50"] = sma(close, 50)
    out["sma200"] = sma(close, 200)
    out["ema12"] = ema(close, 12)
    out["ema26"] = ema(close, 26)

    out["rsi"] = rsi(close, 14)
    out["macd"], out["macd_signal"], out["macd_hist"] = macd(close)
    out["stoch_k"], out["stoch_d"] = stochastic(high, low, close)
    out["roc20"] = roc(close, 20)

    out["bb_upper"], out["bb_mid"], out["bb_lower"] = bollinger(close)
    bb_span = (out["bb_upper"] - out["bb_lower"]).replace(0, np.nan)
    out["bb_pct"] = (close - out["bb_lower"]) / bb_span
    out["bb_width"] = bb_span / out["bb_mid"].replace(0, np.nan) * 100

    out["atr"] = atr(high, low, close, 14)
    out["atr_pct"] = out["atr"] / close * 100
    out["volatility"] = realized_volatility(close)

    out["adx"], out["plus_di"], out["minus_di"] = adx(high, low, close, 14)

    out["obv"] = obv(close, vol)
    out["obv_ema"] = ema(out["obv"], 21)
    out["vol_sma"] = sma(vol, 20)
    out["vol_ratio"] = vol / out["vol_sma"].replace(0, np.nan)
    out["mfi"] = money_flow_index(high, low, close, vol)

    return out
