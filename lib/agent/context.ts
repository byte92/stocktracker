import { estimateTokens, getContextStats } from '@/lib/ai/chat'
import { buildAgentAnswerDraft } from '@/lib/agent/answer/builder'
import type { AgentAnswerDraft, AgentContextBuildResult, AgentPlan, AgentProviderMessage, AgentSkillResult } from '@/lib/agent/types'
import type { AiChatMessage, AiConfig } from '@/types'

type CompressionLevel = 'normal' | 'tight' | 'minimal'

const COMPRESSION_LIMITS: Record<CompressionLevel, {
  maxString: number
  maxLargeString: number
  maxArray: number
  maxObjectKeys: number
  maxDepth: number
}> = {
  normal: { maxString: 3200, maxLargeString: 5200, maxArray: 10, maxObjectKeys: 32, maxDepth: 5 },
  tight: { maxString: 900, maxLargeString: 1400, maxArray: 5, maxObjectKeys: 18, maxDepth: 4 },
  minimal: { maxString: 240, maxLargeString: 360, maxArray: 3, maxObjectKeys: 10, maxDepth: 3 },
}

function buildAgentSystemPrompt(language: AiConfig['analysisLanguage']) {
  return [
    '你是 StockTracker Agent，一名面向个人投资者的投资标的与持仓分析助手。',
    '你只能回答与用户当前持仓、用户明确提到的标的、交易记录、行情、估值、技术指标、风险、仓位和资产配置有关的问题。',
    '你必须优先基于 Agent 提供的 skillResults 回答，不得编造未提供的数据。',
    '如果 skillResults 中说明数据缺失，你需要明确指出缺失项，并给出下一步可观察的信号。',
    '你会收到 answerDraft，它是系统从 skillResults 中抽取出的回答骨架。必须优先使用 answerDraft 中的事实、计算、缺失数据和质量警告组织回复。',
    '如果用户要求本系统业务域内的可验证计算（成本、收益、分红/派息、手续费、仓位等），你可以基于 skillResults/answerDraft 中已有数字列出公式并计算；不得扩展到通识问答或脱离业务的数据。',
    '如果使用 web.browse 结果，必须把它作为浏览器实际打开的页面内容呈现，包含页面标题、最终链接、抓取时间和正文要点。',
    '如果使用 web.search 结果，必须把它们作为公开网页候选来源呈现，包含搜索时间、标题、链接、摘要/要点；不要把搜索结果说成实时数据库事实或已完全核验的事实。',
    '涉及收益、交易、成本、分红/派息、手续费等数字时，必须说明口径；不要把累计收益说成单笔收益，不要把当前行情或技术指标倒推成历史交易当日依据。',
    '回答交易复盘问题时，交易记录只代表已发生事实；请基于事实账本、成本收益、仓位风险、行情位置和行为纪律分析。用户提到道氏理论、趋势跟随、均值回归、基本面、股息现金流、资产配置或风险控制时，再按对应框架展开。',
    '你不能承诺收益，不能声称确定涨跌，不能提供内幕消息，不能把回答包装成绝对买卖指令。',
    '不要在每次回复中输出免责声明、风险提示模板或“仅供参考，不构成投资建议”之类的固定结尾；这些边界由界面中的固定提醒承担。',
    '回答要具体、直接、可执行，并区分事实、推断和行动条件。',
    `默认输出语言：${language === 'en-US' ? 'English' : '中文'}`,
  ].join('\n')
}

