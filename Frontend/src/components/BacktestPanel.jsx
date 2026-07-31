import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { dateLabel, money, moneyCompact, num, pct, pctPlain } from '../lib/format.js'
import { Stat } from './Primitives.jsx'

const PAD = { top: 14, right: 62, bottom: 22, left: 8 }

/**
 * Strategy against buy-and-hold on one value axis — never two scales.
 * Both series are money in the same currency, so a shared axis is honest.
 */
function EquityCurve({ curve, height = 220, capital }) {
  const hostRef = useRef(null)
  const [width, setWidth] = useState(640)
  const [hoverIndex, setHoverIndex] = useState(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      if (w > 0) setWidth(Math.floor(w))
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const geometry = useMemo(() => {
    if (!curve?.length) return null
    const values = curve.flatMap((p) => [p.strategy, p.buy_hold])
    const min = Math.min(...values, capital)
    const max = Math.max(...values, capital)

    // Across decades a portfolio can grow by orders of magnitude, and on a
    // linear axis every early year collapses onto the baseline. Log scaling
    // makes equal percentage moves look equal, which is what compounding
    // actually means. It also keeps the axis strictly positive — a linear
    // axis padded below the minimum can otherwise label a negative balance.
    const useLog = min > 0 && max / min >= 20
    const project = useLog ? (v) => Math.log10(Math.max(v, 1e-9)) : (v) => v
    const invert = useLog ? (v) => 10 ** v : (v) => v

    const pMin = project(min)
    const pMax = project(max)
    const pad = (pMax - pMin || 1) * 0.06
    const lo = pMin - pad
    const hi = pMax + pad

    const plotW = Math.max(width - PAD.left - PAD.right, 10)
    const plotH = Math.max(height - PAD.top - PAD.bottom, 10)
    const x = (i) => PAD.left + (i / Math.max(curve.length - 1, 1)) * plotW
    const y = (v) => PAD.top + (1 - (project(v) - lo) / (hi - lo)) * plotH

    const path = (key) =>
      curve.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p[key]).toFixed(2)}`).join(' ')

    const ticks = Array.from({ length: 4 }, (_, i) => invert(lo + ((hi - lo) * i) / 3))
    return { x, y, plotW, plotH, path, ticks, useLog }
  }, [curve, width, height, capital])

  const onMove = useCallback(
    (event) => {
      if (!geometry || !curve?.length) return
      const rect = event.currentTarget.getBoundingClientRect()
      const rel = event.clientX - rect.left - PAD.left
      const ratio = Math.max(0, Math.min(1, rel / geometry.plotW))
      setHoverIndex(Math.round(ratio * (curve.length - 1)))
    },
    [geometry, curve],
  )

  if (!geometry || !curve?.length) return null

  const point = hoverIndex != null ? curve[hoverIndex] : null
  const finalPoint = curve[curve.length - 1]
  const series = [
    { key: 'strategy', label: 'Following signals', color: 'var(--accent)' },
    { key: 'buy_hold', label: 'Buy & hold', color: 'var(--bench)' },
  ]

  return (
    <div ref={hostRef} className="w-full">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--ink-2)' }}>
            <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded-full" style={{ background: s.color }} />
            {s.label}
            <span className="tnum font-semibold" style={{ color: 'var(--ink)' }}>
              {money((point || finalPoint)[s.key], { digits: 0 })}
            </span>
          </span>
        ))}
      </div>

      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Portfolio value over time. Following signals ended at ${money(finalPoint.strategy, { digits: 0 })}; buy and hold ended at ${money(finalPoint.buy_hold, { digits: 0 })}.`}
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIndex(null)}
        style={{ display: 'block', cursor: 'crosshair' }}
      >
        {geometry.ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={geometry.y(t)}
              y2={geometry.y(t)}
              stroke="var(--grid)"
              strokeWidth="1"
            />
            <text
              x={width - PAD.right + 6}
              y={geometry.y(t) + 3.5}
              fontSize="10"
              fill="var(--ink-3)"
              className="tnum"
            >
              {moneyCompact(t)}
            </text>
          </g>
        ))}

        {/* Starting capital — the break-even line. */}
        <line
          x1={PAD.left}
          x2={width - PAD.right}
          y1={geometry.y(capital)}
          y2={geometry.y(capital)}
          stroke="var(--ink-3)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />

        <path d={geometry.path('buy_hold')} fill="none" stroke="var(--bench)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <path d={geometry.path('strategy')} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {point && (
          <g>
            <line
              x1={geometry.x(hoverIndex)}
              x2={geometry.x(hoverIndex)}
              y1={PAD.top}
              y2={height - PAD.bottom}
              stroke="var(--ink-3)"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
            {series.map((s) => (
              <circle
                key={s.key}
                cx={geometry.x(hoverIndex)}
                cy={geometry.y(point[s.key])}
                r="4"
                fill={s.color}
                stroke="var(--surface)"
                strokeWidth="2"
              />
            ))}
          </g>
        )}

        <text x={PAD.left} y={height - 5} fontSize="10" fill="var(--ink-3)">
          {dateLabel(curve[0].time)}
        </text>
        <text x={width - PAD.right} y={height - 5} fontSize="10" fill="var(--ink-3)" textAnchor="end">
          {dateLabel(finalPoint.time)}
        </text>
      </svg>

      <div className="h-4 text-[11px]" style={{ color: 'var(--ink-3)' }}>
        {point ? dateLabel(point.time) : 'Hover the chart to read any date'}
        {geometry.useLog && !point && ' · log scale'}
      </div>
    </div>
  )
}

