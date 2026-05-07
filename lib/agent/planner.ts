import { detectStockCode, formatStockCandidate, matchStocks } from '@/lib/agent/entity/stockMatcher'
import { resolveSecurityCandidates, type SecurityCandidate } from '@/lib/agent/entity/securityResolver'
import { MARKET_LABELS, SUPPORTED_MARKETS } from '@/config/defaults'
import type { AgentPlan, AgentResolvedSecurity, AgentSkillCall } from '@/lib/agent/types'
import type { AiChatMessage, AiConfig, Market, Stock } from '@/types'
import { callJsonCompletion } from '@/lib/external/llmProvider'
import { buildPlannerSystemPrompt } from '@/lib/agent/planner/prompt'
import { isPlannerNormalizedSkillName } from '@/lib/agent/planner/skillCatalog'
import {
  appendDomainCalculationFallback,
  appendExternalResearchFallback,
  buildDefaultExternalStockSkillCalls,
  buildDefaultStockSkillCalls,
  buildExternalStockSkillCalls,
  buildStockSkillCalls,
} from '@/lib/agent/planner/skillCalls'
import { dedupeSkillCalls, includesAny, textArg } from '@/lib/agent/planner/text'
import { buildFallbackSearchQuery, normalizeWebSkillCalls } from '@/lib/agent/planner/web'

const PORTFOLIO_KEYWORDS = ['组合', '仓位', '持仓', '风险', '亏损', '盈利', '收益', '回撤', '集中', '配置', '哪只', '哪些']
const TRADE_KEYWORDS = ['交易', '复盘', '买入', '卖出', '分红', '派息', '成本', '加仓', '减仓']
const OUT_OF_SCOPE_KEYWORDS = ['天气', '菜谱', '写代码', '编程', '电影', '小说', '医疗', '法律', '旅游', '翻译']

const EXPLICIT_PORTFOLIO_KEYWORDS = ['组合', '全部', '整体', '所有', '每只', '哪些', '哪只', '仓位', '配置']
const FOLLOW_UP_STOCK_KEYWORDS = ['收益', '盈利', '亏损', '成本', '均价', '平均', '持仓', '分红', '派息', '手续费', '操作', '建议', '怎么看', '怎么样', '多少']
const LLM_PLANNER_TIMEOUT_MS = 8_000

type ExternalStockTarget = Pick<SecurityCandidate, 'code' | 'name' | 'market'>

function inferMarketFromCode(code: string): Market | null {
  if (/^\d{6}$/.test(code)) return 'A'
  if (/^\d{5}$/.test(code)) return 'HK'
  if (/^[A-Z]{1,6}$/.test(code)) return 'US'
  return null
}

function inferMarketFromUserIntent(content: string, code: string): Market | null {
  if (/(美股|美国|纳斯达克|纽交所|nyse|nasdaq)/i.test(content)) return 'US'
  if (/(港股|香港|港交所|hk\b)/i.test(content)) return 'HK'
  if (/(A股|A 股|沪深|上证|深交所|上交所)/i.test(content)) return 'A'
  if (/(加密|数字货币|虚拟货币|crypto|币|usdt|usdc|[-_/](usd|usdt|usdc)\b)/i.test(content)) return 'CRYPTO'
  if (/(基金|场内基金|ETF)/i.test(content) && /^\d{6}$/.test(code)) return 'FUND'
  return inferMarketFromCode(code)
}

function marketOptionsText() {
  return SUPPORTED_MARKETS.map((market) => `${MARKET_LABELS[market]}（${market}）`).join('、')
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
    if (!financialArgs.researchQuery) financialArgs.researchQuery = buildFallbackSearchQuery(stock, userMessage)
    skills.push({ name: 'stock.getFinancials', args: financialArgs, reason: '模型判断需要财报或业绩数据' })
  }
  skills.push(...normalizeFinanceCalculationCalls(plan, stock, userMessage))
  skills.push(...normalizeWebSkillCalls(plan, userMessage, stock))
  appendExternalResearchFallback(skills, userMessage, stock)
  appendDomainCalculationFallback(skills, userMessage, stock)
  return dedupeSkillCalls(skills)
}

