import { useId } from 'react'
import { direction, num, pct } from '../lib/format.js'

/**
 * A signed change. The arrow and the sign carry direction; colour only
 * reinforces it — which is what keeps this readable with green/red vision
 * deficiency.
 */
export function Delta({ value, digits = 2, size = 'md', showArrow = true, suffix = '%' }) {
  const dir = direction(value)
  const sizes = { sm: 'text-[11px]', md: 'text-[13px]', lg: 'text-[15px]' }
  return (
    <span
      className={`tnum inline-flex items-center gap-1 font-semibold ${sizes[size]}`}
      style={{ color: dir.color }}
    >
      {showArrow && (
        <span aria-hidden="true" className="text-[0.85em] leading-none">
          {dir.arrow}
        </span>
      )}
      <span>
        {suffix === '%' ? pct(value, digits) : `${value >= 0 ? '+' : '−'}${num(Math.abs(value), digits)}`}
      </span>
      <span className="sr-only">{dir.word}</span>
    </span>
  )
}

/** A minimal trend line — no axes, no ticks; it exists to show shape only. */
export function Sparkline({ values, width = 84, height = 26, strokeWidth = 1.75 }) {
  const gradientId = useId()
  if (!values || values.length < 2) {
    return <div style={{ width, height }} aria-hidden="true" />
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const stepX = width / (values.length - 1)
  // Inset vertically so the 2px stroke is never clipped at the extremes.
  const pad = strokeWidth
  const y = (v) => pad + (1 - (v - min) / span) * (height - pad * 2)

  const points = values.map((v, i) => `${(i * stepX).toFixed(2)},${y(v).toFixed(2)}`)
  const line = `M${points.join(' L')}`
  const area = `${line} L${width},${height} L0,${height} Z`
  const rising = values[values.length - 1] >= values[0]
  const color = rising ? 'var(--up)' : 'var(--down)'

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Trend ${rising ? 'rising' : 'falling'} over the period`}
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * Confidence arc. A single magnitude, so the number is the headline and the
 * arc is the supporting mark — never the other way round.
 */
export function ConfidenceArc({ value = 0, color = 'var(--accent)', size = 132, label = 'Confidence' }) {
  const stroke = 9
  const r = (size - stroke) / 2
  const cx = size / 2
  const cy = size / 2
  // 270° sweep starting bottom-left, so the gap sits under the figure.
  const sweep = 270
  const start = 135
  const toXY = (deg) => {
    const rad = ((deg - 90) * Math.PI) / 180
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
  }
  const arcPath = (fromDeg, toDeg) => {
    const [x1, y1] = toXY(fromDeg)
    const [x2, y2] = toXY(toDeg)
    const large = toDeg - fromDeg > 180 ? 1 : 0
    return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`
  }

  const clamped = Math.max(0, Math.min(100, value))
  const end = start + (sweep * clamped) / 100

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`${label} ${Math.round(clamped)} out of 100`}>
        <path d={arcPath(start, start + sweep)} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} strokeLinecap="round" />
        {clamped > 0.5 && (
          <path
            d={arcPath(start, end)}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            style={{ transition: 'd 0.4s var(--ease-out-soft)' }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[30px] font-bold leading-none" style={{ color: 'var(--ink)' }}>
          {Math.round(clamped)}
          <span className="text-[15px] font-semibold" style={{ color: 'var(--ink-3)' }}>
            %
          </span>
        </div>
        <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.09em]" style={{ color: 'var(--ink-3)' }}>
          {label}
        </div>
      </div>
    </div>
  )
}

/** A labelled figure. Used across the signal, backtest and quote panels. */
export function Stat({ label, value, sub, color, title, align = 'left' }) {
  return (
    <div title={title} className={align === 'right' ? 'text-right' : ''}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.07em]" style={{ color: 'var(--ink-3)' }}>
        {label}
      </div>
      <div className="tnum mt-0.5 text-[15px] font-semibold leading-tight" style={{ color: color || 'var(--ink)' }}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-[11px] leading-tight" style={{ color: 'var(--ink-3)' }}>
          {sub}
        </div>
      )}
    </div>
  )
}

export function Chip({ children, color, wash, title }) {
  return (
    <span
      className="chip"
      title={title}
      style={{ color: color || 'var(--ink-2)', background: wash || 'var(--surface-2)', borderColor: 'var(--line)' }}
    >
      {children}
    </span>
  )
}

export function CardShell({ title, action, children, className = '', bodyClass = 'p-4' }) {
  return (
    <section className={`card overflow-hidden ${className}`}>
      {(title || action) && (
        <header className="card-head">
          <h2 className="card-title">{title}</h2>
          {action}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  )
}

export function Spinner({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.22" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function ErrorNote({ message, onRetry }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] px-3.5 py-3 text-[13px]"
      style={{ background: 'var(--down-wash)', color: 'var(--ink)', border: '1px solid var(--line)' }}
    >
      <span>
        <strong className="font-semibold">Couldn’t load. </strong>
        {message}
      </span>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function SkeletonRows({ rows = 5, height = 34 }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height, opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  )
}
