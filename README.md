# AI Trade Assistant

A market dashboard that answers one question: **when does money go in, and when does it come out?**

It pulls live price history, computes seven independent technical factors, combines them into a
single score, turns that score into an action with concrete entry/stop/target levels — then shows
how that exact strategy would have performed historically, against simply buying and holding.

---

## Quick start

Two processes. Backend first.

```bash
# 1. Backend — http://127.0.0.1:8000
python3 -m venv .venv                        # first time only
.venv/bin/pip install -r Backend/Requirements.txt
cd Backend && ../.venv/bin/uvicorn app.main:app --reload --port 8000
```

```bash
# 2. Frontend — http://localhost:5173
cd Frontend
npm install                                  # first time only
npm run dev
```

Open the URL Vite prints. No API keys, no accounts, no configuration — market data comes from
Yahoo Finance via `yfinance`, and the Vite dev server proxies `/api` to the backend, so there is
no CORS setup either.

> If port 5173 is taken Vite picks the next free one and prints it; the proxy follows along.

---

## What it does

### The signal

Seven factors each score the tape from −1 (bearish) to +1 (bullish). They combine by weight into
a composite from −100 to +100:

| Factor | Weight | What it measures |
|---|---:|---|
| Trend structure | 22 | Price vs the 50- and 200-period averages, and whether the 50 is over the 200 |
| MACD momentum | 16 | Histogram size, and whether it is expanding |
| Moving-average cross | 14 | Gap between the 12- and 26-period EMAs |
| RSI | 14 | Momentum, faded back at genuine extremes |
| Trend strength (ADX) | 12 | Directional-movement gap, scaled by how trending the tape is |
| Volume & money flow | 12 | Whether volume confirms the move |
| Bollinger position | 10 | Mean reversion — the brake that stops the score chasing an extended move |

The composite maps to an action: **≥ +45** strong buy, **≥ +18** buy, **≤ −18** sell, **≤ −45**
strong sell, otherwise hold. Confidence blends how far the score sits from neutral with how much
of the factor weight actually agrees with its direction — so a +30 where every factor points the
same way scores higher than a +30 that is two factors fighting five.

Every factor appears in the UI with its own contribution and a plain-English reason. Nothing is a
black box.

### The levels

Stops sit 1.8 ATR from entry — far enough that ordinary noise will not trigger them — then get
pulled to just beyond the nearest swing low when one falls in a sensible range. Targets are 1.5×
and 2.5× the resulting risk.

### The backtest

The same scoring code that produces the live signal is replayed over the visible window. Two
rules keep it honest:

1. **No lookahead.** A signal computed from bar *i*'s close is acted on at bar *i+1*'s open.
2. **Costs are real.** Every fill pays 5 bps of commission and slippage, and each position carries
   a 2.5 ATR stop checked against the bar's low — a gap below the stop fills at the open, not at
   the stop.

Results sit next to buy-and-hold on total return, annualised return, worst drawdown, Sharpe, and
time invested, because return alone is a bad scorecard. **On most large-cap names buy-and-hold
wins on raw return while the strategy wins on drawdown.** The app shows that rather than hiding
it.

Confidence in the backtest is graded by completed round trips: under 10 and the panel says so
outright.

### The assistant

Ask in plain language — *"why that signal?"*, *"what's my risk?"*, *"how much should I buy?"*
Answers are computed from the same indicator values shown on the page.

By default this runs on a **grounded responder**: no API key, no network call, deterministic, and
incapable of inventing a number. If an Anthropic credential is present (`ANTHROPIC_API_KEY`, or a
profile from `ant auth login`), the same computed data goes to Claude for open-ended questions
instead, under a system prompt that forbids stating any figure absent from that data. If Claude is
unavailable, rate-limited, or declines, it falls back silently. The badge above the chat input
says which engine answered.

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # entirely optional
```

---

## Using it

| | |
|---|---|
| `/` | Focus search |
| `1`–`8` | Switch range (1D → MAX) |
| ★ | Add or remove the current symbol from the watchlist |
| **Live** | Auto-refresh every 30s, paused while the tab is hidden |
| ◑ | Colourblind-safe palette |
| ☀ / ☾ | Light / dark theme |

Search covers equities, ETFs, indices (`^GSPC`), crypto (`BTC-USD`), FX (`EURUSD=X`) and futures
(`GC=F`) — anything Yahoo Finance resolves.

Watchlist, theme, range and starting capital persist in `localStorage`.

---

## Design notes

**Colour is never the only signal.** The default green-up / red-down convention fails a
deuteranopia check badly: the measured separation between `#0ca30c` and `#d03b3b` is ΔE 4.1, where
8 is the floor. Rather than abandon the convention every trader reads instinctively, every value
in the app also carries a sign, an arrow glyph and a text label — and the ◑ toggle swaps both
poles for a blue/orange pair measuring ΔE 24.7 (light) and 26.8 (dark). The strategy-vs-benchmark
series use that same validated pair.

