import { THIRD_PARTY_REQUEST_HEADERS, thirdPartyApiUrls } from '@/lib/external/thirdPartyApis'
import { loggedFetch } from '@/lib/observability/fetch'
import { logger } from '@/lib/observability/logger'
import { parseDate, parseNumber, rawNumber, toYahooSymbol } from '@/lib/external/globalStock/utils'
import type { Market } from '@/types'
import type {
  GlobalStockNews,
  YahooAnalystEstimate,
  YahooInstitutionalHolders,
  YahooKeyStatistics,
  YahooOptionContract,
  YahooOptionsChain,
} from '@/lib/external/globalStock/types'

let crumbCache: { crumb: string; cookie: string; expiresAt: number } | null = null

async function getYahooSessionHeaders() {
  if (crumbCache && crumbCache.expiresAt > Date.now()) return crumbCache
  const fc = await loggedFetch(thirdPartyApiUrls.yahooFc(), {
    headers: THIRD_PARTY_REQUEST_HEADERS.yahooFinance,
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  }, {
    operation: 'global.yahoo.fc',
    provider: 'yahoo-finance',
    failureLevel: 'warn',
  })
  const cookie = fc.headers.get('set-cookie') ?? ''
  const crumbRes = await loggedFetch(thirdPartyApiUrls.yahooCrumb(), {
    headers: { ...THIRD_PARTY_REQUEST_HEADERS.yahooFinance, ...(cookie ? { Cookie: cookie } : {}) },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  }, {
    operation: 'global.yahoo.crumb',
    provider: 'yahoo-finance',
    failureLevel: 'warn',
  })
  if (!crumbRes.ok) throw new Error(`Yahoo crumb failed: ${crumbRes.status}`)
  const crumb = (await crumbRes.text()).trim()
  crumbCache = { crumb, cookie, expiresAt: Date.now() + 30 * 60 * 1000 }
  return crumbCache
}

async function yahooJson(url: string) {
  const session = await getYahooSessionHeaders()
  const res = await loggedFetch(url, {
    headers: {
      ...THIRD_PARTY_REQUEST_HEADERS.yahooFinance,
      ...(session.cookie ? { Cookie: session.cookie } : {}),
    },
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  }, {
    operation: 'global.yahoo.fetch',
    provider: 'yahoo-finance',
    resource: url,
    failureLevel: 'warn',
  })
  if (!res.ok) return null
  return res.json().catch(() => null)
}

export async function yahooQuoteSummary(symbol: string, modules: string[]) {
  try {
    const session = await getYahooSessionHeaders()
    const url = thirdPartyApiUrls.yahooQuoteSummary(symbol, {
      modules: modules.join(','),
      crumb: session.crumb,
    })
    const json = await yahooJson(url) as { quoteSummary?: { result?: Record<string, unknown>[] } } | null
    return json?.quoteSummary?.result?.[0] ?? null
  } catch (error) {
    logger.warn('global.yahoo.quoteSummary.failed', { error, symbol, modules })
    return null
  }
}

