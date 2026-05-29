import { buildTechnicalIndicatorHistory, buildTechnicalIndicatorSnapshot } from '@/lib/technicalIndicators'
import { marketSupportsValuation } from '@/config/defaults'
import { calcStockSummary } from '@/lib/finance'
import { stockPriceService } from '@/lib/StockPriceService'
import { runFinancialAnalysisChain } from '@/lib/agent/chains/financialAnalysis'
import { matchStocks } from '@/lib/agent/entity/stockMatcher'
import { resolveSecurityCandidates } from '@/lib/agent/entity/securityResolver'
import { webSearchSkill, type WebSearchResult } from '@/lib/agent/skills/search'
import { fetchDailyCandles } from '@/lib/external/kline'
import { fetchAShareFinancialContext, fetchAShareSignals, type AShareFinancialContext, type AShareSignals } from '@/lib/external/aShare'
import { fetchGlobalFinancialContext, fetchGlobalStockSignals, type GlobalFinancialContext, type GlobalStockSignals } from '@/lib/external/globalStock'
import { THIRD_PARTY_REQUEST_HEADERS, thirdPartyApiUrls } from '@/lib/external/thirdPartyApis'
import { loggedFetch } from '@/lib/observability/fetch'
import { cleanFinancialDisplayText, type FinancialAnalysis, type FinancialAnalysisInput } from '@/lib/agent/financials/schema'
import type { AgentSkill } from '@/lib/agent/types'
import type { Market, Stock } from '@/types'
import type { StockQuote } from '@/types/stockApi'

function findStock(stocks: Stock[], args: Record<string, unknown>) {
  const stockId = typeof args.stockId === 'string' ? args.stockId : ''
  const code = typeof args.code === 'string' ? args.code.toUpperCase() : ''
  const name = typeof args.name === 'string' ? args.name : ''
  return stocks.find((stock) => stock.id === stockId)
    ?? (code ? stocks.find((stock) => stock.code.toUpperCase() === code) : undefined)
    ?? (name ? matchStocks(name, stocks, 1)[0]?.stock : undefined)
    ?? null
}

function quoteToContext(quote: StockQuote | null) {
  if (!quote) return null
  return {
    symbol: quote.symbol,
    name: quote.name,
    price: quote.price,
    change: quote.change,
    changePercent: quote.changePercent,
    peTtm: quote.peTtm ?? null,
    epsTtm: quote.epsTtm ?? null,
    pb: quote.pb ?? null,
    marketCap: quote.marketCap ?? null,
    currency: quote.currency,
    source: quote.source,
    valuationSource: quote.valuationSource ?? null,
    timestamp: quote.timestamp,
  }
}

export const stockMatchSkill: AgentSkill<{ query?: string }> = {
  name: 'stock.match',
  description: '根据用户输入匹配本地持仓中的标的。',
  inputSchema: { query: 'string' },
  requiredScopes: ['stock.read', 'quote.read'],
  async execute(args, ctx) {
    const matches = matchStocks(args.query ?? '', ctx.stocks, 5).map((match) => ({
      id: match.stock.id,
      code: match.stock.code,
      name: match.stock.name,
      market: match.stock.market,
      confidence: match.confidence,
      reason: match.reason,
    }))
    return { skillName: 'stock.match', ok: true, data: { matches } }
  },
}

