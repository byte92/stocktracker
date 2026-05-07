'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type SeriesMarker,
  type MouseEventParams,
} from 'lightweight-charts'
import type { Market, Trade } from '@/types'
import { nextApiUrls } from '@/lib/api/endpoints'
import { calcPerShareCost, add, mul, sub } from '@/lib/money'
import { useI18n } from '@/lib/i18n'

type KlineItem = {
  time: number
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

type MappedTrade = Trade & {
  mappedDate: string
  mappedTime: number
}

const RANGES = [
  { label: '1个月', value: '1mo' },
  { label: '3个月', value: '3mo' },
  { label: '6个月', value: '6mo' },
  { label: '1年', value: '1y' },
  { label: '3年', value: '3y' },
]

const INTERVALS = [
  { label: '日K', value: '1d' },
  { label: '5分', value: '5m' },
  { label: '15分', value: '15m' },
  { label: '30分', value: '30m' },
  { label: '60分', value: '60m' },
]

type LegendKey = 'buy' | 'sell' | 'dividend' | 'ma5' | 'ma10' | 'ma20' | 'cost' | 'holding'

const LEGEND_ITEMS: Array<{ key: LegendKey; label: string; color: string; type: 'marker' | 'line' | 'histogram' }> = [
  { key: 'buy', label: '买点', color: '#ef4444', type: 'marker' },
  { key: 'sell', label: '卖点', color: '#22c55e', type: 'marker' },
  { key: 'dividend', label: '收益', color: '#f97316', type: 'marker' },
  { key: 'ma5', label: 'MA5', color: '#f59e0b', type: 'line' },
  { key: 'ma10', label: 'MA10', color: '#3b82f6', type: 'line' },
  { key: 'ma20', label: 'MA20', color: '#a855f7', type: 'line' },
  { key: 'cost', label: '成本线', color: '#06b6d4', type: 'line' },
  { key: 'holding', label: '持仓区间', color: '#93c5fd', type: 'histogram' },
]

export default function StockKline({
  symbol,
  market,
  trades,
}: {
  symbol: string
  market: Market
  trades: Trade[]
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const ma5Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const ma10Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const ma20Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const tradeLineRef = useRef<ISeriesApi<'Line'> | null>(null)
  const costLineRef = useRef<ISeriesApi<'Line'> | null>(null)
  const holdingRef = useRef<ISeriesApi<'Histogram'> | null>(null)

  const dataRef = useRef<KlineItem[]>([])
  const mappedTradesRef = useRef<MappedTrade[]>([])
  const markersRef = useRef<SeriesMarker<any>[]>([])
  const maDataRef = useRef<{ ma5: LineData[]; ma10: LineData[]; ma20: LineData[] }>({ ma5: [], ma10: [], ma20: [] })

  const [range, setRange] = useState('6mo')
  const [interval, setInterval] = useState('1d')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<string>('')
  const [data, setData] = useState<KlineItem[]>([])
  const [hover, setHover] = useState<{
    x: number
    y: number
    date: string
    candle?: KlineItem
    ma5?: number
    ma10?: number
    ma20?: number
    trades: MappedTrade[]
  } | null>(null)

  const [visibility, setVisibility] = useState<Record<LegendKey, boolean>>({
    buy: true, sell: true, dividend: true,
    ma5: true, ma10: true, ma20: true,
    cost: true, holding: true,
  })
  const { t: tr, getAssetUnit } = useI18n()

  const seriesRefMap: Record<string, React.RefObject<any>> = {
    ma5: ma5Ref,
    ma10: ma10Ref,
    ma20: ma20Ref,
    cost: costLineRef,
    holding: holdingRef,
  }

  const minuteSupported = market === 'A' || market === 'FUND' || market === 'CRYPTO'
  const assetUnit = getAssetUnit(market)
  const incomeLabel = market === 'CRYPTO' ? tr('收益') : tr('分红')

  useEffect(() => {
    if (!minuteSupported && interval !== '1d') {
      setInterval('1d')
    }
  }, [minuteSupported, interval])

  const mappedTrades = useMemo<MappedTrade[]>(() => {
    if (!data.length) return []
    const dateList = data.map((d) => d.date)
    const dateSet = new Set(dateList)
    const firstTimeByDate = new Map<string, number>()
    for (const d of data) {
      if (!firstTimeByDate.has(d.date)) firstTimeByDate.set(d.date, d.time)
    }

    const earliestDate = dateList[0]
    const latestDate = dateList[dateList.length - 1]

    return trades
      .filter((t) => t.type === 'BUY' || t.type === 'SELL' || t.type === 'DIVIDEND')
      .map((t) => {
        let mappedDate = t.date
        if (!dateSet.has(mappedDate)) {
          // 交易日期不在 K 线范围内 → 不展示
          if (t.date < earliestDate || t.date > latestDate) return null
          // 日期在范围内但无精确匹配（如周末）→ 映射到下一个交易日
          mappedDate = dateList.find((d) => d >= t.date) || ''
        }
        if (!mappedDate) return null
        const mappedTime = firstTimeByDate.get(mappedDate)
        if (!mappedTime) return null
        return { ...t, mappedDate, mappedTime }
      })
      .filter((x): x is MappedTrade => Boolean(x))
      .sort((a, b) => a.mappedTime - b.mappedTime)
  }, [data, trades])

  const tradeMarkers = useMemo(() => {
    if (!mappedTrades.length) return [] as SeriesMarker<any>[]
    const markers: SeriesMarker<any>[] = []

    for (const t of mappedTrades) {
      if (t.type === 'DIVIDEND') {
        markers.push({
          time: t.mappedTime as any,
          position: 'aboveBar',
          color: '#f97316',
          shape: 'circle',
          text: `${incomeLabel} ${t.netAmount.toFixed(2)}`,
        })
      } else {
        markers.push({
          time: t.mappedTime as any,
          position: t.type === 'BUY' ? 'belowBar' : 'aboveBar',
          color: t.type === 'BUY' ? '#ef4444' : '#22c55e',
          shape: t.type === 'BUY' ? 'arrowUp' : 'arrowDown',
          text: `${t.type === 'BUY' ? tr('买入') : tr('卖出')} ${fmtNum(t.quantity)}`,
        })
      }
    }

    return markers
  }, [mappedTrades, incomeLabel, tr])

  const ma5Data = useMemo(() => calcMA(data, 5), [data])
  const ma10Data = useMemo(() => calcMA(data, 10), [data])
  const ma20Data = useMemo(() => calcMA(data, 20), [data])

  const tradeLineData = useMemo<LineData<any>[]>(() => {
    const byTime = new Map<number, number>()
    for (const t of mappedTrades) {
      if (t.type === 'DIVIDEND') continue
      byTime.set(t.mappedTime, t.price)
    }
    return Array.from(byTime.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([time, value]) => ({ time: time as any, value }))
  }, [mappedTrades])

  // 动态成本线（卖出按 FIFO 匹配成本批次随时间变化）
  const costLineData = useMemo<LineData<any>[]>(() => {
    if (!data.length) return []
    const sortedTrades = [...trades]
      .filter((t) => t.type === 'BUY' || t.type === 'SELL')
      .sort((a, b) => a.date.localeCompare(b.date))

    const costQueue: Array<{ price: number; quantity: number }> = []
    const result: LineData<any>[] = []
    let tradeIdx = 0

    for (const d of data) {
      while (tradeIdx < sortedTrades.length && sortedTrades[tradeIdx].date <= d.date) {
        const t = sortedTrades[tradeIdx]
        if (t.type === 'BUY') {
          costQueue.push({ price: calcPerShareCost(t.netAmount, t.quantity), quantity: t.quantity })
        } else {
          let remaining = t.quantity
          while (remaining > 0 && costQueue.length > 0) {
            if (costQueue[0].quantity <= remaining) {
              remaining = normalizeQuantity(sub(remaining, costQueue[0].quantity))
              costQueue.shift()
            } else {
              costQueue[0].quantity = normalizeQuantity(sub(costQueue[0].quantity, remaining))
              remaining = 0
            }
          }
        }
        tradeIdx++
      }
      const totalCost = costQueue.reduce((sum, item) => add(sum, mul(item.price, item.quantity)), 0)
      const totalQty = costQueue.reduce((sum, item) => add(sum, item.quantity), 0)
      if (totalQty > 0) {
        result.push({ time: d.time as any, value: calcPerShareCost(totalCost, totalQty) })
      }
    }
    return result
  }, [data, trades])

  const holdingData = useMemo<HistogramData<any>[]>(() => {
    if (!data.length) return []
    const deltaByDate = new Map<string, number>()
    for (const t of mappedTrades) {
      const delta = t.type === 'BUY' ? t.quantity : t.type === 'SELL' ? -t.quantity : 0
      deltaByDate.set(t.mappedDate, (deltaByDate.get(t.mappedDate) || 0) + delta)
    }
    let holding = 0
    return data.map((d) => {
      holding = normalizeQuantity(add(holding, deltaByDate.get(d.date) || 0))
      return {
        time: d.time as any,
        value: holding > 0 ? 1 : 0,
        color: holding > 0 ? 'rgba(59,130,246,0.12)' : 'rgba(0,0,0,0)',
      }
    })
  }, [data, mappedTrades])

  useEffect(() => {
    let mounted = true
    setLoading(true)
    setError(null)

    fetch(
      nextApiUrls.stock.kline(symbol, market, range, interval),
      { cache: 'no-store' }
    )
      .then(async (res) => {
        const payload = await res.json()
        if (!res.ok) throw new Error(tr(payload?.error || '获取K线失败'))
        if (!mounted) return
        setData((payload?.candles || []) as KlineItem[])
        setSource(payload?.source || '')
      })
      .catch((e) => {
        if (!mounted) return
        setError(e instanceof Error ? e.message : tr('获取K线失败'))
        setData([])
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [symbol, market, range, interval])

  useEffect(() => {
    if (!wrapRef.current) return

    const chart = createChart(wrapRef.current, {
      width: wrapRef.current.clientWidth,
      height: 360,
      layout: {
        background: { color: 'transparent' },
        textColor: '#8b95a7',
      },
      grid: {
        vertLines: { color: 'rgba(120,130,160,0.18)' },
        horzLines: { color: 'rgba(120,130,160,0.18)' },
      },
      crosshair: {
        mode: 0,
      },
      rightPriceScale: {
        borderColor: 'rgba(120,130,160,0.28)',
      },
      timeScale: {
        borderColor: 'rgba(120,130,160,0.28)',
      },
    })

    const candle = chart.addCandlestickSeries({
      upColor: '#ef4444',
      downColor: '#22c55e',
      borderVisible: false,
      wickUpColor: '#ef4444',
      wickDownColor: '#22c55e',
    })
    const volume = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      color: '#64748b',
    })
    const ma5 = chart.addLineSeries({
      color: '#f59e0b',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    })
    const ma10 = chart.addLineSeries({
      color: '#3b82f6',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    })
    const ma20 = chart.addLineSeries({
      color: '#a855f7',
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    })
    const tradeLine = chart.addLineSeries({
      color: 'rgba(250,204,21,0.9)',
      lineWidth: 1,
      lineStyle: 2,
      pointMarkersVisible: true,
      pointMarkersRadius: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    })
    const holdingBand = chart.addHistogramSeries({
      priceScaleId: 'holding',
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
      base: 0,
    })
    const costLine = chart.addLineSeries({
      color: '#06b6d4',
      lineWidth: 2,
      lineStyle: 2,
      lastValueVisible: true,
      priceLineVisible: false,
    })

    chart.priceScale('').applyOptions({
      scaleMargins: { top: 0.75, bottom: 0 },
    })
    chart.priceScale('holding').applyOptions({
      visible: false,
      autoScale: false,
      scaleMargins: { top: 0, bottom: 0 },
    })

    chartRef.current = chart
    candleRef.current = candle
    volumeRef.current = volume
    ma5Ref.current = ma5
    ma10Ref.current = ma10
    ma20Ref.current = ma20
    tradeLineRef.current = tradeLine
    costLineRef.current = costLine
    holdingRef.current = holdingBand

    const onCrosshairMove = (param: MouseEventParams<any>) => {
      if (!param.time || !param.point) {
        setHover(null)
        return
      }
      const key = normalizeTimeKey(param.time)
      if (!key) {
        setHover(null)
        return
      }

      const candle = dataRef.current.find((d) => String(d.time) === key)
      const date = candle?.date || normalizeChartDate(param.time)
      if (!date) {
        setHover(null)
        return
      }
      const tradesAt = mappedTradesRef.current.filter((t) => t.mappedDate === date)
      const { ma5: ma5DataArr, ma10: ma10DataArr, ma20: ma20DataArr } = maDataRef.current
      const ma5Val = ma5DataArr.find((d) => String(d.time) === key)?.value
      const ma10Val = ma10DataArr.find((d) => String(d.time) === key)?.value
      const ma20Val = ma20DataArr.find((d) => String(d.time) === key)?.value
      setHover({
        x: param.point.x,
        y: param.point.y,
        date,
        candle,
        ma5: ma5Val,
        ma10: ma10Val,
        ma20: ma20Val,
        trades: tradesAt,
      })
    }

    chart.subscribeCrosshairMove(onCrosshairMove)

    const observer = new ResizeObserver(() => {
      if (!wrapRef.current || !chartRef.current) return
      chartRef.current.applyOptions({ width: wrapRef.current.clientWidth })
    })
    observer.observe(wrapRef.current)

    return () => {
      observer.disconnect()
      chart.unsubscribeCrosshairMove(onCrosshairMove)
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      volumeRef.current = null
      ma5Ref.current = null
      ma10Ref.current = null
      ma20Ref.current = null
      tradeLineRef.current = null
      costLineRef.current = null
      holdingRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || !ma5Ref.current || !ma10Ref.current || !ma20Ref.current || !tradeLineRef.current || !costLineRef.current || !holdingRef.current) return

    dataRef.current = data
    mappedTradesRef.current = mappedTrades
    maDataRef.current = { ma5: ma5Data, ma10: ma10Data, ma20: ma20Data }

    const candleData: CandlestickData<any>[] = data.map((d) => ({
      time: d.time as any,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }))
    const volumeData: HistogramData<any>[] = data.map((d) => ({
      time: d.time as any,
      value: d.volume,
      color: d.close >= d.open ? 'rgba(239,68,68,0.5)' : 'rgba(34,197,94,0.5)',
    }))

    candleRef.current.setData(candleData)
    volumeRef.current.setData(volumeData)
    ma5Ref.current.setData(ma5Data)
    ma10Ref.current.setData(ma10Data)
    ma20Ref.current.setData(ma20Data)
    tradeLineRef.current.setData(tradeLineData)
    holdingRef.current.setData(holdingData)
    costLineRef.current.setData(costLineData)
    markersRef.current = tradeMarkers
    candleRef.current.setMarkers(tradeMarkers)
    chartRef.current?.timeScale().fitContent()
  }, [data, mappedTrades, ma5Data, ma10Data, ma20Data, tradeLineData, costLineData, holdingData, tradeMarkers])

  // 同步各系列的可见性
  useEffect(() => {
    for (const item of LEGEND_ITEMS) {
      if (item.type !== 'marker') {
        seriesRefMap[item.key]?.current?.applyOptions({ visible: visibility[item.key] })
      }
    }
    const markerColors = new Set(
      LEGEND_ITEMS.filter((item) => item.type === 'marker' && visibility[item.key]).map((item) => item.color)
    )
    candleRef.current?.setMarkers(markersRef.current.filter((m) => markerColors.has(m.color as string)))
  }, [visibility])

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 space-y-2">
        <div className="text-sm text-foreground font-medium">{tr('K 线图')}</div>
        <div className="flex items-center justify-start gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">{tr('范围')}</span>
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  range === r.value
                    ? 'border-primary bg-primary/15 text-primary'
                    : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                {tr(r.label)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">{tr('粒度')}</span>
            {INTERVALS.map((i) => {
              const disabled = !minuteSupported && i.value !== '1d'
              return (
                <button
                  key={i.value}
                  onClick={() => !disabled && setInterval(i.value)}
                  disabled={disabled}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                    interval === i.value
                      ? 'border-primary bg-primary/15 text-primary'
                      : disabled
                      ? 'border-border text-muted-foreground/40 cursor-not-allowed'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tr(i.label)}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {(ma5Data.length > 0 || ma10Data.length > 0 || ma20Data.length > 0) && (
        <div className="mb-2 flex items-center gap-3 text-xs font-mono">
          {(['ma5', 'ma10', 'ma20'] as const).map((key) => {
            const arr = key === 'ma5' ? ma5Data : key === 'ma10' ? ma10Data : ma20Data
            const color = key === 'ma5' ? '#f59e0b' : key === 'ma10' ? '#3b82f6' : '#a855f7'
            const label = key.toUpperCase()
            const hoverVal = hover?.[key]
            const latestVal = arr.length ? arr[arr.length - 1].value : undefined
            const val = hoverVal ?? latestVal
            return val !== undefined ? (
              <span key={key}>
                <span style={{ color }}>{label}</span>{' '}
                <span className="text-foreground">{val.toFixed(2)}</span>
              </span>
            ) : null
          })}
        </div>
      )}

      {!minuteSupported && (
        <div className="mb-2 text-xs text-muted-foreground">{tr('当前市场暂仅支持日 K，分钟级将自动使用 1D。')}</div>
      )}

      <div className="relative">
        <div ref={wrapRef} className="h-[360px] w-full" />
        {hover && (
          <div
            className="pointer-events-none absolute z-10 min-w-48 rounded-md border border-border bg-card/95 px-3 py-2 text-xs shadow-lg"
            style={{
              left: Math.max(8, Math.min(hover.x + 12, (wrapRef.current?.clientWidth || 420) - 220)),
              top: Math.max(8, hover.y - 12),
            }}
          >
            <div className="font-medium text-foreground">{hover.date}</div>
            {hover.candle && (() => {
              const c = hover.candle
              const up = c.close >= c.open
              const closeColor = up ? '#ef4444' : '#22c55e'
              return (
                <div className="mt-1 font-mono text-xs space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span><span style={{ color: '#94a3b8' }}>{tr('开')}</span> <span className="text-foreground">{c.open.toFixed(2)}</span></span>
                    <span><span style={{ color: '#ef4444' }}>{tr('高')}</span> <span className="text-foreground">{c.high.toFixed(2)}</span></span>
                    <span><span style={{ color: '#22c55e' }}>{tr('低')}</span> <span className="text-foreground">{c.low.toFixed(2)}</span></span>
                    <span><span style={{ color: closeColor }}>{tr('收')}</span> <span className="text-foreground">{c.close.toFixed(2)}</span></span>
                  </div>
                  {(hover.ma5 !== undefined || hover.ma10 !== undefined || hover.ma20 !== undefined) && (
                    <div className="flex items-center gap-2 flex-wrap">
                      {hover.ma5 !== undefined && <span><span style={{ color: '#f59e0b' }}>MA5</span> <span className="text-foreground">{hover.ma5.toFixed(2)}</span></span>}
                      {hover.ma10 !== undefined && <span><span style={{ color: '#3b82f6' }}>MA10</span> <span className="text-foreground">{hover.ma10.toFixed(2)}</span></span>}
                      {hover.ma20 !== undefined && <span><span style={{ color: '#a855f7' }}>MA20</span> <span className="text-foreground">{hover.ma20.toFixed(2)}</span></span>}
                    </div>
                  )}
                  <div><span style={{ color: '#64748b' }}>{tr('成交量')}</span> <span className="text-foreground">{fmtNum(c.volume)} {assetUnit}</span></div>
                </div>
              )
            })()}
            {hover.trades.length > 0 && (
              <div className="mt-2 space-y-1">
                {hover.trades.map((t) => {
                  if (t.type === 'DIVIDEND') {
                    const perShare = t.price || (t.quantity > 0 ? t.totalAmount / t.quantity : 0)
                    return (
                      <div key={t.id} className="flex items-center justify-between gap-2">
                        <span className="text-[#f97316]">{incomeLabel}</span>
                        <span className="text-muted-foreground font-mono text-right">
                          {tr('每{unit}{amount} · {quantity}{unit2}', { unit: assetUnit, amount: fmtNum(perShare), quantity: fmtNum(t.quantity), unit2: assetUnit })}<br />
                          {tr('税前{gross} 税{tax} 实收{net}', { gross: t.totalAmount.toFixed(2), tax: t.tax.toFixed(2), net: t.netAmount.toFixed(2) })}
                        </span>
                      </div>
                    )
                  }
                  return (
                    <div key={t.id} className="flex items-center justify-between gap-2">
                      <span className={t.type === 'BUY' ? 'profit-text' : 'loss-text'}>
                        {t.type === 'BUY' ? tr('买入') : tr('卖出')} {fmtNum(t.quantity)} {assetUnit}
                      </span>
                      <span className="text-muted-foreground font-mono">
                        {tr('@{price} 费{fee}', { price: t.price, fee: (t.commission + t.tax).toFixed(2) })}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-1 flex-wrap">
          {LEGEND_ITEMS.map((item) => (
            <LegendDot
              key={item.key}
              label={tr(item.label)}
              color={item.color}
              active={visibility[item.key]}
              onClick={() => setVisibility((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
            />
          ))}
        </div>
        <span>{loading ? tr('加载中...') : error ? error : tr('数据源: {source} · 级别: {interval}', { source: source || '-', interval: interval.toUpperCase() })}</span>
      </div>
    </div>
  )
}

function fmtNum(v: number): string {
  return v.toFixed(8).replace(/\.?0+$/, '').replace(/\.$/, '') || '0'
}

function normalizeQuantity(value: number) {
  return Math.abs(value) < 1e-12 ? 0 : value
}

function LegendDot({ label, color, active, onClick }: { label: string; color: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-1 py-0.5 rounded transition-all ${
        active ? 'opacity-100' : 'opacity-30 line-through'
      } hover:opacity-80`}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </button>
  )
}

function calcMA(data: KlineItem[], period: number): LineData<any>[] {
  if (!data.length) return []
  const result: LineData<any>[] = []
  const queue: number[] = []
  let sum = 0

  for (const d of data) {
    queue.push(d.close)
    sum += d.close
    if (queue.length > period) {
      sum -= queue.shift() || 0
    }
    if (queue.length === period) {
      result.push({ time: d.time as any, value: Number((sum / period).toFixed(4)) })
    }
  }
  return result
}

function normalizeTimeKey(time: any): string | null {
  if (!time) return null
  if (typeof time === 'number') return String(time)
  if (typeof time === 'string') return String(Date.parse(`${time}T00:00:00Z`) / 1000)
  if (typeof time === 'object' && 'year' in time && 'month' in time && 'day' in time) {
    const y = String(time.year).padStart(4, '0')
    const m = String(time.month).padStart(2, '0')
    const d = String(time.day).padStart(2, '0')
    return String(Date.parse(`${y}-${m}-${d}T00:00:00Z`) / 1000)
  }
  return null
}

function normalizeChartDate(time: any): string | null {
  if (!time) return null
  if (typeof time === 'number') return new Date(time * 1000).toISOString().slice(0, 10)
  if (typeof time === 'string') return time.slice(0, 10)
  if (typeof time === 'object' && 'year' in time && 'month' in time && 'day' in time) {
    const y = String(time.year).padStart(4, '0')
    const m = String(time.month).padStart(2, '0')
    const d = String(time.day).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return null
}
