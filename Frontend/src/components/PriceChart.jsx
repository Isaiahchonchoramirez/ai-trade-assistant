import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  PriceScaleMode,
  createChart,
  createSeriesMarkers,
} from 'lightweight-charts'
import { money, num, pct } from '../lib/format.js'
import { useTokens } from '../hooks/usePrefs.js'

const INTRADAY = new Set(['1m', '5m', '15m', '30m', '1h'])

/** Which extra panes exist, and how tall each is. */
const PANE_HEIGHT = { volume: 76, rsi: 92, macd: 92 }

export default function PriceChart({ data, range, theme, cvd, height = 460 }) {
  const hostRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef({})
  const [hover, setHover] = useState(null)
  const [layers, setLayers] = useState({ ma: true, bands: false, volume: true, rsi: true, macd: false })

  const tokens = useTokens([theme, cvd])
  const intraday = INTRADAY.has(data?.interval)

  // Over a wide enough price range a linear scale flattens the early years
  // into the axis and hides every move in them. Equal percentage moves should
  // look equal, so switch to log once the span gets large.
  const logScale = useMemo(() => {
    const candles = data?.candles
    if (!candles?.length) return false
    let lo = Infinity
    let hi = 0
    for (const c of candles) {
      if (c.low > 0 && c.low < lo) lo = c.low
      if (c.high > hi) hi = c.high
    }
    return lo > 0 && hi / lo >= 8
  }, [data])

  const toggle = useCallback((key) => setLayers((l) => ({ ...l, [key]: !l[key] })), [])

  // ---- Build the chart. Rebuilt when the pane layout or theme changes,
  // because panes cannot be reordered in place. ----
  useEffect(() => {
    const host = hostRef.current
    if (!host || !data?.candles?.length) return

    const chart = createChart(host, {
      width: host.clientWidth,
      height,
      layout: {
        background: { color: 'transparent' },
        textColor: tokens.ink3,
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: tokens.line, separatorHoverColor: tokens.line, enableResize: false },
      },
      grid: {
        vertLines: { color: tokens.grid, style: 0 },
        horzLines: { color: tokens.grid, style: 0 },
      },
      rightPriceScale: {
        borderColor: tokens.line,
        scaleMargins: { top: 0.08, bottom: 0.08 },
        mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      },
      timeScale: {
        borderColor: tokens.line,
        timeVisible: intraday,
        secondsVisible: false,
        rightOffset: 3,
        barSpacing: 8,
      },
      crosshair: {
        mode: 1,
        vertLine: { color: tokens.ink3, width: 1, style: 2, labelBackgroundColor: tokens.ink },
        horzLine: { color: tokens.ink3, width: 1, style: 2, labelBackgroundColor: tokens.ink },
      },
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
      localization: {
        priceFormatter: (v) => (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(2)),
      },
    })
    chartRef.current = chart

    // Pane 0 is price; the rest are assigned in the order they are enabled.
    let nextPane = 1
    const paneIndex = {}
    for (const key of ['volume', 'rsi', 'macd']) {
      if (layers[key]) paneIndex[key] = nextPane++
    }

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: tokens.up,
      downColor: tokens.down,
      borderUpColor: tokens.up,
      borderDownColor: tokens.down,
      wickUpColor: tokens.up,
      wickDownColor: tokens.down,
      priceLineVisible: false,
      lastValueVisible: true,
    })
    candles.setData(data.candles)
    seriesRef.current = { candles }

    const addLine = (id, points, color, width = 1.5, dashed = false) => {
      if (!points?.length) return
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: width,
        lineStyle: dashed ? 2 : 0,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      s.setData(points)
      seriesRef.current[id] = s
    }

    if (layers.ma) {
      addLine('sma20', data.overlays?.sma20, tokens.accent, 1.5)
      addLine('sma50', data.overlays?.sma50, tokens.bench, 1.5)
      addLine('sma200', data.overlays?.sma200, tokens.ink3, 1.5, true)
    }
    if (layers.bands) {
      addLine('bb_upper', data.overlays?.bb_upper, tokens.ink3, 1, true)
      addLine('bb_lower', data.overlays?.bb_lower, tokens.ink3, 1, true)
    }

    // Volume is coloured by that bar's own direction, matching the candles.
    if (layers.volume) {
      const vol = chart.addSeries(
        HistogramSeries,
        { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
        paneIndex.volume,
      )
      vol.setData(
        data.candles.map((c) => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? `${tokens.up}66` : `${tokens.down}66`,
        })),
      )
      seriesRef.current.volume = vol
      chart.panes()[paneIndex.volume]?.setHeight(PANE_HEIGHT.volume)
    }

    if (layers.rsi && data.oscillators?.rsi?.length) {
      const rsi = chart.addSeries(
        LineSeries,
        { color: tokens.accent, lineWidth: 1.75, priceLineVisible: false, lastValueVisible: true },
        paneIndex.rsi,
      )
      rsi.setData(data.oscillators.rsi)
      // 70 / 30 are the conventional overbought and oversold thresholds.
      for (const [value, title] of [[70, 'Overbought'], [30, 'Oversold']]) {
        rsi.createPriceLine({
          price: value,
          color: tokens.ink3,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title,
        })
      }
      seriesRef.current.rsi = rsi
      chart.panes()[paneIndex.rsi]?.setHeight(PANE_HEIGHT.rsi)
    }

    if (layers.macd && data.oscillators?.macd?.length) {
      const hist = chart.addSeries(
        HistogramSeries,
        { priceLineVisible: false, lastValueVisible: false },
        paneIndex.macd,
      )
      hist.setData(
        (data.oscillators.macd_hist || []).map((p) => ({
          ...p,
          color: p.value >= 0 ? `${tokens.up}88` : `${tokens.down}88`,
        })),
      )
      const macdLine = chart.addSeries(
        LineSeries,
        { color: tokens.accent, lineWidth: 1.75, priceLineVisible: false, lastValueVisible: false },
        paneIndex.macd,
      )
      macdLine.setData(data.oscillators.macd)
      const signalLine = chart.addSeries(
        LineSeries,
        { color: tokens.bench, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false },
        paneIndex.macd,
      )
      signalLine.setData(data.oscillators.macd_signal)
      Object.assign(seriesRef.current, { macdHist: hist, macd: macdLine, macdSignal: signalLine })
      chart.panes()[paneIndex.macd]?.setHeight(PANE_HEIGHT.macd)
    }

    // Entry / stop / target from the live signal, drawn on the price pane.
    const levels = data.signal?.levels
    if (levels) {
      const priceLine = (price, color, title, style = 2) =>
        candles.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title })
      priceLine(levels.stop, tokens.down, 'Stop')
      priceLine(levels.targets?.[0], tokens.up, 'Target')
    }

    // A marker on the last bar, so the current call is visible on the chart
    // itself rather than only in the side panel.
    const action = data.signal?.action
    if (action && action !== 'HOLD') {
      const bullish = action.includes('BUY')
      createSeriesMarkers(candles, [
        {
          time: data.candles[data.candles.length - 1].time,
          position: bullish ? 'belowBar' : 'aboveBar',
          color: bullish ? tokens.up : tokens.down,
          shape: bullish ? 'arrowUp' : 'arrowDown',
          text: action.replace('STRONG_', '').replace('_', ' '),
        },
      ])
    }

    chart.timeScale().fitContent()

    const onCrosshair = (param) => {
      if (!param?.time || !param.point) {
        setHover(null)
        return
      }
      const read = (key) => param.seriesData.get(seriesRef.current[key])
      const bar = read('candles')
      if (!bar) {
        setHover(null)
        return
      }
      setHover({
        time: param.time,
        ...bar,
        sma20: read('sma20')?.value,
        sma50: read('sma50')?.value,
        sma200: read('sma200')?.value,
        rsi: read('rsi')?.value,
        macd: read('macd')?.value,
        volume: read('volume')?.value,
      })
    }
    chart.subscribeCrosshairMove(onCrosshair)

    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      if (w > 0) chart.applyOptions({ width: Math.floor(w) })
    })
    observer.observe(host)

    return () => {
      observer.disconnect()
      chart.unsubscribeCrosshairMove(onCrosshair)
      chart.remove()
      chartRef.current = null
      seriesRef.current = {}
    }
  }, [data, layers, tokens, height, intraday, logScale])

  const last = data?.candles?.[data.candles.length - 1]
  const prev = data?.candles?.[data.candles.length - 2]
  const shown = hover || last
  const reference = hover ? data?.candles?.find((c) => c.time === hover.time) : last
  const basis = hover
    ? data?.candles?.[Math.max(0, data.candles.findIndex((c) => c.time === hover.time) - 1)]
    : prev
  const changePct = reference && basis && basis.close ? ((reference.close - basis.close) / basis.close) * 100 : null

  const legend = useMemo(
    () =>
      [
        layers.ma && { label: 'SMA 20', color: 'var(--accent)', value: shown?.sma20 },
        layers.ma && { label: 'SMA 50', color: 'var(--bench)', value: shown?.sma50 },
        layers.ma && { label: 'SMA 200', color: 'var(--ink-3)', value: shown?.sma200, dashed: true },
      ].filter(Boolean),
    [layers.ma, shown],
  )

  if (!data?.candles?.length) {
    return (
      <div className="flex items-center justify-center text-[13px]" style={{ height, color: 'var(--ink-3)' }}>
        No price data for this range.
      </div>
    )
  }

  const TOGGLES = [
    ['ma', 'Moving averages'],
    ['bands', 'Bollinger'],
    ['volume', 'Volume'],
    ['rsi', 'RSI'],
    ['macd', 'MACD'],
  ]

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3 pb-2">
        {/* OHLC readout — follows the crosshair, falls back to the last bar. */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px]" style={{ color: 'var(--ink-3)' }}>
          {[
            ['O', shown?.open],
            ['H', shown?.high],
            ['L', shown?.low],
            ['C', shown?.close],
          ].map(([k, v]) => (
            <span key={k} className="tnum">
              {k}{' '}
              <span className="font-semibold" style={{ color: 'var(--ink)' }}>
                {v == null ? '—' : num(v, v >= 1000 ? 1 : 2)}
              </span>
            </span>
          ))}
          {changePct != null && (
            <span
              className="tnum font-semibold"
              style={{ color: changePct >= 0 ? 'var(--up)' : 'var(--down)' }}
            >
              {pct(changePct)}
            </span>
          )}
          {legend.map((l) => (
            <span key={l.label} className="tnum inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-3.5 rounded-full"
                style={{
                  background: l.dashed
                    ? `repeating-linear-gradient(90deg, ${l.color} 0 3px, transparent 3px 6px)`
                    : l.color,
                }}
              />
              {l.label}{' '}
              <span style={{ color: 'var(--ink-2)' }}>{l.value == null ? '—' : num(l.value, 2)}</span>
            </span>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {TOGGLES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => toggle(key)}
              aria-pressed={layers[key]}
              className="rounded-[7px] px-2 py-1 text-[11px] font-semibold transition-colors"
              style={{
                background: layers[key] ? 'var(--accent-wash)' : 'transparent',
                color: layers[key] ? 'var(--accent)' : 'var(--ink-3)',
                border: `1px solid ${layers[key] ? 'transparent' : 'var(--line)'}`,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div ref={hostRef} style={{ height, width: '100%' }} />

      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-4 py-2 text-[11px]"
        style={{ borderColor: 'var(--line)', color: 'var(--ink-3)' }}
      >
        <span>
          {data.bars} bars · {range} · {data.interval}
          {logScale && ' · log scale'}
        </span>
        {data.signal?.levels && (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-0.5 w-3.5" style={{ background: 'var(--down)' }} />
              Stop {money(data.signal.levels.stop)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-0.5 w-3.5" style={{ background: 'var(--up)' }} />
              Target {money(data.signal.levels.targets?.[0])}
            </span>
          </>
        )}
        {layers.rsi && <span>RSI pane: 70 overbought / 30 oversold</span>}
      </div>
    </div>
  )
}
