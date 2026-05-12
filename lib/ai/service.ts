import { createHash } from 'node:crypto'
import { buildAnalysisSystemPrompt, PORTFOLIO_ANALYSIS_PROMPT, STOCK_ANALYSIS_PROMPT } from '@/lib/agent/prompts/analysis'
import { runPortfolioAnalysisAgentTask, runStockAnalysisAgentTask } from '@/lib/agent/tasks/analysis'
import { callJsonCompletion } from '@/lib/external/llmProvider'
import { logger } from '@/lib/observability/logger'
import type { PortfolioAnalysisContext, StockAnalysisContext } from '@/lib/agent/skills/analysis'
import type {
  AiAnalysisHistoryRecord,
  AiAnalysisResult,
  AiConfig,
  AiConfidence,
  AiNewsDriver,
  AiProbabilityScenario,
  AiTechnicalSignal,
  Stock,
} from '@/types'
import type { Market } from '@/types'

const ANALYSIS_CACHE = new Map<string, { expiresAt: number; result: AiAnalysisResult }>()

function getCacheKey(prefix: string, payload: unknown) {
  return `${prefix}:${createHash('sha1').update(JSON.stringify(payload)).digest('hex')}`
}

function getCachedAnalysis(key: string) {
  const cached = ANALYSIS_CACHE.get(key)
  if (!cached) return null
  if (Date.now() > cached.expiresAt) {
    ANALYSIS_CACHE.delete(key)
    return null
  }
  return cached.result
}

function setCachedAnalysis(key: string, result: AiAnalysisResult, ttlSeconds: number) {
  ANALYSIS_CACHE.set(key, {
    result: { ...result, cached: true },
    expiresAt: Date.now() + ttlSeconds * 1000,
  })
}

function validateAiConfig(config: AiConfig) {
  if (!config.enabled) throw new Error('AI 功能尚未启用')
  if (!config.baseUrl.trim()) throw new Error('请先配置 AI Base URL')
  if (!config.model.trim()) throw new Error('请先配置 AI 模型')
  if (!config.apiKey.trim()) throw new Error('请先配置 AI API Key')
}

function buildPromptEnvelope(config: AiConfig, analysisPrompt: string, outputContract: Record<string, unknown>, task: string, context: unknown) {
  return {
    system: buildAnalysisSystemPrompt(config.analysisLanguage, analysisPrompt),
    user: JSON.stringify({
      task,
      intensity: 'high',
      horizons: {
        short: '1-5 个交易日',
        medium: '1-4 周',
      },
      outputRules: [
        '必须先得出结论，再给出证据依据；summary 第一句话必须包含明确主动作。',
        '标的主动作只能从“买入 / 加仓 / 继续持有 / 减仓 / 卖出 / 观望 / 回避”中选择；组合主动作只能从“继续持有 / 分批减仓 / 控制仓位 / 暂不加仓 / 调整结构 / 等待确认”中选择。',
        '不能把“仅供参考”“结合自身情况”“继续观察”作为主结论；若选择观望或等待确认，必须说明等待的具体信号、当前不操作的原因和后续触发动作。',
        'actionPlan 必须是可执行清单，每条都要包含动作、触发条件或原因，不能只写泛泛提醒。',
        '禁止输出“不要只凭单一信号操作”“避免情绪化买卖”“投资有风险”这类用户已经知道的常识句，必须替换为当前标的或组合的具体条件。',
        '凡是提到“支撑”“阻力”“新闻情绪”“趋势确认”“风险边界”，必须给出具体数值、方向、依据或明确说明当前数据缺失。',
        '标的 actionPlan 至少包含一条买入/加仓触发条件、一条减仓/卖出触发条件，以及一条继续持有或观望的前提。',
        '必须把事实与推断分开表达。',
        '必须给出概率分析，且概率总和为 100。',
        '高强度模式下必须给明确倾向，且必须回答“现在更应该做什么”“现在不该做什么”。',
        '结论不能停留在“继续观察”这种空泛表述，除非你明确说明观察的原因、等待的信号和不建议动作的原因。',
        '如果证据不足，请明确写出信息不足和需要继续观察的信号。',
        '如果新闻、技术面、盈亏结构彼此矛盾，必须指出矛盾来源，并说明当前更应优先看哪一项。',
      ],
      context,
      outputContract,
    }),
  }
}

function requireTextField(parsed: Partial<AiAnalysisResult>, field: keyof AiAnalysisResult, missing: string[]) {
  const value = parsed[field]
  if (typeof value !== 'string' || !value.trim()) {
    missing.push(String(field))
    return ''
  }
  return value
}

function requireArrayField<T>(parsed: Partial<AiAnalysisResult>, field: keyof AiAnalysisResult, missing: string[]) {
  const value = parsed[field]
  if (!Array.isArray(value) || value.length === 0) {
    missing.push(String(field))
    return [] as T[]
  }
  return value as T[]
}

