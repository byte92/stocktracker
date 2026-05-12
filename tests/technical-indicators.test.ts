import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTechnicalIndicatorHistory, buildTechnicalIndicatorSnapshot, type CandlePoint } from '@/lib/technicalIndicators'

function createCandle(close: number, index: number): CandlePoint {
  return {
    time: index,
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1000 + index * 20,
  }
}

test('技术指标快照会生成均线、MACD、RSI、BOLL 与 ATR', () => {
  const candles = Array.from({ length: 40 }, (_, index) => createCandle(10 + index * 0.4, index))

  const snapshot = buildTechnicalIndicatorSnapshot(candles)

  assert.ok(snapshot)
  assert.equal(snapshot?.trendBias, 'bullish')
  assert.ok(snapshot?.ma5 !== null)
  assert.ok(snapshot?.ma10 !== null)
  assert.ok(snapshot?.ma20 !== null)
  assert.ok(snapshot?.ema12 !== null)
  assert.ok(snapshot?.ema26 !== null)
  assert.ok(snapshot?.macd.dif !== null)
  assert.ok(snapshot?.macd.dea !== null)
  assert.ok(snapshot?.macd.histogram !== null)
  assert.ok(snapshot?.rsi14 !== null)
  assert.ok(snapshot?.boll.upper !== null)
  assert.ok(snapshot?.boll.middle !== null)
  assert.ok(snapshot?.boll.lower !== null)
  assert.ok(snapshot?.atr14 !== null)
  assert.ok(snapshot?.supportLevel !== null)
  assert.ok(snapshot?.resistanceLevel !== null)
  assert.ok(snapshot?.volumeRatio20 !== null)
})

test('技术指标在样本不足时返回空值或中性趋势', () => {
  const candles = [createCandle(10, 0), createCandle(10.2, 1), createCandle(10.1, 2)]
  const snapshot = buildTechnicalIndicatorSnapshot(candles)

  assert.ok(snapshot)
  assert.equal(snapshot?.trendBias, 'neutral')
  assert.equal(snapshot?.ma20, null)
  assert.equal(snapshot?.rsi14, null)
  assert.equal(snapshot?.atr14, null)
})

test('技术指标历史会生成最近窗口序列和变化摘要', () => {
  const candles = Array.from({ length: 45 }, (_, index) => createCandle(10 + index * 0.2, index))

  const history = buildTechnicalIndicatorHistory(candles, 20)

  assert.equal(history.window, 20)
  assert.equal(history.points.length, 20)
  assert.equal(history.points[0]?.date, '2026-01-26')
  assert.equal(history.points.at(-1)?.date, '2026-01-45')
  assert.ok(history.points.at(-1)?.macd.histogram !== null)
  assert.ok(history.summary.closeChangePercent !== null)
  assert.ok(history.summary.macdHistogramChange !== null)
  assert.ok(history.summary.rsiChange !== null)
})
