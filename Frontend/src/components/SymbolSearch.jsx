import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { useDebounced } from '../hooks/usePrefs.js'
import { Spinner } from './Primitives.jsx'

/** Combobox over the symbol universe. Full keyboard control, debounced fetch. */
export default function SymbolSearch({ onSelect, placeholder = 'Search any symbol…' }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const debounced = useDebounced(query, 200)

  // "/" focuses search from anywhere, the way every trading terminal does.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onClickAway = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [])

  useEffect(() => {
    const term = debounced.trim()
    if (term.length < 1) {
      setResults([])
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    api
      .search(term, controller.signal)
      .then((data) => {
        setResults(data.results || [])
        setActive(0)
        setOpen(true)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setResults([])
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [debounced])

  const choose = (symbol) => {
    if (!symbol) return
    onSelect(symbol.toUpperCase())
    setQuery('')
    setResults([])
    setOpen(false)
    inputRef.current?.blur()
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[active]?.symbol || query.trim())
      return
    }
    if (!results.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + results.length) % results.length)
    }
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--ink-3)"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>

        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls="symbol-results"
          aria-autocomplete="list"
          aria-label="Search for a symbol"
          value={query}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={onKeyDown}
          className="w-full rounded-[10px] py-2 pl-9 pr-16 text-[13px] outline-none transition-colors"
          style={{ background: 'var(--surface-2)', color: 'var(--ink)', border: '1px solid var(--line)' }}
        />

        <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
          {loading && <span style={{ color: 'var(--ink-3)' }}><Spinner size={13} /></span>}
          {!query && (
            <kbd
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
              style={{ background: 'var(--surface-3)', color: 'var(--ink-3)' }}
            >
              /
            </kbd>
          )}
        </div>
      </div>

      {open && results.length > 0 && (
        <ul
          id="symbol-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-40 mt-1.5 max-h-72 overflow-auto rounded-[12px] py-1"
          style={{ background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-pop)' }}
        >
          {results.map((r, i) => (
            <li key={`${r.symbol}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r.symbol)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                style={{ background: i === active ? 'var(--surface-2)' : 'transparent' }}
              >
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                    {r.symbol}
                  </span>
                  <span className="block truncate text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
                    {r.name}
                  </span>
                </span>
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ background: 'var(--surface-3)', color: 'var(--ink-3)' }}
                >
                  {r.exchange || r.type}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
