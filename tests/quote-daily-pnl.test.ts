import assert from 'node:assert/strict'
import test from 'node:test'
import { getDailyQuotePnl, getMarketDate, hasMarketOpened, isMarketHoliday, isMarketTradingDay, type MarketHolidayCalendar } from '@/lib/quoteDailyPnl'
import type { StockQuote } from '@/types/stockApi'

const chinaHolidayCalendar2026: MarketHolidayCalendar = {
  market: 'A',
  year: 2026,
  holidays: ['2026-05-01', '2026-05-04', '2026-05-05'],
  source: 'test',
  fetchedAt: '2026-01-01T00:00:00.000Z',
}

function quote(overrides: Partial<StockQuote> = {}): StockQuote {
  return {
    symbol: '601838',
    name: '成都银行',
    price: 10,
    change: 0.5,
    changePercent: 5.26,
    timestamp: '2026-05-04T10:30:00+08:00',
    currency: 'CNY',
    source: 'test',
    ...overrides,
  }
}

test('getDailyQuotePnl ignores weekend quotes for A shares', () => {
  const sundayBeijing = new Date('2026-05-03T10:00:00+08:00')
  const result = getDailyQuotePnl(100, quote({ timestamp: '2026-05-02T15:00:00+08:00' }), 'A', sundayBeijing)

  assert.equal(result.state, 'market-closed')
  assert.equal(result.amount, 0)
  assert.equal(result.rate, 0)
})

test('getDailyQuotePnl ignores stale previous trading day quotes', () => {
  const wednesdayBeijing = new Date('2026-05-06T10:00:00+08:00')
  const result = getDailyQuotePnl(100, quote({ timestamp: '2026-04-30T15:00:00+08:00' }), 'A', wednesdayBeijing)

  assert.equal(result.state, 'stale-quote')
  assert.equal(result.amount, 0)
  assert.equal(result.rate, 0)
})

test('getDailyQuotePnl uses same-day market quotes', () => {
  const wednesdayBeijing = new Date('2026-05-06T10:00:00+08:00')
  const result = getDailyQuotePnl(100, quote({ timestamp: '2026-05-06T09:45:00+08:00' }), 'A', wednesdayBeijing)

  assert.equal(result.state, 'active')
  assert.equal(result.amount, 50)
  assert.equal(result.previousValue, 950)
  assert.equal(Number(result.rate?.toFixed(2)), 5.26)
})

test('getDailyQuotePnl ignores same-day A-share quotes before market open', () => {
  const beforeOpen = new Date('2026-05-06T09:20:00+08:00')
  const result = getDailyQuotePnl(100, quote({ timestamp: '2026-05-06T09:20:00+08:00' }), 'A', beforeOpen)

  assert.equal(isMarketTradingDay('A', beforeOpen), true)
  assert.equal(hasMarketOpened('A', beforeOpen), false)
  assert.equal(result.state, 'market-not-open')
  assert.equal(result.amount, 0)
  assert.equal(result.rate, 0)
})

test('getDailyQuotePnl starts A-share daily pnl at market open', () => {
  const openTime = new Date('2026-05-06T09:30:00+08:00')
  const result = getDailyQuotePnl(100, quote({ timestamp: '2026-05-06T09:30:00+08:00' }), 'A', openTime)

  assert.equal(hasMarketOpened('A', openTime), true)
  assert.equal(result.state, 'active')
  assert.equal(result.amount, 50)
})

test('A shares are closed during the 2026 Labor Day holiday', () => {
  const laborDayHoliday = new Date('2026-05-04T10:00:00+08:00')
  const result = getDailyQuotePnl(100, quote({ timestamp: '2026-05-04T09:45:00+08:00' }), 'A', laborDayHoliday, chinaHolidayCalendar2026)

  assert.equal(isMarketHoliday('A', laborDayHoliday), false)
  assert.equal(isMarketHoliday('A', laborDayHoliday, chinaHolidayCalendar2026), true)
  assert.equal(isMarketTradingDay('A', laborDayHoliday, chinaHolidayCalendar2026), false)
  assert.equal(result.state, 'market-closed')
  assert.equal(result.amount, 0)
  assert.equal(result.rate, 0)
})

test('US trading day remains open on 2026-05-04 New York time', () => {
  const mondayNewYorkMarketHours = new Date('2026-05-04T22:00:00+08:00')

  assert.equal(getMarketDate(mondayNewYorkMarketHours, 'US'), '2026-05-04')
  assert.equal(isMarketTradingDay('US', mondayNewYorkMarketHours), true)
})

test('US market daily pnl waits for New York open time', () => {
  const beforeOpenNewYork = new Date('2026-05-04T21:20:00+08:00')
  const openNewYork = new Date('2026-05-04T21:30:00+08:00')

  assert.equal(getMarketDate(beforeOpenNewYork, 'US'), '2026-05-04')
  assert.equal(isMarketTradingDay('US', beforeOpenNewYork), true)
  assert.equal(hasMarketOpened('US', beforeOpenNewYork), false)
  assert.equal(hasMarketOpened('US', openNewYork), true)
})

test('US market is closed on Sunday Beijing time', () => {
  const sundayBeijing = new Date('2026-05-03T10:00:00+08:00')

  assert.equal(isMarketTradingDay('US', sundayBeijing), false)
  assert.equal(getMarketDate(sundayBeijing, 'US'), '2026-05-02')
})

test('date-only quote timestamps keep the market trading date', () => {
  const mondayNewYork = new Date('2026-05-04T10:00:00-04:00')
  const result = getDailyQuotePnl(
    100,
    quote({
      symbol: 'AAPL',
      timestamp: '2026-05-01',
      currency: 'USD',
    }),
    'US',
    mondayNewYork,
  )

  assert.equal(result.state, 'stale-quote')
  assert.equal(result.amount, 0)
})
