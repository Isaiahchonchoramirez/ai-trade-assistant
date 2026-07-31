import { ACTION_LABEL, ACTION_SHORT, actionColor, money, pct } from '../lib/format.js'
import { Sparkline, SkeletonRows } from './Primitives.jsx'

/** One row per symbol: price, day move, 3-month shape, and the current call. */
export default function Watchlist({ items, loading, active, onSelect, onRemove }) {
  if (loading && !items.length) return <SkeletonRows rows={6} height={44} />

  if (!items.length) {
    return (
      <p className="px-1 py-6 text-center text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
        Nothing here yet. Search for a symbol and star it to follow along.
      </p>
    )
  }

  return (
    <ul className="flex flex-col">
      {items.map((item) => {
        const isActive = item.symbol === active
        const up = (item.change_pct ?? 0) >= 0
        return (
          <li key={item.symbol} className="group relative">
            <button
              type="button"
              onClick={() => onSelect(item.symbol)}
              aria-current={isActive ? 'true' : undefined}
              className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left transition-colors"
              style={{ background: isActive ? 'var(--accent-wash)' : 'transparent' }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.background = 'var(--surface-2)'
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.background = 'transparent'
              }}
            >
              {/* The symbol never truncates — it is the row's identity. The
                  badge shrinks first, then the company name. */}
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="shrink-0 text-[13px] font-bold" style={{ color: 'var(--ink)' }}>
                    {item.symbol}
                  </span>
                  {item.action && (
                    <span
                      className="min-w-0 truncate rounded px-1 py-px text-[9.5px] font-bold uppercase tracking-wide"
                      style={{ color: actionColor(item.action), background: 'var(--surface-2)' }}
                      title={`${ACTION_LABEL[item.action]} — composite ${item.composite}, ${item.confidence}% confidence`}
                    >
                      {ACTION_SHORT[item.action]}
                    </span>
                  )}
                </span>
                <span className="block truncate text-[11px]" style={{ color: 'var(--ink-3)' }}>
                  {item.name}
                </span>
              </span>

              <Sparkline values={item.sparkline} width={46} height={22} />

              <span className="shrink-0 text-right">
                <span className="tnum block text-[12.5px] font-semibold" style={{ color: 'var(--ink)' }}>
                  {money(item.price, { currency: item.currency })}
                </span>
                <span
                  className="tnum block text-[11px] font-semibold"
                  style={{ color: up ? 'var(--up)' : 'var(--down)' }}
                >
                  <span aria-hidden="true">{up ? '▲' : '▼'}</span> {pct(item.change_pct, 2)}
                </span>
              </span>
            </button>

            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(item.symbol)}
                aria-label={`Remove ${item.symbol} from the watchlist`}
                className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded text-[13px] leading-none group-hover:flex focus-visible:flex"
                style={{ background: 'var(--surface-3)', color: 'var(--ink-3)' }}
              >
                ×
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
