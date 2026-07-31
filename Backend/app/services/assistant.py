"""The assistant that answers questions about a symbol.

Two engines, in order of preference:

1. **Claude** — used only when an Anthropic credential is present. It is given
   the *computed* analysis as context and is told not to invent numbers, so its
   answers stay anchored to the same maths the rest of the app shows.
2. **The grounded responder** — always available, no key, no network. It reads
   the same analysis dict and answers from it directly.

The app is fully usable on engine 2 alone; Claude is an upgrade for open-ended
questions, never a dependency.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

log = logging.getLogger(__name__)

MODEL = "claude-opus-5"

SYSTEM_PROMPT = """You are the analyst inside a technical-analysis dashboard.

You will be given a JSON block of indicator values, a composite signal, and \
backtest statistics that the application has already computed for one symbol. \
Answer the user's question about that symbol.

Rules:
- Every number you state must come from the provided data. Never estimate, \
recall, or invent a price, indicator reading, or statistic.
- If the data does not contain what was asked, say so plainly.
- This is technical analysis of price history, not a recommendation, and you \
say so when the user asks what to do with their money.
- Be direct and specific. Two or three short paragraphs at most. No preamble, \
no bulleted restatement of the whole dataset.
"""

ACTION_WORDS = {
    "STRONG_BUY": "a strong buy signal",
    "BUY": "a buy signal",
    "HOLD": "a hold — no clear edge either way",
    "SELL": "a sell signal",
    "STRONG_SELL": "a strong sell signal",
}

DISCLAIMER = (
    "This is a reading of price history, not financial advice — the signal "
    "describes what the indicators say, not what will happen."
)


# --------------------------------------------------------------------------
# Formatting helpers
# --------------------------------------------------------------------------


def _money(value: Any) -> str:
    if value is None:
        return "n/a"
    return f"${float(value):,.2f}"


def _pct(value: Any, digits: int = 2) -> str:
    if value is None:
        return "n/a"
    return f"{float(value):+,.{digits}f}%"


# --------------------------------------------------------------------------
# The grounded responder
# --------------------------------------------------------------------------


def _answer_action(ctx: dict) -> str:
    a = ctx["analysis"]
    lv = a["levels"]
    top = a["factors"][0]
    return (
        f"{a['symbol']} reads as {ACTION_WORDS[a['action']]} — composite score "
        f"{a['composite']:+.0f} out of ±100, confidence {a['confidence']:.0f}%, "
        f"in what looks like {a['regime'].lower()}.\n\n"
        f"The heaviest input is {top['label'].lower()} ({top['contribution']:+.1f} points): "
        f"{top['reason']}\n\n"
        f"If you acted on it: entry around {_money(lv['entry'])}, protective stop at "
        f"{_money(lv['stop'])} ({_money(lv['risk_per_share'])} of risk per share), "
        f"first target {_money(lv['targets'][0])}. {DISCLAIMER}"
    )


def _answer_why(ctx: dict) -> str:
    a = ctx["analysis"]
    lines = [
        f"{a['symbol']} scores {a['composite']:+.0f}. Each factor contributes up to "
        f"its weight, signed by direction:\n"
    ]
    for f in a["factors"]:
        lines.append(f"- {f['label']} ({f['contribution']:+.1f} of {f['weight']:.0f}): {f['reason']}")
    bulls = sum(1 for f in a["factors"] if f["stance"] == "bullish")
    bears = sum(1 for f in a["factors"] if f["stance"] == "bearish")
    lines.append(
        f"\nThat is {bulls} bullish, {bears} bearish, "
        f"{len(a['factors']) - bulls - bears} neutral — hence "
        f"{a['confidence']:.0f}% confidence."
    )
    return "\n".join(lines)


def _answer_risk(ctx: dict) -> str:
    a = ctx["analysis"]
    lv, snap = a["levels"], a["snapshot"]
    entry, stop = lv["entry"], lv["stop"]
    risk_pct = abs(entry - stop) / entry * 100 if entry else 0
    supports = ", ".join(_money(s) for s in lv["support"]) or "none nearby"
    resistances = ", ".join(_money(r) for r in lv["resistance"]) or "none nearby"
    return (
        f"Stop sits at {_money(stop)}, {risk_pct:.1f}% from an entry at {_money(entry)}. "
        f"That is roughly 1.8× the average true range ({_money(snap['atr'])} per bar, "
        f"{snap['atr_pct']:.1f}% of price), so ordinary daily noise should not trigger it.\n\n"
        f"Targets are {_money(lv['targets'][0])} and {_money(lv['targets'][1])} — "
        f"1.5× and 2.5× the risk you are taking.\n\n"
        f"Support below: {supports}. Resistance above: {resistances}. "
        f"Annualised volatility is running at {snap['volatility']:.0f}%."
    )


def _answer_size(ctx: dict) -> str:
    a = ctx["analysis"]
    lv = a["levels"]
    risk = lv["risk_per_share"] or 0.01
    rows = []
    for account in (5_000, 10_000, 25_000, 100_000):
        budget = account * 0.01
        shares = int(budget / risk)
        rows.append(
            f"- {_money(account)} account → risk {_money(budget)} → {shares:,} shares "
            f"({_money(shares * lv['entry'])} position)"
        )
    return (
        f"Sizing so that a stop-out costs 1% of the account, with "
        f"{_money(risk)} of risk per share:\n\n" + "\n".join(rows) + f"\n\n{DISCLAIMER}"
    )


def _answer_backtest(ctx: dict) -> str:
    bt = ctx.get("backtest")
    if not bt:
        return "No backtest is available for the current window."
    s, b, t, p = bt["strategy"], bt["buy_hold"], bt["trades_summary"], bt["period"]
    verdict = (
        "beat buy-and-hold" if bt["edge"]["beat_buy_hold"] else "trailed buy-and-hold"
    )
    dd = (
        f"and cut the worst drawdown from {abs(b['max_drawdown_pct']):.0f}% to "
        f"{abs(s['max_drawdown_pct']):.0f}%"
        if abs(s["max_drawdown_pct"]) < abs(b["max_drawdown_pct"])
        else f"with a deeper worst drawdown ({abs(s['max_drawdown_pct']):.0f}% vs "
        f"{abs(b['max_drawdown_pct']):.0f}%)"
    )
    return (
        f"Over the {p['years']:.1f} years on screen, following this signal turned "
        f"{_money(bt['config']['initial_capital'])} into {_money(s['final_value'])} "
        f"({_pct(s['total_return_pct'])}), versus {_money(b['final_value'])} "
        f"({_pct(b['total_return_pct'])}) for simply holding. It {verdict} {dd}.\n\n"
        f"That came from {t['count']} round trips, {t['win_rate_pct']:.0f}% of them "
        f"profitable, average winner {_pct(t['avg_win_pct'])} against average loser "
        f"{_pct(t['avg_loss_pct'])}. The strategy was only in the market "
        f"{s['exposure_pct']:.0f}% of the time — cash the rest.\n\n"
        f"Risk-adjusted, that is a Sharpe of {s['sharpe']:.2f} against "
        f"{b['sharpe']:.2f} for holding. Past results are not a forecast, and a "
        f"backtest always flatters itself relative to live trading."
    )


def _answer_indicator(ctx: dict, question: str) -> str | None:
    a = ctx["analysis"]
    snap = a["snapshot"]
    q = question.lower()

    if "rsi" in q:
        r = snap["rsi"]
        state = "overbought" if r > 70 else "oversold" if r < 30 else "neutral"
        return (
            f"RSI is {r:.1f} — {state}. Above 70 means buyers have been in control long "
            f"enough that a pause is common; below 30 is the mirror image. It measures the "
            f"ratio of average gains to average losses over the last 14 bars."
        )
    if "macd" in q:
        return (
            f"MACD line {snap['macd']:.3f}, signal {snap['macd_signal']:.3f}, histogram "
            f"{snap['macd_hist']:+.3f}. The histogram is "
            f"{'positive — momentum favours buyers' if snap['macd_hist'] > 0 else 'negative — momentum favours sellers'}. "
            f"It is the gap between the 12- and 26-period averages, measured against its own 9-period average."
        )
    if "adx" in q or "trend strength" in q:
        adx = snap["adx"]
        quality = "strong" if adx >= 25 else "weak" if adx < 20 else "moderate"
        return (
            f"ADX is {adx:.1f}, a {quality} trend. Below 20 the market is chopping and "
            f"trend-following signals misfire; above 25 a move has real direction behind it. "
            f"Current regime: {a['regime'].lower()}."
        )
    if "bollinger" in q or "band" in q:
        pct = snap["bb_pct"]
        return (
            f"Price sits at {pct * 100:.0f}% of the Bollinger band range. 100% is the upper "
            f"band (two standard deviations above the 20-period average), 0% the lower. "
            f"Extremes tend to mean-revert; the middle tells you little."
        )
    if "atr" in q or "volatil" in q:
        return (
            f"Average true range is {_money(snap['atr'])} — {snap['atr_pct']:.1f}% of price "
            f"per bar. Annualised, realised volatility is {snap['volatility']:.0f}%. "
            f"That is what sets the stop distance: {_money(a['levels']['stop'])}."
        )
    if "volume" in q or "mfi" in q:
        ratio = snap["vol_ratio"]
        return (
            f"Volume is running at {ratio:.2f}× its 20-period average, and the money-flow "
            f"index is {snap['mfi']:.1f}. "
            f"{'Volume is confirming the move.' if ratio > 1.1 else 'Volume is light — the move has less conviction behind it.'}"
        )
    if "moving average" in q or re.search(r"\bsma\b|\bema\b|\b50\b|\b200\b", q):
        return (
            f"20-period average {_money(snap['sma20'])}, 50-period {_money(snap['sma50'])}, "
            f"200-period {_money(snap['sma200'])}. Price is {_money(snap['close'])}, which is "
            f"{'above' if snap['close'] > snap['sma50'] else 'below'} the 50 and "
            f"{'above' if snap['sma200'] and snap['close'] > snap['sma200'] else 'below'} the 200. "
            f"{'The 50 is over the 200 — the classic uptrend structure.' if snap['sma200'] and snap['sma50'] > snap['sma200'] else 'The 50 is under the 200 — the classic downtrend structure.'}"
        )
    return None


def _answer_price(ctx: dict) -> str:
    q = ctx.get("quote") or {}
    a = ctx["analysis"]
    name = q.get("name", a["symbol"])
    change = q.get("change_pct")
    direction = "up" if (change or 0) >= 0 else "down"
    return (
        f"{name} ({a['symbol']}) last traded at {_money(q.get('price') or a['snapshot']['close'])}, "
        f"{direction} {_pct(change)} on the session against a previous close of "
        f"{_money(q.get('previous_close'))}. "
        f"52-week range {_money(q.get('week52_low'))} to {_money(q.get('week52_high'))}."
    )


def _answer_help(ctx: dict) -> str:
    a = ctx["analysis"]
    return (
        f"I read the live indicators for {a['symbol']} and answer from them. Try:\n\n"
        f"- *Should I buy?* — the signal and the levels that go with it\n"
        f"- *Why?* — every factor that fed the score, with its weight\n"
        f"- *What's my risk?* — stop, targets, support and resistance\n"
        f"- *How much should I buy?* — position size at 1% account risk\n"
        f"- *How has this done historically?* — the backtest for this window\n"
        f"- *What is RSI saying?* — or MACD, ADX, Bollinger, volume, the moving averages\n\n"
        f"Right now the composite reads {a['composite']:+.0f} → {a['action'].replace('_', ' ').lower()}."
    )


def respond_locally(question: str, ctx: dict) -> str:
    """Answer from the computed analysis. Always available, no network."""
    q = question.lower().strip()

    indicator = _answer_indicator(ctx, q)
    if indicator:
        return indicator

    if any(w in q for w in ("why", "explain", "reason", "breakdown", "factor")):
        return _answer_why(ctx)
    if any(w in q for w in ("backtest", "historical", "how has", "past", "track record", "performed")):
        return _answer_backtest(ctx)
    if any(w in q for w in ("how much", "position size", "how many shares", "sizing")):
        return _answer_size(ctx)
    if any(w in q for w in ("risk", "stop", "target", "downside", "support", "resistance")):
        return _answer_risk(ctx)
    if any(w in q for w in ("price", "quote", "trading at", "worth", "cost")):
        return _answer_price(ctx)
    if any(w in q for w in ("buy", "sell", "should i", "signal", "what do you think", "hold", "entry", "exit")):
        return _answer_action(ctx)
    if any(w in q for w in ("help", "what can you", "how do i")):
        return _answer_help(ctx)

    return _answer_action(ctx)


# --------------------------------------------------------------------------
# Claude
# --------------------------------------------------------------------------


def _claude_available() -> bool:
    """An Anthropic credential can come from an env var or a stored profile."""
    if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        return True
    return os.path.isdir(os.path.expanduser("~/.config/anthropic"))


def _compact_context(ctx: dict) -> str:
    """The analysis, trimmed to what is worth spending tokens on."""
    import json

    a = ctx["analysis"]
    payload: dict[str, Any] = {
        "symbol": a["symbol"],
        "action": a["action"],
        "composite_score": a["composite"],
        "confidence_pct": a["confidence"],
        "regime": a["regime"],
        "indicators": a["snapshot"],
        "levels": a["levels"],
        "factors": [
            {k: f[k] for k in ("label", "score", "weight", "contribution", "reason")}
            for f in a["factors"]
        ],
    }
    if ctx.get("quote"):
        q = ctx["quote"]
        payload["quote"] = {
            k: q.get(k)
            for k in ("name", "price", "change_pct", "sector", "market_cap", "pe_ratio", "week52_high", "week52_low")
        }
    if ctx.get("backtest"):
        bt = ctx["backtest"]
        payload["backtest"] = {
            "window": bt["period"],
            "strategy": bt["strategy"],
            "buy_and_hold": bt["buy_hold"],
            "trades": bt["trades_summary"],
        }
    return json.dumps(payload, separators=(",", ":"), default=str)


def respond_with_claude(question: str, ctx: dict, history: list[dict] | None = None) -> str | None:
    """Ask Claude, grounded on the computed data. `None` means fall back."""
    try:
        import anthropic
    except ImportError:
        log.info("anthropic package not installed; using the local responder")
        return None

    try:
        client = anthropic.Anthropic()
    except Exception as exc:
        log.info("no Anthropic credential available (%s)", exc)
        return None

    messages: list[dict[str, Any]] = []
    for turn in (history or [])[-6:]:
        role = turn.get("role")
        content = (turn.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})

    messages.append(
        {
            "role": "user",
            "content": f"<computed_data>\n{_compact_context(ctx)}\n</computed_data>\n\n{question}",
        }
    )

    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=8000,
            system=SYSTEM_PROMPT,
            messages=messages,
            # Low effort keeps the assistant snappy; thinking stays on because
            # disabling it on this model has its own failure modes.
            output_config={"effort": "low"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.RateLimitError:
        log.warning("Claude rate limited; falling back to the local responder")
        return None
    except anthropic.APIStatusError as exc:
        log.warning("Claude returned %s: %s", exc.status_code, exc.message)
        return None
    except anthropic.APIConnectionError as exc:
        log.warning("could not reach Claude (%s)", exc)
        return None
    except Exception as exc:
        log.warning("unexpected Claude failure: %s", exc)
        return None

    if response.stop_reason == "refusal":
        log.info("Claude declined the request; falling back")
        return None

    text = "".join(
        block.text for block in response.content if getattr(block, "type", "") == "text"
    ).strip()
    return text or None


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------


def answer(question: str, ctx: dict, history: list[dict] | None = None) -> dict[str, Any]:
    question = (question or "").strip()
    if not question:
        return {"answer": _answer_help(ctx), "engine": "grounded"}

    if _claude_available():
        reply = respond_with_claude(question, ctx, history)
        if reply:
            return {"answer": reply, "engine": "claude"}

    return {"answer": respond_locally(question, ctx), "engine": "grounded"}


def engine_status() -> dict[str, Any]:
    """What the UI shows next to the chat input."""
    try:
        import anthropic  # noqa: F401

        installed = True
    except ImportError:
        installed = False
    ready = installed and _claude_available()
    return {
        "claude_available": ready,
        "engine": "claude" if ready else "grounded",
        "detail": (
            f"Answers generated by {MODEL}, grounded on the computed indicators."
            if ready
            else "Answers computed directly from the live indicators. Set ANTHROPIC_API_KEY for conversational replies."
        ),
    }
