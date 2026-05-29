import { THIRD_PARTY_REQUEST_HEADERS, thirdPartyApiUrls } from '@/lib/external/thirdPartyApis'
import { loggedFetch } from '@/lib/observability/fetch'
import { logger } from '@/lib/observability/logger'
import { getEastmoneySecId, normalizeAStockCode, parseDate, parseNumber } from '@/lib/external/aShare/utils'
import type {
  AShareBlockTrade,
  AShareDividend,
  AShareFundFlowDaily,
  AShareHolderChange,
  AShareLockupExpiry,
  AShareMarginTrading,
  AShareResearchReport,
  AShareStockInfo,
  DragonTigerBoard,
  DragonTigerSeat,
  EastmoneyDatacenterRow,
} from '@/lib/external/aShare/types'

type DatacenterOptions = {
  columns?: string
  filter?: string
  pageSize?: number
  pageNumber?: number
  sortColumns?: string
  sortTypes?: string
}

function text(row: EastmoneyDatacenterRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key]
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim()
  }
  return ''
}

function numberField(row: EastmoneyDatacenterRow, keys: string[]) {
  for (const key of keys) {
    const value = parseNumber(row[key])
    if (value !== null) return value
  }
  return null
}

function dateField(row: EastmoneyDatacenterRow, keys: string[]) {
  for (const key of keys) {
    const value = parseDate(row[key])
    if (value) return value
  }
  return null
}

export async function eastmoneyDatacenter(reportName: string, options: DatacenterOptions = {}) {
  const url = thirdPartyApiUrls.eastmoneyDatacenter({
    reportName,
    columns: options.columns ?? 'ALL',
    filter: options.filter ?? '',
    pageNumber: options.pageNumber ?? 1,
    pageSize: options.pageSize ?? 50,
    sortColumns: options.sortColumns ?? '',
    sortTypes: options.sortTypes ?? '-1',
    source: 'WEB',
    client: 'WEB',
  })

  const res = await loggedFetch(url, {
    headers: THIRD_PARTY_REQUEST_HEADERS.browserLike,
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  }, {
    operation: 'ashare.eastmoney.datacenter',
    provider: 'eastmoney',
    resource: reportName,
  })
  if (!res.ok) return []
  const json = await res.json().catch(() => null) as { result?: { data?: EastmoneyDatacenterRow[] } } | null
  return Array.isArray(json?.result?.data) ? json.result.data : []
}

export async function fetchEastmoneyStockInfo(code: string): Promise<AShareStockInfo | null> {
  const normalized = normalizeAStockCode(code)
  try {
    const url = thirdPartyApiUrls.eastmoneyStockGet({
      fltt: 2,
      invt: 2,
      fields: 'f57,f58,f84,f85,f127,f116,f117,f189,f43',
      secid: getEastmoneySecId(normalized),
    })
    const res = await loggedFetch(url, {
      headers: THIRD_PARTY_REQUEST_HEADERS.browserLike,
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    }, {
      operation: 'ashare.eastmoney.stockInfo',
      provider: 'eastmoney',
      resource: normalized,
    })
    if (!res.ok) return null
    const json = await res.json().catch(() => null) as { data?: Record<string, unknown> } | null
    const data = json?.data
    if (!data) return null
    return {
      code: String(data.f57 ?? normalized),
      name: String(data.f58 ?? ''),
      industry: data.f127 ? String(data.f127) : null,
      totalShares: parseNumber(data.f84),
      floatShares: parseNumber(data.f85),
      marketCap: parseNumber(data.f116),
      floatMarketCap: parseNumber(data.f117),
      listDate: parseDate(data.f189),
      price: parseNumber(data.f43),
      source: 'eastmoney-stock-info',
    }
  } catch (error) {
    logger.warn('ashare.eastmoney.stockInfo.failed', { error, code: normalized })
    return null
  }
}

export async function fetchEastmoneyResearchReports(code: string, limit = 8): Promise<AShareResearchReport[]> {
  const normalized = normalizeAStockCode(code)
  try {
    const url = thirdPartyApiUrls.eastmoneyReportList({
      industryCode: '*',
      pageSize: Math.min(Math.max(limit, 1), 50),
      industry: '*',
      rating: '*',
      ratingChange: '*',
      beginTime: '2000-01-01',
      endTime: '2030-01-01',
      pageNo: 1,
      qType: 0,
      orgCode: '',
      code: normalized,
      rcode: '',
      p: 1,
      pageNum: 1,
      pageNumber: 1,
    })
    const res = await loggedFetch(url, {
      headers: { ...THIRD_PARTY_REQUEST_HEADERS.browserLike, Referer: 'https://data.eastmoney.com/' },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    }, {
      operation: 'ashare.eastmoney.reports',
      provider: 'eastmoney-reportapi',
      resource: normalized,
    })
    if (!res.ok) return []
    const json = await res.json().catch(() => null) as { data?: Record<string, unknown>[] } | null
    const rows = Array.isArray(json?.data) ? json.data : []
    return rows.slice(0, limit).map((row) => {
      const infoCode = row.infoCode ? String(row.infoCode) : null
      return {
        title: String(row.title ?? ''),
        publishDate: parseDate(row.publishDate),
        orgName: row.orgSName ? String(row.orgSName) : null,
        rating: row.emRatingName ? String(row.emRatingName) : null,
        industry: row.indvInduName ? String(row.indvInduName) : null,
        infoCode,
        pdfUrl: infoCode ? `https://pdf.dfcfw.com/pdf/H3_${infoCode}_1.pdf` : null,
        epsForecasts: {
          currentYear: parseNumber(row.predictThisYearEps),
          nextYear: parseNumber(row.predictNextYearEps),
          nextTwoYear: parseNumber(row.predictNextTwoYearEps),
        },
        source: 'eastmoney-reportapi' as const,
      }
    }).filter((item) => item.title)
  } catch (error) {
    logger.warn('ashare.eastmoney.reports.failed', { error, code: normalized })
    return []
  }
}

