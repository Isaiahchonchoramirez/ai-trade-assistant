"""Market data access.

Everything the app knows about the outside world comes through here. Calls are
blocking, so the API layer runs them in FastAPI's threadpool; a small TTL cache
in front keeps a busy dashboard from hammering the upstream provider.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable

import pandas as pd
import yfinance as yf

log = logging.getLogger(__name__)


class DataUnavailable(Exception):
    """Raised when a symbol cannot be resolved or carries no usable history."""


# --------------------------------------------------------------------------
# TTL cache
# --------------------------------------------------------------------------


class TTLCache:
    def __init__(self) -> None:
        self._store: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def get_or_set(self, key: str, ttl: float, producer: Callable[[], Any]) -> Any:
        now = time.time()
        with self._lock:
            hit = self._store.get(key)
            if hit and now - hit[0] < ttl:
                return hit[1]
        # Produced outside the lock: a slow upstream call must not block reads
        # of unrelated keys. A rare duplicate fetch is the cheaper trade.
        value = producer()
        with self._lock:
            self._store[key] = (now, value)
        return value

    def clear(self) -> None:
        with self._lock:
            self._store.clear()


_cache = TTLCache()


# --------------------------------------------------------------------------
# Range configuration
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class RangeSpec:
    interval: str
    #: How much history to pull. Always far more than is displayed, so slow
    #: indicators such as the 200-period average are warm at the first visible bar.
    fetch_period: str
    #: Bars to display. `None` means "everything in the trailing `days` window".
    display_bars: int | None = None
    days: int | None = None
    label: str = ""


#: `fetch_period` always covers the displayed window *plus* at least 200 extra
#: bars, so the 200-period average is defined on the very first visible bar.
#:
#: Intraday windows are also capped upstream: sub-hourly intervals are only
#: served for the trailing 60 days, and asking for more returns nothing at all
#: rather than a truncated range. `1mo` stays clear of that ceiling while still
#: yielding ~570 fifteen-minute bars — plenty to warm a 200-period average.
RANGES: dict[str, RangeSpec] = {
    "1D": RangeSpec("5m", "1mo", days=1, label="1 day"),
    "5D": RangeSpec("15m", "1mo", days=5, label="5 days"),
    "1M": RangeSpec("1d", "2y", display_bars=22, label="1 month"),
    "3M": RangeSpec("1d", "2y", display_bars=64, label="3 months"),
    "6M": RangeSpec("1d", "3y", display_bars=128, label="6 months"),
    "1Y": RangeSpec("1d", "3y", display_bars=252, label="1 year"),
    "5Y": RangeSpec("1wk", "10y", display_bars=261, label="5 years"),
    "MAX": RangeSpec("1wk", "max", label="Max"),
}

DEFAULT_RANGE = "6M"

#: Bars per year, used to annualise backtest returns per interval.
PERIODS_PER_YEAR = {"5m": 19656, "15m": 6552, "1h": 1638, "1d": 252, "1wk": 52}


def _ttl_for(interval: str) -> float:
    if interval.endswith("m") or interval.endswith("h"):
        return 60.0
    return 300.0


# --------------------------------------------------------------------------
# History
# --------------------------------------------------------------------------


def _normalise(raw: pd.DataFrame) -> pd.DataFrame:
    """Lowercase OHLCV columns, tz-aware index, no gaps in price."""
    if raw is None or raw.empty:
        raise DataUnavailable("no rows returned")

    df = raw.copy()
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df.columns = [str(c).lower().replace(" ", "_") for c in df.columns]

    missing = {"open", "high", "low", "close"} - set(df.columns)
    if missing:
        raise DataUnavailable(f"missing columns: {sorted(missing)}")
    if "volume" not in df.columns:
        df["volume"] = 0.0

    df = df[["open", "high", "low", "close", "volume"]].astype("float64")
    df = df.dropna(subset=["close"])
    df = df[~df.index.duplicated(keep="last")].sort_index()

    if df.empty:
        raise DataUnavailable("no usable rows after cleaning")
    return df


def fetch_history(symbol: str, range_key: str = DEFAULT_RANGE) -> tuple[pd.DataFrame, RangeSpec]:
    """Full padded history for `symbol`, plus the spec describing the request."""
    spec = RANGES.get(range_key.upper(), RANGES[DEFAULT_RANGE])
    key = f"hist:{symbol.upper()}:{spec.fetch_period}:{spec.interval}"

    def produce() -> pd.DataFrame:
        raw = yf.Ticker(symbol).history(
            period=spec.fetch_period,
            interval=spec.interval,
            auto_adjust=True,
            actions=False,
        )
        return _normalise(raw)

    try:
        df = _cache.get_or_set(key, _ttl_for(spec.interval), produce)
    except DataUnavailable:
        raise
    except Exception as exc:  # upstream failures land here
        log.warning("history fetch failed for %s: %s", symbol, exc)
        raise DataUnavailable(f"could not load history for {symbol}") from exc

    return df, spec


def display_slice(df: pd.DataFrame, spec: RangeSpec) -> pd.DataFrame:
    """The visible window, given the full padded frame."""
    if spec.days is not None:
        # Intraday: keep whole sessions rather than a fixed bar count, so the
        # chart always starts at an opening bell.
        sessions = sorted({ts.date() for ts in df.index})
        keep = set(sessions[-spec.days :])
        return df[[ts.date() in keep for ts in df.index]]
    if spec.display_bars is not None:
        return df.tail(spec.display_bars)
    return df


def candles_payload(df: pd.DataFrame) -> list[dict[str, Any]]:
    """OHLCV rows in the shape the charting layer expects."""
    out = []
    for ts, row in df.iterrows():
        out.append(
            {
                "time": int(ts.timestamp()),
                "open": round(float(row["open"]), 4),
                "high": round(float(row["high"]), 4),
                "low": round(float(row["low"]), 4),
                "close": round(float(row["close"]), 4),
                "volume": float(row["volume"]),
            }
        )
    return out


def series_payload(df: pd.DataFrame, column: str) -> list[dict[str, Any]]:
    """A single indicator line, with undefined warm-up bars omitted."""
    if column not in df.columns:
        return []
    s = df[column].dropna()
    return [{"time": int(ts.timestamp()), "value": round(float(v), 4)} for ts, v in s.items()]


# --------------------------------------------------------------------------
# Quotes
# --------------------------------------------------------------------------


def _safe(value: Any) -> Any:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


def fetch_quote(symbol: str) -> dict[str, Any]:
    """Last price and the day's move, with company metadata where available."""

    def produce() -> dict[str, Any]:
        ticker = yf.Ticker(symbol)
        try:
            info = ticker.info or {}
        except Exception:
            info = {}

        price = _safe(info.get("regularMarketPrice"))
        prev = _safe(info.get("regularMarketPreviousClose")) or _safe(info.get("previousClose"))

        if price is None or prev is None:
            # Fall back to the tape itself — always available if the symbol is real.
            try:
                hist = yf.Ticker(symbol).history(period="5d", interval="1d", auto_adjust=False)
                clean = _normalise(hist)
                price = price if price is not None else float(clean["close"].iloc[-1])
                if prev is None and len(clean) > 1:
                    prev = float(clean["close"].iloc[-2])
            except Exception as exc:
                raise DataUnavailable(f"no quote for {symbol}") from exc

        if price is None:
            raise DataUnavailable(f"no quote for {symbol}")
        prev = prev if prev else price

        change = float(price) - float(prev)
        return {
            "symbol": symbol.upper(),
            "name": info.get("shortName") or info.get("longName") or symbol.upper(),
            "price": round(float(price), 4),
            "previous_close": round(float(prev), 4),
            "change": round(change, 4),
            "change_pct": round(change / float(prev) * 100, 3) if prev else 0.0,
            "currency": info.get("currency") or "USD",
            "exchange": info.get("fullExchangeName") or info.get("exchange"),
            "quote_type": info.get("quoteType"),
            "sector": info.get("sector"),
            "industry": info.get("industry"),
            "market_cap": _safe(info.get("marketCap")),
            "pe_ratio": _safe(info.get("trailingPE")),
            "beta": _safe(info.get("beta")),
            "dividend_yield": _safe(info.get("dividendYield")),
            "day_high": _safe(info.get("regularMarketDayHigh")),
            "day_low": _safe(info.get("regularMarketDayLow")),
            "volume": _safe(info.get("regularMarketVolume")),
            "avg_volume": _safe(info.get("averageVolume")),
            "week52_high": _safe(info.get("fiftyTwoWeekHigh")),
            "week52_low": _safe(info.get("fiftyTwoWeekLow")),
            "market_state": info.get("marketState"),
            "summary": info.get("longBusinessSummary"),
        }

    return _cache.get_or_set(f"quote:{symbol.upper()}", 20.0, produce)


