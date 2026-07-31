/** Display formatting. Every number the user reads passes through here. */

const currency = (code = 'USD', digits = 2) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })

export function money(value, { currency: code = 'USD', digits } = {}) {
  if (value == null || Number.isNaN(value)) return '—'
  const abs = Math.abs(value)
  // Sub-dollar instruments need more places or they all read as $0.00.
  const dp = digits ?? (abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6)
  try {
    return currency(code, dp).format(value)
  } catch {
    return `$${value.toFixed(dp)}`
  }
}

export function num(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** Percent with an explicit sign — the sign is what carries direction, not colour. */
export function pct(value, digits = 2) {
  if (value == null || Number.isNaN(value)) return '—'
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}%`
}

export function pctPlain(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return '—'
  return `${value.toFixed(digits)}%`
}

export function compact(value) {
  if (value == null || Number.isNaN(value)) return '—'
  const abs = Math.abs(value)
  const unit = abs >= 1e12 ? ['T', 1e12] : abs >= 1e9 ? ['B', 1e9] : abs >= 1e6 ? ['M', 1e6] : abs >= 1e3 ? ['K', 1e3] : null
  if (!unit) return value.toLocaleString(undefined, { maximumFractionDigits: 0 })
  return `${(value / unit[1]).toFixed(abs / unit[1] >= 100 ? 0 : 1)}${unit[0]}`
}

export function moneyCompact(value) {
  if (value == null || Number.isNaN(value)) return '—'
  return `$${compact(value)}`
}

export function dateLabel(seconds, { withTime = false } = {}) {
  if (seconds == null) return '—'
  const d = new Date(seconds * 1000)
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  })
}

/** Direction as a word and a glyph, so colour is never the only signal. */
export function direction(value) {
  if (value == null || Number.isNaN(value) || value === 0) {
    return { key: 'flat', arrow: '→', word: 'flat', color: 'var(--neutral)' }
  }
  return value > 0
    ? { key: 'up', arrow: '▲', word: 'up', color: 'var(--up)' }
    : { key: 'down', arrow: '▼', word: 'down', color: 'var(--down)' }
}

export const ACTION_LABEL = {
  STRONG_BUY: 'Strong Buy',
  BUY: 'Buy',
  HOLD: 'Hold',
  SELL: 'Sell',
  STRONG_SELL: 'Strong Sell',
}

/** Abbreviated form for tight rows, where the symbol must not be truncated. */
export const ACTION_SHORT = {
  STRONG_BUY: 'S·BUY',
  BUY: 'BUY',
  HOLD: 'HOLD',
  SELL: 'SELL',
  STRONG_SELL: 'S·SELL',
}

/** Actions map onto the same up/down poles, so the CVD swap covers them too. */
export function actionColor(action) {
  switch (action) {
    case 'STRONG_BUY':
    case 'BUY':
      return 'var(--up)'
    case 'STRONG_SELL':
    case 'SELL':
      return 'var(--down)'
    default:
      return 'var(--neutral)'
  }
}

export function actionWash(action) {
  switch (action) {
    case 'STRONG_BUY':
    case 'BUY':
      return 'var(--up-wash)'
    case 'STRONG_SELL':
    case 'SELL':
      return 'var(--down-wash)'
    default:
      return 'var(--surface-2)'
  }
}

/** A verb for the action — what you would actually *do*. */
export const ACTION_VERB = {
  STRONG_BUY: 'Money in',
  BUY: 'Money in',
  HOLD: 'Stay put',
  SELL: 'Money out',
  STRONG_SELL: 'Money out',
}
