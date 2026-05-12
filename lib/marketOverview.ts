import { createHash } from 'node:crypto'
import { buildAnalysisSystemPrompt, MARKET_ANALYSIS_PROMPT } from '@/lib/agent/prompts/analysis'
import { runMarketAnalysisAgentTask } from '@/lib/agent/tasks/analysis'
import { fetchStockNews } from '@/lib/external/news'
import { callJsonCompletion } from '@/lib/external/llmProvider'
import { MARKET_INDEX_DEFINITIONS, fetchMarketIndexSnapshot } from '@/lib/external/marketIndices'
import { logger } from '@/lib/observability/logger'
import type {
  AiAnalysisHistoryRecord,
  AiAnalysisResult,
  AiConfig,
  AiConfidence,
  AiNewsDriver,
  AiProbabilityScenario,
  AiTechnicalSignal,
  MarketIndexSnapshot,
  MarketRegion,
  NewsItem,
  TechnicalIndicatorSnapshot,
} from '@/types'
import type { Market } from '@/types'

const MARKET_ANALYSIS_CACHE = new Map<string, { expiresAt: number; result: AiAnalysisResult }>()

type MarketGroup = {
  region: MarketRegion
  label: string
  indices: MarketIndexSnapshot[]
  upCount: number
  downCount: number
  flatCount: number
  strongestIndex: MarketIndexSnapshot | null
  weakestIndex: MarketIndexSnapshot | null
}

type MarketOverview = {
  groups: MarketGroup[]
  totalUpCount: number
  totalDownCount: number
  totalFlatCount: number
  strongestIndex: MarketIndexSnapshot | null
  weakestIndex: MarketIndexSnapshot | null
  summary: {
    marketTone: string
    riskBias: string
    focusRegion: string
    cautionRegion: string
  }
  news: NewsItem[]
  updatedAt: string
}

export type MarketAnalysisContext = {
  groups: Array<{
    region: MarketRegion
    label: string
    upCount: number
    downCount: number
    flatCount: number
    indices: Array<{
      code: string
      name: string
      price: number
      change: number
      changePercent: number
      trendBias: TechnicalIndicatorSnapshot['trendBias'] | 'unknown'
      rsi14: number | null
      macdHistogram: number | null
      supportLevel: number | null
      resistanceLevel: number | null
    }>
  }>
  strongestIndex: { name: string; changePercent: number } | null
  weakestIndex: { name: string; changePercent: number } | null
  totalUpCount: number
  totalDownCount: number
  totalFlatCount: number
  news: NewsItem[]
}

const GROUP_LABELS: Record<MarketRegion, string> = {
  A: 'A 股大盘',
  HK: '港股大盘',
  US: '美股大盘',
}

function getMarketCacheKey(prefix: string, payload: unknown) {
  return `${prefix}:${createHash('sha1').update(JSON.stringify(payload)).digest('hex')}`
}

function getCachedMarketAnalysis(key: string) {
  const cached = MARKET_ANALYSIS_CACHE.get(key)
  if (!cached) return null
  if (Date.now() > cached.expiresAt) {
    MARKET_ANALYSIS_CACHE.delete(key)
    return null
  }
  return cached.result
}