def fetch_sparkline(symbol: str, bars: int = 60) -> tuple[list[float], float]:
    """Closing prices for a mini chart, plus the percent move across them."""

    def produce() -> tuple[list[float], float]:
        raw = yf.Ticker(symbol).history(period="3mo", interval="1d", auto_adjust=True, actions=False)
        df = _normalise(raw).tail(bars)
        closes = [round(float(v), 4) for v in df["close"]]
        pct = ((closes[-1] / closes[0]) - 1) * 100 if len(closes) > 1 and closes[0] else 0.0
        return closes, round(pct, 2)

    return _cache.get_or_set(f"spark:{symbol.upper()}:{bars}", 300.0, produce)


# --------------------------------------------------------------------------
# Search
# --------------------------------------------------------------------------

#: Fallback universe for offline / rate-limited symbol lookup.
UNIVERSE: list[tuple[str, str]] = [
    ("AAPL", "Apple Inc."), ("MSFT", "Microsoft Corporation"), ("NVDA", "NVIDIA Corporation"),
    ("GOOGL", "Alphabet Inc."), ("AMZN", "Amazon.com, Inc."), ("META", "Meta Platforms, Inc."),
    ("TSLA", "Tesla, Inc."), ("AVGO", "Broadcom Inc."), ("BRK-B", "Berkshire Hathaway Inc."),
    ("JPM", "JPMorgan Chase & Co."), ("V", "Visa Inc."), ("MA", "Mastercard Incorporated"),
    ("UNH", "UnitedHealth Group"), ("XOM", "Exxon Mobil Corporation"), ("JNJ", "Johnson & Johnson"),
    ("WMT", "Walmart Inc."), ("PG", "Procter & Gamble"), ("HD", "The Home Depot, Inc."),
    ("COST", "Costco Wholesale"), ("ORCL", "Oracle Corporation"), ("AMD", "Advanced Micro Devices"),
    ("NFLX", "Netflix, Inc."), ("CRM", "Salesforce, Inc."), ("ADBE", "Adobe Inc."),
    ("INTC", "Intel Corporation"), ("QCOM", "QUALCOMM Incorporated"), ("PLTR", "Palantir Technologies"),
    ("UBER", "Uber Technologies"), ("DIS", "The Walt Disney Company"), ("BA", "The Boeing Company"),
    ("PFE", "Pfizer Inc."), ("KO", "The Coca-Cola Company"), ("PEP", "PepsiCo, Inc."),
    ("MCD", "McDonald's Corporation"), ("NKE", "NIKE, Inc."), ("SBUX", "Starbucks Corporation"),
    ("GS", "The Goldman Sachs Group"), ("BAC", "Bank of America"), ("T", "AT&T Inc."),
    ("SPY", "SPDR S&P 500 ETF Trust"), ("QQQ", "Invesco QQQ Trust"), ("DIA", "SPDR Dow Jones ETF"),
    ("IWM", "iShares Russell 2000 ETF"), ("VTI", "Vanguard Total Stock Market ETF"),
    ("VOO", "Vanguard S&P 500 ETF"), ("ARKK", "ARK Innovation ETF"), ("GLD", "SPDR Gold Shares"),
    ("SLV", "iShares Silver Trust"), ("USO", "United States Oil Fund"), ("TLT", "iShares 20+ Year Treasury"),
    ("XLK", "Technology Select Sector SPDR"), ("XLF", "Financial Select Sector SPDR"),
    ("XLE", "Energy Select Sector SPDR"), ("XLV", "Health Care Select Sector SPDR"),
    ("BTC-USD", "Bitcoin USD"), ("ETH-USD", "Ethereum USD"), ("SOL-USD", "Solana USD"),
    ("DOGE-USD", "Dogecoin USD"), ("^GSPC", "S&P 500"), ("^IXIC", "NASDAQ Composite"),
    ("^DJI", "Dow Jones Industrial Average"), ("^VIX", "CBOE Volatility Index"),
    ("^RUT", "Russell 2000"), ("EURUSD=X", "EUR/USD"), ("GC=F", "Gold Futures"), ("CL=F", "Crude Oil Futures"),
]


