import type { TechnicalIndicatorHistory, TechnicalIndicatorHistoryPoint, TechnicalIndicatorSnapshot } from '@/types'

export interface CandlePoint {
  time: number
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

function round(value: number | null, digits = 4) {
  if (value === null || !Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function sma(values: number[], period: number) {
  if (values.length < period) return null
  const slice = values.slice(values.length - period)
  return slice.reduce((sum, value) => sum + value, 0) / period
}

function emaSeries(values: number[], period: number) {
  if (values.length < period) return [] as number[]
  const multiplier = 2 / (period + 1)
  const initial = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period
  const result = [initial]
  for (let index = period; index < values.length; index += 1) {
    const prev = result[result.length - 1]
    result.push((values[index] - prev) * multiplier + prev)
  }
  return result
}

function latestEma(values: number[], period: number) {
  const series = emaSeries(values, period)
  return series.length ? series[series.length - 1] : null
}

function calcMacd(values: number[]) {
  const ema12 = emaSeries(values, 12)
  const ema26 = emaSeries(values, 26)
  if (!ema12.length || !ema26.length) {
    return { dif: null, dea: null, histogram: null }
  }

  const offset = 26 - 12
  const difSeries = ema26.map((value, index) => ema12[index + offset] - value)
  if (!difSeries.length) {
    return { dif: null, dea: null, histogram: null }
  }

  const deaSeries = emaSeries(difSeries, 9)
  if (!deaSeries.length) {
    const dif = difSeries[difSeries.length - 1]
    return { dif, dea: null, histogram: null }
  }

  const alignedDif = difSeries.slice(difSeries.length - deaSeries.length)
  const dif = alignedDif[alignedDif.length - 1]
  const dea = deaSeries[deaSeries.length - 1]
  return {
    dif,
    dea,
    histogram: (dif - dea) * 2,
  }
}

function calcRsi(values: number[], period: number) {
  if (values.length <= period) return null
  let gains = 0
  let losses = 0

  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1]
    if (change >= 0) gains += change
    else losses += Math.abs(change)
  }

  let averageGain = gains / period
  let averageLoss = losses / period

  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1]
    averageGain = ((averageGain * (period - 1)) + Math.max(change, 0)) / period
    averageLoss = ((averageLoss * (period - 1)) + Math.max(-change, 0)) / period
  }

  if (averageLoss === 0) return 100
  const rs = averageGain / averageLoss
  return 100 - (100 / (1 + rs))
}

function calcBoll(values: number[], period: number, multiplier: number) {
  if (values.length < period) {
    return { upper: null, middle: null, lower: null }
  }
  const slice = values.slice(values.length - period)
  const middle = slice.reduce((sum, value) => sum + value, 0) / period
  const variance = slice.reduce((sum, value) => sum + ((value - middle) ** 2), 0) / period
  const stdDev = Math.sqrt(variance)
  return {
    upper: middle + stdDev * multiplier,
    middle,
    lower: middle - stdDev * multiplier,
  }
}

function calcAtr(candles: CandlePoint[], period: number) {
  if (candles.length <= period) return null
  const trs: number[] = []
  for (let index = 1; index < candles.length; index += 1) {
    const current = candles[index]
    const prevClose = candles[index - 1].close
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prevClose),
      Math.abs(current.low - prevClose),
    )
    trs.push(tr)
  }
  if (trs.length < period) return null
  const slice = trs.slice(trs.length - period)
  return slice.reduce((sum, value) => sum + value, 0) / period
}

function calcSupportResistance(candles: CandlePoint[]) {
  if (!candles.length) return { supportLevel: null, resistanceLevel: null }
  const slice = candles.slice(-20)
  return {
    supportLevel: Math.min(...slice.map((item) => item.low)),
    resistanceLevel: Math.max(...slice.map((item) => item.high)),
  }
}

function calcVolumeRatio(candles: CandlePoint[]) {
  if (candles.length < 20) return null
  const slice = candles.slice(-20)
  const last = slice[slice.length - 1]?.volume ?? 0
  const average = slice.reduce((sum, item) => sum + item.volume, 0) / slice.length
  if (average === 0) return null
  return last / average
}

function inferTrendBias(close: number, ma20: number | null, macdHistogram: number | null, rsi14: number | null): TechnicalIndicatorSnapshot['trendBias'] {
  if (ma20 === null || macdHistogram === null || rsi14 === null) return 'neutral'
  if (close >= ma20 && macdHistogram >= 0 && rsi14 >= 50) return 'bullish'
  if (close < ma20 && macdHistogram < 0 && rsi14 < 50) return 'bearish'
  return 'neutral'
}