export const stockGetHoldingSkill: AgentSkill<Record<string, unknown>> = {
  name: 'stock.getHolding',
  description: '读取单个标的的本地持仓、成本、盈亏和备注。',
  inputSchema: { stockId: 'string' },
  requiredScopes: ['stock.read'],
  async execute(args, ctx) {
    const stock = findStock(ctx.stocks, args)
    if (!stock) return { skillName: 'stock.getHolding', ok: false, error: '未找到对应持仓' }
    const quote = await stockPriceService.getQuote(stock.code, stock.market).catch(() => null)
    const summary = calcStockSummary(stock, quote?.price)
    return {
      skillName: 'stock.getHolding',
      ok: true,
      data: {
        stock: {
          id: stock.id,
          code: stock.code,
          name: stock.name,
          market: stock.market,
          note: stock.note ?? '',
        },
        summary: {
          currentHolding: summary.currentHolding,
          avgCostPrice: summary.avgCostPrice,
          marketPrice: quote?.price ?? null,
          marketValue: quote?.price ? Number((summary.currentHolding * quote.price).toFixed(2)) : null,
          realizedPnl: summary.realizedPnl,
          unrealizedPnl: summary.unrealizedPnl,
          totalPnl: summary.totalPnl,
          totalPnlPercent: summary.totalPnlPercent,
          totalCommission: summary.totalCommission,
          totalDividend: summary.totalDividend,
          tradeCount: summary.tradeCount,
          pnlIncludesMarketPrice: Boolean(quote?.price),
        },
      },
    }
  },
}

export const stockGetRecentTradesSkill: AgentSkill<Record<string, unknown>> = {
  name: 'stock.getRecentTrades',
  description: '读取单个标的最近交易记录。',
  inputSchema: { stockId: 'string', limit: 'number' },
  requiredScopes: ['trade.read'],
  async execute(args, ctx) {
    const stock = findStock(ctx.stocks, args)
    if (!stock) return { skillName: 'stock.getRecentTrades', ok: false, error: '未找到对应持仓' }
    const limit = Math.max(1, Math.min(Number(args.limit ?? 8), 30))
    return {
      skillName: 'stock.getRecentTrades',
      ok: true,
      data: {
        stockId: stock.id,
        trades: stock.trades.slice(-limit).map((trade) => ({
          type: trade.type,
          date: trade.date,
          price: trade.price,
          quantity: trade.quantity,
          commission: trade.commission,
          tax: trade.tax,
          netAmount: trade.netAmount,
          note: trade.note ?? '',
        })),
      },
    }
  },
}

export const stockGetQuoteSkill: AgentSkill<Record<string, unknown>> = {
  name: 'stock.getQuote',
  description: '读取单个本地持仓标的的行情和估值数据。',
  inputSchema: { stockId: 'string' },
  requiredScopes: ['quote.read'],
  async execute(args, ctx) {
    const stock = findStock(ctx.stocks, args)
    if (!stock) return { skillName: 'stock.getQuote', ok: false, error: '未找到对应持仓' }
    const quote = await stockPriceService.getQuote(stock.code, stock.market).catch(() => null)
    return { skillName: 'stock.getQuote', ok: true, data: { stockId: stock.id, quote: quoteToContext(quote) } }
  },
}

export const stockGetExternalQuoteSkill: AgentSkill<{ symbol?: string; market?: Market; query?: string; keyword?: string; name?: string }> = {
  name: 'stock.getExternalQuote',
  description: '读取未持仓标的的行情和估值数据。',
  inputSchema: { symbol: 'string', market: 'Market', query: 'string', keyword: 'string', name: 'string' },
  requiredScopes: ['quote.read'],
  async execute(args, ctx) {
    if (!args.symbol || !args.market) {
      const query = String(args.query ?? args.keyword ?? args.name ?? args.symbol ?? '')
      const candidates = (await resolveSecurityCandidates(query, ctx.stocks, 3)).slice(0, 3)
      if (!candidates.length) return { skillName: 'stock.getExternalQuote', ok: false, error: '缺少标的代码或市场' }

      const resolved = await Promise.all(candidates.map(async (candidate) => {
        const quote = await stockPriceService.getQuote(candidate.code, candidate.market).catch(() => null)
        return {
          symbol: candidate.code,
          name: candidate.name,
          market: candidate.market,
          inPortfolio: candidate.inPortfolio,
          stockId: candidate.stockId,
          quote: quoteToContext(quote),
        }
      }))
      return {
        skillName: 'stock.getExternalQuote',
        ok: true,
        data: { query, candidates: resolved },
        needsFollowUp: true,
        suggestedSkills: candidates.map((candidate) => ({
          name: 'stock.getTechnicalSnapshot',
          args: { symbol: candidate.code, market: candidate.market },
          reason: '已解析出未持仓标的，继续抓取外部 K 线并计算技术指标',
        })),
      }
    }

    const quote = await stockPriceService.getQuote(args.symbol, args.market).catch(() => null)
    return { skillName: 'stock.getExternalQuote', ok: true, data: { symbol: args.symbol, market: args.market, inPortfolio: false, quote: quoteToContext(quote) } }
  },
}