def _local_search(query: str, limit: int) -> list[dict[str, Any]]:
    q = query.strip().upper()
    if not q:
        return []
    scored = []
    for sym, name in UNIVERSE:
        if sym.startswith(q):
            scored.append((0, sym, name))
        elif q in sym:
            scored.append((1, sym, name))
        elif q in name.upper():
            scored.append((2, sym, name))
    scored.sort(key=lambda t: (t[0], len(t[1])))
    return [{"symbol": s, "name": n, "type": "EQUITY"} for _, s, n in scored[:limit]]


def search_symbols(query: str, limit: int = 8) -> list[dict[str, Any]]:
    """Symbol lookup — upstream search first, local universe as a safety net."""
    q = query.strip()
    if not q:
        return []

    def produce() -> list[dict[str, Any]]:
        results: list[dict[str, Any]] = []
        try:
            quotes = yf.Search(q, max_results=limit, news_count=0).quotes or []
            for item in quotes:
                sym = item.get("symbol")
                if not sym:
                    continue
                results.append(
                    {
                        "symbol": sym,
                        "name": item.get("shortname") or item.get("longname") or sym,
                        "type": item.get("quoteType", "EQUITY"),
                        "exchange": item.get("exchDisp"),
                    }
                )
        except Exception as exc:
            log.info("upstream search unavailable (%s); using local universe", exc)

        if not results:
            results = _local_search(q, limit)
        return results[:limit]

    return _cache.get_or_set(f"search:{q.lower()}:{limit}", 600.0, produce)


