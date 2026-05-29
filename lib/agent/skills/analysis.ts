import { exchangeRateService, MARKET_CURRENCY, type Currency } from '@/lib/ExchangeRateService'
import { calcStockSummary } from '@/lib/finance'
import { stockPriceService } from '@/lib/StockPriceService'
import { getDailyQuotePnl } from '@/lib/quoteDailyPnl'
import { buildTechnicalIndicatorHistory, buildTechnicalIndicatorSnapshot } from '@/lib/technicalIndicators'
import { fetchDailyCandles } from '@/lib/external/kline'
import { fetchStockNews } from '@/lib/external/news'
import type { AgentSkill } from '@/lib/agent/types'
import type { AiConfig, AppConfig, Market, NewsItem, Stock, TechnicalIndicatorHistory, TechnicalIndicatorSnapshot } from '@/types'

export type PortfolioAnalysisContext = {
  baseCurrency: Currency
  summaries: Array<{
    id: string
    code: string
    name: string
    market: Market
    currentHolding: number
    avgCostPrice: number
    realizedPnl: number
    unrealizedPnl: number
    totalPnl: number
    totalBuyAmount: number
    currentCost: number
    displayCost: number
    totalCommission: number
    totalDividend: number
    holdingWeight: number
    totalCapitalWeight: number | null
    currentPrice: number | null
    changePercent: number | null
    dailyPnl: number | null
    lastTradeDate: string | null
    lastTradeType: 'BUY' | 'SELL' | 'DIVIDEND' | null
  }>
  totalCurrentCost: number
  totalHistoricalBuyAmount: number
  totalCapital: { amount: number; currency: Currency; baseCurrencyAmount: number } | null
  cashReserve: number | null
  totalPositionWeight: number | null
  totalRealizedPnl: number
  totalUnrealizedPnl: number
  totalDailyPnl: number
  largestPositionWeight: number
  profitableCount: number
  losingCount: number
  topHoldings: Array<{ code: string; name: string; weight: number; totalPnl: number }>
  strongestHoldings: Array<{ code: string; name: string; totalPnl: number; changePercent: number | null }>
  weakestHoldings: Array<{ code: string; name: string; totalPnl: number; changePercent: number | null }>
  recentlyActiveHoldings: Array<{ code: string; name: string; lastTradeDate: string }>
}

export type StockAnalysisContext = {
  stock: Stock
  summary: ReturnType<typeof calcStockSummary>
  quote: Awaited<ReturnType<typeof stockPriceService.getQuote>>
  indicators: TechnicalIndicatorSnapshot | null
  recentIndicators: TechnicalIndicatorHistory
  news: NewsItem[]
}

function convertPortfolioMoney(amount: number, market: Market, rates: Record<string, number>, baseCurrency: Currency) {
  const fromCurrency = MARKET_CURRENCY[market] || 'CNY'
  if (fromCurrency === baseCurrency) return amount
  const fromRate = rates[fromCurrency] || 1
  const toRate = rates[baseCurrency] || 1
  return (amount * fromRate) / toRate
}

function convertCurrencyMoney(amount: number, fromCurrency: Currency, rates: Record<string, number>, baseCurrency: Currency) {
  if (fromCurrency === baseCurrency) return amount
  const fromRate = rates[fromCurrency] || 1
  const toRate = rates[baseCurrency] || 1
  return (amount * fromRate) / toRate
}