export const stockGetTechnicalSnapshotSkill: AgentSkill<Record<string, unknown>> = {
  name: 'stock.getTechnicalSnapshot',
  description: '读取单个标的的技术指标摘要。',
  inputSchema: { stockId: 'string', symbol: 'string', market: 'Market', query: 'string' },
  requiredScopes: ['quote.read'],
  async execute(args, ctx) {
    const stock = findStock(ctx.stocks, args)
    if (!stock) {
      const symbol = typeof args.symbol === 'string' ? args.symbol : ''
      const market = typeof args.market === 'string' ? args.market as Market : null
      if (symbol && market) {
        const candles = await fetchDailyCandles(symbol, market)
        return {
          skillName: 'stock.getTechnicalSnapshot',
          ok: true,
          data: {
            symbol,
            market,
            indicators: buildTechnicalIndicatorSnapshot(candles),
            recentIndicators: buildTechnicalIndicatorHistory(candles, 20),
            candleCount: candles.length,
          },
        }
      }

      const query = String(args.query ?? args.keyword ?? args.name ?? args.symbol ?? '')
      const candidates = (await resolveSecurityCandidates(query, ctx.stocks, 2)).slice(0, 2)
      if (candidates.length) {
        const resolved = await Promise.all(candidates.map(async (candidate) => {
          const candles = await fetchDailyCandles(candidate.code, candidate.market).catch(() => [])
          return {
            symbol: candidate.code,
            name: candidate.name,
            market: candidate.market,
            indicators: candles.length ? buildTechnicalIndicatorSnapshot(candles) : null,
            recentIndicators: candles.length ? buildTechnicalIndicatorHistory(candles, 20) : null,
            candleCount: candles.length,
          }
        }))
        return { skillName: 'stock.getTechnicalSnapshot', ok: true, data: { query, candidates: resolved } }
      }

      return { skillName: 'stock.getTechnicalSnapshot', ok: false, error: '未找到对应持仓或外部标的' }
    }

    const candles = await fetchDailyCandles(stock.code, stock.market)
    return {
      skillName: 'stock.getTechnicalSnapshot',
      ok: true,
      data: {
        stockId: stock.id,
        indicators: buildTechnicalIndicatorSnapshot(candles),
        recentIndicators: buildTechnicalIndicatorHistory(candles, 20),
        candleCount: candles.length,
      },
    }
  },
}

export type FinancialsInput = {
  symbol: string
  market: Market
  researchQuery?: string
  sourceHints?: string[]
  documents?: FinancialAnalysisInput['documents']
}

export type LegacyFinancialsData = {
  symbol: string
  market: Market
  earningsDate: string | null
  epsActual: number | null
  epsEstimate: number | null
  epsSurprise: number | null
  revenue: number | null
  netProfit: number | null
  revenueGrowth: number | null
  earningsGrowth: number | null
  source: string
  note?: string
}

export type FinancialsData = LegacyFinancialsData & {
  analysis: FinancialAnalysis
  documents: FinancialAnalysisInput['documents']
  aShareContext?: AShareFinancialContext
  globalContext?: GlobalFinancialContext
  chain: {
    provider: 'langchain-openai' | 'native-json'
    degraded: boolean
    error?: string
  }
}

