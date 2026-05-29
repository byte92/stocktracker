import {
  fetchGlobalFinancialStatement,
  fetchGlobalFundFlow,
  fetchGlobalKeyIndicators,
  fetchGlobalMarketList,
  resolveGlobalStock,
  searchGlobalStocks,
} from '@/lib/external/globalStock/eastmoney'
import { fetchSecCompanyFacts, fetchSecFilings } from '@/lib/external/globalStock/sec'
import {
  fetchYahooAnalystEstimates,
  fetchYahooInstitutionalHolders,
  fetchYahooKeyStatistics,
  fetchYahooNews,
  fetchYahooOptionsChain,
} from '@/lib/external/globalStock/yahoo'
import type { Market } from '@/types'
import type { GlobalFinancialContext, GlobalStockSignals } from '@/lib/external/globalStock/types'

export async function fetchGlobalFinancialContext(symbol: string, market: Market): Promise<GlobalFinancialContext | null> {
  if (market !== 'US' && market !== 'HK') return null
  const target = await resolveGlobalStock(symbol, market)
  if (!target) return null
  const [
    balance,
    income,
    cashflow,
    keyIndicators,
    yahooKeyStatistics,
    analystEstimates,
    institutionalHolders,
    secFilings,
    secCompanyFacts,
  ] = await Promise.all([
    fetchGlobalFinancialStatement(target, 'balance'),
    fetchGlobalFinancialStatement(target, 'income'),
    fetchGlobalFinancialStatement(target, 'cashflow'),
    fetchGlobalKeyIndicators(target),
    fetchYahooKeyStatistics(symbol, market),
    fetchYahooAnalystEstimates(symbol, market),
    fetchYahooInstitutionalHolders(symbol, market),
    market === 'US' ? fetchSecFilings(symbol, undefined).catch(() => null) : Promise.resolve(null),
    market === 'US' ? fetchSecCompanyFacts(symbol).catch(() => null) : Promise.resolve(null),
  ])

  return {
    target,
    statements: { balance, income, cashflow },
    keyIndicators,
    yahooKeyStatistics,
    analystEstimates,
    institutionalHolders,
    ...(market === 'US' ? { secFilings, secCompanyFacts } : {}),
  }
}

export async function fetchGlobalStockSignals(
  symbol: string,
  market: Market,
  options: { includeMarketRank?: boolean; marketRank?: 'us_nasdaq' | 'us_nyse' | 'us_etf' | 'hk' } = {},
): Promise<GlobalStockSignals | null> {
  if (market !== 'US' && market !== 'HK') return null
  const target = await resolveGlobalStock(symbol, market)
  if (!target) return null
  const [fundFlow, optionChain, secFilings, news, marketRank] = await Promise.all([
    fetchGlobalFundFlow(target),
    market === 'US' ? fetchYahooOptionsChain(symbol).catch(() => null) : Promise.resolve(null),
    market === 'US' ? fetchSecFilings(symbol, undefined).catch(() => null) : Promise.resolve(null),
    fetchYahooNews(market === 'HK' ? `${target.code}.HK` : target.code).catch(() => []),
    options.includeMarketRank
      ? fetchGlobalMarketList(options.marketRank ?? (market === 'HK' ? 'hk' : 'us_nasdaq')).catch(() => ({ total: 0, stocks: [] }))
      : Promise.resolve(null),
  ])

  return {
    target,
    fundFlow,
    ...(market === 'US' ? { options: optionChain, secFilings } : {}),
    news,
    ...(marketRank ? { marketRank: { market: options.marketRank ?? (market === 'HK' ? 'hk' : 'us_nasdaq'), ...marketRank } } : {}),
    sources: ['eastmoney-datacenter', 'eastmoney-push2his', 'yahoo-finance', ...(market === 'US' ? ['sec-edgar'] : [])],
  }
}

export {
  fetchGlobalMarketList,
  fetchYahooOptionsChain,
  fetchYahooNews,
  searchGlobalStocks,
}

export type * from '@/lib/external/globalStock/types'
