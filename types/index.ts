// 数据模型 - 设计为未来可迁移云端数据库的结构
// 所有字段名使用英文，便于未来对接RESTful API

export type Market = 'A' | 'HK' | 'US' | 'FUND' | 'CRYPTO'

// 交易类型：DIVIDEND 表示现金收益（股票分红、基金派息、加密资产收益等）
export type TradeType = 'BUY' | 'SELL' | 'DIVIDEND'

// 单笔交易记录
export interface Trade {
  id: string            // UUID
  stockId: string       // 关联持仓 ID
  type: TradeType
  date: string          // ISO date string: "2024-01-15"
  price: number         // 成交价格（现金收益时为单位到账金额）
  quantity: number      // 成交数量（现金收益时为持有数量）
  commission: number    // 手续费（元）
  tax: number           // 税费合计（如印花税、过户费、结算费）
  deferredDividendTax?: number // A股分红递延到卖出时补扣的个人所得税
  totalAmount: number   // 总金额（price * quantity，不含费用）
  netAmount: number     // 实际金额（买入含费用，卖出/现金收益扣费用）
  note?: string
  createdAt: string     // 创建时间
  updatedAt: string
}

// 单笔交易盈亏明细（计算型，卖出按 FIFO 匹配成本批次）
export interface TradePnlDetail {
  tradeId: string
  type: TradeType
  date: string
  pnl: number           // 该笔盈亏
  pnlPercent: number    // 盈亏率
  costBasis: number     // 对应的买入成本
  proceeds: number      // 卖出实收（含税后）
  holdingAfterTrade?: number   // 该笔交易完成后的总持仓
  soldQuantity?: number        // 对买入记录而言，该笔买入已被卖出的数量
  remainingQuantity?: number   // 对买入记录而言，该笔买入当前尚未卖出的剩余数量
  isDividend?: boolean
}

// 投资标的持仓/历史记录
export interface Stock {
  id: string
  code: string          // 标的代码：000001, 00700, AAPL, BTC
  name: string          // 标的名称
  market: Market
  trades: Trade[]
  note?: string
  createdAt: string
  updatedAt: string
}

// 手续费配置（每个市场可单独配置）
export interface FeeConfig {
  market: Market
  commissionRate: number      // 佣金率（如 0.0003 = 万三）
  minCommission: number       // 最低佣金（元）
  stampDutyRate: number       // 印花税率（按该市场的默认口径）
  transferFeeRate: number     // 过户费率（按该市场的默认口径）
  settlementFeeRate?: number  // 结算费率（港股用）
}

export type AiAnalysisLanguage = 'zh-CN' | 'en-US'
export type AiProvider = 'openai-compatible' | 'anthropic-compatible'
export type AiAnalysisType = 'portfolio' | 'stock' | 'market' | 'financial'
export type AiConfidence = 'low' | 'medium' | 'high'
export type AiAnalysisStrength = 'high' | 'medium' | 'weak'
export type MarketRegion = 'A' | 'HK' | 'US'
export type Currency = 'CNY' | 'HKD' | 'USD' | 'USDT'

export interface AiConfig {
  enabled: boolean
  provider: AiProvider
  baseUrl: string
  model: string
  apiKey: string
  temperature: number
  maxContextTokens: number
  newsEnabled: boolean
  analysisLanguage: AiAnalysisLanguage
}

// 应用配置
export interface AppConfig {
  version: string
  defaultMarket: Market
  feeConfigs: Record<Market, FeeConfig>
  aiConfig: AiConfig
  currency: {
    A: 'CNY'
    HK: 'HKD'
    US: 'USD'
    FUND: 'CNY'
    CRYPTO: 'USDT'
  }
  portfolio: {
    totalCapital: {
      amount: number
      currency: Currency
    } | null
  }
}

// 盈亏计算结果（计算型，不存储）
export interface TradeProfit {
  tradeId: string
  pnl: number           // 盈亏金额
  pnlPercent: number    // 盈亏百分比
  buyAmount: number     // 买入金额（含手续费）
  sellAmount: number    // 卖出金额（扣手续费）
}

// 单个标的整体盈亏摘要（计算型）
export interface StockSummary {
  stock: Stock
  totalBuyAmount: number    // 总买入（含费）
  totalSellAmount: number   // 总卖出（扣费）
  currentHolding: number    // 当前持仓数量
  avgCostPrice: number      // 当前持仓成本价（券商摊薄口径）
  fifoCostBasis: number     // 当前剩余持仓的 FIFO 批次成本
  fifoAvgCostPrice: number  // 当前剩余持仓的 FIFO 成本价
  realizedPnl: number       // 已实现盈亏（现金收益会优先摊低仍持有批次的成本）
  unrealizedPnl: number     // 未实现盈亏（需输入当前价格）
  totalPnl: number          // 总盈亏
  totalPnlPercent: number   // 总盈亏%
  totalCommission: number   // 总手续费
  totalDividend: number     // 累计现金收益
  tradeCount: number        // 交易笔数（不含现金收益）
  tradePnlDetails: TradePnlDetail[]  // 每笔交易的盈亏明细
}

