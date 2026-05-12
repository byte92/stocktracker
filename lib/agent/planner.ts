import { resolveSecurityCandidates, type SecurityCandidate } from '@/lib/agent/entity/securityResolver'
import type { AgentPlan, AgentResolvedSecurity, AgentSkillCall } from '@/lib/agent/types'
import type { AiChatMessage, AiConfig, Market, Stock } from '@/types'
import { callJsonCompletion } from '@/lib/external/llmProvider'
import { buildPlannerSystemPrompt } from '@/lib/agent/planner/prompt'
import { isPlannerNormalizedSkillName, resolvePlannerSkillActionName } from '@/lib/agent/planner/skillCatalog'
import {
  buildDefaultExternalStockSkillCalls,
  buildDefaultStockSkillCalls,
  buildExternalStockSkillCalls,
  buildStockSkillCalls,
} from '@/lib/agent/planner/skillCalls'
import { dedupeSkillCalls, textArg } from '@/lib/agent/planner/text'
import { buildDefaultSearchQuery, normalizeWebSkillCalls } from '@/lib/agent/planner/web'

const LLM_PLANNER_TIMEOUT_MS = 8_000
const PLANNER_REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high'] as const

type PlannerReasoningEffort = typeof PLANNER_REASONING_EFFORTS[number]

type ExternalStockTarget = Pick<SecurityCandidate, 'code' | 'name' | 'market'>

function isPlannerReasoningEffort(value: string): value is PlannerReasoningEffort {
  return PLANNER_REASONING_EFFORTS.includes(value as PlannerReasoningEffort)
}

function getPlannerReasoningEffort(): PlannerReasoningEffort | undefined {
  const configured = process.env.AGENT_PLANNER_REASONING_EFFORT?.trim().toLowerCase()
  if (configured) return isPlannerReasoningEffort(configured) ? configured : undefined
  return 'none'
}

function normalizeFinanceCalculationCall(call: AgentSkillCall, stock: Stock, userMessage: string): AgentSkillCall {
  const requestedType = textArg(call.args, ['type', 'calculation'])
  return {
    name: 'finance.calculate',
    args: {
      ...call.args,
      type: requestedType || 'dividend.estimate',
      stockId: stock.id,
    },
    reason: call.reason || '模型判断需要执行投资业务域计算',
  }
}

function normalizeFinanceCalculationCalls(plan: AgentPlan, stock: Stock, userMessage: string) {
  return plan.requiredSkills
    .filter((call) => call.name === 'finance.calculate')
    .map((call) => normalizeFinanceCalculationCall(call, stock, userMessage))
}

function planRequestsSkill(plan: AgentPlan, name: string) {
  return plan.requiredSkills.some((call) => call.name === name)
}

function plannedSkillArgs(plan: AgentPlan, name: string) {
  return plan.requiredSkills.find((call) => call.name === name)?.args ?? {}
}

function buildModelStockSkillCalls(stock: Stock, plan: AgentPlan, userMessage: string) {
  const skills = buildDefaultStockSkillCalls(stock)
  if (planRequestsSkill(plan, 'stock.getFinancials')) {
    const financialArgs: Record<string, unknown> = { ...plannedSkillArgs(plan, 'stock.getFinancials'), symbol: stock.code, market: stock.market }
    if (!financialArgs.researchQuery) financialArgs.researchQuery = buildDefaultSearchQuery(stock, userMessage)
    skills.push({ name: 'stock.getFinancials', args: financialArgs, reason: '模型判断需要财报或业绩数据' })
  }
  skills.push(...normalizeFinanceCalculationCalls(plan, stock, userMessage))
  skills.push(...normalizeWebSkillCalls(plan, userMessage, stock))
  return dedupeSkillCalls(skills)
}

function buildModelExternalStockSkillCalls(target: ExternalStockTarget, plan: AgentPlan, userMessage: string) {
  const skills = buildDefaultExternalStockSkillCalls(target)
  if (planRequestsSkill(plan, 'stock.getFinancials')) {
    const financialArgs: Record<string, unknown> = { ...plannedSkillArgs(plan, 'stock.getFinancials'), symbol: target.code, market: target.market }
    if (!financialArgs.researchQuery) financialArgs.researchQuery = buildDefaultSearchQuery(target, userMessage)
    skills.push({ name: 'stock.getFinancials', args: financialArgs, reason: '模型判断需要财报或业绩数据' })
  }
  skills.push(...normalizeWebSkillCalls(plan, userMessage, target))
  return dedupeSkillCalls(skills)
}

function passthroughModelContextCalls(plan: AgentPlan) {
  return plan.requiredSkills.filter((call) => !isPlannerNormalizedSkillName(call.name))
}