function buildModelExternalStockSkillCalls(target: ExternalStockTarget, plan: AgentPlan, userMessage: string) {
  const skills = buildDefaultExternalStockSkillCalls(target)
  if (planRequestsSkill(plan, 'stock.getFinancials')) {
    const financialArgs: Record<string, unknown> = { ...plannedSkillArgs(plan, 'stock.getFinancials'), symbol: target.code, market: target.market }
    if (!financialArgs.researchQuery) financialArgs.researchQuery = buildFallbackSearchQuery(target, userMessage)
    skills.push({ name: 'stock.getFinancials', args: financialArgs, reason: '模型判断需要财报或业绩数据' })
  }
  skills.push(...normalizeWebSkillCalls(plan, userMessage, target))
  appendExternalResearchFallback(skills, userMessage, target)
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

  const normalizedWebCalls = normalizeWebSkillCalls(plan, userMessage)
  const baseCalls = plan.requiredSkills.filter((call) => !call.name.startsWith('web.'))
  const normalizedPlan = {
    ...plan,
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

  const local = candidates.find((candidate) => candidate.inPortfolio && candidate.stockId)
  const stock = local ? stocks.find((item) => item.id === local.stockId) : null
  if (local && stock) {
    return {
      intent: includesAny(userMessage, TRADE_KEYWORDS) ? 'trade_review' : 'stock_analysis',
      entities: [{ type: 'stock', raw: query, stockId: stock.id, code: stock.code, name: stock.name, market: stock.market, confidence: local.confidence }],
      requiredSkills: dedupeSkillCalls([
        ...buildModelStockSkillCalls(stock, normalizedPlan, userMessage),
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

  const raw = await callJsonCompletion(aiConfig, buildPlannerSystemPrompt(), userPrompt, AbortSignal.timeout(LLM_PLANNER_TIMEOUT_MS))
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

async function tryPlanViaLLM(userMessage: string, stocks: Stock[], history: AiChatMessage[] | undefined, aiConfig: AiConfig) {
  if (!aiConfig.enabled || !aiConfig.baseUrl || !aiConfig.model) return null
  try {
    return await planViaLLM(userMessage, stocks, history, aiConfig)
  } catch {
    return null
  }
}

function findRecentStockFocus(history: AiChatMessage[] | undefined, stocks: Stock[]) {
  for (const message of [...(history ?? [])].reverse()) {
    const agent = message.contextSnapshot?.agent as { entities?: unknown } | undefined
    const entities = agent?.entities
    if (!Array.isArray(entities)) continue

    for (const entity of entities) {
      if (!entity || typeof entity !== 'object') continue
      const stockId = 'stockId' in entity && typeof entity.stockId === 'string' ? entity.stockId : ''
      const code = 'code' in entity && typeof entity.code === 'string' ? entity.code : ''
      const name = 'name' in entity && typeof entity.name === 'string' ? entity.name : ''
      const stock = stocks.find((item) => item.id === stockId)
        ?? (code ? stocks.find((item) => item.code.toUpperCase() === code.toUpperCase()) : undefined)
        ?? (name ? stocks.find((item) => item.name === name) : undefined)
      if (stock) return stock
    }
  }
  return null
}

function shouldUseRecentStockFocus(content: string) {
  if (!includesAny(content, FOLLOW_UP_STOCK_KEYWORDS)) return false
  return !includesAny(content, EXPLICIT_PORTFOLIO_KEYWORDS)
}

function extractMentionedCodes(content: string) {
  const matches = content.match(/\b[A-Z]{1,6}\b|\b\d{5,6}\b/g) ?? []
  const ignoredTokens = new Set(['A', 'SH', 'SZ', 'BJ', 'SS', 'HK', 'US', 'ETF', 'PE', 'PB', 'TTM', 'EPS', 'RSI', 'MACD', 'BOLL', 'ATR'])
  return Array.from(new Set(
    matches
      .map((item) => item.toUpperCase())
      .filter((item) => !ignoredTokens.has(item)),
  ))
}

async function findRecentExternalTargets(history: AiChatMessage[] | undefined, stocks: Stock[]) {
  const existingCodes = new Set(stocks.map((stock) => stock.code.toUpperCase()))
  const targets: SecurityCandidate[] = []

  const pushTarget = (candidate: SecurityCandidate) => {
    if (existingCodes.has(candidate.code.toUpperCase())) return
    if (targets.some((item) => item.code === candidate.code && item.market === candidate.market)) return
    targets.push(candidate)
  }

  for (const message of [...(history ?? [])].reverse()) {
    const agent = message.contextSnapshot?.agent as { entities?: unknown } | undefined
    const entities = agent?.entities
    if (Array.isArray(entities)) {
      for (const entity of entities) {
        if (!entity || typeof entity !== 'object') continue
        const code = 'code' in entity && typeof entity.code === 'string' ? entity.code : ''
        const market = 'market' in entity && typeof entity.market === 'string' ? entity.market as Market : null
        const name = 'name' in entity && typeof entity.name === 'string' ? entity.name : code
        if (code && market) pushTarget({ code, name, market, confidence: 0.76, inPortfolio: false, source: 'inference' })
      }
    }

    for (const code of extractMentionedCodes(message.content)) {
      for (const candidate of await resolveSecurityCandidates(code, stocks, 1)) {
        pushTarget(candidate)
      }
    }

    if (targets.length >= 3) break
  }

  return targets.slice(0, 3)
}

function shouldUseRecentExternalTargets(content: string) {
  return /(这|那|上述|上面|前面|它们|他们|两只|几个|这些|都|一起|对比|比较|分析)/.test(content)
    && !detectStockCode(content)
    && !includesAny(content, EXPLICIT_PORTFOLIO_KEYWORDS)
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
  const code = detectStockCode(content)

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

    const llmPlan = await tryPlanViaLLM(content, stocks, history, aiConfig)
    if (llmPlan?.responseMode === 'answer') {
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

  const llmPlan = await tryPlanViaLLM(content, stocks, history, aiConfig)
  if (llmPlan) return llmPlan

  if (includesAny(content, OUT_OF_SCOPE_KEYWORDS) && !includesAny(content, PORTFOLIO_KEYWORDS) && !code) {
    return {
      intent: 'out_of_scope',
      entities: [],
      requiredSkills: [],
      responseMode: 'refuse',
    }
  }

  const matches = matchStocks(content, stocks, 3)
  if (matches.length === 1 && matches[0].confidence >= 0.72) {
    const stock = matches[0].stock
    return {
      intent: includesAny(content, TRADE_KEYWORDS) ? 'trade_review' : 'stock_analysis',
      entities: [{ type: 'stock', raw: content, stockId: stock.id, code: stock.code, name: stock.name, market: stock.market, confidence: matches[0].confidence }],
      requiredSkills: buildStockSkillCalls(stock, content),
      responseMode: 'answer',
    }
  }

  if (matches.length > 1 && matches[0].confidence - matches[1].confidence < 0.2) {
    return {
      intent: 'stock_analysis',
      entities: matches.map((match) => ({
        type: 'stock',
        raw: content,
        stockId: match.stock.id,
        code: match.stock.code,
        name: match.stock.name,
        market: match.stock.market,
        confidence: match.confidence,
      })),
      requiredSkills: [
        { name: 'security.resolve', args: { query: content }, reason: '存在多只可能标的，需要明确候选列表供澄清' },
      ],
      responseMode: 'clarify',
      clarifyQuestion: `你想分析的是 ${matches.map((match) => formatStockCandidate(match.stock)).join('，')} 中的哪一只？`,
    }
  }

  if (code && !matches.length) {
    const inferredMarket = inferMarketFromUserIntent(content, code)
    if (inferredMarket) {
      const target = { code, name: code, market: inferredMarket }
      return {
        intent: 'stock_analysis',
        entities: [{ type: 'stock', raw: code, code, market: inferredMarket, confidence: 0.72 }],
        requiredSkills: buildExternalStockSkillCalls(target, content),
        responseMode: 'answer',
      }
    }
    return {
      intent: 'stock_analysis',
      entities: [{ type: 'stock', raw: code, code, confidence: 0.55 }],
      requiredSkills: [
        { name: 'security.resolve', args: { query: code }, reason: '代码未在持仓中找到，需推断候选市场' },
      ],
      responseMode: 'clarify',
      clarifyQuestion: `我识别到了 ${code}，但还不能确认它属于哪个市场。你想分析的是 ${marketOptionsText()} 中的哪一个？`,
    }
  }

  if (shouldUseRecentExternalTargets(content)) {
    const recentExternalTargets = await findRecentExternalTargets(history, stocks)
    if (recentExternalTargets.length) {
      return {
        intent: 'stock_analysis',
        entities: recentExternalTargets.map((candidate) => ({ type: 'stock', raw: candidate.name, code: candidate.code, name: candidate.name, market: candidate.market, confidence: candidate.confidence })),
        requiredSkills: recentExternalTargets.flatMap((candidate) => buildExternalStockSkillCalls(candidate, content)),
        responseMode: 'answer',
      }
    }
  }

  const recentStockFocus = findRecentStockFocus(history, stocks)
  if (recentStockFocus && shouldUseRecentStockFocus(content)) {
    return {
      intent: includesAny(content, TRADE_KEYWORDS) ? 'trade_review' : 'stock_analysis',
      entities: [{
        type: 'stock',
        raw: content,
        stockId: recentStockFocus.id,
        code: recentStockFocus.code,
        name: recentStockFocus.name,
        market: recentStockFocus.market,
        confidence: 0.78,
      }],
      requiredSkills: buildStockSkillCalls(recentStockFocus, content),
      responseMode: 'answer',
    }
  }

  if (includesAny(content, PORTFOLIO_KEYWORDS)) {
    return {
      intent: includesAny(content, ['风险', '回撤', '集中']) ? 'portfolio_risk' : 'portfolio_summary',
      entities: [{ type: 'portfolio', raw: '当前组合', confidence: 0.86 }],
      requiredSkills: [
        { name: 'portfolio.getSummary', args: {}, reason: '组合类问题需要读取组合摘要' },
        { name: 'portfolio.getTopPositions', args: { limit: 8 }, reason: '组合分析需要关注最大仓位、最大盈亏和近期活跃持仓' },
      ],
      responseMode: 'answer',
    }
  }

  const resolvedExternalTargets = (await resolveSecurityCandidates(content, stocks, 3))
    .filter((candidate) => !candidate.inPortfolio)
  if (resolvedExternalTargets.length) {
    return {
      intent: 'stock_analysis',
      entities: resolvedExternalTargets.map((candidate) => ({ type: 'stock', raw: candidate.name, code: candidate.code, name: candidate.name, market: candidate.market, confidence: candidate.confidence })),
      requiredSkills: resolvedExternalTargets.flatMap((candidate) => buildExternalStockSkillCalls(candidate, content)),
      responseMode: 'answer',
    }
  }

  return {
    intent: 'unknown',
    entities: [{ type: 'portfolio', raw: '当前组合', confidence: 0.45 }],
    requiredSkills: [
      { name: 'portfolio.getSummary', args: {}, reason: '模型规划不可用，使用兜底组合摘要' },
      { name: 'portfolio.getTopPositions', args: { limit: 5 }, reason: '模型规划不可用，使用兜底持仓' },
    ],
    responseMode: 'answer',
  }
}
