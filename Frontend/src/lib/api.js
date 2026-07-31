/** Thin API client. Requests go through the Vite proxy, so no origin config. */

import { IS_DEMO, demoApi } from './demo.js'

const BASE = '/api/v1'

class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request(path, { signal, method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      signal,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new ApiError('Cannot reach the API. Is the backend running on port 8000?', 0)
  }

  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try {
      const payload = await res.json()
      if (payload?.detail) {
        detail = typeof payload.detail === 'string' ? payload.detail : JSON.stringify(payload.detail)
      }
    } catch {
      /* non-JSON error body — the status message is all we have */
    }
    throw new ApiError(detail, res.status)
  }

  return res.json()
}

const live = {
  meta: (signal) => request('/meta', { signal }),
  search: (q, signal) => request(`/search?q=${encodeURIComponent(q)}`, { signal }),
  quote: (symbol, signal) => request(`/quote/${encodeURIComponent(symbol)}`, { signal }),
  news: (symbol, signal) => request(`/news/${encodeURIComponent(symbol)}?limit=6`, { signal }),
  overview: (signal) => request('/market/overview', { signal }),
  watchlist: (symbols, signal) =>
    request(`/watchlist?symbols=${encodeURIComponent(symbols.join(','))}`, { signal }),
  analysis: (symbol, range, capital, signal) =>
    request(
      `/analysis/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&capital=${capital}`,
      { signal },
    ),
  chat: (payload, signal) => request('/chat', { method: 'POST', body: payload, signal }),
}

/**
 * In a static build there is no backend to reach, so calls resolve from a
 * frozen snapshot of real engine output instead. Same signatures either way,
 * so nothing above this line knows the difference.
 */
const demo = {
  meta: () => demoApi.meta(),
  search: (q) => demoApi.search(q),
  quote: (symbol) => demoApi.quote(symbol),
  news: (symbol) => demoApi.news(symbol),
  overview: () => demoApi.overview(),
  watchlist: () => demoApi.watchlist(),
  analysis: (symbol, range, capital) => demoApi.analysis(symbol, range, capital),
  chat: (payload) => demoApi.chat(payload),
}

export const api = IS_DEMO ? demo : live

export { ApiError, IS_DEMO }
