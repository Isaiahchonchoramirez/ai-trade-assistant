"""HTTP surface.

Handlers are declared `def`, not `async def`, on purpose: every one of them
ends in a blocking yfinance call, so FastAPI runs them in its threadpool where
they cannot stall the event loop.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ...core.config import settings
from ...services import assistant, backtest as backtest_service, indicators as ind, market, signals

log = logging.getLogger(__name__)
router = APIRouter()


def _load(symbol: str, range_key: str):
    """Fetch, warm the indicators, and slice to the visible window."""
    sym = symbol.upper()
    try:
        raw, spec = market.fetch_history(symbol, range_key)
    except market.DataUnavailable as exc:
        # Upstream messages ("no rows returned") mean nothing to a person
        # looking at a search box, so say what they can actually do about it.
        log.info("no history for %s at %s: %s", sym, range_key, exc)
        raise HTTPException(
            status_code=404,
            detail=(
                f"No price history for {sym}. Check the symbol, or try a longer range — "
                "intraday data is not available for every instrument."
            ),
        ) from exc

    full = ind.compute_all(raw)
    view = market.display_slice(full, spec)
    if view.empty:
        raise HTTPException(
            status_code=404,
            detail=f"{sym} has no bars in the {range_key.upper()} window. Try a longer range.",
        )
    return view, spec


# --------------------------------------------------------------------------
# Meta
# --------------------------------------------------------------------------


@router.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "version": settings.version}


@router.get("/meta")
def meta() -> dict[str, Any]:
    return {
        "app": settings.app_name,
        "version": settings.version,
        "ranges": [
            {"key": key, "label": spec.label, "interval": spec.interval}
            for key, spec in market.RANGES.items()
        ],
        "default_range": market.DEFAULT_RANGE,
        "default_watchlist": settings.default_watchlist,
        "factor_weights": signals.WEIGHTS,
        "assistant": assistant.engine_status(),
        "disclaimer": settings.disclaimer,
    }


# --------------------------------------------------------------------------
# Symbols
# --------------------------------------------------------------------------


@router.get("/search")
def search(q: str = Query("", min_length=0), limit: int = Query(8, ge=1, le=25)):
    return {"query": q, "results": market.search_symbols(q, limit)}


@router.get("/quote/{symbol}")
def quote(symbol: str) -> dict[str, Any]:
    try:
        return market.fetch_quote(symbol)
    except market.DataUnavailable as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/news/{symbol}")
def news(symbol: str, limit: int = Query(6, ge=1, le=20)):
    return {"symbol": symbol.upper(), "items": market.fetch_news(symbol, limit)}


# --------------------------------------------------------------------------
# Analysis — the endpoint the dashboard is built around
# --------------------------------------------------------------------------


@router.get("/analysis/{symbol}")
def analysis(
    symbol: str,
    range: str = Query(market.DEFAULT_RANGE, alias="range"),
    include_backtest: bool = True,
    capital: float = Query(10_000.0, gt=0, le=100_000_000),
) -> dict[str, Any]:
    """Candles, indicator overlays, the live signal, and the backtest."""
    view, spec = _load(symbol, range)
    sym = symbol.upper()

    signal = signals.analyse(view, sym)

    result: dict[str, Any] = {
        "symbol": sym,
        "range": range.upper(),
        "interval": spec.interval,
        "bars": len(view),
        "candles": market.candles_payload(view),
        "overlays": {
            name: market.series_payload(view, name)
            for name in ("sma20", "sma50", "sma200", "ema12", "ema26", "bb_upper", "bb_lower", "bb_mid")
        },
        "oscillators": {
            name: market.series_payload(view, name)
            for name in ("rsi", "macd", "macd_signal", "macd_hist", "adx", "plus_di", "minus_di", "stoch_k", "mfi")
        },
        "signal": signal,
        "disclaimer": settings.disclaimer,
    }

    try:
        result["quote"] = market.fetch_quote(symbol)
    except Exception as exc:  # a chart without a quote header still beats a 500
        log.info("quote unavailable for %s: %s", symbol, exc)
        result["quote"] = None

    if include_backtest:
        bt = backtest_service.run(
            view,
            spec.interval,
            backtest_service.BacktestConfig(initial_capital=capital),
        )
        # How much the result is worth trusting comes down to the number of
        # completed round trips, not the number of bars: a trend strategy can
        # sit in one position for a year. Graded rather than boolean, because
        # on most ranges the honest answer is "indicative, not proof" — and a
        # warning that never goes away stops being read.
        trades = bt["trades_summary"]["count"]
        bt["evidence"] = "high" if trades >= 25 else "moderate" if trades >= 10 else "low"
        bt["reliable"] = trades >= 10
        result["backtest"] = bt

    return result


@router.get("/history/{symbol}")
def history(symbol: str, range: str = Query(market.DEFAULT_RANGE, alias="range")):
    """Just the candles — for the sparkline and chart-only consumers."""
    view, spec = _load(symbol, range)
    return {
        "symbol": symbol.upper(),
        "range": range.upper(),
        "interval": spec.interval,
        "candles": market.candles_payload(view),
    }


# --------------------------------------------------------------------------
# Batched views
# --------------------------------------------------------------------------


def _mini(symbol: str, with_spark: bool = True) -> dict[str, Any] | None:
    """Quote plus a composite score — one row of the watchlist."""
    row: dict[str, Any] = {"symbol": symbol.upper()}
    try:
        row.update(market.fetch_quote(symbol))
    except Exception as exc:
        log.info("skipping %s: %s", symbol, exc)
        return None

    try:
        raw, spec = market.fetch_history(symbol, "6M")
        full = ind.compute_all(raw)
        view = market.display_slice(full, spec)
        scores = signals.score_frame(view)
        composite = float(scores["composite"].iloc[-1])
        row["composite"] = round(composite, 1)
        row["action"] = signals.action_for(composite)
        row["confidence"] = round(float(scores["confidence"].iloc[-1]), 1)
        if with_spark:
            row["sparkline"] = [round(float(v), 4) for v in view["close"].tail(60)]
    except Exception as exc:
        log.info("no signal for %s: %s", symbol, exc)
        row.setdefault("composite", None)
        row.setdefault("action", None)

    return row


def _gather(symbols: list[str], with_spark: bool = True) -> list[dict[str, Any]]:
    if not symbols:
        return []
    with ThreadPoolExecutor(max_workers=settings.max_workers) as pool:
        results = list(pool.map(lambda s: _mini(s, with_spark), symbols))
    return [r for r in results if r]


@router.get("/watchlist")
def watchlist(symbols: str = Query("", description="Comma-separated symbols")):
    requested = [s.strip() for s in symbols.split(",") if s.strip()] or settings.default_watchlist
    return {"items": _gather(requested[:25])}


@router.get("/market/overview")
def market_overview() -> dict[str, Any]:
    """Indices, sector rotation, and a one-line read on overall breadth."""
    with ThreadPoolExecutor(max_workers=settings.max_workers) as pool:
        indices_future = pool.submit(_gather, settings.index_symbols, True)
        sectors_future = pool.submit(_gather, settings.sector_symbols, False)
        indices = indices_future.result()
        sectors = sectors_future.result()

    for sector in sectors:
        sector["name"] = settings.sector_names.get(sector["symbol"], sector.get("name"))
    sectors.sort(key=lambda s: s.get("change_pct") or 0, reverse=True)

    scored = [i["composite"] for i in indices if i.get("composite") is not None]
    breadth = sum(scored) / len(scored) if scored else 0.0
    advancing = sum(1 for s in sectors if (s.get("change_pct") or 0) > 0)

    if breadth >= 25:
        tone, headline = "bullish", "Broad risk appetite — most indices are trending up."
    elif breadth <= -25:
        tone, headline = "bearish", "Broad risk-off — most indices are trending down."
    else:
        tone, headline = "mixed", "Mixed tape — no clear directional consensus."

    vix = next((i for i in indices if i["symbol"] == "^VIX"), None)
    if vix and vix.get("price"):
        level = vix["price"]
        fear = "complacent" if level < 15 else "elevated" if level > 25 else "normal"
        headline += f" Volatility is {fear} (VIX {level:.1f})."

    return {
        "indices": indices,
        "sectors": sectors,
        "breadth": {
            "score": round(breadth, 1),
            "tone": tone,
            "headline": headline,
            "sectors_advancing": advancing,
            "sectors_total": len(sectors),
        },
    }


# --------------------------------------------------------------------------
# Assistant
# --------------------------------------------------------------------------


class ChatTurn(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=20)
    question: str = Field(..., max_length=2000)
    range: str = market.DEFAULT_RANGE
    history: list[ChatTurn] = Field(default_factory=list)


class KeyRequest(BaseModel):
    key: str = Field(..., max_length=400)


@router.get("/assistant")
def assistant_status() -> dict[str, Any]:
    return assistant.engine_status()


@router.post("/assistant/connect")
def assistant_connect(payload: KeyRequest) -> dict[str, Any]:
    """Verify a key and store it locally.

    The key is never echoed back and never logged — the response says only
    whether it worked.
    """
    ok, message = assistant.verify_key(payload.key)
    if not ok:
        raise HTTPException(status_code=400, detail=message)
    assistant.save_key(payload.key)
    return {"message": message, **assistant.engine_status()}


@router.post("/assistant/disconnect")
def assistant_disconnect() -> dict[str, Any]:
    assistant.clear_key()
    return {"message": "Disconnected.", **assistant.engine_status()}


@router.post("/chat")
def chat(payload: ChatRequest) -> dict[str, Any]:
    view, spec = _load(payload.symbol, payload.range)
    sym = payload.symbol.upper()

    ctx: dict[str, Any] = {"analysis": signals.analyse(view, sym)}
    try:
        ctx["quote"] = market.fetch_quote(payload.symbol)
    except Exception:
        ctx["quote"] = None
    try:
        ctx["backtest"] = backtest_service.run(view, spec.interval)
    except Exception as exc:
        log.info("no backtest context for %s: %s", sym, exc)

    result = assistant.answer(
        payload.question, ctx, [t.model_dump() for t in payload.history]
    )
    return {"symbol": sym, **result}
