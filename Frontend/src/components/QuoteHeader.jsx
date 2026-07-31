import { compact, money, moneyCompact, num, pct } from '../lib/format.js'

/** Where the price sits inside its 52-week range. */
function RangeBar({ low, high, price }) {
  if (low == null || high == null || price == null || high <= low) return null
  const position = Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100))

  return (
    <div className="min-w-[168px] flex-1">
      <div className="mb-1 flex justify-between text-[10px]" style={{ color: 'var(--ink-3)' }}>
        <span>52-week range</span>
        <span className="tnum">{position.toFixed(0)}% of range</span>
      </div>
      <div className="relative h-1.5 rounded-full" style={{ background: 'var(--surface-3)' }}>
        <span
          className="absolute top-1/2 h-3 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${position}%`, background: 'var(--ink)', boxShadow: '0 0 0 2px var(--surface)' }}
        />
      </div>
      <div className="tnum mt-1 flex justify-between text-[10.5px]" style={{ color: 'var(--ink-3)' }}>
        <span>{money(low)}</span>
        <span>{money(high)}</span>
      </div>
    </div>
  )
}

export default function QuoteHeader({ quote, symbol, isSaved, onToggleSave }) {
  const change = quote?.change_pct ?? 0
  const up = change >= 0
  const currency = quote?.currency || 'USD'

  const facts = [
    quote?.market_cap && ['Market cap', moneyCompact(quote.market_cap)],
    quote?.pe_ratio && ['P/E', num(quote.pe_ratio, 1)],
    quote?.volume && ['Volume', compact(quote.volume)],
    quote?.avg_volume && ['Avg volume', compact(quote.avg_volume)],
    quote?.beta && ['Beta', num(quote.beta, 2)],
  ].filter(Boolean)

  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[24px] font-bold leading-none" style={{ color: 'var(--ink)' }}>
            {symbol}
          </h1>
          <button
            type="button"
            onClick={onToggleSave}
            aria-pressed={isSaved}
            aria-label={isSaved ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
            title={isSaved ? 'Remove from watchlist' : 'Add to watchlist'}
            className="text-[15px] leading-none transition-transform hover:scale-110"
            style={{ color: isSaved ? 'var(--warn)' : 'var(--ink-3)' }}
          >
            {isSaved ? '★' : '☆'}
          </button>
          {quote?.sector && (
            <span
              className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
              style={{ background: 'var(--surface-2)', color: 'var(--ink-3)' }}
            >
              {quote.sector}
            </span>
          )}
          {quote?.market_state && quote.market_state !== 'REGULAR' && (
            <span
              className="rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase"
              style={{ background: 'var(--surface-2)', color: 'var(--ink-3)' }}
              title="The market is not in its regular session right now"
            >
              {quote.market_state.toLowerCase()}
            </span>
          )}
        </div>

        <p className="mt-0.5 truncate text-[13px]" style={{ color: 'var(--ink-3)' }}>
          {quote?.name || '—'}
          {quote?.exchange ? ` · ${quote.exchange}` : ''}
        </p>

        <div className="mt-2.5 flex flex-wrap items-baseline gap-3">
          <span className="text-[32px] font-bold leading-none" style={{ color: 'var(--ink)' }}>
            {money(quote?.price, { currency })}
          </span>
          <span
            className="tnum inline-flex items-baseline gap-1.5 text-[15px] font-semibold"
            style={{ color: up ? 'var(--up)' : 'var(--down)' }}
          >
            <span aria-hidden="true">{up ? '▲' : '▼'}</span>
            {money(Math.abs(quote?.change ?? 0), { currency })}
            <span>({pct(change, 2)})</span>
            <span className="sr-only">{up ? 'up' : 'down'} today</span>
          </span>
        </div>
      </div>

      <div className="flex min-w-[220px] flex-1 flex-col items-end gap-3">
        <RangeBar low={quote?.week52_low} high={quote?.week52_high} price={quote?.price} />
        {facts.length > 0 && (
          <dl className="flex flex-wrap justify-end gap-x-5 gap-y-1 text-[11.5px]">
            {facts.map(([label, value]) => (
              <div key={label} className="text-right">
                <dt className="text-[10px]" style={{ color: 'var(--ink-3)' }}>
                  {label}
                </dt>
                <dd className="tnum font-semibold" style={{ color: 'var(--ink-2)' }}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  )
}
