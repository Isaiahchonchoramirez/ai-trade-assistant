import { useState } from 'react'
import { ACTION_LABEL, ACTION_VERB, actionColor, actionWash, money, num } from '../lib/format.js'
import { ConfidenceArc, Stat } from './Primitives.jsx'

/** Composite thresholds, mirroring signals.py so the scale reads the same. */
const STRONG = 45
const MILD = 18

/**
 * Where the composite score sits on the −100…+100 scale, with the action
 * bands drawn in. Position along the track carries the meaning; colour is
 * redundant reinforcement.
 */
function CompositeScale({ score }) {
  const toPct = (v) => ((v + 100) / 200) * 100
  const bands = [
    { from: -100, to: -STRONG, color: 'var(--down)', opacity: 0.34 },
    { from: -STRONG, to: -MILD, color: 'var(--down)', opacity: 0.16 },
    { from: -MILD, to: MILD, color: 'var(--neutral)', opacity: 0.14 },
    { from: MILD, to: STRONG, color: 'var(--up)', opacity: 0.16 },
    { from: STRONG, to: 100, color: 'var(--up)', opacity: 0.34 },
  ]
  const pos = Math.max(0, Math.min(100, toPct(score)))

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.07em]" style={{ color: 'var(--ink-3)' }}>
          Composite score
        </span>
        <span className="tnum text-[13px] font-bold" style={{ color: actionColor(scoreAction(score)) }}>
          {score >= 0 ? '+' : '−'}
          {Math.abs(score).toFixed(0)}
        </span>
      </div>

      <div
        className="relative h-2.5 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={`Composite score ${score.toFixed(0)} on a scale from minus 100 to plus 100`}
      >
        {bands.map((b) => (
          <span
            key={b.from}
            className="absolute inset-y-0"
            style={{
              left: `${toPct(b.from)}%`,
              width: `${toPct(b.to) - toPct(b.from)}%`,
              background: b.color,
              opacity: b.opacity,
            }}
          />
        ))}
        {/* 2px surface ring keeps the marker legible over any band. */}
        <span
          className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${pos}%`,
            background: 'var(--ink)',
            boxShadow: '0 0 0 2px var(--surface)',
            transition: 'left 0.4s var(--ease-out-soft)',
          }}
        />
      </div>

      <div className="mt-1 flex justify-between text-[10px]" style={{ color: 'var(--ink-3)' }}>
        <span>−100 sell</span>
        <span>0 neutral</span>
        <span>+100 buy</span>
      </div>
    </div>
  )
}

function scoreAction(score) {
  if (score >= STRONG) return 'STRONG_BUY'
  if (score >= MILD) return 'BUY'
  if (score <= -STRONG) return 'STRONG_SELL'
  if (score <= -MILD) return 'SELL'
  return 'HOLD'
}

/**
 * Diverging bars, one per factor, sorted by influence. Bars grow left or
 * right from a shared zero line — position carries the sign, so this stays
 * readable without colour.
 */
export function FactorBars({ factors, weights }) {
  const [open, setOpen] = useState(null)
  const maxWeight = Math.max(...Object.values(weights || {}), 22)

  return (
    <ul className="flex flex-col gap-0.5">
      {factors.map((f) => {
        const magnitude = (Math.abs(f.contribution) / maxWeight) * 50
        const positive = f.contribution >= 0
        const color = f.stance === 'bullish' ? 'var(--up)' : f.stance === 'bearish' ? 'var(--down)' : 'var(--neutral)'
        const isOpen = open === f.key

        return (
          <li key={f.key}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : f.key)}
              aria-expanded={isOpen}
              className="group grid w-full grid-cols-[minmax(0,1fr)_128px_54px] items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--surface-2)]"
            >
              <span className="truncate text-[12px] font-medium" style={{ color: 'var(--ink-2)' }}>
                {f.label}
              </span>

              <span className="relative block h-3.5" aria-hidden="true">
                <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2" style={{ background: 'var(--line-strong)' }} />
                <span
                  className="absolute top-1/2 h-2 -translate-y-1/2"
                  style={{
                    left: positive ? '50%' : `${50 - magnitude}%`,
                    width: `${Math.max(magnitude, 0.8)}%`,
                    background: color,
                    // 4px rounded data-end; the zero-line end stays square.
                    borderRadius: positive ? '0 4px 4px 0' : '4px 0 0 4px',
                  }}
                />
              </span>

              <span className="tnum text-right text-[12px] font-semibold" style={{ color }}>
                {f.contribution >= 0 ? '+' : '−'}
                {Math.abs(f.contribution).toFixed(1)}
              </span>
            </button>

            {isOpen && (
              <p
                className="mx-2 mb-1.5 rounded-lg px-2.5 py-2 text-[12px] leading-relaxed"
                style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}
              >
                {f.reason}
                <span className="mt-1 block text-[11px]" style={{ color: 'var(--ink-3)' }}>
                  Weight {f.weight.toFixed(0)} of 100 · scored {f.score >= 0 ? '+' : '−'}
                  {Math.abs(f.score).toFixed(2)} of a possible 1.00
                </span>
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default function SignalPanel({ signal, weights, currency = 'USD' }) {
  const color = actionColor(signal.action)
  const wash = actionWash(signal.action)
  const lv = signal.levels
  const riskPct = lv.entry ? (lv.risk_per_share / lv.entry) * 100 : 0

  return (
    <div className="flex flex-col gap-4">
      {/* Headline: what to do, how sure, and why — in that order. */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl p-4" style={{ background: wash }}>
        <ConfidenceArc value={signal.confidence} color={color} size={124} />

        <div className="min-w-[190px] flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.09em]" style={{ color: 'var(--ink-3)' }}>
            {signal.regime}
          </div>
          <div className="mt-0.5 text-[27px] font-bold leading-tight" style={{ color }}>
            {ACTION_VERB[signal.action]}
          </div>
          <div className="text-[13px] font-semibold" style={{ color: 'var(--ink-2)' }}>
            Signal: {ACTION_LABEL[signal.action]}
          </div>
          <p className="mt-2 text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            {signal.headline}
          </p>
        </div>
      </div>

      <CompositeScale score={signal.composite} />

      {/* The plan, if you acted on it. */}
      <div>
        <h3 className="card-title mb-2">If you took this trade</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Stat label="Entry" value={money(lv.entry, { currency })} sub="last close" />
          <Stat
            label="Stop"
            value={money(lv.stop, { currency })}
            sub={`${riskPct.toFixed(1)}% away`}
            color="var(--down)"
          />
          <Stat
            label="Target 1"
            value={money(lv.targets[0], { currency })}
            sub="1.5× risk"
            color="var(--up)"
          />
          <Stat
            label="Target 2"
            value={money(lv.targets[1], { currency })}
            sub="2.5× risk"
            color="var(--up)"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px]" style={{ color: 'var(--ink-3)' }}>
          <span>
            Risk per share <span className="tnum font-semibold" style={{ color: 'var(--ink-2)' }}>{money(lv.risk_per_share, { currency })}</span>
          </span>
          {lv.support?.length > 0 && (
            <span>
              Support{' '}
              <span className="tnum font-semibold" style={{ color: 'var(--ink-2)' }}>
                {lv.support.map((s) => money(s, { currency })).join(' · ')}
              </span>
            </span>
          )}
          {lv.resistance?.length > 0 && (
            <span>
              Resistance{' '}
              <span className="tnum font-semibold" style={{ color: 'var(--ink-2)' }}>
                {lv.resistance.map((r) => money(r, { currency })).join(' · ')}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Every input to the score, largest influence first. */}
      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <h3 className="card-title">Why — all seven factors</h3>
          <span className="text-[10px]" style={{ color: 'var(--ink-3)' }}>
            tap a row for detail
          </span>
        </div>
        <FactorBars factors={signal.factors} weights={weights} />
      </div>

      {/* Raw readings, for anyone who wants to check the maths. */}
      <div>
        <h3 className="card-title mb-2">Indicator readings</h3>
        <div className="grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Stat label="RSI (14)" value={num(signal.snapshot.rsi, 1)} />
          <Stat label="MACD hist" value={num(signal.snapshot.macd_hist, 3)} />
          <Stat label="ADX (14)" value={num(signal.snapshot.adx, 1)} />
          <Stat label="ATR" value={money(signal.snapshot.atr, { currency })} sub={`${num(signal.snapshot.atr_pct, 1)}% of price`} />
          <Stat label="Volatility" value={`${num(signal.snapshot.volatility, 0)}%`} sub="annualised" />
          <Stat label="Money flow" value={num(signal.snapshot.mfi, 1)} />
          <Stat label="Rel. volume" value={`${num(signal.snapshot.vol_ratio, 2)}×`} sub="vs 20-bar avg" />
          <Stat label="Band position" value={`${num((signal.snapshot.bb_pct ?? 0) * 100, 0)}%`} sub="of Bollinger range" />
        </div>
      </div>
    </div>
  )
}
