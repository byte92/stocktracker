import { SUPPORTED_MARKETS } from '@/config/defaults'
import { calcStockSummary, generateId } from '@/lib/finance'
import { stockPriceService } from '@/lib/StockPriceService'
import { streamCompletion, type LlmProviderMessage } from '@/lib/external/llmProvider'
import type { AiChatContextStats, AiChatMessage, AiConfig, Market, Stock } from '@/types'
import type { StockQuote } from '@/types/stockApi'

export type ProviderMessage = LlmProviderMessage

export type ExternalStockRequest = {
  symbol: string
  market: Market
}

export type ChatContextBuildResult = {
  messages: ProviderMessage[]
  contextSnapshot: Record<string, unknown>
  stats: AiChatContextStats
}

export const AI_CHAT_TITLE_MAX_LENGTH = 24

export function validateAiChatConfig(config: AiConfig) {
  if (!config.enabled) throw new Error('AI 功能尚未启用')
  if (!config.baseUrl.trim()) throw new Error('请先配置 AI Base URL')
  if (!config.model.trim()) throw new Error('请先配置 AI 模型')
  if (!config.apiKey.trim()) throw new Error('请先配置 AI API Key')
}

export function estimateTokens(input: string) {
  const ascii = input.match(/[\x00-\x7F]+/g)?.join(' ') ?? ''
  const nonAsciiCount = input.length - ascii.length
  const englishLikeTokens = ascii.trim() ? ascii.trim().split(/\s+/).length : 0
  return Math.max(1, Math.ceil(nonAsciiCount * 0.9 + englishLikeTokens * 1.35))
}

export function getContextStats(tokenEstimate: number, maxContextTokens: number): AiChatContextStats {
  const max = Math.max(4096, maxContextTokens || 128000)
  const ratio = tokenEstimate / max
  const level: AiChatContextStats['level'] =
    ratio >= 0.85 ? 'near-limit' : ratio >= 0.55 ? 'long' : ratio >= 0.25 ? 'medium' : 'short'
  return { tokenEstimate, maxContextTokens: max, level }
}

export function getContextLevelLabel(level: AiChatContextStats['level']) {
  const labels: Record<AiChatContextStats['level'], string> = {
    short: '短',
    medium: '中',
    long: '长',
    'near-limit': '接近上限',
  }
  return labels[level]
}

export function buildChatTitle(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (!normalized) return '新对话'
  return normalized.length > AI_CHAT_TITLE_MAX_LENGTH ? `${normalized.slice(0, AI_CHAT_TITLE_MAX_LENGTH - 1)}…` : normalized
}