function stringifyCompact(value: unknown, maxLength = 1200) {
  const text = JSON.stringify(value, null, 2)
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function parseMoneyWan(value: string | undefined) {
  if (!value) return null
  const normalized = value.replace(/,/g, '').trim()
  if (!normalized || normalized === '--') return null
  const amountWan = Number(normalized)
  return Number.isFinite(amountWan) ? amountWan * 10_000 : null
}

function parseNumberValue(value: string | undefined) {
  if (!value) return null
  const normalized = value.replace(/,/g, '').trim()
  if (!normalized || normalized === '--') return null
  const num = Number(normalized)
  return Number.isFinite(num) ? num : null
}

function growthPercent(current: number | null, previous: number | null) {
  if (current === null || previous === null || previous === 0) return null
  return Number((((current - previous) / Math.abs(previous)) * 100).toFixed(2))
}

function formatFinancialAmount(amount: number) {
  if (Math.abs(amount) >= 100_000_000) {
    return `${(amount / 100_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })} 亿`
  }
  return `${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} 元`
}

function extractFinancialRow(text: string, label: string, count: number) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = text.match(new RegExp(`${escaped}\\s+((?:[-\\d,.]+\\s+){1,${count}})`, 'i'))
  return match?.[1]?.trim().split(/\s+/).slice(0, count) ?? []
}

async function fetchSinaAStockFinancials(symbol: string): Promise<LegacyFinancialsData | null> {
  const iconv = await import('iconv-lite')
  const url = thirdPartyApiUrls.sinaProfitStatement(symbol)
  const res = await loggedFetch(url, {
    headers: THIRD_PARTY_REQUEST_HEADERS.browserLike,
    signal: AbortSignal.timeout(15_000),
  }, {
    operation: 'financials.sina.profitStatement',
    provider: 'sina-finance',
    resource: symbol,
  })
  if (!res.ok) return null

  const buffer = Buffer.from(await res.arrayBuffer())
  const html = iconv.decode(buffer, 'gb18030')
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const dates = Array.from(text.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g)).map((match) => match[0]).slice(0, 5)
  if (!dates.length) return null

  const revenueValues = extractFinancialRow(text, '一、营业收入', dates.length)
  const netProfitValues = extractFinancialRow(text, '归属于母公司的净利润', dates.length)
  const epsValues = extractFinancialRow(text, '基本每股收益(元/股)', dates.length)
  const currentRevenue = parseMoneyWan(revenueValues[0])
  const previousRevenue = parseMoneyWan(revenueValues[4] ?? revenueValues[1])
  const currentNetProfit = parseMoneyWan(netProfitValues[0])
  const previousNetProfit = parseMoneyWan(netProfitValues[4] ?? netProfitValues[1])
  const epsActual = parseNumberValue(epsValues[0])

  if (currentRevenue === null && currentNetProfit === null && epsActual === null) return null

  return {
    symbol,
    market: 'A',
    earningsDate: dates[0] ?? null,
    epsActual,
    epsEstimate: null,
    epsSurprise: null,
    revenue: currentRevenue,
    netProfit: currentNetProfit,
    revenueGrowth: growthPercent(currentRevenue, previousRevenue),
    earningsGrowth: growthPercent(currentNetProfit, previousNetProfit),
    source: 'sina-finance-profit-statement',
    note: [
      currentRevenue !== null ? `营业收入 ${formatFinancialAmount(currentRevenue)}` : '',
      currentNetProfit !== null ? `归母净利润 ${formatFinancialAmount(currentNetProfit)}` : '',
      epsActual !== null ? `基本每股收益 ${epsActual} 元/股` : '',
      dates[0] ? `报告期 ${dates[0]}` : '',
    ].filter(Boolean).join('；'),
  }
}

function buildFinancialSearchQuery(symbol: string, market: Market, displayName: string, researchQuery: string) {
  if (/财报|年报|季报|中报|业绩|earnings|annual|quarter|10-q|10-k/i.test(researchQuery)) return researchQuery
  if (market === 'US') return `${displayName} ${symbol} latest earnings report revenue profit cash flow`
  if (market === 'HK') return `${displayName} ${symbol} 最新 财报 业绩 公告 收入 利润 现金流`
  return `${displayName} ${symbol} 最新 财报 业绩 营收 净利润 现金流`
}