function toSeat(row: EastmoneyDatacenterRow): DragonTigerSeat {
  return {
    name: text(row, ['OPERATEDEPT_NAME', 'EXPLANATION']),
    buyWan: numberField(row, ['BUY']),
    sellWan: numberField(row, ['SELL']),
    netWan: numberField(row, ['NET']),
  }
}

export async function fetchDragonTigerBoard(code: string, tradeDate = new Date().toISOString().slice(0, 10)): Promise<DragonTigerBoard> {
  const normalized = normalizeAStockCode(code)
  const start = new Date(`${tradeDate}T00:00:00+08:00`)
  start.setDate(start.getDate() - 45)
  const startDate = start.toISOString().slice(0, 10)
  try {
    const rows = await eastmoneyDatacenter('RPT_DAILYBILLBOARD_DETAILSNEW', {
      filter: `(TRADE_DATE>='${startDate}')(TRADE_DATE<='${tradeDate}')(SECURITY_CODE="${normalized}")`,
      pageSize: 50,
      sortColumns: 'TRADE_DATE',
      sortTypes: '-1',
    })
    const records = rows.map((row) => ({
      date: dateField(row, ['TRADE_DATE']),
      reason: text(row, ['EXPLANATION']),
      netBuyWan: numberField(row, ['BILLBOARD_NET_AMT']) !== null ? Number((numberField(row, ['BILLBOARD_NET_AMT'])! / 10_000).toFixed(1)) : null,
      turnoverPercent: numberField(row, ['TURNOVERRATE']),
    }))

    const latestDate = records[0]?.date
    const [buyRows, sellRows] = latestDate ? await Promise.all([
      eastmoneyDatacenter('RPT_BILLBOARD_DAILYDETAILSBUY', {
        filter: `(TRADE_DATE='${latestDate}')(SECURITY_CODE="${normalized}")`,
        pageSize: 10,
        sortColumns: 'BUY',
        sortTypes: '-1',
      }),
      eastmoneyDatacenter('RPT_BILLBOARD_DAILYDETAILSSELL', {
        filter: `(TRADE_DATE='${latestDate}')(SECURITY_CODE="${normalized}")`,
        pageSize: 10,
        sortColumns: 'SELL',
        sortTypes: '-1',
      }),
    ]) : [[], []]

    return {
      records,
      seats: {
        buy: buyRows.slice(0, 5).map(toSeat),
        sell: sellRows.slice(0, 5).map(toSeat),
      },
      source: 'eastmoney-datacenter',
    }
  } catch (error) {
    logger.warn('ashare.eastmoney.dragonTiger.failed', { error, code: normalized })
    return { records: [], seats: { buy: [], sell: [] }, source: 'eastmoney-datacenter' }
  }
}

export async function fetchLockupExpiry(code: string, tradeDate = new Date().toISOString().slice(0, 10), days = 90): Promise<AShareLockupExpiry[]> {
  const normalized = normalizeAStockCode(code)
  const end = new Date(`${tradeDate}T00:00:00+08:00`)
  end.setDate(end.getDate() + days)
  const endDate = end.toISOString().slice(0, 10)
  const rows = await eastmoneyDatacenter('RPT_LIFT_STAGE', {
    filter: `(SECURITY_CODE="${normalized}")(LIFT_DATE>='${tradeDate}')(LIFT_DATE<='${endDate}')`,
    pageSize: 30,
    sortColumns: 'LIFT_DATE',
    sortTypes: '1',
  }).catch(() => [])
  return rows.map((row) => ({
    date: dateField(row, ['LIFT_DATE']),
    shares: numberField(row, ['LIFT_NUM', 'LIFT_SHARES']),
    marketValue: numberField(row, ['LIFT_MARKET_CAP', 'FREE_MARKET_CAP']),
    ratio: numberField(row, ['FREE_RATIO', 'LIFT_RATIO']),
    shareholder: text(row, ['HOLDER_NAME', 'SHAREHOLDER_NAME']) || null,
  }))
}