function textFromRecord(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function normalizeProbabilityScenarios(value: unknown): AiProbabilityScenario[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const record = item as Record<string, unknown>
      const label = textFromRecord(record, ['label', 'name', 'scenario'])
      const probability = Number(record.probability ?? record.percent ?? record.chance)
      const rationale = textFromRecord(record, ['rationale', 'reason', 'description', 'explanation', 'impact'])
      if (!label || !Number.isFinite(probability) || !rationale) return null
      return { label, probability, rationale }
    })
    .filter((item): item is AiProbabilityScenario => Boolean(item))
}

function normalizeAnalysisShape(parsed: Partial<AiAnalysisResult> | null) {
  if (!parsed) return parsed
  return {
    ...parsed,
    probabilityAssessment: normalizeProbabilityScenarios(parsed.probabilityAssessment),
    timeHorizons: Array.isArray(parsed.timeHorizons)
      ? parsed.timeHorizons.map((item) => ({
          ...item,
          scenarios: normalizeProbabilityScenarios((item as { scenarios?: unknown }).scenarios),
        }))
      : parsed.timeHorizons,
  }
}

function collectMissingAnalysisFields(parsed: Partial<AiAnalysisResult> | null, mode: 'portfolio' | 'stock') {
  if (!parsed) {
    return ['__json__']
  }

  const missing: string[] = []
  if (!['high', 'medium', 'weak'].includes(String(parsed.analysisStrength))) missing.push('analysisStrength')
  if (!['low', 'medium', 'high'].includes(String(parsed.confidence))) missing.push('confidence')
  for (const field of ['summary', 'stance', 'disclaimer'] as const) {
    const value = parsed[field]
    if (typeof value !== 'string' || !value.trim()) missing.push(field)
  }
  for (const field of [
    'facts',
    'inferences',
    'actionPlan',
    'invalidationSignals',
    'timeHorizons',
    'probabilityAssessment',
    'technicalSignals',
    'newsDrivers',
    'keyLevels',
    'actionableObservations',
    'risks',
    'evidence',
  ] as const) {
    const value = parsed[field]
    if (!Array.isArray(value) || value.length === 0) missing.push(field)
  }
  if (mode === 'stock' && (!Array.isArray(parsed.positionAdvice) || parsed.positionAdvice.length === 0)) missing.push('positionAdvice')
  if (mode === 'portfolio' && (!Array.isArray(parsed.portfolioRiskNotes) || parsed.portfolioRiskNotes.length === 0)) missing.push('portfolioRiskNotes')
  return Array.from(new Set(missing))
}

async function repairAnalysisResult(
  config: AiConfig,
  mode: 'portfolio' | 'stock',
  parsed: Partial<AiAnalysisResult> | null,
  missingFields: string[],
  context: PortfolioAnalysisContext | StockAnalysisContext,
) {
  if (!parsed || !missingFields.length || missingFields.includes('__json__')) return parsed
  const raw = await callProvider(
    config,
    '你是严格的 JSON 结构修复助手。只输出 JSON 对象，不要输出解释。',
    JSON.stringify({
      task: '补全 AI 投资分析结果缺失的字段。必须保留 currentResult 中已有结论，只补齐 missingFields；补齐内容必须基于 context，不得编造不存在的数据。',
      mode,
      missingFields,
      currentResult: parsed,
      context,
      outputContract: mode === 'stock'
        ? {
            actionableObservations: ['string'],
            risks: ['string'],
            evidence: ['string'],
            positionAdvice: ['string'],
          }
        : {
            actionableObservations: ['string'],
            risks: ['string'],
            evidence: ['string'],
            portfolioRiskNotes: ['string'],
          },
    }),
  )
  const patch = safeParseJsonObject<Partial<AiAnalysisResult>>(raw)
  return patch ? { ...parsed, ...patch } : parsed
}