function normalizeSearchDocuments(result: WebSearchResult | undefined): FinancialAnalysisInput['documents'] {
  if (!result?.results?.length) return []
  return result.results
    .map((item) => ({
      title: item.title,
      url: item.url,
      publisher: item.source,
      excerpt: cleanFinancialDisplayText(item.content || item.snippet || ''),
    }))
    .filter((item) => item.title && item.excerpt)
    .slice(0, 5)
}

function normalizeAShareFinancialDocuments(context: AShareFinancialContext): FinancialAnalysisInput['documents'] {
  const documents: FinancialAnalysisInput['documents'] = []
  if (context.stockInfo) {
    documents.push({
      title: `${context.stockInfo.name || context.stockInfo.code} 东财个股基本面`,
      publisher: 'eastmoney-stock-info',
      excerpt: cleanFinancialDisplayText(stringifyCompact(context.stockInfo)),
    })
  }

  for (const row of context.statements.profit.slice(0, 5)) {
    documents.push({
      title: `新浪利润表 ${row.reportDate ?? ''}`.trim(),
      publisher: 'sina-finance-report2022',
      excerpt: cleanFinancialDisplayText(stringifyCompact(row.values)),
    })
  }
  for (const row of context.statements.balance.slice(0, 3)) {
    documents.push({
      title: `新浪资产负债表 ${row.reportDate ?? ''}`.trim(),
      publisher: 'sina-finance-report2022',
      excerpt: cleanFinancialDisplayText(stringifyCompact(row.values)),
    })
  }
  for (const row of context.statements.cashflow.slice(0, 3)) {
    documents.push({
      title: `新浪现金流量表 ${row.reportDate ?? ''}`.trim(),
      publisher: 'sina-finance-report2022',
      excerpt: cleanFinancialDisplayText(stringifyCompact(row.values)),
    })
  }

  if (context.epsForecasts.length) {
    documents.push({
      title: '同花顺一致预期 EPS',
      publisher: 'ths-worth',
      excerpt: cleanFinancialDisplayText(stringifyCompact(context.epsForecasts)),
    })
  }

  for (const report of context.reports.slice(0, 5)) {
    documents.push({
      title: report.title,
      url: report.pdfUrl ?? undefined,
      publisher: report.orgName ?? report.source,
      excerpt: cleanFinancialDisplayText(stringifyCompact({
        publishDate: report.publishDate,
        rating: report.rating,
        industry: report.industry,
        epsForecasts: report.epsForecasts,
      })),
    })
  }

  for (const announcement of context.announcements.slice(0, 5)) {
    documents.push({
      title: announcement.title,
      url: announcement.url ?? undefined,
      publisher: announcement.source,
      excerpt: cleanFinancialDisplayText(stringifyCompact({
        date: announcement.date,
        type: announcement.type,
      })),
    })
  }

  return documents.filter((item) => item.title && item.excerpt).slice(0, 20)
}

