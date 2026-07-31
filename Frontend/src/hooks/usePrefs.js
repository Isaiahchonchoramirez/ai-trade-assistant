import { useCallback, useEffect, useState } from 'react'

/** State mirrored into localStorage, tolerant of private-mode failures. */
export function useStored(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? initial : JSON.parse(raw)
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* storage unavailable — the value still works for this session */
    }
  }, [key, value])

  return [value, setValue]
}

/** Theme, kept on <html data-theme> so the pre-paint script agrees with React. */
export function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'dark')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('ta.theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])
  return { theme, setTheme, toggle }
}

/** Colourblind-safe palette flag, on <html data-cvd>. */
export function useCvd() {
  const [cvd, setCvd] = useState(() => document.documentElement.dataset.cvd === '1')

  useEffect(() => {
    if (cvd) document.documentElement.dataset.cvd = '1'
    else delete document.documentElement.dataset.cvd
    try {
      localStorage.setItem('ta.cvd', cvd ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [cvd])

  return { cvd, toggle: useCallback(() => setCvd((v) => !v), []) }
}

/**
 * Reads a CSS custom property off :root.
 *
 * The charting library takes concrete colour strings, not `var(--x)`, so the
 * token has to be resolved in JS and re-resolved whenever the theme changes.
 */
export function useTokens(deps = []) {
  const read = useCallback(() => {
    const cs = getComputedStyle(document.documentElement)
    const get = (name) => cs.getPropertyValue(name).trim()
    return {
      ink: get('--ink'),
      ink2: get('--ink-2'),
      ink3: get('--ink-3'),
      grid: get('--grid'),
      line: get('--line'),
      surface: get('--surface'),
      up: get('--up'),
      down: get('--down'),
      accent: get('--accent'),
      bench: get('--bench'),
      neutral: get('--neutral'),
    }
  }, [])

  const [tokens, setTokens] = useState(read)
  useEffect(() => {
    setTokens(read())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return tokens
}

/** Debounce a fast-changing value (search input → network request). */
export function useDebounced(value, delay = 220) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}