function normalizeAnalysisResult(parsed: Partial<AiAnalysisResult> | null, mode: 'portfolio' | 'stock'): AiAnalysisResult {
  if (!parsed) {
    throw new Error('AI 分析返回不是有效 JSON，已停止生成分析。')
  }

  const missing = collectMissingAnalysisFields(parsed, mode).filter((field) => field !== '__json__')
  const analysisStrength = ['high', 'medium', 'weak'].includes(String(parsed.analysisStrength)) ? parsed.analysisStrength! : 'weak'
  const confidence = ['low', 'medium', 'high'].includes(String(parsed.confidence)) ? parsed.confidence! : 'low'
  const summary = requireTextField(parsed, 'summary', missing)
  const stance = requireTextField(parsed, 'stance', missing)
  const disclaimer = requireTextField(parsed, 'disclaimer', missing)
  const facts = requireArrayField<string>(parsed, 'facts', missing)
  const inferences = requireArrayField<string>(parsed, 'inferences', missing)
  const actionPlan = requireArrayField<string>(parsed, 'actionPlan', missing)
  const invalidationSignals = requireArrayField<string>(parsed, 'invalidationSignals', missing)
  const timeHorizons = requireArrayField<AiAnalysisResult['timeHorizons'][number]>(parsed, 'timeHorizons', missing)
  const probabilityAssessment = requireArrayField<AiProbabilityScenario>(parsed, 'probabilityAssessment', missing)
  const technicalSignals = requireArrayField<AiTechnicalSignal>(parsed, 'technicalSignals', missing)
  const newsDrivers = requireArrayField<AiNewsDriver>(parsed, 'newsDrivers', missing)
  const keyLevels = requireArrayField<string>(parsed, 'keyLevels', missing)
  const actionableObservations = requireArrayField<string>(parsed, 'actionableObservations', missing)
  const risks = requireArrayField<string>(parsed, 'risks', missing)
  const evidence = requireArrayField<string>(parsed, 'evidence', missing)
  const positionAdvice = mode === 'stock' ? requireArrayField<string>(parsed, 'positionAdvice', missing) : undefined
  const portfolioRiskNotes = mode === 'portfolio' ? requireArrayField<string>(parsed, 'portfolioRiskNotes', missing) : undefined

  if (missing.length) {
    throw new Error(`AI 分析返回缺少必填字段：${Array.from(new Set(missing)).join('、')}。已停止生成分析。`)
  }

  return {
    generatedAt: new Date().toISOString(),
    cached: false,
    analysisStrength,
    summary,
    stance,
    facts,
    inferences,
    actionPlan,
    invalidationSignals,
    timeHorizons,
    probabilityAssessment,
    technicalSignals,
    newsDrivers,
    keyLevels,
    positionAdvice,
    portfolioRiskNotes,
    actionableObservations,
    risks,
    confidence,
    disclaimer,
    evidence,
  }
}