function normalizeGlobalFinancialDocuments(context: GlobalFinancialContext): FinancialAnalysisInput['documents'] {
  const documents: FinancialAnalysisInput['documents'] = []
  documents.push({
    title: `${context.target.name || context.target.code} 东财港美股财务指标`,
    publisher: 'eastmoney-datacenter',
    excerpt: cleanFinancialDisplayText(stringifyCompact({
      target: context.target,
      keyIndicators: context.keyIndicators.slice(0, 6),
    })),
  })
  for (const statement of ['income', 'balance', 'cashflow'] as const) {
    const rows = context.statements[statement].slice(0, 12)
    if (!rows.length) continue
    documents.push({
      title: `东财${statement === 'income' ? '利润表' : statement === 'balance' ? '资产负债表' : '现金流量表'}`,
      publisher: 'eastmoney-datacenter',
      excerpt: cleanFinancialDisplayText(stringifyCompact(rows)),
    })
  }
  if (context.yahooKeyStatistics) {
    documents.push({
      title: 'Yahoo 关键估值和盈利指标',
      publisher: 'yahoo-finance',
      excerpt: cleanFinancialDisplayText(stringifyCompact(context.yahooKeyStatistics)),
    })
  }
  if (context.analystEstimates) {
    documents.push({
      title: 'Yahoo 分析师预期和评级趋势',
      publisher: 'yahoo-finance',
      excerpt: cleanFinancialDisplayText(stringifyCompact(context.analystEstimates)),
    })
  }
  if (context.institutionalHolders) {
    documents.push({
      title: 'Yahoo 机构持仓',
      publisher: 'yahoo-finance',
      excerpt: cleanFinancialDisplayText(stringifyCompact(context.institutionalHolders)),
    })
  }
  if (context.secFilings) {
    documents.push({
      title: 'SEC EDGAR Filing 列表',
      publisher: 'sec-edgar',
      excerpt: cleanFinancialDisplayText(stringifyCompact(context.secFilings.filings.slice(0, 10))),
    })
  }
  if (context.secCompanyFacts) {
    documents.push({
      title: 'SEC XBRL 结构化财务指标',
      publisher: 'sec-edgar',
      excerpt: cleanFinancialDisplayText(stringifyCompact(context.secCompanyFacts.metrics)),
    })
  }
  return documents.filter((item) => item.title && item.excerpt).slice(0, 20)
}

async function fetchFinancialDocuments(query: string, sourceHints: string[], ctx: Parameters<AgentSkill<FinancialsInput, FinancialsData>['execute']>[1]) {
  const result = await webSearchSkill.execute({
    query,
    ...(sourceHints.length ? { sourceHints } : {}),
    limit: 3,
    searchLimit: 8,
  }, ctx)
  return result.ok ? normalizeSearchDocuments(result.data as WebSearchResult) : []
}

function buildFinancialAnalysisInput({
  symbol,
  market,
  stock,
  financials,
  quote,
  documents,
  userQuestion,
  language,
}: {
  symbol: string
  market: Market
  stock: Stock | undefined
  financials: LegacyFinancialsData | null
  quote: StockQuote | null
  documents: FinancialAnalysisInput['documents']
  userQuestion: string
  language: FinancialAnalysisInput['language']
}): FinancialAnalysisInput {
  const summary = stock ? calcStockSummary(stock, quote?.price) : null
  return {
    security: {
      symbol,
      market,
      name: stock?.name ?? quote?.name,
      inPortfolio: Boolean(stock),
      stockId: stock?.id,
    },
    localHolding: summary ? {
      currentHolding: summary.currentHolding,
      avgCostPrice: summary.avgCostPrice,
      marketPrice: quote?.price ?? null,
      marketValue: quote?.price ? Number((summary.currentHolding * quote.price).toFixed(2)) : null,
      realizedPnl: summary.realizedPnl,
      unrealizedPnl: summary.unrealizedPnl,
      totalPnl: summary.totalPnl,
      totalPnlPercent: summary.totalPnlPercent,
      tradeCount: summary.tradeCount,
    } : undefined,
    structuredFinancials: financials ? {
      reportPeriod: financials.earningsDate,
      revenue: financials.revenue,
      revenueGrowth: financials.revenueGrowth,
      netProfit: financials.netProfit,
      netProfitGrowth: financials.earningsGrowth,
      eps: financials.epsActual,
      source: financials.source,
      note: financials.note,
    } : undefined,
    quote: quote ? {
      price: quote.price,
      peTtm: quote.peTtm ?? null,
      pb: quote.pb ?? null,
      epsTtm: quote.epsTtm ?? null,
      marketCap: quote.marketCap ?? null,
      currency: quote.currency,
      source: quote.source,
    } : null,
    documents,
    userQuestion,
    language,
  }
}

