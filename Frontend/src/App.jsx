import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './lib/api.js'
import { useCvd, useStored, useTheme } from './hooks/usePrefs.js'
import { ACTION_LABEL, ACTION_VERB, actionColor } from './lib/format.js'
import { CardShell, ErrorNote, SkeletonRows, Spinner } from './components/Primitives.jsx'
import SymbolSearch from './components/SymbolSearch.jsx'
import Watchlist from './components/Watchlist.jsx'
import MarketRail from './components/MarketRail.jsx'
import QuoteHeader from './components/QuoteHeader.jsx'
import PriceChart from './components/PriceChart.jsx'
import SignalPanel from './components/SignalPanel.jsx'
import BacktestPanel from './components/BacktestPanel.jsx'
import Assistant from './components/Assistant.jsx'
import NewsList from './components/NewsList.jsx'

const RANGES = ['1D', '5D', '1M', '3M', '6M', '1Y', '5Y', 'MAX']
const REFRESH_MS = 30_000

export default function App() {
  const { theme, toggle: toggleTheme } = useTheme()
  const { cvd, toggle: toggleCvd } = useCvd()

  const [symbol, setSymbol] = useStored('ta.symbol', 'AAPL')
  const [range, setRange] = useStored('ta.range', '6M')
  const [capital, setCapital] = useStored('ta.capital', 10000)
  const [saved, setSaved] = useStored('ta.watchlist', [
    'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'TSLA', 'SPY', 'BTC-USD',
  ])
  const [live, setLive] = useStored('ta.live', false)
  const [tab, setTab] = useState('signal')

  const [meta, setMeta] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [analysisError, setAnalysisError] = useState(null)
  const [loadingAnalysis, setLoadingAnalysis] = useState(true)
  const [overview, setOverview] = useState(null)
  const [rows, setRows] = useState([])
  const [loadingRows, setLoadingRows] = useState(true)
  const [news, setNews] = useState([])
  const [loadingNews, setLoadingNews] = useState(true)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  // ---- Static metadata, once. ----
  useEffect(() => {
    const controller = new AbortController()
    api.meta(controller.signal).then(setMeta).catch(() => {})
    return () => controller.abort()
  }, [])

  // ---- The main payload: candles, signal and backtest for the current view. ----
  useEffect(() => {
    const controller = new AbortController()
    setLoadingAnalysis(true)
    setAnalysisError(null)

    api
      .analysis(symbol, range, capital, controller.signal)
      .then((data) => {
        setAnalysis(data)
        setUpdatedAt(new Date())
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setAnalysisError(err.message)
        setAnalysis(null)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingAnalysis(false)
      })

    return () => controller.abort()
  }, [symbol, range, capital, nonce])

  // ---- Side panels. A failure here must not blank the page. ----
  useEffect(() => {
    const controller = new AbortController()
    api.overview(controller.signal).then(setOverview).catch(() => {})
    return () => controller.abort()
  }, [nonce])

  useEffect(() => {
    const controller = new AbortController()
    setNews([])
    setLoadingNews(true)
    api
      .news(symbol, controller.signal)
      .then((data) => setNews(data.items || []))
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoadingNews(false)
      })
    return () => controller.abort()
  }, [symbol])

  useEffect(() => {
    if (!saved.length) {
      setRows([])
      setLoadingRows(false)
      return
    }
    const controller = new AbortController()
    setLoadingRows(true)
    api
      .watchlist(saved, controller.signal)
      .then((data) => setRows(data.items || []))
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoadingRows(false)
      })
    return () => controller.abort()
  }, [saved, nonce])

  // ---- Live polling, paused while the tab is hidden so it costs nothing in
  // the background. ----
  const liveRef = useRef(live)
  liveRef.current = live
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => {
      if (liveRef.current && document.visibilityState === 'visible') refresh()
    }, REFRESH_MS)
    return () => clearInterval(id)
  }, [live, refresh])

  // ---- Range hotkeys, 1 through 8. ----
  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const index = Number(e.key) - 1
      if (index >= 0 && index < RANGES.length) setRange(RANGES[index])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setRange])

  const isSaved = saved.includes(symbol)
  const toggleSaved = useCallback(() => {
    setSaved((list) => (list.includes(symbol) ? list.filter((s) => s !== symbol) : [...list, symbol]))
  }, [symbol, setSaved])

  const pick = useCallback(
    (next) => {
      setSymbol(next)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    },
    [setSymbol],
  )

  const signal = analysis?.signal
  const currency = analysis?.quote?.currency || 'USD'

  return (
    <div className="min-h-screen">
      <header
        className="sticky top-0 z-30 border-b backdrop-blur"
        style={{ background: 'var(--overlay)', borderColor: 'var(--line)' }}
      >
        <div className="mx-auto flex max-w-[1560px] flex-wrap items-center gap-3 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span
              className="grid h-7 w-7 place-items-center rounded-lg text-[13px] font-bold"
              style={{ background: 'var(--up)', color: '#fff' }}
              aria-hidden="true"
            >
              ↗
            </span>
            <span className="text-[14px] font-bold tracking-tight" style={{ color: 'var(--ink)' }}>
              Trade Assistant
            </span>
          </div>

          <div className="order-last w-full min-w-0 sm:order-none sm:w-auto sm:max-w-md sm:flex-1">
            <SymbolSearch onSelect={pick} />
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setLive((v) => !v)}
              aria-pressed={live}
              className="btn"
              title={live ? `Refreshing every ${REFRESH_MS / 1000}s` : 'Turn on auto-refresh'}
              style={live ? { color: 'var(--up)', borderColor: 'var(--up)' } : undefined}
            >
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: live ? 'var(--up)' : 'var(--ink-3)' }}
              />
              Live
            </button>

            <button type="button" onClick={refresh} className="btn" aria-label="Refresh data now" title="Refresh now">
              {loadingAnalysis ? <Spinner size={14} /> : <span aria-hidden="true">⟳</span>}
            </button>

            <button
              type="button"
              onClick={toggleCvd}
              aria-pressed={cvd}
              className="btn"
              title={
                cvd
                  ? 'Colourblind-safe palette on — blue for up, orange for down'
                  : 'Switch to a colourblind-safe palette (blue up / orange down)'
              }
            >
              <span aria-hidden="true">◑</span>
              <span className="sr-only">Colourblind-safe palette</span>
            </button>

            <button
              type="button"
              onClick={toggleTheme}
              className="btn"
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1560px] gap-4 px-4 py-4 lg:grid-cols-[264px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-[60px] lg:self-start">
          <CardShell
            title="Watchlist"
            bodyClass="px-2 pb-2 pt-1"
            action={
              <span className="text-[10px]" style={{ color: 'var(--ink-3)' }}>
                {rows.length} symbols
              </span>
            }
          >
            <Watchlist
              items={rows}
              loading={loadingRows}
              active={symbol}
              onSelect={pick}
              onRemove={(s) => setSaved((list) => list.filter((x) => x !== s))}
            />
          </CardShell>
        </aside>

        <main className="flex min-w-0 flex-col gap-4">
          <CardShell title="Market overview" bodyClass="p-4">
            <MarketRail overview={overview} loading={!overview} onSelect={pick} />
          </CardShell>

          {analysisError && <ErrorNote message={analysisError} onRetry={refresh} />}

          <section className="card overflow-hidden">
            <div className="border-b p-4" style={{ borderColor: 'var(--line)' }}>
              {loadingAnalysis && !analysis ? (
                <SkeletonRows rows={2} height={30} />
              ) : (
                <QuoteHeader
                  quote={analysis?.quote}
                  symbol={symbol}
                  isSaved={isSaved}
                  onToggleSave={toggleSaved}
                />
              )}

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="seg" role="group" aria-label="Chart range">
                  {RANGES.map((r, i) => (
                    <button
                      key={r}
                      type="button"
                      className="seg-item"
                      aria-pressed={range === r}
                      onClick={() => setRange(r)}
                      title={`${r} · press ${i + 1}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>

                {signal && (
                  <span
                    className="chip"
                    style={{
                      color: actionColor(signal.action),
                      background: 'var(--surface-2)',
                      borderColor: 'var(--line)',
                    }}
                    title={`Composite ${signal.composite} · ${signal.confidence}% confidence`}
                  >
                    <span aria-hidden="true">
                      {signal.action.includes('BUY') ? '▲' : signal.action.includes('SELL') ? '▼' : '■'}
                    </span>
                    {ACTION_VERB[signal.action]} · {ACTION_LABEL[signal.action]}
                  </span>
                )}
              </div>
            </div>

            {loadingAnalysis && !analysis ? (
              <div className="p-4">
                <div className="skeleton" style={{ height: 420 }} />
              </div>
            ) : (
              analysis && <PriceChart data={analysis} range={range} theme={theme} cvd={cvd} />
            )}
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <section className="card overflow-hidden">
              <div className="card-head">
                <div className="seg" role="tablist" aria-label="Analysis view">
                  <button
                    type="button"
                    role="tab"
                    className="seg-item"
                    aria-selected={tab === 'signal'}
                    onClick={() => setTab('signal')}
                  >
                    Signal
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className="seg-item"
                    aria-selected={tab === 'backtest'}
                    onClick={() => setTab('backtest')}
                  >
                    Backtest
                  </button>
                </div>
                {updatedAt && (
                  <span className="text-[10px]" style={{ color: 'var(--ink-3)' }}>
                    updated {updatedAt.toLocaleTimeString()}
                  </span>
                )}
              </div>

              <div className="p-4">
                {loadingAnalysis && !analysis ? (
                  <SkeletonRows rows={7} height={26} />
                ) : tab === 'signal' ? (
                  signal && <SignalPanel signal={signal} weights={meta?.factor_weights} currency={currency} />
                ) : (
                  analysis?.backtest && (
                    <BacktestPanel
                      backtest={analysis.backtest}
                      symbol={symbol}
                      capital={capital}
                      onCapitalChange={setCapital}
                      currency={currency}
                    />
                  )
                )}
              </div>
            </section>

            <div className="flex flex-col gap-4">
              <CardShell
                title="Ask about this symbol"
                bodyClass="p-0"
                action={
                  meta?.assistant && (
                    <span
                      className="chip"
                      style={{
                        color: meta.assistant.claude_available ? 'var(--accent)' : 'var(--ink-3)',
                        background: 'var(--surface-2)',
                      }}
                      title={meta.assistant.detail}
                    >
                      {meta.assistant.claude_available ? 'Claude' : 'Grounded'}
                    </span>
                  )
                }
              >
                <Assistant symbol={symbol} range={range} engine={meta?.assistant} />
              </CardShell>

              <CardShell title={`${symbol} headlines`} bodyClass="px-4 pb-2 pt-1">
                <NewsList items={news} loading={loadingNews} />
              </CardShell>
            </div>
          </div>

          <footer className="pb-6 pt-1 text-[11px] leading-relaxed" style={{ color: 'var(--ink-3)' }}>
            <p>
              {meta?.disclaimer ||
                'Educational technical analysis, not financial advice. Signals describe what indicators say about past price action — they do not predict the future.'}
            </p>
            <p className="mt-1">
              Prices via Yahoo Finance and may be delayed. Press <kbd>/</kbd> to search,{' '}
              <kbd>1</kbd>–<kbd>8</kbd> to change range.
            </p>
          </footer>
        </main>
      </div>
    </div>
  )
}
