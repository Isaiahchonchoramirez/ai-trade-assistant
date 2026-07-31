import { SkeletonRows } from './Primitives.jsx'

function timeAgo(published) {
  if (!published) return null
  const then = typeof published === 'number' ? published * 1000 : Date.parse(published)
  if (Number.isNaN(then)) return null
  const mins = Math.round((Date.now() - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export default function NewsList({ items, loading }) {
  if (loading && !items?.length) return <SkeletonRows rows={4} height={38} />

  if (!items?.length) {
    return (
      <p className="py-4 text-center text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
        No recent headlines for this symbol.
      </p>
    )
  }

  return (
    <ul className="flex flex-col">
      {items.map((item, i) => {
        const when = timeAgo(item.published)
        return (
          <li key={i} className="border-b last:border-0" style={{ borderColor: 'var(--line)' }}>
            <a
              href={item.url || '#'}
              target="_blank"
              rel="noreferrer noopener"
              className="block px-1 py-2.5 transition-colors hover:bg-[var(--surface-2)]"
            >
              <p className="text-[12.5px] font-medium leading-snug" style={{ color: 'var(--ink)' }}>
                {item.title}
              </p>
              <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-3)' }}>
                {item.publisher}
                {when ? ` · ${when}` : ''}
              </p>
            </a>
          </li>
        )
      })}
    </ul>
  )
}