async function buildPortfolioAnalysisContext(
  stocks: Stock[],
  baseCurrency: Currency = 'CNY',
  totalCapital?: AppConfig['portfolio']['totalCapital'],
): Promise<PortfolioAnalysisContext> {
  const rates = await exchangeRateService.getRates()
  const quotes = new Map<string, Awaited<ReturnType<typeof stockPriceService.getQuote>>>()
  await Promise.all(stocks.map(async (stock) => {
    const quote = await stockPriceService.getQuote(stock.code, stock.market)
    quotes.set(stock.id, quote)
  }))

  const summaries = stocks.map((stock) => {
    const quote = quotes.get(stock.id) ?? null
    const summary = calcStockSummary(stock, quote?.price)
    const lastTrade = [...stock.trades].sort((left, right) => right.date.localeCompare(left.date))[0] ?? null
    const currentCost = convertPortfolioMoney(summary.fifoCostBasis, stock.market, rates, baseCurrency)
    const displayCost = convertPortfolioMoney(summary.avgCostPrice * summary.currentHolding, stock.market, rates, baseCurrency)
    const dailyQuotePnl = quote && summary.currentHolding > 0
      ? getDailyQuotePnl(summary.currentHolding, quote, stock.market)
      : null
    const dailyPnl = dailyQuotePnl?.state === 'active'
      ? convertPortfolioMoney(dailyQuotePnl.amount, stock.market, rates, baseCurrency)
      : null
    return {
      id: stock.id,
      code: stock.code,
      name: stock.name,
      market: stock.market,
      currentHolding: summary.currentHolding,
      avgCostPrice: convertPortfolioMoney(summary.avgCostPrice, stock.market, rates, baseCurrency),
      realizedPnl: convertPortfolioMoney(summary.realizedPnl, stock.market, rates, baseCurrency),
      unrealizedPnl: convertPortfolioMoney(summary.unrealizedPnl, stock.market, rates, baseCurrency),
      totalPnl: convertPortfolioMoney(summary.totalPnl, stock.market, rates, baseCurrency),
      totalBuyAmount: convertPortfolioMoney(summary.totalBuyAmount, stock.market, rates, baseCurrency),
      currentCost,
      displayCost,
      totalCommission: convertPortfolioMoney(summary.totalCommission, stock.market, rates, baseCurrency),
      totalDividend: convertPortfolioMoney(summary.totalDividend, stock.market, rates, baseCurrency),
      currentPrice: quote?.price ?? null,
      changePercent: quote?.changePercent ?? null,
      dailyPnl,
      lastTradeDate: lastTrade?.date ?? null,
      lastTradeType: lastTrade?.type ?? null,
      holdingWeight: 0,
      totalCapitalWeight: null,
    }
  })
  const totalCurrentCost = summaries.reduce((sum, item) => sum + item.currentCost, 0)
  const totalHistoricalBuyAmount = summaries.reduce((sum, item) => sum + item.totalBuyAmount, 0)
  const normalizedTotalCapital = totalCapital && totalCapital.amount > 0
    ? {
        amount: totalCapital.amount,
        currency: totalCapital.currency,
        baseCurrencyAmount: convertCurrencyMoney(totalCapital.amount, totalCapital.currency, rates, baseCurrency),
      }
    : null
  const enriched = summaries.map((item) => ({
    ...item,
    holdingWeight: totalCurrentCost > 0 ? item.currentCost / totalCurrentCost : 0,
    totalCapitalWeight: normalizedTotalCapital && normalizedTotalCapital.baseCurrencyAmount > 0
      ? Math.max(item.currentCost, 0) / normalizedTotalCapital.baseCurrencyAmount
      : null,
  }))
  const positiveCurrentCost = enriched.reduce((sum, item) => sum + Math.max(item.currentCost, 0), 0)

  return {
    baseCurrency,
    summaries: enriched,
    totalCurrentCost,
    totalHistoricalBuyAmount,
    totalCapital: normalizedTotalCapital,
    cashReserve: normalizedTotalCapital ? normalizedTotalCapital.baseCurrencyAmount - positiveCurrentCost : null,
    totalPositionWeight: normalizedTotalCapital && normalizedTotalCapital.baseCurrencyAmount > 0
      ? positiveCurrentCost / normalizedTotalCapital.baseCurrencyAmount
      : null,
    totalRealizedPnl: enriched.reduce((sum, item) => sum + item.realizedPnl, 0),
    totalUnrealizedPnl: enriched.reduce((sum, item) => sum + item.unrealizedPnl, 0),
    totalDailyPnl: enriched.reduce((sum, item) => sum + (item.dailyPnl ?? 0), 0),
    largestPositionWeight: enriched.reduce((max, item) => Math.max(max, item.holdingWeight), 0),
    profitableCount: enriched.filter((item) => item.totalPnl >= 0).length,
    losingCount: enriched.filter((item) => item.totalPnl < 0).length,
    topHoldings: [...enriched].sort((left, right) => right.holdingWeight - left.holdingWeight).slice(0, 3).map((item) => ({
      code: item.code,
      name: item.name,
      weight: item.holdingWeight,
      totalPnl: item.totalPnl,
    })),
    strongestHoldings: [...enriched].sort((left, right) => right.totalPnl - left.totalPnl).slice(0, 2).map((item) => ({
      code: item.code,
      name: item.name,
      totalPnl: item.totalPnl,
      changePercent: item.changePercent,
    })),
    weakestHoldings: [...enriched].sort((left, right) => left.totalPnl - right.totalPnl).slice(0, 2).map((item) => ({
      code: item.code,
      name: item.name,
      totalPnl: item.totalPnl,
      changePercent: item.changePercent,
    })),
    recentlyActiveHoldings: [...enriched]
      .filter((item) => item.lastTradeDate)
      .sort((left, right) => (right.lastTradeDate ?? '').localeCompare(left.lastTradeDate ?? ''))
      .slice(0, 3)
      .map((item) => ({ code: item.code, name: item.name, lastTradeDate: item.lastTradeDate! })),
  }
}