// 导出的数据结构（用于JSON导出）
export interface ExportData {
  meta: {
    version: string
    exportedAt: string
    appName: string
  }
  config: AppConfig
  stocks: Stock[]
}

export interface NewsItem {
  title: string
  source: string
  publishedAt: string
  summary: string
  url: string
}

export interface TechnicalIndicatorSnapshot {
  close: number
  ma5: number | null
  ma10: number | null
  ma20: number | null
  ema12: number | null
  ema26: number | null
  macd: {
    dif: number | null
    dea: number | null
    histogram: number | null
  }
  rsi14: number | null
  boll: {
    upper: number | null
    middle: number | null
    lower: number | null
  }
  atr14: number | null
  supportLevel: number | null
  resistanceLevel: number | null
  volumeRatio20: number | null
  trendBias: 'bullish' | 'neutral' | 'bearish'
}

export interface TechnicalIndicatorHistoryPoint {
  date: string
  close: number
  changePercent: number | null
  volumeRatio20: number | null
  ma5: number | null
  ma10: number | null
  ma20: number | null
  macd: {
    dif: number | null
    dea: number | null
    histogram: number | null
  }
  rsi14: number | null
  trendBias: TechnicalIndicatorSnapshot['trendBias']
}

export interface TechnicalIndicatorHistory {
  window: number
  points: TechnicalIndicatorHistoryPoint[]
  summary: {
    closeChangePercent: number | null
    macdHistogramChange: number | null
    rsiChange: number | null
    bullishDays: number
    bearishDays: number
  }
}

export interface MarketIndexSnapshot {
  id: string
  code: string
  name: string
  region: MarketRegion
  market: Market
  price: number
  change: number
  changePercent: number
  previousClose: number | null
  open: number | null
  high: number | null
  low: number | null
  volume: number | null
  timestamp: string
  currency: string
  source: string
  indicators?: TechnicalIndicatorSnapshot | null
}

export interface AiProbabilityScenario {
  label: string
  probability: number
  rationale: string
}

export interface AiTimeHorizonAssessment {
  horizon: 'short' | 'medium'
  summary: string
  scenarios: AiProbabilityScenario[]
}

export interface AiTechnicalSignal {
  name: string
  value: string
  interpretation: string
}

export interface AiNewsDriver {
  headline: string
  source: string
  publishedAt: string
  sentiment: 'positive' | 'neutral' | 'negative'
  impact: string
  url?: string
}

export interface AiAnalysisResult {
  generatedAt: string
  cached: boolean
  analysisStrength: AiAnalysisStrength
  summary: string
  stance: string
  facts: string[]
  inferences: string[]
  actionPlan: string[]
  invalidationSignals: string[]
  timeHorizons: AiTimeHorizonAssessment[]
  probabilityAssessment: AiProbabilityScenario[]
  technicalSignals: AiTechnicalSignal[]
  newsDrivers: AiNewsDriver[]
  keyLevels: string[]
  positionAdvice?: string[]
  portfolioRiskNotes?: string[]
  actionableObservations: string[]
  risks: string[]
  confidence: AiConfidence
  disclaimer: string
  evidence: string[]
}

export interface AiAnalysisHistoryRecord {
  id: string
  userId: string
  type: AiAnalysisType
  stockId?: string | null
  stockCode?: string | null
  stockName?: string | null
  market?: Market | null
  tags: string[]
  confidence: AiConfidence
  generatedAt: string
  createdAt: string
  result: AiAnalysisResult | Record<string, unknown>
}

export type AiChatRole = 'system' | 'user' | 'assistant'
export type AiContextLevel = 'short' | 'medium' | 'long' | 'near-limit'

export interface AiChatSession {
  id: string
  userId: string
  title: string
  scope: string
  createdAt: string
  updatedAt: string
  messageCount: number
  latestMessageAt?: string | null
}

export interface AiChatMessage {
  id: string
  sessionId: string
  userId: string
  role: AiChatRole
  content: string
  contextSnapshot?: Record<string, unknown> | null
  tokenEstimate: number
  createdAt: string
}

export interface AiAgentRun {
  id: string
  sessionId: string
  userId: string
  messageId?: string | null
  intent: string
  responseMode: string
  plan: Record<string, unknown>
  skillCalls: unknown[]
  skillResults: unknown[]
  contextStats: Record<string, unknown>
  error?: string | null
  createdAt: string
}

export interface AiChatContextStats {
  tokenEstimate: number
  maxContextTokens: number
  level: AiContextLevel
}