export async function fetchYahooKeyStatistics(symbol: string, market: Market): Promise<YahooKeyStatistics | null> {
  const yahooSymbol = toYahooSymbol(symbol, market)
  const data = await yahooQuoteSummary(yahooSymbol, ['financialData', 'defaultKeyStatistics', 'summaryDetail'])
  if (!data) return null
  const fd = data.financialData && typeof data.financialData === 'object' ? data.financialData as Record<string, unknown> : {}
  const ks = data.defaultKeyStatistics && typeof data.defaultKeyStatistics === 'object' ? data.defaultKeyStatistics as Record<string, unknown> : {}
  const sd = data.summaryDetail && typeof data.summaryDetail === 'object' ? data.summaryDetail as Record<string, unknown> : {}
  return {
    currentPrice: rawNumber(fd.currentPrice),
    targetHigh: rawNumber(fd.targetHighPrice),
    targetLow: rawNumber(fd.targetLowPrice),
    targetMean: rawNumber(fd.targetMeanPrice),
    recommendation: typeof fd.recommendationKey === 'string' ? fd.recommendationKey : null,
    trailingPe: rawNumber(sd.trailingPE),
    forwardPe: rawNumber(ks.forwardPE),
    pegRatio: rawNumber(ks.pegRatio),
    priceToBook: rawNumber(ks.priceToBook),
    enterpriseValue: rawNumber(ks.enterpriseValue),
    evToEbitda: rawNumber(ks.enterpriseToEbitda),
    evToRevenue: rawNumber(ks.enterpriseToRevenue),
    profitMargin: rawNumber(ks.profitMargins),
    operatingMargin: rawNumber(fd.operatingMargins),
    grossMargin: rawNumber(fd.grossMargins),
    returnOnEquity: rawNumber(fd.returnOnEquity),
    returnOnAssets: rawNumber(fd.returnOnAssets),
    earningsGrowth: rawNumber(fd.earningsGrowth),
    revenueGrowth: rawNumber(fd.revenueGrowth),
    beta: rawNumber(ks.beta),
    dividendYield: rawNumber(sd.dividendYield),
    marketCap: rawNumber(sd.marketCap),
    totalRevenue: rawNumber(fd.totalRevenue),
    totalCash: rawNumber(fd.totalCash),
    totalDebt: rawNumber(fd.totalDebt),
  }
}

export async function fetchYahooAnalystEstimates(symbol: string, market: Market): Promise<YahooAnalystEstimate | null> {
  const yahooSymbol = toYahooSymbol(symbol, market)
  const data = await yahooQuoteSummary(yahooSymbol, ['earningsTrend', 'recommendationTrend', 'upgradeDowngradeHistory', 'earnings', 'earningsHistory'])
  if (!data) return null
  const earningsTrend = data.earningsTrend && typeof data.earningsTrend === 'object' ? data.earningsTrend as { trend?: Record<string, unknown>[] } : {}
  const recommendationTrend = data.recommendationTrend && typeof data.recommendationTrend === 'object' ? data.recommendationTrend as { trend?: Record<string, unknown>[] } : {}
  const upgradeDowngradeHistory = data.upgradeDowngradeHistory && typeof data.upgradeDowngradeHistory === 'object' ? data.upgradeDowngradeHistory as { history?: Record<string, unknown>[] } : {}
  return {
    epsTrend: (earningsTrend.trend ?? []).map((item) => {
      const earningsEstimate = item.earningsEstimate && typeof item.earningsEstimate === 'object' ? item.earningsEstimate as Record<string, unknown> : {}
      const revenueEstimate = item.revenueEstimate && typeof item.revenueEstimate === 'object' ? item.revenueEstimate as Record<string, unknown> : {}
      return {
        period: typeof item.period === 'string' ? item.period : null,
        endDate: parseDate(item.endDate),
        epsEstimate: rawNumber((earningsEstimate.avg as Record<string, unknown> | undefined) ?? null),
        epsHigh: rawNumber((earningsEstimate.high as Record<string, unknown> | undefined) ?? null),
        epsLow: rawNumber((earningsEstimate.low as Record<string, unknown> | undefined) ?? null),
        revenueEstimate: rawNumber((revenueEstimate.avg as Record<string, unknown> | undefined) ?? null),
        numAnalysts: rawNumber((earningsEstimate.numberOfAnalysts as Record<string, unknown> | undefined) ?? null),
      }
    }),
    ratingTrend: (recommendationTrend.trend ?? []).slice(0, 8),
    upgradeDowngrade: (upgradeDowngradeHistory.history ?? []).slice(0, 20),
  }
}