export const stockGetFinancialsSkill: AgentSkill<FinancialsInput, FinancialsData> = {
  name: 'stock.getFinancials',
  description: '获取并分析标的最近财报数据，返回营收、利润、EPS、估值、亮点、风险、来源和缺失项，支持美股/A股/港股。',
  inputSchema: { symbol: 'string', market: 'Market', researchQuery: 'string?', sourceHints: 'string[]?' },
  requiredScopes: ['quote.read', 'network.fetch'],
  async execute(args, ctx) {
    const { symbol, market } = args
    if (!symbol) return { skillName: 'stock.getFinancials', ok: false, error: '缺少标的代码' }
    if (!marketSupportsValuation(market, String(symbol))) {
      return {
        skillName: 'stock.getFinancials',
        ok: false,
        error: '基金、ETF、加密资产等产品本身没有公司财报，无法进行财报分析。可以改问持仓表现、跟踪指数、费率、净值或组合风险。',
      }
    }
    const normalizedSymbol = String(symbol).toUpperCase()
    const stock = ctx.stocks.find((item) => item.code === symbol || item.code.toUpperCase() === normalizedSymbol)
    const displayName = stock?.name ? `${stock.name} ${symbol}` : String(symbol)
    const researchQuery = String(args.researchQuery || displayName).replace(/\s+/g, ' ').trim()
    const sourceHints = Array.isArray(args.sourceHints)
      ? args.sourceHints.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : []
    const manualDocuments = Array.isArray(args.documents)
      ? args.documents.filter((item): item is FinancialAnalysisInput['documents'][number] => (
          Boolean(item && typeof item.title === 'string' && typeof item.excerpt === 'string')
        ))
      : []

    const [quote, financials, aShareContext, globalContext] = await Promise.all([
      stockPriceService.getQuote(String(symbol), market).catch(() => null),
      market === 'A' ? fetchSinaAStockFinancials(String(symbol)).catch(() => null) : Promise.resolve(null),
      market === 'A' ? fetchAShareFinancialContext(String(symbol)).catch(() => null) : Promise.resolve(null),
      market === 'US' || market === 'HK' ? fetchGlobalFinancialContext(String(symbol), market).catch(() => null) : Promise.resolve(null),
    ])
    const aShareDocuments = aShareContext ? normalizeAShareFinancialDocuments(aShareContext) : []
    const globalDocuments = globalContext ? normalizeGlobalFinancialDocuments(globalContext) : []
    const searchQuery = buildFinancialSearchQuery(String(symbol), market, displayName, researchQuery)
    const documents = manualDocuments.length
      ? manualDocuments
      : aShareDocuments.length
      ? aShareDocuments
      : globalDocuments.length
      ? globalDocuments
      : financials
      ? []
      : await fetchFinancialDocuments(searchQuery, sourceHints, ctx).catch(() => [])
    const input = buildFinancialAnalysisInput({
      symbol: String(symbol),
      market,
      stock,
      financials,
      quote,
      documents,
      userQuestion: researchQuery,
      language: ctx.aiConfig.analysisLanguage === 'en-US' ? 'en' : 'zh',
    })
    const chain = await runFinancialAnalysisChain(input, ctx.aiConfig)

    const data: FinancialsData = {
      symbol: String(symbol),
      market,
      earningsDate: financials?.earningsDate ?? chain.analysis.reportPeriod ?? null,
      epsActual: financials?.epsActual ?? chain.analysis.metrics.eps ?? null,
      epsEstimate: financials?.epsEstimate ?? null,
      epsSurprise: financials?.epsSurprise ?? null,
      revenue: financials?.revenue ?? chain.analysis.metrics.revenue ?? null,
      netProfit: financials?.netProfit ?? chain.analysis.metrics.netProfit ?? null,
      revenueGrowth: financials?.revenueGrowth ?? chain.analysis.metrics.revenueGrowth ?? null,
      earningsGrowth: financials?.earningsGrowth ?? chain.analysis.metrics.netProfitGrowth ?? null,
      source: financials?.source ?? (documents.length ? 'public-web-financial-documents' : 'financial-analysis-chain'),
      note: financials?.note,
      analysis: chain.analysis,
      documents,
      ...(aShareContext ? { aShareContext } : {}),
      ...(globalContext ? { globalContext } : {}),
      chain: {
        provider: chain.provider,
        degraded: chain.degraded,
        ...(chain.error ? { error: chain.error } : {}),
      },
    }

    return { skillName: 'stock.getFinancials', ok: true, data }
  },
}

