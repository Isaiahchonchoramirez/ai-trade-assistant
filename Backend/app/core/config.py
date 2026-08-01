"""Application settings, all overridable by environment variable."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _csv(name: str, default: list[str]) -> list[str]:
    raw = os.environ.get(name)
    if not raw:
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    app_name: str = "AI Trade Assistant"
    version: str = "1.0.0"

    #: Browser origins allowed to call this API. The Vite dev server moves
    #: ports when one is busy, so the common range is covered.
    cors_origins: list[str] = field(
        default_factory=lambda: _csv(
            "CORS_ORIGINS",
            [
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "http://localhost:5174",
                "http://127.0.0.1:5174",
                "http://localhost:4173",
                "http://127.0.0.1:4173",
            ],
        )
    )

    #: The market summary strip at the top of the dashboard.
    index_symbols: list[str] = field(
        default_factory=lambda: _csv(
            "INDEX_SYMBOLS", ["^GSPC", "^IXIC", "^DJI", "^RUT", "^VIX"]
        )
    )

    #: Sector ETFs, used as a proxy for where money is rotating.
    sector_symbols: list[str] = field(
        default_factory=lambda: _csv(
            "SECTOR_SYMBOLS",
            ["XLK", "XLF", "XLV", "XLE", "XLY", "XLP", "XLI", "XLU", "XLB", "XLRE"],
        )
    )

    sector_names: dict[str, str] = field(
        default_factory=lambda: {
            "XLK": "Technology",
            "XLF": "Financials",
            "XLV": "Health Care",
            "XLE": "Energy",
            "XLY": "Cons. Discretionary",
            "XLP": "Cons. Staples",
            "XLI": "Industrials",
            "XLU": "Utilities",
            "XLB": "Materials",
            "XLRE": "Real Estate",
        }
    )

    default_watchlist: list[str] = field(
        default_factory=lambda: _csv(
            "DEFAULT_WATCHLIST",
            ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "TSLA", "SPY", "BTC-USD"],
        )
    )

    #: Parallelism for the batched endpoints. yfinance calls are IO-bound.
    max_workers: int = int(os.environ.get("MAX_WORKERS", "8"))

    #: Explicit path to a built frontend. Empty means auto-detect — see main.py.
    static_dir: str = os.environ.get("STATIC_DIR", "")

    disclaimer: str = (
        "Educational technical analysis, not financial advice. Signals describe "
        "what indicators say about past price action — they do not predict the "
        "future. Never risk money you cannot afford to lose."
    )


settings = Settings()