export async function fetchYahooInstitutionalHolders(symbol: string, market: Market): Promise<YahooInstitutionalHolders | null> {
  const yahooSymbol = toYahooSymbol(symbol, market)
  const data = await yahooQuoteSummary(yahooSymbol, ['institutionOwnership', 'majorHoldersBreakdown'])
  if (!data) return null
  const major = data.majorHoldersBreakdown && typeof data.majorHoldersBreakdown === 'object' ? data.majorHoldersBreakdown as Record<string, unknown> : {}
  const ownership = data.institutionOwnership && typeof data.institutionOwnership === 'object' ? data.institutionOwnership as { ownershipList?: Record<string, unknown>[] } : {}
  return {
    overview: {
      insidersPercentHeld: rawNumber(major.insidersPercentHeld),
      institutionsPercentHeld: rawNumber(major.institutionsPercentHeld),
      institutionsFloatPercentHeld: rawNumber(major.institutionsFloatPercentHeld),
      institutionsCount: rawNumber(major.institutionsCount),
    },
    topHolders: (ownership.ownershipList ?? []).slice(0, 10),
  }
}

function parseOption(item: Record<string, unknown>): YahooOptionContract {
  return {
    strike: rawNumber(item.strike),
    lastPrice: rawNumber(item.lastPrice),
    bid: rawNumber(item.bid),
    ask: rawNumber(item.ask),
    volume: rawNumber(item.volume),
    openInterest: rawNumber(item.openInterest),
    impliedVolatility: rawNumber(item.impliedVolatility),
    inTheMoney: typeof item.inTheMoney === 'boolean' ? item.inTheMoney : null,
    expiration: parseDate(item.expiration),
    contractSymbol: typeof item.contractSymbol === 'string' ? item.contractSymbol : null,
  }
}

export async function fetchYahooOptionsChain(symbol: string, expiration?: number): Promise<YahooOptionsChain | null> {
  try {
    const session = await getYahooSessionHeaders()
    const url = thirdPartyApiUrls.yahooOptions(symbol.toUpperCase(), {
      crumb: session.crumb,
      ...(expiration ? { date: expiration } : {}),
    })
    const json = await yahooJson(url) as { optionChain?: { result?: Array<Record<string, unknown>> } } | null
    const result = json?.optionChain?.result?.[0]
    if (!result) return null
    const options = Array.isArray(result.options) ? result.options[0] as Record<string, unknown> | undefined : undefined
    return {
      expirationDates: Array.isArray(result.expirationDates) ? result.expirationDates.filter((item): item is number => typeof item === 'number') : [],
      calls: Array.isArray(options?.calls) ? options.calls.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')).map(parseOption) : [],
      puts: Array.isArray(options?.puts) ? options.puts.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')).map(parseOption) : [],
      underlyingPrice: result.quote && typeof result.quote === 'object' ? rawNumber((result.quote as Record<string, unknown>).regularMarketPrice) : null,
      source: 'yahoo-options',
    }
  } catch (error) {
    logger.warn('global.yahoo.options.failed', { error, symbol })
    return null
  }
}

export async function fetchYahooNews(keyword: string, limit = 10): Promise<GlobalStockNews[]> {
  try {
    const url = thirdPartyApiUrls.yahooFinanceSearch({ q: keyword, quotesCount: 0, newsCount: limit })
    const json = await yahooJson(url) as { news?: Record<string, unknown>[] } | null
    const news = Array.isArray(json?.news) ? json.news : []
    return news.slice(0, limit).map((item) => ({
      title: String(item.title ?? ''),
      publisher: item.publisher ? String(item.publisher) : null,
      link: item.link ? String(item.link) : null,
      publishTime: parseNumber(item.providerPublishTime),
      thumbnail: item.thumbnail && typeof item.thumbnail === 'object'
        ? ((((item.thumbnail as Record<string, unknown>).resolutions as Record<string, unknown>[] | undefined)?.[0]?.url as string | undefined) ?? null)
        : null,
    })).filter((item) => item.title)
  } catch (error) {
    logger.warn('global.yahoo.news.failed', { error, keyword })
    return []
  }
}