async function buildStockAnalysisContext(stock: Stock, aiConfig: AiConfig): Promise<StockAnalysisContext> {
  const quote = await stockPriceService.getQuote(stock.code, stock.market)
  const summary = calcStockSummary(stock, quote?.price)
  const candles = await fetchDailyCandles(stock.code, stock.market)
  const indicators = buildTechnicalIndicatorSnapshot(candles)
  const recentIndicators = buildTechnicalIndicatorHistory(candles, 20)
  const news = aiConfig.newsEnabled ? await fetchStockNews(stock.code, stock.name, stock.market) : []
  return { stock, summary, quote, indicators, recentIndicators, news }
}

export const portfolioGetAnalysisContextSkill: AgentSkill<Record<string, unknown>, PortfolioAnalysisContext> = {
  name: 'portfolio.getAnalysisContext',
  description: '为固定组合 AI 分析读取完整但受控的组合上下文。',
  inputSchema: { baseCurrency: 'string', totalCapital: 'object?' },
  requiredScopes: ['portfolio.read', 'quote.read'],
  async execute(args, ctx) {
    const baseCurrency = ['CNY', 'HKD', 'USD', 'USDT'].includes(String(args.baseCurrency))
      ? args.baseCurrency as Currency
      : 'CNY'
    const rawTotalCapital = args.totalCapital as AppConfig['portfolio']['totalCapital'] | undefined
    const totalCapital = rawTotalCapital && typeof rawTotalCapital.amount === 'number' && ['CNY', 'HKD', 'USD', 'USDT'].includes(rawTotalCapital.currency)
      ? rawTotalCapital
      : null
    return {
      skillName: 'portfolio.getAnalysisContext',
      ok: true,
      data: await buildPortfolioAnalysisContext(ctx.stocks, baseCurrency, totalCapital),
    }
  },
}

export const stockGetAnalysisContextSkill: AgentSkill<{ stockId?: string }, StockAnalysisContext> = {
  name: 'stock.getAnalysisContext',
  description: '为固定标的 AI 分析读取持仓、行情、技术指标和新闻上下文。',
  inputSchema: { stockId: 'string' },
  requiredScopes: ['stock.read', 'trade.read', 'quote.read'],
  async execute(args, ctx) {
    const stock = ctx.stocks.find((item) => item.id === args.stockId)
    if (!stock) return { skillName: 'stock.getAnalysisContext', ok: false, error: '未找到目标标的' }
    return {
      skillName: 'stock.getAnalysisContext',
      ok: true,
      data: await buildStockAnalysisContext(stock, ctx.aiConfig),
    }
  },
}
