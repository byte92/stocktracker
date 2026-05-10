import type { Market } from '@/types'
import type { StockQuote } from '@/types/stockApi'

export type DailyQuoteState = 'active' | 'market-closed' | 'market-not-open' | 'stale-quote' | 'missing-quote'

export type DailyQuotePnl = {
  amount: number
  rate: number | null
  previousValue: number
  state: DailyQuoteState
}

export type MarketHolidayCalendar = {
  market: Market
  year: number
  holidays: string[]
  source: string
  fetchedAt: string
}

const MARKET_TIME_ZONES: Record<Market, string> = {
  A: 'Asia/Shanghai',
  FUND: 'Asia/Shanghai',
  HK: 'Asia/Hong_Kong',
  US: 'America/New_York',
  CRYPTO: 'UTC',
}

const MARKET_OPEN_MINUTES: Partial<Record<Market, number>> = {
  A: 9 * 60 + 30,
  FUND: 9 * 60 + 30,
  HK: 9 * 60 + 30,
  US: 9 * 60 + 30,
}

function getMarketTimeZone(market: Market) {
  return MARKET_TIME_ZONES[market] ?? 'UTC'
}

function getDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(date)

  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    weekday: value('weekday'),
  }
}

function getTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '0'
  return {
    hour: Number(value('hour')),
    minute: Number(value('minute')),
  }
}

export function getMarketDate(date: Date, market: Market) {
  return getDateParts(date, getMarketTimeZone(market)).date
}

export function needsMarketHolidayCalendar(market: Market) {
  return market === 'A' || market === 'FUND'
}

export function isMarketHoliday(market: Market, date = new Date(), calendar?: MarketHolidayCalendar | null) {
  if (!calendar || calendar.market !== market) return false

  const marketDate = getMarketDate(date, market)
  if (calendar.year !== Number(marketDate.slice(0, 4))) return false

  return calendar.holidays.includes(marketDate)
}

export function isMarketTradingDay(market: Market, date = new Date(), calendar?: MarketHolidayCalendar | null) {
  if (market === 'CRYPTO') return true

  const { weekday } = getDateParts(date, getMarketTimeZone(market))
  return weekday !== 'Sat' && weekday !== 'Sun' && !isMarketHoliday(market, date, calendar)
}

export function hasMarketOpened(market: Market, date = new Date(), calendar?: MarketHolidayCalendar | null) {
  if (market === 'CRYPTO') return true
  if (!isMarketTradingDay(market, date, calendar)) return false

  const openMinutes = MARKET_OPEN_MINUTES[market]
  if (openMinutes === undefined) return true

  const { hour, minute } = getTimeParts(date, getMarketTimeZone(market))
  return hour * 60 + minute >= openMinutes
}

function parseQuoteDate(timestamp: string | undefined, market: Market) {
  if (!timestamp) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(timestamp)) {
    return timestamp
  }

  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return null

  return getMarketDate(parsed, market)
}

export function getDailyQuotePnl(
  holding: number,
  quote: StockQuote | null | undefined,
  market: Market,
  now = new Date(),
  calendar?: MarketHolidayCalendar | null,
): DailyQuotePnl {
  if (!quote || holding <= 0) {
    return { amount: 0, rate: null, previousValue: 0, state: 'missing-quote' }
  }

  if (!isMarketTradingDay(market, now, calendar)) {
    return { amount: 0, rate: 0, previousValue: 0, state: 'market-closed' }
  }

  if (!hasMarketOpened(market, now, calendar)) {
    return { amount: 0, rate: 0, previousValue: 0, state: 'market-not-open' }
  }

  const quoteDate = parseQuoteDate(quote.timestamp, market)
  const marketDate = getMarketDate(now, market)
  if (quoteDate && quoteDate !== marketDate) {
    return { amount: 0, rate: 0, previousValue: 0, state: 'stale-quote' }
  }

  const previousClose = quote.price - quote.change
  const previousValue = holding * Math.max(previousClose, 0)
  const amount = holding * quote.change

  return {
    amount,
    rate: previousValue > 0 ? (amount / previousValue) * 100 : 0,
    previousValue,
    state: 'active',
  }
}