# --------------------------------------------------------------------------
# News
# --------------------------------------------------------------------------


def fetch_news(symbol: str, limit: int = 8) -> list[dict[str, Any]]:
    def produce() -> list[dict[str, Any]]:
        try:
            raw = yf.Ticker(symbol).news or []
        except Exception as exc:
            log.info("news unavailable for %s: %s", symbol, exc)
            return []

        def nested_url(container: dict, key: str) -> str | None:
            value = container.get(key)
            if isinstance(value, dict):
                return value.get("url")
            return value if isinstance(value, str) else None

        items = []
        for entry in raw[:limit]:
            # yfinance has shipped both a flat and a nested shape over time.
            content = entry.get("content") if isinstance(entry.get("content"), dict) else entry
            title = content.get("title") or entry.get("title")
            if not title:
                continue
            url = nested_url(content, "canonicalUrl") or nested_url(content, "clickThroughUrl")
            provider = content.get("provider")
            publisher = provider.get("displayName") if isinstance(provider, dict) else entry.get("publisher")
            items.append(
                {
                    "title": title,
                    "url": url or entry.get("link"),
                    "publisher": publisher or "",
                    "published": content.get("pubDate") or entry.get("providerPublishTime"),
                    "summary": (content.get("summary") or "")[:400],
                }
            )
        return items

    return _cache.get_or_set(f"news:{symbol.upper()}:{limit}", 900.0, produce)
