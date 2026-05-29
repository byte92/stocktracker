import type { Market } from '@/types'
import type { GlobalStockMarket } from '@/lib/external/globalStock/types'

export function toYahooSymbol(symbol: string, market: Market) {
  const normalized = symbol.trim().toUpperCase()
  if (market === 'HK') return `${normalized.replace(/^0+/, '').padStart(4, '0')}.HK`
  return normalized
}

export function normalizeGlobalSymbol(symbol: string, market: Market) {
  const trimmed = symbol.trim().toUpperCase()
  if (market === 'HK') return trimmed.replace(/\.HK$/, '').padStart(5, '0')
  return trimmed
}

export function parseGlobalMarket(mktNum: unknown): GlobalStockMarket | null {
  const value = String(mktNum ?? '')
  if (value === '116') return 'HK'
  if (value === '105' || value === '106' || value === '107') return 'US'
  return null
}

export function secucodeFor(symbol: string, market: Market, mktNum?: number | null) {
  const normalized = normalizeGlobalSymbol(symbol, market)
  if (market === 'HK') return `${normalized}.HK`
  if (mktNum === 106) return `${normalized}.N`
  return `${normalized}.O`
}

export function secidFor(symbol: string, market: Market, mktNum?: number | null) {
  const normalized = normalizeGlobalSymbol(symbol, market)
  if (market === 'HK') return `116.${normalized}`
  return `${mktNum ?? 105}.${normalized}`
}

export function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const normalized = String(value).replace(/,/g, '').replace(/%$/, '').trim()
  if (!normalized || normalized === '-' || normalized === '--') return null
  const num = Number(normalized)
  return Number.isFinite(num) ? num : null
}

export function rawNumber(value: unknown): number | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    return parseNumber(record.raw ?? record.fmt)
  }
  return parseNumber(value)
}

export function parseDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') {
    if (value > 10_000_000_000) return new Date(value).toISOString().slice(0, 10)
    if (value > 1_000_000_000) return new Date(value * 1000).toISOString().slice(0, 10)
  }
  const raw = String(value).trim()
  const ymd = raw.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/)?.[0]
  if (ymd) {
    const [year, month, day] = ymd.replace(/\//g, '-').split('-')
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  return raw.slice(0, 10) || null
}

export function toSecCik(value: string | number) {
  return String(value).replace(/\D/g, '').padStart(10, '0')
}

export function compactJson(value: unknown, maxLength = 1200) {
  const text = JSON.stringify(value, null, 2)
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}
