import { money, pct } from '../lib/format.js'
import { Sparkline, SkeletonRows } from './Primitives.jsx'

/**
 * Sector performance as a diverging heatmap.
 *
 * Hue carries the sign, intensity carries the magnitude, and every cell prints
 * its own number — so nothing here depends on telling green from red. Cells
 * near zero deliberately fade into the surface: that is what "no move" should
 * look like.
 */
function SectorGrid({ sectors, onSelect }) {
  const strongest = Math.max(...sectors.map((s) => Math.abs(s.change_pct ?? 0)), 1)

  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-5">
      {sectors.map((s) => {
        const change = s.change_pct ?? 0
        const intensity = Math.min(Math.abs(change) / strongest, 1)
        const mix = Math.round(12 + intensity * 68)
        const pole = change >= 0 ? 'var(--up)' : 'var(--down)'

        return (
          <button
            key={s.symbol}
            type="button"
            onClick={() => onSelect(s.symbol)}
            title={`${s.name} (${s.symbol}) ${pct(change)} today`}
            className="rounded-[10px] p-2.5 text-left transition-transform hover:scale-[1.02]"
            style={{
              // The cell is a tint of the surface, so the theme's own maximum
              // contrast ink is always the readable choice — a fixed white
              // would fail on light mode's pale tints.
              background: `color-mix(in oklab, ${pole} ${mix}%, var(--surface))`,
              border: '1px solid var(--line)',
              color: 'var(--ink)',
            }}
          >
            <div className="truncate text-[11px] font-semibold opacity-80">{s.name}</div>
            <div className="tnum mt-0.5 text-[15px] font-bold leading-none">
              <span aria-hidden="true" className="text-[0.7em]">
                {change >= 0 ? '▲' : '▼'}
              </span>{' '}
              {pct(change, 2)}
            </div>
          </button>
        )
      })}
    </div>
  )
}

export default function MarketRail({ overview, loading, onSelect }) {
  if (loading && !overview) {
    return (
      <div className="flex flex-col gap-3">
        <SkeletonRows rows={2} height={54} />
      </div>
    )
  }
  if (!overview) return null

  const { indices, sectors, breadth } = overview
  const toneColor =
    breadth.tone === 'bullish' ? 'var(--up)' : breadth.tone === 'bearish' ? 'var(--down)' : 'var(--neutral)'

  return (
    <div className="flex flex-col gap-4">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]" style={{ color: 'var(--ink-2)' }}>
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: toneColor }}
        />
        <span className="font-semibold uppercase tracking-wide" style={{ color: toneColor }}>
          {breadth.tone}
        </span>
        <span>{breadth.headline}</span>
        <span style={{ color: 'var(--ink-3)' }}>
          {breadth.sectors_advancing} of {breadth.sectors_total} sectors advancing.
        </span>
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {indices.map((idx) => {
          const up = (idx.change_pct ?? 0) >= 0
          return (
            <button
              key={idx.symbol}
              type="button"
              onClick={() => onSelect(idx.symbol)}
              className="rounded-[10px] p-2.5 text-left transition-colors"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--line)' }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-semibold" style={{ color: 'var(--ink-3)' }}>
                    {idx.name}
                  </div>
                  <div className="tnum mt-0.5 text-[15px] font-bold" style={{ color: 'var(--ink)' }}>
                    {money(idx.price, { digits: 2 })}
                  </div>
                  <div
                    className="tnum text-[11.5px] font-semibold"
                    style={{ color: up ? 'var(--up)' : 'var(--down)' }}
                  >
                    <span aria-hidden="true">{up ? '▲' : '▼'}</span> {pct(idx.change_pct, 2)}
                  </div>
                </div>
                <Sparkline values={idx.sparkline} width={44} height={30} />
              </div>
            </button>
          )
        })}
      </div>

      <div>
        <h3 className="card-title mb-2">Sector rotation — today</h3>
        <SectorGrid sectors={sectors} onSelect={onSelect} />
      </div>
    </div>
  )
}