function setCachedMarketAnalysis(key: string, result: AiAnalysisResult, ttlSeconds: number) {
  MARKET_ANALYSIS_CACHE.set(key, {
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

async function callProvider(config: AiConfig, systemPrompt: string, userPrompt: string) {
  return callJsonCompletion(config, systemPrompt, userPrompt)
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
      logger.warn('ai.market.parseJson.failed', { rawPreview: raw.slice(0, 500) })
      return null
    }
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

function normalizeMarketAnalysisShape(parsed: Partial<AiAnalysisResult> | null) {
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

function collectMissingMarketAnalysisFields(parsed: Partial<AiAnalysisResult> | null) {
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
  return Array.from(new Set(missing))
}

async function repairMarketAnalysisResult(
  config: AiConfig,
  parsed: Partial<AiAnalysisResult> | null,
  missingFields: string[],
  context: MarketAnalysisContext,
) {
  if (!parsed || !missingFields.length || missingFields.includes('__json__')) return parsed
  const raw = await callProvider(
    config,
    '你是严格的 JSON 结构修复助手。只输出 JSON 对象，不要输出解释。',
    JSON.stringify({
      task: '补全 AI 大盘分析结果缺失的字段。必须保留 currentResult 中已有结论，只补齐 missingFields；补齐内容必须基于 context，不得编造不存在的数据。',
      missingFields,
      currentResult: parsed,
      context,
      outputContract: {
        actionableObservations: ['string'],
        risks: ['string'],
        evidence: ['string'],
      },
    }),
  )
  const patch = safeParseJsonObject<Partial<AiAnalysisResult>>(raw)
  return patch ? { ...parsed, ...patch } : parsed
}

function normalizeMarketAnalysisResult(
  parsed: Partial<AiAnalysisResult> | null,
): AiAnalysisResult {
  if (!parsed) {
    throw new Error('AI 大盘分析返回不是有效 JSON，已停止生成分析。')
  }

  const missing = collectMissingMarketAnalysisFields(parsed).filter((field) => field !== '__json__')
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

  if (missing.length) {
    throw new Error(`AI 大盘分析返回缺少必填字段：${Array.from(new Set(missing)).join('、')}。已停止生成分析。`)
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
    actionableObservations,
    risks,
    confidence,
    disclaimer,
    evidence,
  }
}

function marketPrompt(context: MarketAnalysisContext, config: AiConfig) {
  return {
    system: buildAnalysisSystemPrompt(config.analysisLanguage, MARKET_ANALYSIS_PROMPT),
    user: JSON.stringify({
      task: '请对当前 A 股、港股和美股大盘做短中期分析，结合指数涨跌结构、技术指标和近期新闻，输出更有指导性的结构化观察建议。',
      intensity: 'high',
      horizons: {
        short: '1-5 个交易日',
        medium: '1-4 周',
      },
      outputRules: [
        '必须先判断市场强弱，再解释依据。',
        '必须区分事实与推断。',
        '必须给出概率分析，且概率总和为 100。',
        '高强度模式下可以给更直接的节奏倾向，但不能承诺收益。',
        '必须明确回答当前更适合偏进攻还是偏防守，以及现在不适合做什么。',
        '不能只写“关注节奏变化”，必须指出最值得优先观察的市场和触发条件。',
      ],
      context,
      outputContract: {
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
        actionableObservations: ['string'],
        risks: ['string'],
        confidence: 'low|medium|high',
        evidence: ['string'],
        disclaimer: 'string',
      },
    }),
  }
}

export async function fetchMarketOverview(): Promise<MarketOverview> {
  const snapshots = (await Promise.all(MARKET_INDEX_DEFINITIONS.map((definition) => fetchMarketIndexSnapshot(definition))))
    .filter((item): item is MarketIndexSnapshot => item !== null)

  const groups = (['A', 'HK', 'US'] as const).map((region) => {
    const indices = snapshots.filter((item) => item.region === region)
    return {
      region,
      label: GROUP_LABELS[region],
      indices,
      upCount: indices.filter((item) => item.change > 0).length,
      downCount: indices.filter((item) => item.change < 0).length,
      flatCount: indices.filter((item) => item.change === 0).length,
      strongestIndex: indices.length > 0
        ? [...indices].sort((left, right) => right.changePercent - left.changePercent)[0] ?? null
        : null,
      weakestIndex: indices.length > 0
        ? [...indices].sort((left, right) => left.changePercent - right.changePercent)[0] ?? null
        : null,
    }
  })

  const strongestIndex = snapshots.length > 0
    ? [...snapshots].sort((left, right) => right.changePercent - left.changePercent)[0] ?? null
    : null
  const weakestIndex = snapshots.length > 0
    ? [...snapshots].sort((left, right) => left.changePercent - right.changePercent)[0] ?? null
    : null
  const totalUpCount = snapshots.filter((item) => item.change > 0).length
  const totalDownCount = snapshots.filter((item) => item.change < 0).length
  const totalFlatCount = snapshots.filter((item) => item.change === 0).length
  const benchmarkDefs = MARKET_INDEX_DEFINITIONS.filter((item) =>
    ['shanghai-composite', 'hang-seng', 'dow-jones'].includes(item.id),
  )
  const news = (await Promise.all(
    benchmarkDefs.map((definition) => fetchStockNews(definition.code, definition.name, definition.market, 2)),
  )).flat().slice(0, 6)

  const focusRegion = groups
    .filter((group) => group.indices.length > 0)
    .sort((left, right) => {
      const leftStrength = left.strongestIndex?.changePercent ?? -999
      const rightStrength = right.strongestIndex?.changePercent ?? -999
      return rightStrength - leftStrength
    })[0] ?? null
  const cautionRegion = groups
    .filter((group) => group.indices.length > 0)
    .sort((left, right) => {
      const leftWeakness = left.weakestIndex?.changePercent ?? 999
      const rightWeakness = right.weakestIndex?.changePercent ?? 999
      return leftWeakness - rightWeakness
    })[0] ?? null
  const riskBias = totalUpCount > totalDownCount
    ? '当前风险偏好略偏正面，但仍需提防强弱分化。'
    : totalUpCount < totalDownCount
      ? '当前市场更偏防守，适合先看弱势是否继续扩散。'
      : '当前三地市场分化明显，整体更像等待确认。'
  const marketTone = strongestIndex && weakestIndex
    ? `当前最强指数是 ${strongestIndex.name}，最弱指数是 ${weakestIndex.name}，市场节奏以分化为主。`
    : '当前市场节奏以观察三地强弱轮动为主。'

  return {
    groups,
    totalUpCount,
    totalDownCount,
    totalFlatCount,
    strongestIndex,
    weakestIndex,
    summary: {
      marketTone,
      riskBias,
      focusRegion: focusRegion ? `${focusRegion.label} 相对更强，更值得优先跟踪。` : '暂无明确的领先市场。',
      cautionRegion: cautionRegion ? `${cautionRegion.label} 当前更弱，需要优先防范拖累效应。` : '暂无明确的弱势市场。',
    },
    news,
    updatedAt: new Date().toISOString(),
  }
}

export async function buildMarketAnalysisContextFromSources(aiConfig: AiConfig): Promise<{ context: MarketAnalysisContext; indices: MarketIndexSnapshot[]; news: NewsItem[] }> {
  const indices = (await Promise.all(
    MARKET_INDEX_DEFINITIONS.map((definition) => fetchMarketIndexSnapshot(definition, { includeIndicators: true })),
  )).filter((item): item is MarketIndexSnapshot => item !== null)

  const benchmarkDefs = MARKET_INDEX_DEFINITIONS.filter((item) =>
    ['shanghai-composite', 'hang-seng', 'dow-jones'].includes(item.id),
  )
  const news = aiConfig.newsEnabled
    ? (await Promise.all(
        benchmarkDefs.map((definition) => fetchStockNews(definition.code, definition.name, definition.market, 3)),
      )).flat()
    : []

  return {
    context: buildMarketAnalysisContext(indices, news),
    indices,
    news,
  }
}

function buildMarketAnalysisContext(indices: MarketIndexSnapshot[], news: NewsItem[]): MarketAnalysisContext {
  const groups = (['A', 'HK', 'US'] as const).map((region) => {
    const regionIndices = indices.filter((item) => item.region === region)
    return {
      region,
      label: GROUP_LABELS[region],
      upCount: regionIndices.filter((item) => item.change > 0).length,
      downCount: regionIndices.filter((item) => item.change < 0).length,
      flatCount: regionIndices.filter((item) => item.change === 0).length,
      indices: regionIndices.map((item) => ({
        code: item.code,
        name: item.name,
        price: item.price,
        change: item.change,
        changePercent: item.changePercent,
        trendBias: (item.indicators?.trendBias ?? 'unknown') as TechnicalIndicatorSnapshot['trendBias'] | 'unknown',
        rsi14: item.indicators?.rsi14 ?? null,
        macdHistogram: item.indicators?.macd.histogram ?? null,
        supportLevel: item.indicators?.supportLevel ?? null,
        resistanceLevel: item.indicators?.resistanceLevel ?? null,
      })),
    }
  })

  const strongest = indices.length > 0
    ? [...indices].sort((left, right) => right.changePercent - left.changePercent)[0]
    : null
  const weakest = indices.length > 0
    ? [...indices].sort((left, right) => left.changePercent - right.changePercent)[0]
    : null

  return {
    groups,
    strongestIndex: strongest ? { name: strongest.name, changePercent: strongest.changePercent } : null,
    weakestIndex: weakest ? { name: weakest.name, changePercent: weakest.changePercent } : null,
    totalUpCount: indices.filter((item) => item.change > 0).length,
    totalDownCount: indices.filter((item) => item.change < 0).length,
    totalFlatCount: indices.filter((item) => item.change === 0).length,
    news,
  }
}

export async function generateMarketAnalysis(aiConfig: AiConfig, forceRefresh = false): Promise<AiAnalysisResult> {
  validateAiConfig(aiConfig)

  const cacheKey = getMarketCacheKey('market', {
    aiConfig: { ...aiConfig, apiKey: '***' },
    date: new Date().toISOString().slice(0, 10),
  })

  if (!forceRefresh) {
    const cached = getCachedMarketAnalysis(cacheKey)
    if (cached) return cached
  }

  const task = await runMarketAnalysisAgentTask(aiConfig)
  const { context } = task.context
  const { system, user } = marketPrompt(context, aiConfig)
  const raw = await callProvider(aiConfig, system, user)
  let parsed = safeParseJsonObject<Partial<AiAnalysisResult>>(raw)
  parsed = normalizeMarketAnalysisShape(parsed)
  parsed = await repairMarketAnalysisResult(aiConfig, parsed, collectMissingMarketAnalysisFields(parsed), context)
  parsed = normalizeMarketAnalysisShape(parsed)

  const result = normalizeMarketAnalysisResult(parsed)

  setCachedMarketAnalysis(cacheKey, result, 900)
  return result
}

export function buildAnalysisTags(
  type: AiAnalysisHistoryRecord['type'],
  confidence: AiConfidence,
  _strength: AiAnalysisResult['analysisStrength'],
  stock?: { market: Market; code: string; name: string },
) {
  const typeLabel = type === 'portfolio' ? '组合分析' : type === 'market' ? '大盘分析' : '标的分析'
  const tags = [
    typeLabel,
    confidence === 'high' ? '高信心' : confidence === 'medium' ? '中等信心' : '低信心',
  ]
  if (stock) {
    tags.push(stock.code, stock.market, stock.name)
  } else if (type === 'market') {
    tags.push('A股', '港股', '美股')
  }
  return tags
}
