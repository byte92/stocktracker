import { eastmoneyDatacenter } from '@/lib/external/aShare/eastmoney'
import { THIRD_PARTY_REQUEST_HEADERS, thirdPartyApiUrls } from '@/lib/external/thirdPartyApis'
import { loggedFetch } from '@/lib/observability/fetch'
import { logger } from '@/lib/observability/logger'
import {
  normalizeGlobalSymbol,
  parseDate,
  parseGlobalMarket,
  parseNumber,
  secidFor,
  secucodeFor,
} from '@/lib/external/globalStock/utils'
import type { Market } from '@/types'
import type {
  GlobalFinancialStatementRow,
  GlobalFundFlowDaily,
  GlobalKeyIndicator,
  GlobalMarketListItem,
  GlobalStockSearchResult,
} from '@/lib/external/globalStock/types'

type Row = Record<string, unknown>

function text(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = row[key]
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim()
  }
  return ''
}

function num(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = parseNumber(row[key])
    if (value !== null) return value
  }
  return null
}

export async function searchGlobalStocks(keyword: string, limit = 10): Promise<GlobalStockSearchResult[]> {
  try {
    const url = thirdPartyApiUrls.eastmoneySearch({
      input: keyword,
      type: 14,
      token: 'D43BF722C8E33BDC906FB84D85E326E8',
      count: limit,
    })
    const res = await loggedFetch(url, {
      headers: THIRD_PARTY_REQUEST_HEADERS.browserLike,
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    }, {
      operation: 'global.eastmoney.search',
      provider: 'eastmoney-search',
      resource: keyword,
    })
    if (!res.ok) return []
    const json = await res.json().catch(() => null) as { QuotationCodeTable?: { Data?: Row[] } } | null
    const rows = Array.isArray(json?.QuotationCodeTable?.Data) ? json.QuotationCodeTable.Data : []
    return rows.map((row) => {
      const market = parseGlobalMarket(row.MktNum)
      if (!market) return null
      const code = String(row.Code ?? '').toUpperCase()
      const mktNum = parseNumber(row.MktNum)
      return {
        code: normalizeGlobalSymbol(code, market),
        name: String(row.Name ?? ''),
        market,
        secid: secidFor(code, market, mktNum),
        secucode: secucodeFor(code, market, mktNum),
        mktNum,
        securityType: row.SecurityTypeName ? String(row.SecurityTypeName) : null,
      }
    }).filter((item): item is GlobalStockSearchResult => item !== null)
  } catch (error) {
    logger.warn('global.eastmoney.search.failed', { error, keyword })
    return []
  }
}

export async function resolveGlobalStock(symbol: string, market: Market): Promise<GlobalStockSearchResult | null> {
  if (market !== 'US' && market !== 'HK') return null
  const normalized = normalizeGlobalSymbol(symbol, market)
  const matches = await searchGlobalStocks(normalized, 10)
  const exact = matches.find((item) => item.market === market && item.code.replace(/^0+/, '') === normalized.replace(/^0+/, ''))
  if (exact) return exact
  return {
    code: normalized,
    name: '',
    market,
    secid: secidFor(normalized, market),
    secucode: secucodeFor(normalized, market),
    mktNum: market === 'HK' ? 116 : 105,
    securityType: null,
  }
}

export async function fetchGlobalFinancialStatement(
  target: GlobalStockSearchResult,
  statement: 'balance' | 'income' | 'cashflow',
  limit = 120,
): Promise<GlobalFinancialStatementRow[]> {
  const marketKey = target.market === 'HK' ? 'hk' : 'us'
  const reportMap = {
    balance: { us: 'RPT_USF10_FN_BALANCE', hk: 'RPT_HKF10_FN_BALANCE' },
    income: { us: 'RPT_USF10_FN_INCOME', hk: 'RPT_HKF10_FN_INCOME' },
    cashflow: { us: 'RPT_USSK_FN_CASHFLOW', hk: 'RPT_HKSK_FN_CASHFLOW' },
  }
  const rows = await eastmoneyDatacenter(reportMap[statement][marketKey], {
    filter: `(SECUCODE="${target.secucode}")`,
    pageSize: limit,
    sortColumns: 'REPORT_DATE',
    sortTypes: '-1',
  }).catch(() => [])
  return rows.map((row) => ({
    reportDate: parseDate(row.REPORT_DATE),
    report: row.REPORT ? String(row.REPORT) : null,
    itemName: text(row, ['ITEM_NAME', 'STD_ITEM_NAME']),
    amount: num(row, ['AMOUNT']),
    yoyRatio: num(row, ['YOY_RATIO']),
    currency: row.CURRENCY ? String(row.CURRENCY) : null,
    values: row,
  })).filter((row) => row.itemName)
}

