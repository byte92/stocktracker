import assert from 'node:assert/strict'
import test from 'node:test'
import { AlphaVantageDataSource } from '@/lib/dataSources/AlphaVantageSource'
import { NasdaqSource } from '@/lib/dataSources/NasdaqSource'
import { TencentFinanceSource } from '@/lib/dataSources/TencentFinanceSource'
import { YahooFinanceSource } from '@/lib/dataSources/YahooFinanceSource'
import { exchangeRateService } from '@/lib/ExchangeRateService'
import { fetchDailyCandles, fetchKline } from '@/lib/external/kline'
import { MARKET_INDEX_DEFINITIONS, fetchMarketIndexSnapshot } from '@/lib/external/marketIndices'
import { fetchStockNews } from '@/lib/external/news'
import type { StockQuote } from '@/types/stockApi'

const RUN_EXTERNAL_API_TESTS =
  process.env.EXTERNAL_API_TESTS === '1' || process.env.npm_lifecycle_event === 'test:external'

function externalTest(name: string, fn: () => Promise<void>) {
  test(name, { skip: !RUN_EXTERNAL_API_TESTS, timeout: 20000 }, fn)
}

function assertQuote(quote: StockQuote | null, source: string) {
  assert.ok(quote, `${source} should return a quote`)
  assert.equal(typeof quote.symbol, 'string')
  assert.equal(typeof quote.name, 'string')
  assert.ok(Number.isFinite(quote.price) && quote.price > 0, `${source} should return a valid price`)
  assert.ok(Number.isFinite(quote.change), `${source} should return a valid change`)
  assert.ok(Number.isFinite(quote.changePercent), `${source} should return a valid changePercent`)
  assert.equal(typeof quote.timestamp, 'string')
  assert.equal(typeof quote.currency, 'string')
  assert.equal(typeof quote.source, 'string')
}

externalTest('腾讯财经报价接口可用', async () => {
  const source = new TencentFinanceSource({ provider: 'tencent' })
  assert.equal(await source.healthCheck(), true)
  assertQuote(await source.getQuote('000001', 'A'), 'Tencent A quote')
  assertQuote(await source.getQuote('00700', 'HK'), 'Tencent HK quote')
})

externalTest('Nasdaq 报价接口可用', async () => {
  const source = new NasdaqSource({ provider: 'nasdaq' })
  assert.equal(await source.healthCheck(), true)
  assertQuote(await source.getQuote('AAPL', 'US'), 'Nasdaq quote')
})

externalTest('Yahoo Finance 报价接口可用', async () => {
  const source = new YahooFinanceSource({ provider: 'yahoo-finance' })
  assert.equal(await source.healthCheck(), true)
  assertQuote(await source.getQuote('AAPL', 'US'), 'Yahoo quote')
})

const alphaVantageApiKey = process.env.ALPHA_VANTAGE_API_KEY ?? process.env.NEXT_PUBLIC_ALPHA_VANTAGE_API_KEY
test('Alpha Vantage 报价接口可用', {
  skip: !RUN_EXTERNAL_API_TESTS || !alphaVantageApiKey,
  timeout: 20000,
}, async () => {
  const source = new AlphaVantageDataSource({ provider: 'alpha-vantage', apiKey: alphaVantageApiKey })
  assert.equal(await source.healthCheck(), true)
  assertQuote(await source.getQuote('IBM', 'US'), 'Alpha Vantage quote')
})

externalTest('腾讯 K 线接口可用', async () => {
  const result = await fetchKline('000001', 'A', { interval: '1d', range: '1mo' })
  assert.equal(result.source, 'tencent')
  assert.ok(result.candles.length >= 2, 'Tencent kline should return at least two candles')
  assert.ok(result.candles.every((item) => Number.isFinite(item.close) && item.close > 0))
})

externalTest('美股 K 线接口可用', async () => {
  const candles = await fetchDailyCandles('AAPL', 'US', 30)
  assert.ok(candles.length >= 2, 'US kline should return at least two candles')
  assert.ok(candles.every((item) => Number.isFinite(item.close) && item.close > 0))
})

externalTest('大盘指数接口可用', async () => {
  const definition = MARKET_INDEX_DEFINITIONS.find((item) => item.id === 'shanghai-composite')
  assert.ok(definition)

  const snapshot = await fetchMarketIndexSnapshot(definition, { includeIndicators: true })
  assert.ok(snapshot, 'Market index snapshot should be available')
  assert.ok(Number.isFinite(snapshot.price) && snapshot.price > 0)
  assert.equal(snapshot.source, 'tencent')
})

externalTest('Google News RSS 新闻接口可用', async () => {
  const news = await fetchStockNews('AAPL', 'Apple', 'US', 3)
  assert.ok(news.length > 0, 'Google News should return at least one item')
  assert.ok(news.every((item) => item.title && item.url))
})

externalTest('汇率接口可用', async () => {
  const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
    signal: AbortSignal.timeout(7000),
    cache: 'no-store',
  })
  assert.equal(response.ok, true)
  const payload = await response.json()
  assert.ok(Number.isFinite(payload?.rates?.CNY) && payload.rates.CNY > 0)
  assert.ok(Number.isFinite(payload?.rates?.HKD) && payload.rates.HKD > 0)

  exchangeRateService.clearCache()
  const rates = await exchangeRateService.getRates()
  assert.equal(rates.CNY, 1)
  assert.ok(Number.isFinite(rates.USD) && rates.USD > 0)
  assert.ok(Number.isFinite(rates.HKD) && rates.HKD > 0)
})