function needsResolvedSecurity(call: AgentSkillCall) {
  if (call.name === 'security.resolve' || call.name === 'market.resolveCandidate') return true
  if (call.name === 'finance.calculate') {
    const stockId = textArg(call.args, ['stockId'])
    const query = textArg(call.args, ['query', 'keyword', 'name', 'symbol', 'code'])
    return Boolean(!stockId && query)
  }
  if (!['stock.getExternalQuote', 'stock.getTechnicalSnapshot', 'stock.getFinancials'].includes(call.name)) return false
  const symbol = textArg(call.args, ['symbol', 'code', 'query', 'keyword', 'name'])
  const market = textArg(call.args, ['market'])
  return Boolean(symbol && (!market || /[\u4e00-\u9fff]/.test(symbol)))
}

function extractSecurityQueryFromPlan(plan: AgentPlan) {
  const entity = plan.entities.find((item) => item.type === 'stock' && item.raw && (!item.code || !item.market))
  if (entity?.raw) return entity.raw

  const call = plan.requiredSkills.find(needsResolvedSecurity)
  return textArg(call?.args, ['query', 'keyword', 'name', 'symbol', 'code'])
}

async function normalizeLlmPlan(plan: AgentPlan, userMessage: string, stocks: Stock[]): Promise<AgentPlan> {
  if (plan.responseMode !== 'answer') return plan

  const actionPlan = {
    ...plan,
    requiredSkills: plan.requiredSkills.map((call) => ({
      ...call,
      name: resolvePlannerSkillActionName(call.name),
    })),
  }

  const normalizedWebCalls = normalizeWebSkillCalls(actionPlan, userMessage)
  const baseCalls = actionPlan.requiredSkills.filter((call) => !call.name.startsWith('web.'))
  const normalizedPlan = {
    ...actionPlan,
    requiredSkills: dedupeSkillCalls([...baseCalls, ...normalizedWebCalls]),
  }

  const codedEntities = normalizedPlan.entities
    .filter((entity) => entity.type === 'stock' && entity.code && entity.market)
  if (codedEntities.length) {
    const localTargets: Array<{ entity: typeof codedEntities[number]; stock: Stock }> = []
    const externalTargets: ExternalStockTarget[] = []
    for (const entity of codedEntities) {
      const code = String(entity.code).toUpperCase()
      const market = entity.market as Market
      const stock = stocks.find((item) => item.code.toUpperCase() === code && item.market === market)
      if (stock) {
        localTargets.push({ entity, stock })
      } else {
        externalTargets.push({ code, name: entity.name || entity.raw || code, market })
      }
    }
    if (localTargets.length || externalTargets.length) {
      return {
        ...normalizedPlan,
        intent: normalizedPlan.intent === 'unknown' ? 'stock_analysis' : normalizedPlan.intent,
        entities: [
          ...localTargets.map(({ entity, stock }) => ({ type: 'stock' as const, raw: entity.raw, stockId: stock.id, code: stock.code, name: stock.name, market: stock.market, confidence: entity.confidence })),
          ...externalTargets.map((target) => ({ type: 'stock' as const, raw: target.name, code: target.code, name: target.name, market: target.market, confidence: 0.82 })),
        ],
        requiredSkills: dedupeSkillCalls([
          ...localTargets.flatMap(({ stock }) => buildModelStockSkillCalls(stock, normalizedPlan, userMessage)),
          ...externalTargets.flatMap((target) => buildModelExternalStockSkillCalls(target, normalizedPlan, userMessage)),
          ...passthroughModelContextCalls(normalizedPlan),
        ]),
      }
    }
  }

  const query = extractSecurityQueryFromPlan(normalizedPlan)
  if (!query) return normalizedPlan

  const candidates = await resolveSecurityCandidates(query, stocks, 3)
  const local = candidates.find((candidate) => candidate.inPortfolio && candidate.stockId)
  const stock = local ? stocks.find((item) => item.id === local.stockId) : null
  if (local && stock) {
    return {
      intent: normalizedPlan.intent === 'unknown' ? 'stock_analysis' : normalizedPlan.intent,
      entities: [{ type: 'stock', raw: query, stockId: stock.id, code: stock.code, name: stock.name, market: stock.market, confidence: local.confidence }],
      requiredSkills: dedupeSkillCalls([
        ...buildModelStockSkillCalls(stock, normalizedPlan, userMessage),
        ...passthroughModelContextCalls(normalizedPlan),
      ]),
      responseMode: 'answer',
    }
  }

  const externalTargets = candidates.filter((candidate) => !candidate.inPortfolio)
  if (externalTargets.length) {
    return {
      intent: 'stock_analysis',
      entities: externalTargets.map((candidate) => ({ type: 'stock', raw: candidate.name, code: candidate.code, name: candidate.name, market: candidate.market, confidence: candidate.confidence })),
      requiredSkills: dedupeSkillCalls([
        ...externalTargets.flatMap((candidate) => buildModelExternalStockSkillCalls(candidate, normalizedPlan, userMessage)),
        ...passthroughModelContextCalls(normalizedPlan),
      ]),
      responseMode: 'answer',
    }
  }

  return normalizedPlan
}