export async function fetchGlobalKeyIndicators(target: GlobalStockSearchResult, limit = 6): Promise<GlobalKeyIndicator[]> {
  const reportName = `RPT_${target.market === 'HK' ? 'HK' : 'US'}F10_FN_GMAININDICATOR`
  const rows = await eastmoneyDatacenter(reportName, {
    filter: `(SECUCODE="${target.secucode}")`,
    pageSize: limit,
    sortColumns: 'REPORT_DATE',
    sortTypes: '-1',
  }).catch(() => [])
  return rows.map((row) => ({
    reportDate: parseDate(row.REPORT_DATE),
    revenue: num(row, ['OPERATE_INCOME']),
    netProfit: num(row, ['PARENT_HOLDER_NETPROFIT', 'HOLDER_PROFIT', 'NETPROFIT']),
    eps: num(row, ['BASIC_EPS', 'DILUTED_EPS']),
    roe: num(row, ['ROE_AVG', 'ROE']),
    roa: num(row, ['ROA']),
    grossMargin: num(row, ['GROSS_PROFIT_RATIO']),
    netMargin: num(row, ['NET_PROFIT_RATIO']),
    debtAssetRatio: num(row, ['DEBT_ASSET_RATIO']),
    values: row,
  }))
}

export async function fetchGlobalFundFlow(target: GlobalStockSearchResult, limit = 100): Promise<GlobalFundFlowDaily[]> {
  try {
    const url = thirdPartyApiUrls.eastmoneyStockFundFlow({
      secid: target.secid,
      klt: 101,
      fields1: 'f1,f2,f3,f7',
      fields2: 'f51,f52,f53,f54,f55,f56,f57',
      lmt: limit,
    })
    const res = await loggedFetch(url, {
      headers: THIRD_PARTY_REQUEST_HEADERS.browserLike,
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    }, {
      operation: 'global.eastmoney.fundFlow',
      provider: 'eastmoney-push2his',
      resource: target.secid,
    })
    if (!res.ok) return []
    const json = await res.json().catch(() => null) as { data?: { klines?: string[] } } | null
    const rows = Array.isArray(json?.data?.klines) ? json.data.klines : []
    return rows.map((line) => {
      const parts = line.split(',')
      return {
        date: parseDate(parts[0]),
        mainNet: parseNumber(parts[1]),
        smallNet: parseNumber(parts[2]),
        mediumNet: parseNumber(parts[3]),
        largeNet: parseNumber(parts[4]),
        superLargeNet: parseNumber(parts[5]),
        mainPercent: parseNumber(parts[6]),
      }
    })
  } catch (error) {
    logger.warn('global.eastmoney.fundFlow.failed', { error, secid: target.secid })
    return []
  }
}

export async function fetchGlobalMarketList(market: 'us_nasdaq' | 'us_nyse' | 'us_etf' | 'hk', sortField = 'f3', sortDesc = true, limit = 20) {
  const marketMap = { us_nasdaq: 'm:105', us_nyse: 'm:106', us_etf: 'm:107', hk: 'm:116' }
  const url = thirdPartyApiUrls.eastmoneyStockList({
    fs: marketMap[market],
    fields: 'f2,f3,f4,f5,f6,f7,f12,f14,f15,f16,f17,f18',
    pn: 1,
    pz: limit,
    fid: sortField,
    po: sortDesc ? 1 : 0,
  })
  const res = await loggedFetch(url, {
    headers: THIRD_PARTY_REQUEST_HEADERS.browserLike,
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  }, {
    operation: 'global.eastmoney.marketList',
    provider: 'eastmoney-push2',
    resource: market,
  })
  if (!res.ok) return { total: 0, stocks: [] as GlobalMarketListItem[] }
  const json = await res.json().catch(() => null) as { data?: { total?: number; diff?: Row[] } } | null
  const rows = Array.isArray(json?.data?.diff) ? json.data.diff : []
  return {
    total: Number(json?.data?.total ?? rows.length),
    stocks: rows.map((row) => ({
      code: String(row.f12 ?? ''),
      name: String(row.f14 ?? ''),
      price: parseNumber(row.f2),
      changePercent: parseNumber(row.f3),
      changeAmount: parseNumber(row.f4),
      volume: parseNumber(row.f5),
      amount: parseNumber(row.f6),
      amplitude: parseNumber(row.f7),
      high: parseNumber(row.f15),
      low: parseNumber(row.f16),
      open: parseNumber(row.f17),
      prevClose: parseNumber(row.f18),
    })),
  }
}