export async function fetchMarginTrading(code: string, limit = 10): Promise<AShareMarginTrading[]> {
  const normalized = normalizeAStockCode(code)
  const rows = await eastmoneyDatacenter('RPTA_WEB_RZRQ_GGMX', {
    filter: `(SCODE="${normalized}")`,
    pageSize: limit,
    sortColumns: 'DATE',
    sortTypes: '-1',
  }).catch(() => [])
  return rows.map((row) => ({
    date: dateField(row, ['DATE', 'TRADE_DATE']),
    financingBalance: numberField(row, ['RZYE']),
    financingBuy: numberField(row, ['RZMRE']),
    financingRepay: numberField(row, ['RZCHE']),
    securitiesLendingBalance: numberField(row, ['RQYE']),
  }))
}

export async function fetchBlockTrades(code: string, limit = 10): Promise<AShareBlockTrade[]> {
  const normalized = normalizeAStockCode(code)
  const rows = await eastmoneyDatacenter('RPT_BLOCKTRADE_DET', {
    filter: `(SECURITY_CODE="${normalized}")`,
    pageSize: limit,
    sortColumns: 'TRADE_DATE',
    sortTypes: '-1',
  }).catch(() => [])
  return rows.map((row) => ({
    date: dateField(row, ['TRADE_DATE']),
    price: numberField(row, ['DEAL_PRICE', 'PRICE']),
    volume: numberField(row, ['DEAL_VOLUME', 'VOLUME']),
    amount: numberField(row, ['DEAL_AMT', 'AMOUNT']),
    buyer: text(row, ['BUYER_NAME', 'BUYER']) || null,
    seller: text(row, ['SELLER_NAME', 'SELLER']) || null,
    discountRate: numberField(row, ['CHANGE_RATE', 'DISCOUNT_RATE']),
  }))
}

export async function fetchHolderChanges(code: string, limit = 8): Promise<AShareHolderChange[]> {
  const normalized = normalizeAStockCode(code)
  const rows = await eastmoneyDatacenter('RPT_HOLDERNUM_DET', {
    filter: `(SECURITY_CODE="${normalized}")`,
    pageSize: limit,
    sortColumns: 'END_DATE',
    sortTypes: '-1',
  }).catch(() => [])
  return rows.map((row) => ({
    reportDate: dateField(row, ['END_DATE', 'REPORT_DATE']),
    holderCount: numberField(row, ['HOLDER_NUM']),
    changeRatio: numberField(row, ['HOLDER_NUM_RATIO', 'HOLDER_NUM_CHANGE_RATE']),
    avgHoldingMarketValue: numberField(row, ['AVG_MARKET_CAP', 'AVG_HOLDING_MARKET_CAP']),
  }))
}

export async function fetchDividendHistory(code: string, limit = 10): Promise<AShareDividend[]> {
  const normalized = normalizeAStockCode(code)
  const rows = await eastmoneyDatacenter('RPT_SHAREBONUS_DET', {
    filter: `(SECURITY_CODE="${normalized}")`,
    pageSize: limit,
    sortColumns: 'EX_DIVIDEND_DATE',
    sortTypes: '-1',
  }).catch(() => [])
  return rows.map((row) => ({
    exDividendDate: dateField(row, ['EX_DIVIDEND_DATE', 'EQUITY_RECORD_DATE']),
    plan: text(row, ['IMPL_PLAN_PROFILE', 'ASSIGN_PROGRESS', 'PLAN_EXPLAIN']),
    cashPerShare: numberField(row, ['PRETAX_BONUS_RMB']) !== null ? Number((numberField(row, ['PRETAX_BONUS_RMB'])! / 10).toFixed(6)) : null,
    bonusSharesPerShare: numberField(row, ['BONUS_IT_RATIO']) !== null ? Number((numberField(row, ['BONUS_IT_RATIO'])! / 10).toFixed(6)) : null,
    transferSharesPerShare: numberField(row, ['TRANSFER_RATIO']) !== null ? Number((numberField(row, ['TRANSFER_RATIO'])! / 10).toFixed(6)) : null,
  }))
}

export async function fetchFundFlow120d(code: string): Promise<AShareFundFlowDaily[]> {
  const normalized = normalizeAStockCode(code)
  try {
    const url = thirdPartyApiUrls.eastmoneyStockFundFlow({
      lmt: 120,
      klt: 101,
      secid: getEastmoneySecId(normalized),
      fields1: 'f1,f2,f3,f7',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63',
    })
    const res = await loggedFetch(url, {
      headers: THIRD_PARTY_REQUEST_HEADERS.browserLike,
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    }, {
      operation: 'ashare.eastmoney.fundFlow120d',
      provider: 'eastmoney-push2his',
      resource: normalized,
    })
    if (!res.ok) return []
    const json = await res.json().catch(() => null) as { data?: { klines?: string[] } } | null
    const rows = Array.isArray(json?.data?.klines) ? json.data.klines : []
    return rows.map((line) => {
      const parts = line.split(',')
      return {
        date: parseDate(parts[0]),
        mainNet: parseNumber(parts[1]),
        superLargeNet: parseNumber(parts[3]),
        largeNet: parseNumber(parts[5]),
        mediumNet: parseNumber(parts[7]),
        smallNet: parseNumber(parts[9]),
      }
    })
  } catch (error) {
    logger.warn('ashare.eastmoney.fundFlow120d.failed', { error, code: normalized })
    return []
  }
}