export function normalizeChatTitle(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (!normalized) return '新对话'
  return normalized.length > AI_CHAT_TITLE_MAX_LENGTH ? normalized.slice(0, AI_CHAT_TITLE_MAX_LENGTH) : normalized
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

function buildHoldingContext(stocks: Stock[]) {
  return stocks.map((stock) => {
    const summary = calcStockSummary(stock)
    return {
      id: stock.id,
      code: stock.code,
      name: stock.name,
      market: stock.market,
      note: stock.note ?? '',
      quote: null,
      dataSource: 'local',
      summary: {
        currentHolding: summary.currentHolding,
        avgCostPrice: summary.avgCostPrice,
        realizedPnl: summary.realizedPnl,
        unrealizedPnl: summary.unrealizedPnl,
        totalPnl: summary.totalPnl,
        totalPnlPercent: summary.totalPnlPercent,
        totalCommission: summary.totalCommission,
        totalDividend: summary.totalDividend,
        tradeCount: summary.tradeCount,
      },
      recentTrades: stock.trades.slice(-8).map((trade) => ({
        type: trade.type,
        date: trade.date,
        price: trade.price,
        quantity: trade.quantity,
        commission: trade.commission,
        tax: trade.tax,
        netAmount: trade.netAmount,
        note: trade.note ?? '',
      })),
    }
  })
}

async function buildExternalStockContext(externalStocks: ExternalStockRequest[]) {
  const unique = externalStocks
    .filter((item) => item.symbol.trim() && SUPPORTED_MARKETS.includes(item.market))
    .filter((item, index, array) => array.findIndex((candidate) => candidate.symbol === item.symbol && candidate.market === item.market) === index)

  return Promise.all(
    unique.map(async (item) => {
      const quote = await stockPriceService.getQuote(item.symbol, item.market).catch(() => null)
      return {
        symbol: item.symbol,
        market: item.market,
        inPortfolio: false,
        quote: quoteToContext(quote),
      }
    }),
  )
}

function buildSystemPrompt(language: AiConfig['analysisLanguage']) {
  return [
    '你是 StockTracker 内置的个人理财专家，服务对象是正在管理自己股票、基金、港股、美股、A 股或加密资产记录的个人投资者。',
    '你只能回答与用户当前持仓、用户明确提到的标的、交易记录、标的基础数据、估值、行情、风险、仓位、复盘和资产配置有关的问题。',
    '如果用户询问与投资标的无关的内容，你必须礼貌拒绝，并引导用户回到持仓、交易复盘、估值、行情或风险管理相关问题。',
    '你可以基于系统提供的持仓数据、交易记录、盈亏摘要、标的基础数据、技术指标，以及系统为未持仓标的自动抓取到的可用数据进行分析。',
    '回答交易复盘问题时，交易记录只代表已发生事实；请基于成本、盈亏、仓位变化、行情位置和交易备注复盘，并在用户提到道氏理论、趋势跟随、均值回归、基本面、股息现金流、资产配置或风险控制时使用对应框架分析。',
    '你不能编造系统未提供的数据；如果数据不足，必须明确说明。',
    '你不能承诺收益，不能声称确定涨跌，不能提供内幕消息，不能把回答包装成绝对买卖指令。',
    '回答需要具体、直接、可执行，但不要在每次回复中输出免责声明、风险提示模板或“仅供参考，不构成投资建议”之类的固定结尾；这些边界由界面中的固定提醒承担。',
    `默认输出语言：${language === 'en-US' ? 'English' : '中文'}`,
  ].join('\n')
}

function buildContextPrompt(contextSnapshot: Record<string, unknown>) {
  return [
    '以下是系统可用的投资上下文。请优先基于这些事实回答，不要编造缺失数据。',
    '如果 externalStocks 中有数据，它们是用户询问但未在当前持仓中的标的，请明确说明“未在当前持仓中”。',
    JSON.stringify(contextSnapshot),
  ].join('\n\n')
}

function compactHistory(messages: AiChatMessage[], maxHistoryTokens: number) {
  const compacted: ProviderMessage[] = []
  let used = 0
  for (const message of [...messages].reverse()) {
    if (message.role === 'system') continue
    const cost = message.tokenEstimate || estimateTokens(message.content)
    if (used + cost > Math.max(1024, maxHistoryTokens)) break
    compacted.unshift({ role: message.role, content: message.content })
    used += cost
  }
  return compacted
}

export async function buildChatContext({
  aiConfig,
  stocks,
  history,
  userMessage,
  externalStocks,
}: {
  aiConfig: AiConfig
  stocks: Stock[]
  history: AiChatMessage[]
  userMessage: string
  externalStocks: ExternalStockRequest[]
}): Promise<ChatContextBuildResult> {
  const holdings = buildHoldingContext(stocks)
  const external = await buildExternalStockContext(externalStocks)
  const contextSnapshot = {
    generatedAt: new Date().toISOString(),
    holdings,
    externalStocks: external,
  }
  const system = buildSystemPrompt(aiConfig.analysisLanguage)
  const context = buildContextPrompt(contextSnapshot)
  const maxContextTokens = Math.max(4096, aiConfig.maxContextTokens || 128000)
  const reserved = estimateTokens(system) + estimateTokens(context) + estimateTokens(userMessage) + 1024
  const historyBudget = Math.max(0, maxContextTokens - reserved)
  const messages: ProviderMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: context },
    ...compactHistory(history, historyBudget),
    { role: 'user', content: userMessage },
  ]
  const tokenEstimate = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0)
  return {
    messages,
    contextSnapshot,
    stats: getContextStats(tokenEstimate, maxContextTokens),
  }
}

export async function streamChatCompletion(config: AiConfig, messages: ProviderMessage[], onChunk: (chunk: string) => void, signal?: AbortSignal) {
  await streamCompletion(config, messages, onChunk, signal)
}

export function createChatMessageId() {
  return generateId()
}