export function buildTechnicalIndicatorSnapshot(candles: CandlePoint[]): TechnicalIndicatorSnapshot | null {
  if (!candles.length) return null

  const closes = candles.map((item) => item.close)
  const close = closes[closes.length - 1]
  const ma5 = sma(closes, 5)
  const ma10 = sma(closes, 10)
  const ma20 = sma(closes, 20)
  const ema12 = latestEma(closes, 12)
  const ema26 = latestEma(closes, 26)
  const macd = calcMacd(closes)
  const rsi14 = calcRsi(closes, 14)
  const boll = calcBoll(closes, 20, 2)
  const atr14 = calcAtr(candles, 14)
  const { supportLevel, resistanceLevel } = calcSupportResistance(candles)
  const volumeRatio20 = calcVolumeRatio(candles)

  return {
    close: round(close, 4) ?? close,
    ma5: round(ma5),
    ma10: round(ma10),
    ma20: round(ma20),
    ema12: round(ema12),
    ema26: round(ema26),
    macd: {
      dif: round(macd.dif),
      dea: round(macd.dea),
      histogram: round(macd.histogram),
    },
    rsi14: round(rsi14),
    boll: {
      upper: round(boll.upper),
      middle: round(boll.middle),
      lower: round(boll.lower),
    },
    atr14: round(atr14),
    supportLevel: round(supportLevel),
    resistanceLevel: round(resistanceLevel),
    volumeRatio20: round(volumeRatio20),
    trendBias: inferTrendBias(close, ma20, macd.histogram, rsi14),
  }
}

function calcChangePercent(current: number, previous: number | null | undefined) {
  if (previous === null || previous === undefined || previous === 0) return null
  return ((current - previous) / previous) * 100
}

function buildHistoryPoint(candles: CandlePoint[], index: number): TechnicalIndicatorHistoryPoint | null {
  const slice = candles.slice(0, index + 1)
  const snapshot = buildTechnicalIndicatorSnapshot(slice)
  const candle = candles[index]
  if (!snapshot || !candle) return null
  return {
    date: candle.date,
    close: snapshot.close,
    changePercent: round(calcChangePercent(candle.close, candles[index - 1]?.close)),
    volumeRatio20: snapshot.volumeRatio20,
    ma5: snapshot.ma5,
    ma10: snapshot.ma10,
    ma20: snapshot.ma20,
    macd: snapshot.macd,
    rsi14: snapshot.rsi14,
    trendBias: snapshot.trendBias,
  }
}

function latestNumber<T>(points: T[], getter: (point: T) => number | null | undefined) {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const value = getter(points[index])
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function earliestNumber<T>(points: T[], getter: (point: T) => number | null | undefined) {
  for (const point of points) {
    const value = getter(point)
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

export function buildTechnicalIndicatorHistory(candles: CandlePoint[], window = 20): TechnicalIndicatorHistory {
  const safeWindow = Math.max(1, Math.min(Math.floor(window), 60))
  const start = Math.max(0, candles.length - safeWindow)
  const points = candles
    .slice(start)
    .map((_, offset) => buildHistoryPoint(candles, start + offset))
    .filter((point): point is TechnicalIndicatorHistoryPoint => point !== null)

  const firstClose = points[0]?.close
  const lastClose = points[points.length - 1]?.close
  const firstMacd = earliestNumber(points, (point) => point.macd.histogram)
  const lastMacd = latestNumber(points, (point) => point.macd.histogram)
  const firstRsi = earliestNumber(points, (point) => point.rsi14)
  const lastRsi = latestNumber(points, (point) => point.rsi14)

  return {
    window: safeWindow,
    points,
    summary: {
      closeChangePercent: firstClose && lastClose ? round(calcChangePercent(lastClose, firstClose)) : null,
      macdHistogramChange: firstMacd !== null && lastMacd !== null ? round(lastMacd - firstMacd) : null,
      rsiChange: firstRsi !== null && lastRsi !== null ? round(lastRsi - firstRsi) : null,
      bullishDays: points.filter((point) => point.trendBias === 'bullish').length,
      bearishDays: points.filter((point) => point.trendBias === 'bearish').length,
    },
  }
}