function summarizeRecentAgentContext(history: AiChatMessage[] | undefined) {
  const summaries: string[] = []
  for (const message of [...(history ?? [])].reverse()) {
    const agent = message.contextSnapshot?.agent as { entities?: unknown; requiredSkills?: unknown } | undefined
    const entities = Array.isArray(agent?.entities) ? agent.entities : []
    const entityText = entities
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
      .map((item) => [item.name, item.code, item.market].filter(Boolean).join('/'))
      .filter(Boolean)
      .join(', ')
    if (entityText) summaries.push(`最近讨论标的：${entityText}`)
    if (summaries.length >= 3) break
  }
  return summaries.join('\n')
}

async function planViaLLM(userMessage: string, stocks: Stock[], history: AiChatMessage[] | undefined, aiConfig: AiConfig): Promise<AgentPlan> {
  const stockSummary = stocks.length
    ? `当前持仓：\n${stocks.map((s) => `- ${s.name} (${s.code}, ${s.market})`).join('\n')}`
    : '当前无持仓'
  const recentContext = summarizeRecentAgentContext(history)

  const userPrompt = [
    `用户持仓信息：`,
    stockSummary,
    recentContext ? `\n近期对话上下文：\n${recentContext}` : '',
    '',
    `用户问题：${userMessage}`,
  ].filter(Boolean).join('\n')

  const reasoningEffort = getPlannerReasoningEffort()
  const raw = await callJsonCompletion(aiConfig, buildPlannerSystemPrompt(), userPrompt, AbortSignal.timeout(LLM_PLANNER_TIMEOUT_MS), {
    reasoningEffort,
    logFailureLevel: 'warn',
    logMetadata: {
      phase: 'agent.planner',
      optional: true,
      timeoutMs: LLM_PLANNER_TIMEOUT_MS,
      reasoningEffort,
    },
  })
  // 提取 JSON（可能有 markdown 代码块包裹）
  const json = raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim()
  const parsed = JSON.parse(json)

  const plan = {
    intent: parsed.intent || 'unknown',
    entities: Array.isArray(parsed.entities) ? parsed.entities : [],
    requiredSkills: Array.isArray(parsed.requiredSkills) ? parsed.requiredSkills : [],
    responseMode: parsed.responseMode || 'answer',
    clarifyQuestion: parsed.clarifyQuestion,
  }
  return normalizeLlmPlan(plan, userMessage, stocks)
}

export async function planAgentResponse({
  userMessage,
  stocks,
  history,
  resolvedSecurities = [],
  externalStocks = [],
  aiConfig,
}: {
  userMessage: string
  stocks: Stock[]
  history?: AiChatMessage[]
  resolvedSecurities?: AgentResolvedSecurity[]
  externalStocks?: Array<{ symbol: string; market: Market }>
  aiConfig: AiConfig
}): Promise<AgentPlan> {
  const content = userMessage.trim()

  const selectedSecurities: AgentResolvedSecurity[] = [
    ...resolvedSecurities,
    ...externalStocks.map((item) => ({ symbol: item.symbol, market: item.market, inPortfolio: false })),
  ]

  if (selectedSecurities.length) {
    const localTargets: Stock[] = []
    const externalTargets: ExternalStockTarget[] = []
    for (const item of selectedSecurities) {
      const symbol = item.symbol.trim()
      if (!symbol) continue

      const local = item.stockId
        ? stocks.find((stock) => stock.id === item.stockId)
        : stocks.find((stock) => stock.code.toUpperCase() === symbol.toUpperCase() && stock.market === item.market)

      if ((item.inPortfolio || item.stockId) && local) {
        localTargets.push(local)
        continue
      }

      externalTargets.push({ code: symbol, name: item.name || symbol, market: item.market })
    }

    let intent: AgentPlan['intent'] = 'stock_analysis'
    let skills: AgentSkillCall[] = [
      ...localTargets.flatMap((stock) => buildStockSkillCalls(stock, content)),
      ...externalTargets.flatMap((target) => buildExternalStockSkillCalls(target, content)),
    ]

    const llmPlan = await planViaLLM(content, stocks, history, aiConfig)
    if (llmPlan.responseMode === 'answer') {
      intent = llmPlan.intent === 'unknown' ? 'stock_analysis' : llmPlan.intent
      skills = [
        ...localTargets.flatMap((stock) => buildModelStockSkillCalls(stock, llmPlan, content)),
        ...externalTargets.flatMap((target) => buildModelExternalStockSkillCalls(target, llmPlan, content)),
        ...passthroughModelContextCalls(llmPlan),
      ]
    }

    return {
      intent,
      entities: [
        ...localTargets.map((stock) => ({
          type: 'stock' as const,
          raw: stock.name,
          stockId: stock.id,
          code: stock.code,
          name: stock.name,
          market: stock.market,
          confidence: 0.86,
        })),
        ...externalTargets.map((item) => ({
          type: 'stock' as const,
          raw: item.name,
          code: item.code,
          name: item.name,
          market: item.market,
          confidence: 0.82,
        })),
      ],
      requiredSkills: dedupeSkillCalls(skills),
      responseMode: 'answer',
    }
  }

  return planViaLLM(content, stocks, history, aiConfig)
}
