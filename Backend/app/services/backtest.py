"""Historical evaluation of the signal engine.

The strategy is long-only, which matches the question the app is built to
answer: *when do I put money in, and when do I take it out?*

Two rules keep the result honest rather than flattering:

1. **No lookahead.** A signal computed from bar `i`'s close is acted on at bar
   `i+1`'s open. You could not have traded a close you had not seen yet.
2. **Costs are real.** Every fill pays commission and slippage.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from .market import PERIODS_PER_YEAR
from .signals import MILD, score_frame


@dataclass(frozen=True)
class BacktestConfig:
    initial_capital: float = 10_000.0
    #: Composite score that opens a position.
    entry_threshold: float = MILD
    #: Composite score that closes it. Set below the entry threshold so a
    #: position is not churned in and out by noise around a single level.
    exit_threshold: float = -5.0
    #: Protective stop, in ATR multiples below the entry.
    stop_atr: float = 2.5
    #: Round-trip cost per fill, in basis points (commission + slippage).
    cost_bps: float = 5.0


@dataclass
class Trade:
    entry_time: int
    entry_price: float
    exit_time: int | None = None
    exit_price: float | None = None
    exit_reason: str = ""
    bars_held: int = 0

    @property
    def return_pct(self) -> float:
        if self.exit_price is None:
            return 0.0
        return (self.exit_price / self.entry_price - 1) * 100


def _max_drawdown(equity: np.ndarray) -> tuple[float, int]:
    """Deepest peak-to-trough decline, as a percent, and where it bottomed."""
    peaks = np.maximum.accumulate(equity)
    drawdowns = (equity - peaks) / peaks
    trough = int(np.argmin(drawdowns))
    return float(drawdowns[trough] * 100), trough


def _sharpe(returns: np.ndarray, periods: int) -> float:
    """Annualised Sharpe, risk-free rate assumed zero."""
    live = returns[~np.isnan(returns)]
    if live.size < 2:
        return 0.0
    sd = live.std(ddof=1)
    if sd == 0:
        return 0.0
    return float(live.mean() / sd * math.sqrt(periods))


def run(
    df: pd.DataFrame,
    interval: str = "1d",
    config: BacktestConfig | None = None,
) -> dict[str, Any]:
    """Walk `df` (an indicator-laden frame) bar by bar and report the outcome."""
    cfg = config or BacktestConfig()
    scores = score_frame(df)
    composite = scores["composite"].to_numpy(dtype=float)

    opens = df["open"].to_numpy(dtype=float)
    lows = df["low"].to_numpy(dtype=float)
    closes = df["close"].to_numpy(dtype=float)
    atr = df["atr"].to_numpy(dtype=float)
    times = [int(ts.timestamp()) for ts in df.index]
    n = len(df)

    # Trading starts only once the slowest indicator in play is warm; before
    # that the composite is scored on partial information.
    warmup = int(df["atr"].isna().sum())
    start = min(max(warmup + 1, 1), max(n - 1, 1))

    cost = cfg.cost_bps / 10_000.0
    cash = cfg.initial_capital
    shares = 0.0
    stop_price = 0.0
    entry_bar = 0

    trades: list[Trade] = []
    open_trade: Trade | None = None
    equity = np.full(n, cfg.initial_capital, dtype=float)
    in_market = np.zeros(n, dtype=bool)

    for i in range(start, n):
        signal = composite[i - 1]  # decided on the previous close
        price_open = opens[i]

        if shares > 0.0:
            # Stops are checked against the bar's low. When a bar gaps below
            # the stop, the fill is the open — you cannot get out at a price
            # the market never traded.
            if lows[i] <= stop_price:
                fill = min(price_open, stop_price)
                cash = shares * fill * (1 - cost)
                shares = 0.0
                if open_trade:
                    open_trade.exit_time = times[i]
                    open_trade.exit_price = round(fill, 4)
                    open_trade.exit_reason = "stop"
                    open_trade.bars_held = i - entry_bar
                    trades.append(open_trade)
                    open_trade = None
            elif signal <= cfg.exit_threshold:
                cash = shares * price_open * (1 - cost)
                shares = 0.0
                if open_trade:
                    open_trade.exit_time = times[i]
                    open_trade.exit_price = round(price_open, 4)
                    open_trade.exit_reason = "signal"
                    open_trade.bars_held = i - entry_bar
                    trades.append(open_trade)
                    open_trade = None
        elif signal >= cfg.entry_threshold:
            shares = cash * (1 - cost) / price_open
            cash = 0.0
            entry_bar = i
            bar_atr = atr[i - 1]
            if np.isnan(bar_atr):
                bar_atr = price_open * 0.02
            stop_price = price_open - cfg.stop_atr * bar_atr
            open_trade = Trade(entry_time=times[i], entry_price=round(price_open, 4))

        equity[i] = cash + shares * closes[i]
        in_market[i] = shares > 0.0

    equity[:start] = cfg.initial_capital

    if shares > 0.0 and open_trade:
        open_trade.exit_time = times[-1]
        open_trade.exit_price = round(closes[-1], 4)
        open_trade.exit_reason = "open"
        open_trade.bars_held = n - 1 - entry_bar
        trades.append(open_trade)

    # ---- Buy & hold benchmark over the identical window ----
    bh_shares = cfg.initial_capital * (1 - cost) / opens[start]
    buy_hold = np.full(n, cfg.initial_capital, dtype=float)
    buy_hold[start:] = bh_shares * closes[start:]

    periods = PERIODS_PER_YEAR.get(interval, 252)
    years = max((n - start) / periods, 1e-9)

    strat_final = float(equity[-1])
    bh_final = float(buy_hold[-1])
    strat_return = (strat_final / cfg.initial_capital - 1) * 100
    bh_return = (bh_final / cfg.initial_capital - 1) * 100

    def cagr(final: float) -> float:
        if final <= 0:
            return -100.0
        return ((final / cfg.initial_capital) ** (1 / years) - 1) * 100

    strat_dd, _ = _max_drawdown(equity[start:] if n > start else equity)
    bh_dd, _ = _max_drawdown(buy_hold[start:] if n > start else buy_hold)

    strat_rets = np.diff(equity) / equity[:-1] if n > 1 else np.array([])
    bh_rets = np.diff(buy_hold) / buy_hold[:-1] if n > 1 else np.array([])

    closed = [t for t in trades if t.exit_price is not None]
    wins = [t for t in closed if t.return_pct > 0]
    losses = [t for t in closed if t.return_pct <= 0]
    gross_win = sum(t.return_pct for t in wins)
    gross_loss = abs(sum(t.return_pct for t in losses))

    curve = [
        {
            "time": times[i],
            "strategy": round(float(equity[i]), 2),
            "buy_hold": round(float(buy_hold[i]), 2),
        }
        for i in range(n)
    ]

    return {
        "config": {
            "initial_capital": cfg.initial_capital,
            "entry_threshold": cfg.entry_threshold,
            "exit_threshold": cfg.exit_threshold,
            "stop_atr": cfg.stop_atr,
            "cost_bps": cfg.cost_bps,
        },
        "period": {
            "start": times[start] if n > start else times[0],
            "end": times[-1],
            "bars": n - start,
            "years": round(years, 2),
            "interval": interval,
        },
        "strategy": {
            "final_value": round(strat_final, 2),
            "total_return_pct": round(strat_return, 2),
            "cagr_pct": round(cagr(strat_final), 2),
            "max_drawdown_pct": round(strat_dd, 2),
            "sharpe": round(_sharpe(strat_rets, periods), 2),
            "exposure_pct": round(float(in_market[start:].mean() * 100) if n > start else 0.0, 1),
        },
        "buy_hold": {
            "final_value": round(bh_final, 2),
            "total_return_pct": round(bh_return, 2),
            "cagr_pct": round(cagr(bh_final), 2),
            "max_drawdown_pct": round(bh_dd, 2),
            "sharpe": round(_sharpe(bh_rets, periods), 2),
            "exposure_pct": 100.0,
        },
        "edge": {
            "return_delta_pct": round(strat_return - bh_return, 2),
            "drawdown_delta_pct": round(abs(bh_dd) - abs(strat_dd), 2),
            "beat_buy_hold": strat_return > bh_return,
        },
        "trades_summary": {
            "count": len(closed),
            "wins": len(wins),
            "losses": len(losses),
            "win_rate_pct": round(len(wins) / len(closed) * 100, 1) if closed else 0.0,
            "avg_win_pct": round(gross_win / len(wins), 2) if wins else 0.0,
            "avg_loss_pct": round(-gross_loss / len(losses), 2) if losses else 0.0,
            "profit_factor": round(gross_win / gross_loss, 2) if gross_loss > 0 else None,
            "avg_bars_held": round(sum(t.bars_held for t in closed) / len(closed), 1) if closed else 0.0,
            "best_pct": round(max((t.return_pct for t in closed), default=0.0), 2),
            "worst_pct": round(min((t.return_pct for t in closed), default=0.0), 2),
        },
        "trades": [
            {
                "entry_time": t.entry_time,
                "entry_price": t.entry_price,
                "exit_time": t.exit_time,
                "exit_price": t.exit_price,
                "exit_reason": t.exit_reason,
                "bars_held": t.bars_held,
                "return_pct": round(t.return_pct, 2),
            }
            for t in closed[-40:]
        ],
        "equity_curve": curve,
    }
