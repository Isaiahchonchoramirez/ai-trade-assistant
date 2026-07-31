/**
 * Static demo source.
 *
 * The dashboard normally talks to a FastAPI process that computes everything
 * on the fly. A static host has no such process, so this reads frozen
 * responses captured from the real engine (see Backend/snapshot_demo.py) and
 * serves them through the same shape the API returns.
 *
 * Nothing here fabricates numbers. The one thing it computes is rescaling the
 * backtest to a different starting capital, which is exact: the strategy is
 * all-in / all-out, so every dollar figure is linear in the starting amount
 * and every ratio is invariant.
 */

import {
  ACTION_LABEL,
  money,
  num,
  pct,
} from './format.js'

const ROOT = `${import.meta.env.BASE_URL}demo/`
const cache = new Map()

const safe = (symbol) => symbol.replace(/\^/g, '_').toUpperCase()

async function load(name) {
  if (cache.has(name)) return cache.get(name)
  const promise = fetch(`${ROOT}${name}`).then((res) => {
    if (!res.ok) throw new Error(`missing demo file: ${name}`)
    return res.json()
  })
  cache.set(name, promise)
  return promise
}

let manifestPromise
const manifest = () => (manifestPromise ??= load('manifest.json'))

/** Nearest frozen range to the one asked for, so every tab still resolves. */
async function resolveRange(symbol, range) {
  const m = await manifest()
  const available = m.ranges[symbol.toUpperCase()] || m.ranges.AAPL
  if (available.includes(range)) return range
  const order = ['1D', '5D', '1M', '3M', '6M', '1Y', '5Y', 'MAX']
  const wanted = order.indexOf(range)
  let best = available[0]
  let bestGap = Infinity
  for (const candidate of available) {
    const gap = Math.abs(order.indexOf(candidate) - wanted)
    if (gap < bestGap) {
      bestGap = gap
      best = candidate
    }
  }
  return best
}

function rescale(backtest, capital, baseCapital) {
  const k = capital / baseCapital
  if (k === 1) return backtest
  const scaleSide = (side) => ({ ...side, final_value: side.final_value * k })
  return {
    ...backtest,
    config: { ...backtest.config, initial_capital: capital },
    strategy: scaleSide(backtest.strategy),
    buy_hold: scaleSide(backtest.buy_hold),
    equity_curve: backtest.equity_curve.map((p) => ({
      time: p.time,
      strategy: p.strategy * k,
      buy_hold: p.buy_hold * k,
    })),
  }
}

// --------------------------------------------------------------------------
// The grounded responder, ported from Backend/app/services/assistant.py
//
// Same intents and the same wording, reading the same analysis object. It
// exists here so the demo's chat is real rather than a canned transcript.
// --------------------------------------------------------------------------

const DISCLAIMER =
  'This is a reading of price history, not financial advice — the signal describes what the indicators say, not what will happen.'

const ACTION_WORDS = {
  STRONG_BUY: 'a strong buy signal',
  BUY: 'a buy signal',
  HOLD: 'a hold — no clear edge either way',
  SELL: 'a sell signal',
  STRONG_SELL: 'a strong sell signal',
}

function answerAction(ctx) {
  const a = ctx.analysis
  const lv = a.levels
  const top = a.factors[0]
  return (
    `${a.symbol} reads as ${ACTION_WORDS[a.action]} — composite score ` +
    `${a.composite >= 0 ? '+' : ''}${a.composite.toFixed(0)} out of ±100, confidence ` +
    `${a.confidence.toFixed(0)}%, in what looks like ${a.regime.toLowerCase()}.\n\n` +
    `The heaviest input is ${top.label.toLowerCase()} (${top.contribution >= 0 ? '+' : ''}` +
    `${top.contribution.toFixed(1)} points): ${top.reason}\n\n` +
    `If you acted on it: entry around ${money(lv.entry)}, protective stop at ${money(lv.stop)} ` +
    `(${money(lv.risk_per_share)} of risk per share), first target ${money(lv.targets[0])}. ${DISCLAIMER}`
  )
}