export type AShareSignalsInput = {
  symbol?: string
  market?: Market
  query?: string
  keyword?: string
  name?: string
}

export const stockGetAShareSignalsSkill: AgentSkill<AShareSignalsInput, AShareSignals> = {
  name: 'stock.getAshareSignals',
  description: '读取 A 股个股信号数据，包括龙虎榜、解禁、融资融券、大宗交易、股东户数、分红和 120 日资金流。',
  inputSchema: { symbol: 'string', market: 'Market', query: 'string', keyword: 'string', name: 'string' },
  requiredScopes: ['quote.read', 'network.fetch'],
  async execute(args, ctx) {
    let symbol = typeof args.symbol === 'string' ? args.symbol : ''
    let market = typeof args.market === 'string' ? args.market as Market : undefined

    if (!symbol) {
      const query = String(args.query ?? args.keyword ?? args.name ?? '')
      const candidate = (await resolveSecurityCandidates(query, ctx.stocks, 1))[0]
      symbol = candidate?.code ?? ''
      market = candidate?.market
    }

    if (!symbol) return { skillName: 'stock.getAshareSignals', ok: false, error: '缺少 A 股代码' }
    if (market && market !== 'A') {
      return { skillName: 'stock.getAshareSignals', ok: false, error: '该信号数据仅支持 A 股股票。' }
    }

    const data = await fetchAShareSignals(symbol)
    return { skillName: 'stock.getAshareSignals', ok: true, data }
  },
}

export type GlobalStockSignalsInput = {
  symbol?: string
  market?: Market
  query?: string
  keyword?: string
  name?: string
  includeMarketRank?: boolean
}

export const stockGetGlobalSignalsSkill: AgentSkill<GlobalStockSignalsInput, GlobalStockSignals> = {
  name: 'stock.getGlobalSignals',
  description: '读取港股/美股扩展信号，包括东财资金流、Yahoo 期权/新闻、SEC Filing，以及可选全市场排名。',
  inputSchema: { symbol: 'string', market: 'Market', query: 'string', keyword: 'string', name: 'string', includeMarketRank: 'boolean' },
  requiredScopes: ['quote.read', 'network.fetch'],
  async execute(args, ctx) {
    let symbol = typeof args.symbol === 'string' ? args.symbol : ''
    let market = typeof args.market === 'string' ? args.market as Market : undefined
    if (!symbol || !market) {
      const query = String(args.query ?? args.keyword ?? args.name ?? symbol ?? '')
      const candidate = (await resolveSecurityCandidates(query, ctx.stocks, 1))[0]
      symbol = symbol || candidate?.code || ''
      market = market || candidate?.market
    }
    if (!symbol || !market) return { skillName: 'stock.getGlobalSignals', ok: false, error: '缺少港股/美股代码或市场' }
    if (market !== 'US' && market !== 'HK') return { skillName: 'stock.getGlobalSignals', ok: false, error: '该扩展信号仅支持港股和美股。' }
    const data = await fetchGlobalStockSignals(symbol, market, { includeMarketRank: Boolean(args.includeMarketRank) })
    if (!data) return { skillName: 'stock.getGlobalSignals', ok: false, error: '未获取到港美股扩展信号数据' }
    return { skillName: 'stock.getGlobalSignals', ok: true, data }
  },
}