export default function BacktestPanel({ backtest, symbol, capital, onCapitalChange, currency = 'USD' }) {
  const { strategy: s, buy_hold: b, trades_summary: t, edge, period } = backtest
  const better = edge.beat_buy_hold
  const safer = Math.abs(s.max_drawdown_pct) < Math.abs(b.max_drawdown_pct)
  const sharper = s.sharpe > b.sharpe

  return (
    <div className="flex flex-col gap-4">
      {/* The one number a person actually wants. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.07em]" style={{ color: 'var(--ink-3)' }}>
            {money(capital, { currency, digits: 0 })} in {symbol} over {period.years.toFixed(1)} years
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2.5">
            <span
              className="text-[34px] font-bold leading-none"
              style={{ color: s.total_return_pct >= 0 ? 'var(--up)' : 'var(--down)' }}
            >
              {money(s.final_value, { currency, digits: 0 })}
            </span>
            <span
              className="tnum text-[15px] font-semibold"
              style={{ color: s.total_return_pct >= 0 ? 'var(--up)' : 'var(--down)' }}
            >
              {pct(s.total_return_pct, 1)}
            </span>
          </div>
          <div className="mt-1 text-[12px]" style={{ color: 'var(--ink-2)' }}>
            Holding it the whole time gave{' '}
            <span className="tnum font-semibold" style={{ color: 'var(--ink)' }}>
              {money(b.final_value, { currency, digits: 0 })}
            </span>{' '}
            ({pct(b.total_return_pct, 1)}).
          </div>
        </div>

        <label className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--ink-3)' }}>
          Starting capital
          <select
            value={capital}
            onChange={(e) => onCapitalChange(Number(e.target.value))}
            className="rounded-lg px-2 py-1.5 text-[12px] font-semibold"
            style={{ background: 'var(--surface-2)', color: 'var(--ink)', border: '1px solid var(--line)' }}
          >
            {[1000, 5000, 10000, 25000, 50000, 100000].map((v) => (
              <option key={v} value={v}>
                {money(v, { currency, digits: 0 })}
              </option>
            ))}
          </select>
        </label>
      </div>

      <EquityCurve curve={backtest.equity_curve} capital={capital} />

      {/* Head to head. Return alone is a bad scorecard — drawdown and
          risk-adjusted return matter at least as much. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-[12px]">
          <caption className="sr-only">Strategy compared with buy and hold</caption>
          <thead>
            <tr style={{ color: 'var(--ink-3)' }}>
              <th className="pb-1.5 text-left font-semibold">Measure</th>
              <th className="pb-1.5 text-right font-semibold">Following signals</th>
              <th className="pb-1.5 text-right font-semibold">Buy &amp; hold</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {[
              ['Total return', pct(s.total_return_pct, 1), pct(b.total_return_pct, 1), better],
              ['Annualised', pct(s.cagr_pct, 1), pct(b.cagr_pct, 1), s.cagr_pct > b.cagr_pct],
              ['Worst drawdown', pctPlain(s.max_drawdown_pct, 1), pctPlain(b.max_drawdown_pct, 1), safer],
              ['Sharpe ratio', num(s.sharpe, 2), num(b.sharpe, 2), sharper],
              ['Time invested', pctPlain(s.exposure_pct, 0), '100%', null],
            ].map(([label, a, c, wins]) => (
              <tr key={label} className="border-t" style={{ borderColor: 'var(--line)' }}>
                <td className="py-1.5" style={{ color: 'var(--ink-2)' }}>
                  {label}
                </td>
                <td
                  className="py-1.5 text-right font-semibold"
                  style={{ color: wins === true ? 'var(--up)' : 'var(--ink)' }}
                >
                  {a}
                  {wins === true && <span className="ml-1 text-[10px]">✓</span>}
                </td>
                <td
                  className="py-1.5 text-right font-semibold"
                  style={{ color: wins === false ? 'var(--up)' : 'var(--ink)' }}
                >
                  {c}
                  {wins === false && <span className="ml-1 text-[10px]">✓</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Stat label="Round trips" value={t.count} sub={`${t.wins} won · ${t.losses} lost`} />
        <Stat label="Win rate" value={pctPlain(t.win_rate_pct, 0)} />
        <Stat label="Avg win / loss" value={`${pct(t.avg_win_pct, 1)} / ${pct(t.avg_loss_pct, 1)}`} />
        <Stat label="Profit factor" value={t.profit_factor == null ? '—' : num(t.profit_factor, 2)} sub="gross win ÷ gross loss" />
      </div>

      {backtest.evidence !== 'high' && (
        <p
          className="rounded-lg px-3 py-2 text-[12px] leading-relaxed"
          style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}
        >
          <strong
            className="font-semibold"
            style={{ color: backtest.evidence === 'low' ? 'var(--warn)' : 'var(--ink)' }}
          >
            {backtest.evidence === 'low' ? 'Too few trades to judge.' : 'Indicative, not proof.'}
          </strong>{' '}
          {t.count} round {t.count === 1 ? 'trip' : 'trips'} over {period.years.toFixed(1)} years
          {backtest.evidence === 'low'
            ? ' cannot separate an edge from luck. Pick a longer range — 5Y or MAX — for a result worth reading.'
            : ' is a thin sample. The direction is meaningful; the exact numbers are not.'}
        </p>
      )}

      {backtest.trades.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[12px] font-semibold" style={{ color: 'var(--ink-2)' }}>
            Trade log — last {backtest.trades.length}
          </summary>
          <div className="mt-2 max-h-60 overflow-auto">
            <table className="w-full min-w-[440px] text-[11.5px]">
              <thead className="sticky top-0" style={{ background: 'var(--surface)' }}>
                <tr style={{ color: 'var(--ink-3)' }}>
                  <th className="pb-1 text-left font-semibold">In</th>
                  <th className="pb-1 text-left font-semibold">Out</th>
                  <th className="pb-1 text-right font-semibold">Entry</th>
                  <th className="pb-1 text-right font-semibold">Exit</th>
                  <th className="pb-1 text-right font-semibold">Held</th>
                  <th className="pb-1 text-right font-semibold">Result</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {[...backtest.trades].reverse().map((trade, i) => (
                  <tr key={`${trade.entry_time}-${i}`} className="border-t" style={{ borderColor: 'var(--line)' }}>
                    <td className="py-1" style={{ color: 'var(--ink-2)' }}>{dateLabel(trade.entry_time)}</td>
                    <td className="py-1" style={{ color: 'var(--ink-2)' }}>
                      {dateLabel(trade.exit_time)}
                      {trade.exit_reason === 'stop' && (
                        <span className="ml-1 text-[10px]" style={{ color: 'var(--down)' }} title="Closed by the protective stop">
                          stopped
                        </span>
                      )}
                    </td>
                    <td className="py-1 text-right">{money(trade.entry_price, { currency })}</td>
                    <td className="py-1 text-right">{money(trade.exit_price, { currency })}</td>
                    <td className="py-1 text-right" style={{ color: 'var(--ink-3)' }}>{trade.bars_held} bars</td>
                    <td
                      className="py-1 text-right font-semibold"
                      style={{ color: trade.return_pct >= 0 ? 'var(--up)' : 'var(--down)' }}
                    >
                      {trade.return_pct >= 0 ? '▲' : '▼'} {pct(trade.return_pct, 1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
        Signals are computed from each bar's close and acted on at the next bar's open — no
        hindsight. Every fill pays {backtest.config.cost_bps} bps of commission and slippage, and
        each position carries a {backtest.config.stop_atr}× ATR stop. Even so, a backtest always
        flatters itself: it never misses a fill, panics, or changes its mind.
      </p>
    </div>
  )
}