function answerWhy(ctx) {
  const a = ctx.analysis
  const lines = [
    `${a.symbol} scores ${a.composite >= 0 ? '+' : ''}${a.composite.toFixed(0)}. ` +
      'Each factor contributes up to its weight, signed by direction:\n',
  ]
  for (const f of a.factors) {
    lines.push(
      `- ${f.label} (${f.contribution >= 0 ? '+' : ''}${f.contribution.toFixed(1)} of ` +
        `${f.weight.toFixed(0)}): ${f.reason}`,
    )
  }
  const bulls = a.factors.filter((f) => f.stance === 'bullish').length
  const bears = a.factors.filter((f) => f.stance === 'bearish').length
  lines.push(
    `\nThat is ${bulls} bullish, ${bears} bearish, ${a.factors.length - bulls - bears} neutral — ` +
      `hence ${a.confidence.toFixed(0)}% confidence.`,
  )
  return lines.join('\n')
}

function answerRisk(ctx) {
  const a = ctx.analysis
  const { levels: lv, snapshot: snap } = a
  const riskPct = lv.entry ? (Math.abs(lv.entry - lv.stop) / lv.entry) * 100 : 0
  const supports = lv.support.map((s) => money(s)).join(', ') || 'none nearby'
  const resistances = lv.resistance.map((r) => money(r)).join(', ') || 'none nearby'
  return (
    `Stop sits at ${money(lv.stop)}, ${riskPct.toFixed(1)}% from an entry at ${money(lv.entry)}. ` +
    `That is roughly 1.8× the average true range (${money(snap.atr)} per bar, ` +
    `${snap.atr_pct?.toFixed(1)}% of price), so ordinary daily noise should not trigger it.\n\n` +
    `Targets are ${money(lv.targets[0])} and ${money(lv.targets[1])} — 1.5× and 2.5× the risk ` +
    `you are taking.\n\nSupport below: ${supports}. Resistance above: ${resistances}. ` +
    `Annualised volatility is running at ${snap.volatility?.toFixed(0)}%.`
  )
}

function answerSize(ctx) {
  const lv = ctx.analysis.levels
  const risk = lv.risk_per_share || 0.01
  const rows = [5000, 10000, 25000, 100000].map((account) => {
    const budget = account * 0.01
    const shares = Math.floor(budget / risk)
    return `- ${money(account, { digits: 0 })} account → risk ${money(budget)} → ${shares.toLocaleString()} shares (${money(shares * lv.entry)} position)`
  })
  return (
    `Sizing so that a stop-out costs 1% of the account, with ${money(risk)} of risk per share:\n\n` +
    `${rows.join('\n')}\n\n${DISCLAIMER}`
  )
}

function answerBacktest(ctx) {
  const bt = ctx.backtest
  if (!bt) return 'No backtest is available for the current window.'
  const { strategy: s, buy_hold: b, trades_summary: t, period: p } = bt
  const verdict = bt.edge.beat_buy_hold ? 'beat buy-and-hold' : 'trailed buy-and-hold'
  const dd =
    Math.abs(s.max_drawdown_pct) < Math.abs(b.max_drawdown_pct)
      ? `and cut the worst drawdown from ${Math.abs(b.max_drawdown_pct).toFixed(0)}% to ${Math.abs(s.max_drawdown_pct).toFixed(0)}%`
      : `with a deeper worst drawdown (${Math.abs(s.max_drawdown_pct).toFixed(0)}% vs ${Math.abs(b.max_drawdown_pct).toFixed(0)}%)`
  return (
    `Over the ${p.years.toFixed(1)} years on screen, following this signal turned ` +
    `${money(bt.config.initial_capital, { digits: 0 })} into ${money(s.final_value, { digits: 0 })} ` +
    `(${pct(s.total_return_pct)}), versus ${money(b.final_value, { digits: 0 })} ` +
    `(${pct(b.total_return_pct)}) for simply holding. It ${verdict} ${dd}.\n\n` +
    `That came from ${t.count} round trips, ${t.win_rate_pct.toFixed(0)}% of them profitable, ` +
    `average winner ${pct(t.avg_win_pct)} against average loser ${pct(t.avg_loss_pct)}. ` +
    `The strategy was only in the market ${s.exposure_pct.toFixed(0)}% of the time — cash the rest.\n\n` +
    `Risk-adjusted, that is a Sharpe of ${s.sharpe.toFixed(2)} against ${b.sharpe.toFixed(2)} for ` +
    `holding. Past results are not a forecast, and a backtest always flatters itself relative to ` +
    `live trading.`
  )
}