function compactHistory(messages: AiChatMessage[], maxHistoryTokens: number) {
  const compacted: AgentProviderMessage[] = []
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function compactString(value: string, limit: number) {
  if (value.length <= limit) return value
  return `${value.slice(0, limit)}\n[内容已截断，原始长度 ${value.length} 字符]`
}

function compactValue(value: unknown, level: CompressionLevel, depth = 0, key = ''): unknown {
  const limits = COMPRESSION_LIMITS[level]
  if (typeof value === 'string') {
    const lowerKey = key.toLowerCase()
    const limit = ['body', 'content', 'summary', 'raw', 'html', 'text'].some((item) => lowerKey.includes(item))
      ? limits.maxLargeString
      : limits.maxString
    return compactString(value, limit)
  }
  if (!value || typeof value !== 'object') return value
  if (depth >= limits.maxDepth) return '[对象层级已压缩]'

  if (Array.isArray(value)) {
    const items = value
      .slice(0, limits.maxArray)
      .map((item) => compactValue(item, level, depth + 1, key))
    const omitted = value.length - items.length
    return omitted > 0
      ? [...items, { _truncatedItems: omitted }]
      : items
  }

  if (!isRecord(value)) return value
  const entries = Object.entries(value)
  const compacted: Record<string, unknown> = {}
  for (const [entryKey, entryValue] of entries.slice(0, limits.maxObjectKeys)) {
    compacted[entryKey] = compactValue(entryValue, level, depth + 1, entryKey)
  }
  const omitted = entries.length - Object.keys(compacted).length
  if (omitted > 0) compacted._truncatedKeys = omitted
  return compacted
}

function compactSkillResult(result: AgentSkillResult, level: CompressionLevel) {
  return {
    skillName: result.skillName,
    ok: result.ok,
    data: result.data === undefined ? null : compactValue(result.data, level),
    error: result.error ? compactString(result.error, COMPRESSION_LIMITS[level].maxString) : null,
    tokenEstimate: result.tokenEstimate ?? null,
  }
}

function compactAnswerDraft(draft: AgentAnswerDraft) {
  return draft
}

function buildContextSnapshot(plan: AgentPlan, skillResults: AgentSkillResult[], answerDraft: AgentAnswerDraft, level: CompressionLevel) {
  return {
    generatedAt: new Date().toISOString(),
    compression: level,
    agent: {
      version: 2,
      intent: plan.intent,
      responseMode: plan.responseMode,
      entities: compactValue(plan.entities, level),
      requiredSkills: compactValue(plan.requiredSkills, level),
    },
    skillResults: skillResults.map((result) => compactSkillResult(result, level)),
    answerDraft: compactAnswerDraft(answerDraft),
  }
}

function buildContextPrompt(contextSnapshot: Record<string, unknown>) {
  return [
    '以下是 Agent 按需读取到的最小投资上下文。请只基于这些事实回答。',
    '如果某个 Skill 执行失败或返回空数据，请说明该数据不足，而不是猜测。',
    'answerDraft 是优先回答依据；skillResults 是原始证据。若两者冲突，以 skillResults 为准并说明不确定性。',
    'web.browse 的 capturedAt 是浏览器访问时间；content 是浏览器抽取到的页面正文。回答给定链接问题时请优先引用页面标题、最终链接和正文要点。',
    'web.search 的 searchedAt 是检索执行时间；results 是公开网页候选来源。回答新闻/公告/政策类问题时请引用标题、链接和摘要/要点。',
    JSON.stringify(contextSnapshot),
  ].join('\n\n')
}

function buildMessages({
  system,
  context,
  history,
  userMessage,
  maxContextTokens,
}: {
  system: string
  context: string
  history: AiChatMessage[]
  userMessage: string
  maxContextTokens: number
}) {
  const reserved = estimateTokens(system) + estimateTokens(context) + estimateTokens(userMessage) + 1024
  const historyBudget = Math.max(0, maxContextTokens - reserved)
  const messages: AgentProviderMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: context },
    ...compactHistory(history, historyBudget),
    { role: 'user', content: userMessage },
  ]
  const tokenEstimate = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0)
  return { messages, tokenEstimate }
}

export function composeAgentContext({
  aiConfig,
  history,
  userMessage,
  plan,
  skillResults,
}: {
  aiConfig: AiConfig
  history: AiChatMessage[]
  userMessage: string
  plan: AgentPlan
  skillResults: AgentSkillResult[]
}): AgentContextBuildResult {
  const answerDraft = buildAgentAnswerDraft(plan, skillResults)
  const system = buildAgentSystemPrompt(aiConfig.analysisLanguage)
  const maxContextTokens = Math.max(4096, aiConfig.maxContextTokens || 128000)
  let level: CompressionLevel = 'normal'
  let contextSnapshot = buildContextSnapshot(plan, skillResults, answerDraft, level)
  let context = buildContextPrompt(contextSnapshot)
  let built = buildMessages({ system, context, history, userMessage, maxContextTokens })

  if (built.tokenEstimate > maxContextTokens) {
    level = 'tight'
    contextSnapshot = buildContextSnapshot(plan, skillResults, answerDraft, level)
    context = buildContextPrompt(contextSnapshot)
    built = buildMessages({ system, context, history, userMessage, maxContextTokens })
  }

  if (built.tokenEstimate > maxContextTokens) {
    level = 'minimal'
    contextSnapshot = buildContextSnapshot(plan, skillResults, answerDraft, level)
    context = buildContextPrompt(contextSnapshot)
    built = buildMessages({ system, context, history, userMessage, maxContextTokens })
  }

  return {
    messages: built.messages,
    contextSnapshot,
    answerDraft,
    stats: getContextStats(built.tokenEstimate, maxContextTokens),
  }
}