**Scales adapt to the data.** The price chart and the equity curve both switch to logarithmic
automatically when the span demands it (8× for price, 20× for portfolio value). Across 45 years of
AAPL a linear axis flattens the first three decades onto the baseline; on a log axis equal
percentage moves look equal, which is what compounding actually means.

**Charts get a hover layer by default** — a crosshair with full OHLC and indicator readout on the
price chart, and a two-series crosshair tooltip on the equity curve.

---

## Layout

```
Backend/
  app/
    main.py                 FastAPI app, CORS, router mount
    core/config.py          Settings, all env-overridable
    services/
      market.py             yfinance access, TTL cache, range specs, search, news
      indicators.py         Indicator maths — every function is causal
      signals.py            The seven factors, the composite, levels, explanations
      backtest.py           Bar-by-bar replay with costs and stops
      assistant.py          Grounded responder + optional Claude
    api/v1/routes.py        HTTP surface
Frontend/
  src/
    index.css               Design tokens — the validated palette lives here
    App.jsx                 Layout, state, data fetching
    lib/                    API client, display formatting
    hooks/usePrefs.js       Theme, palette, persisted state, CSS-token reader
    components/             Chart, signal, backtest, watchlist, assistant, …
```

Route handlers are declared `def`, not `async def`, on purpose: each ends in a blocking `yfinance`
call, so FastAPI runs them in its threadpool where they cannot stall the event loop. Batched
endpoints fan out across a thread pool on top of that.

### API

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/meta` | Ranges, factor weights, assistant engine status, disclaimer |
| `GET /api/v1/search?q=` | Symbol lookup |
| `GET /api/v1/quote/{symbol}` | Last price, day move, company facts |
| `GET /api/v1/analysis/{symbol}?range=&capital=` | Candles, overlays, oscillators, signal, backtest |
| `GET /api/v1/history/{symbol}?range=` | Candles only |
| `GET /api/v1/market/overview` | Indices, sector rotation, breadth |
| `GET /api/v1/watchlist?symbols=` | Batched quotes + mini signals + sparklines |
| `GET /api/v1/news/{symbol}` | Recent headlines |
| `POST /api/v1/chat` | Ask the assistant about a symbol |

Interactive docs at <http://127.0.0.1:8000/docs>.

### Configuration

Everything has a working default. Override with environment variables: `CORS_ORIGINS`,
`INDEX_SYMBOLS`, `SECTOR_SYMBOLS`, `DEFAULT_WATCHLIST`, `MAX_WORKERS`, `ANTHROPIC_API_KEY`, and
`VITE_API_TARGET` (frontend, if the backend is not on `127.0.0.1:8000`).

---

## Limitations

- **Prices are delayed.** Yahoo Finance is free and not a real-time feed. Do not trade off the
  last tick shown here.
- **Long-only.** A "sell" signal means *exit*, not *go short*.
- **The backtest is single-symbol and unlevered**, with no dividends beyond what the adjusted
  close already includes, no taxes, and no sizing beyond all-in / all-out.
- **A backtest always flatters itself.** It never misses a fill, panics, or changes its mind.
- **Few trades.** A trend-following overlay makes a handful of round trips a year, so on most
  ranges the sample is too small to separate an edge from luck. The app labels this rather than
  glossing over it.

## Disclaimer

Educational technical analysis, not financial advice. These signals describe what indicators say
about past price action — they do not predict the future, and no backtest result implies a future
one. Never risk money you cannot afford to lose.

## Licence

MIT — see `LICENSE`.