function answerIndicator(ctx, q) {
  const a = ctx.analysis
  const snap = a.snapshot

  if (q.includes('rsi')) {
    const r = snap.rsi
    const state = r > 70 ? 'overbought' : r < 30 ? 'oversold' : 'neutral'
    return (
      `RSI is ${r.toFixed(1)} — ${state}. Above 70 means buyers have been in control long enough ` +
      `that a pause is common; below 30 is the mirror image. It measures the ratio of average ` +
      `gains to average losses over the last 14 bars.`
    )
  }
  if (q.includes('macd')) {
    return (
      `MACD line ${snap.macd.toFixed(3)}, signal ${snap.macd_signal.toFixed(3)}, histogram ` +
      `${snap.macd_hist >= 0 ? '+' : ''}${snap.macd_hist.toFixed(3)}. The histogram is ` +
      `${snap.macd_hist > 0 ? 'positive — momentum favours buyers' : 'negative — momentum favours sellers'}. ` +
      `It is the gap between the 12- and 26-period averages, measured against its own 9-period average.`
    )
  }
  if (q.includes('adx') || q.includes('trend strength')) {
    const adx = snap.adx
    const quality = adx >= 25 ? 'strong' : adx < 20 ? 'weak' : 'moderate'
    return (
      `ADX is ${adx.toFixed(1)}, a ${quality} trend. Below 20 the market is chopping and ` +
      `trend-following signals misfire; above 25 a move has real direction behind it. ` +
      `Current regime: ${a.regime.toLowerCase()}.`
    )
  }
  if (q.includes('bollinger') || q.includes('band')) {
    return (
      `Price sits at ${(snap.bb_pct * 100).toFixed(0)}% of the Bollinger band range. 100% is the ` +
      `upper band (two standard deviations above the 20-period average), 0% the lower. Extremes ` +
      `tend to mean-revert; the middle tells you little.`
    )
  }
  if (q.includes('atr') || q.includes('volatil')) {
    return (
      `Average true range is ${money(snap.atr)} — ${snap.atr_pct.toFixed(1)}% of price per bar. ` +
      `Annualised, realised volatility is ${snap.volatility.toFixed(0)}%. That is what sets the ` +
      `stop distance: ${money(a.levels.stop)}.`
    )
  }
  if (q.includes('volume') || q.includes('mfi')) {
    const ratio = snap.vol_ratio
    return (
      `Volume is running at ${ratio.toFixed(2)}× its 20-period average, and the money-flow index ` +
      `is ${snap.mfi.toFixed(1)}. ` +
      `${ratio > 1.1 ? 'Volume is confirming the move.' : 'Volume is light — the move has less conviction behind it.'}`
    )
  }
  if (q.includes('moving average') || /\bsma\b|\bema\b|\b50\b|\b200\b/.test(q)) {
    return (
      `20-period average ${money(snap.sma20)}, 50-period ${money(snap.sma50)}, 200-period ` +
      `${money(snap.sma200)}. Price is ${money(snap.close)}, which is ` +
      `${snap.close > snap.sma50 ? 'above' : 'below'} the 50 and ` +
      `${snap.sma200 && snap.close > snap.sma200 ? 'above' : 'below'} the 200. ` +
      `${snap.sma200 && snap.sma50 > snap.sma200 ? 'The 50 is over the 200 — the classic uptrend structure.' : 'The 50 is under the 200 — the classic downtrend structure.'}`
    )
  }
  return null
}

function answerPrice(ctx) {
  const q = ctx.quote || {}
  const a = ctx.analysis
  const change = q.change_pct
  return (
    `${q.name || a.symbol} (${a.symbol}) last traded at ${money(q.price ?? a.snapshot.close)}, ` +
    `${(change ?? 0) >= 0 ? 'up' : 'down'} ${pct(change)} on the session against a previous close ` +
    `of ${money(q.previous_close)}. 52-week range ${money(q.week52_low)} to ${money(q.week52_high)}.`
  )
}