function extractJsonBlock(content: string) {
  if (!content.trim()) return ''
  const fenced = content.match(/```json\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const objectMatch = content.match(/\{[\s\S]*\}/)
  return objectMatch?.[0]?.trim() ?? content.trim()
}

function safeParseJsonObject<T>(raw: string): T | null {
  const candidate = extractJsonBlock(raw)
  if (!candidate) return null

  try {
    return JSON.parse(candidate) as T
  } catch {
    const repaired = candidate
      .replace(/^[^{]*/, '')
      .replace(/[^}]*$/, '')
      .trim()
    if (!repaired) return null
    try {
      return JSON.parse(repaired) as T
    } catch {
      logger.warn('ai.analysis.parseJson.failed', { rawPreview: raw.slice(0, 500) })
      return null
    }
  }
}

async function callProvider(config: AiConfig, systemPrompt: string, userPrompt: string) {
  return callJsonCompletion(config, systemPrompt, userPrompt)
}

function portfolioPrompt(context: PortfolioAnalysisContext, config: AiConfig) {
  return buildPromptEnvelope(
    config,
    PORTFOLIO_ANALYSIS_PROMPT,
    {
      analysisStrength: 'high|medium|weak',
      summary: 'string',
      stance: 'string',
      facts: ['string'],
      inferences: ['string'],
      actionPlan: ['string'],
      invalidationSignals: ['string'],
      timeHorizons: [{ horizon: 'short|medium', summary: 'string', scenarios: [{ label: 'string', probability: 'number', rationale: 'string' }] }],
      probabilityAssessment: [{ label: 'string', probability: 'number', rationale: 'string' }],
      portfolioRiskNotes: ['string'],
      actionableObservations: ['string'],
      risks: ['string'],
      confidence: 'low|medium|high',
      evidence: ['string'],
      disclaimer: 'string',
    },
    '请对当前组合做短中期分析，重点关注仓位集中度、已实现/未实现盈亏结构、主要风险暴露，并给出可执行的组合操作建议。',
    context,
  )
}

function stockPrompt(context: StockAnalysisContext, config: AiConfig) {
  return buildPromptEnvelope(
    config,
    STOCK_ANALYSIS_PROMPT,
    {
      analysisStrength: 'high|medium|weak',
      summary: 'string',
      stance: 'string',
      facts: ['string'],
      inferences: ['string'],
      actionPlan: ['string'],
      invalidationSignals: ['string'],
      timeHorizons: [{ horizon: 'short|medium', summary: 'string', scenarios: [{ label: 'string', probability: 'number', rationale: 'string' }] }],
      probabilityAssessment: [{ label: 'string', probability: 'number', rationale: 'string' }],
      technicalSignals: [{ name: 'string', value: 'string', interpretation: 'string' }],
      newsDrivers: [{ headline: 'string', source: 'string', publishedAt: 'string', sentiment: 'positive|neutral|negative', impact: 'string', url: 'string' }],
      keyLevels: ['string'],
      positionAdvice: ['string'],
      actionableObservations: ['string'],
      risks: ['string'],
      confidence: 'low|medium|high',
      evidence: ['string'],
      disclaimer: 'string',
    },
    '请对这个标的从持仓视角给出短中期分析，结合技术指标、持仓成本、盈亏状态与新闻驱动，给出买入、卖出、继续持有、减仓或观望等明确操作建议。',
    context,
  )
}

export async function generatePortfolioAnalysis(stocks: Stock[], aiConfig: AiConfig, forceRefresh = false): Promise<AiAnalysisResult> {
  validateAiConfig(aiConfig)
  const cacheKey = getCacheKey('portfolio', {
    stocks: stocks.map((stock) => ({ id: stock.id, updatedAt: stock.updatedAt, trades: stock.trades.length })),
    aiConfig: { ...aiConfig, apiKey: '***' },
  })
  if (!forceRefresh) {
    const cached = getCachedAnalysis(cacheKey)
    if (cached) return cached
  }

  const task = await runPortfolioAnalysisAgentTask(stocks, aiConfig, { baseCurrency: 'CNY' })
  const context = task.context
  const { system, user } = portfolioPrompt(context, aiConfig)
  const raw = await callProvider(aiConfig, system, user)
  let parsed = safeParseJsonObject<Partial<AiAnalysisResult>>(raw)
  parsed = normalizeAnalysisShape(parsed)
  parsed = await repairAnalysisResult(aiConfig, 'portfolio', parsed, collectMissingAnalysisFields(parsed, 'portfolio'), context)
  parsed = normalizeAnalysisShape(parsed)

  const result = normalizeAnalysisResult(parsed, 'portfolio')
  setCachedAnalysis(cacheKey, result, 900)
  return result
}

export async function generateStockAnalysis(stock: Stock, aiConfig: AiConfig, forceRefresh = false): Promise<AiAnalysisResult> {
  validateAiConfig(aiConfig)
  const cacheKey = getCacheKey('stock', {
    stock: { id: stock.id, updatedAt: stock.updatedAt, trades: stock.trades.length },
    aiConfig: { ...aiConfig, apiKey: '***' },
  })
  if (!forceRefresh) {
    const cached = getCachedAnalysis(cacheKey)
    if (cached) return cached
  }

  const task = await runStockAnalysisAgentTask(stock, aiConfig)
  const context = task.context

  const { system, user } = stockPrompt(context, aiConfig)
  const raw = await callProvider(aiConfig, system, user)
  let parsed = safeParseJsonObject<Partial<AiAnalysisResult>>(raw)
  parsed = normalizeAnalysisShape(parsed)
  parsed = await repairAnalysisResult(aiConfig, 'stock', parsed, collectMissingAnalysisFields(parsed, 'stock'), context)
  parsed = normalizeAnalysisShape(parsed)

  const result = normalizeAnalysisResult(parsed, 'stock')
  setCachedAnalysis(cacheKey, result, 600)
  return result
}

export async function testAiConnection(config: AiConfig) {
  validateAiConfig(config)
  const raw = await callProvider(
    config,
    '你是一个只会返回 JSON 的连接测试助手。',
    JSON.stringify({
      task: '请返回一个 JSON 对象，包含 ok=true、provider、model、message。',
      provider: config.provider,
      model: config.model,
    }),
  )
  const parsed = safeParseJsonObject<{ ok?: boolean; provider?: string; model?: string; message?: string }>(raw)
  if (!parsed) {
    return {
      ok: true,
      provider: config.provider,
      model: config.model,
      message: '模型已连通，但返回内容不是严格 JSON，已按兼容模式处理。',
    }
  }
  return {
    ok: parsed.ok === true || parsed.message?.length !== 0,
    provider: parsed.provider ?? config.provider,
    model: parsed.model ?? config.model,
    message: parsed.message ?? '连接成功',
  }
}

export function buildAnalysisTags(
  type: AiAnalysisHistoryRecord['type'],
  confidence: AiConfidence,
  _strength: AiAnalysisResult['analysisStrength'],
  stock?: Pick<Stock, 'market' | 'code' | 'name'>,
) {
  const tags = [
    type === 'portfolio' ? '组合分析' : type === 'market' ? '大盘分析' : '标的分析',
    confidence === 'high' ? '高信心' : confidence === 'medium' ? '中等信心' : '低信心',
  ]
  if (stock) {
    tags.push(stock.code, stock.market, stock.name)
  }
  return tags
}