function answerHelp(ctx) {
  const a = ctx.analysis
  return (
    `I read the live indicators for ${a.symbol} and answer from them. Try:\n\n` +
    `- *Should I buy?* — the signal and the levels that go with it\n` +
    `- *Why?* — every factor that fed the score, with its weight\n` +
    `- *What's my risk?* — stop, targets, support and resistance\n` +
    `- *How much should I buy?* — position size at 1% account risk\n` +
    `- *How has this done historically?* — the backtest for this window\n` +
    `- *What is RSI saying?* — or MACD, ADX, Bollinger, volume, the moving averages\n\n` +
    `Right now the composite reads ${a.composite >= 0 ? '+' : ''}${a.composite.toFixed(0)} → ` +
    `${ACTION_LABEL[a.action].toLowerCase()}.`
  )
}

const has = (q, words) => words.some((w) => q.includes(w))

function respond(question, ctx) {
  const q = question.toLowerCase().trim()
  const indicator = answerIndicator(ctx, q)
  if (indicator) return indicator
  if (has(q, ['why', 'explain', 'reason', 'breakdown', 'factor'])) return answerWhy(ctx)
  if (has(q, ['backtest', 'historical', 'how has', 'past', 'track record', 'performed']))
    return answerBacktest(ctx)
  if (has(q, ['how much', 'position size', 'how many shares', 'sizing'])) return answerSize(ctx)
  if (has(q, ['risk', 'stop', 'target', 'downside', 'support', 'resistance'])) return answerRisk(ctx)
  if (has(q, ['price', 'quote', 'trading at', 'worth', 'cost'])) return answerPrice(ctx)
  if (has(q, ['buy', 'sell', 'should i', 'signal', 'what do you think', 'hold', 'entry', 'exit']))
    return answerAction(ctx)
  if (has(q, ['help', 'what can you', 'how do i'])) return answerHelp(ctx)
  return answerAction(ctx)
}

// --------------------------------------------------------------------------
// The API surface, matching lib/api.js
// --------------------------------------------------------------------------

export const demoApi = {
  async meta() {
    const meta = await load('meta.json')
    const m = await manifest()
    // Only advertise ranges that were actually frozen — intraday goes stale
    // within the hour and MAX is megabytes per symbol.
    const frozen = new Set(Object.values(m.ranges).flat())
    return {
      ...meta,
      demo: true,
      generated_at: m.generated_at,
      ranges: meta.ranges.filter((r) => frozen.has(r.key)),
      assistant: {
        claude_available: false,
        engine: 'grounded',
        detail:
          'Static demo — answers are computed in the browser from the same frozen indicator data the charts use. Run the backend locally for live data.',
      },
    }
  },

  async overview() {
    return load('overview.json')
  },

  async watchlist() {
    return load('watchlist.json')
  },

  async news(symbol) {
    try {
      return await load(`news-${safe(symbol)}.json`)
    } catch {
      return { symbol: symbol.toUpperCase(), items: [] }
    }
  },

  async quote(symbol) {
    const m = await manifest()
    const rng = await resolveRange(symbol, '6M')
    const data = await load(`analysis-${safe(symbol)}-${rng}.json`)
    void m
    return data.quote
  },

  async search(q) {
    const m = await manifest()
    const term = q.trim().toUpperCase()
    const meta = await load('meta.json')
    const names = {}
    for (const item of (await load('watchlist.json')).items) names[item.symbol] = item.name
    const results = m.symbols
      .filter((s) => s.includes(term) || (names[s] || '').toUpperCase().includes(term))
      .map((s) => ({ symbol: s, name: names[s] || s, type: 'EQUITY', exchange: 'demo' }))
    void meta
    return { query: q, results }
  },

  async analysis(symbol, range, capital) {
    const m = await manifest()
    const rng = await resolveRange(symbol, range)
    const data = await load(`analysis-${safe(symbol)}-${rng}.json`)
    return {
      ...data,
      range: rng,
      demo: true,
      demo_requested_range: range !== rng ? range : undefined,
      backtest: data.backtest ? rescale(data.backtest, capital, m.base_capital) : undefined,
    }
  },

  async chat({ symbol, question, range }) {
    const m = await manifest()
    const rng = await resolveRange(symbol, range)
    const data = await load(`analysis-${safe(symbol)}-${rng}.json`)
    const ctx = { analysis: data.signal, quote: data.quote, backtest: data.backtest }
    void m
    void num
    return { symbol: symbol.toUpperCase(), answer: respond(question, ctx), engine: 'grounded' }
  },
}

export const IS_DEMO = import.meta.env.VITE_DEMO === '1'
