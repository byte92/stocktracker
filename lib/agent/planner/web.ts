import type { AgentPlan, AgentSkillCall } from '@/lib/agent/types'
import type { Stock } from '@/types'
import { dedupeSkillCalls, extractUrls, stringArrayArg, stripUrls, textArg } from '@/lib/agent/planner/text'

export type StockSearchTarget = Pick<Stock, 'code' | 'name' | 'market'>

export function buildDefaultSearchQuery(target: StockSearchTarget, content: string) {
  return [target.name, target.code, content].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

export function appendUrlBrowseCall(calls: AgentSkillCall[], userMessage: string) {
  const urls = extractUrls(userMessage)
  if (!urls.length || calls.some((call) => call.name === 'web.browse')) return
  calls.push({
    name: 'web.browse',
    args: { url: urls[0], extractPrompt: stripUrls(userMessage) || userMessage },
    reason: '用户消息包含 URL，需要用浏览器打开页面并提取正文',
  })
}

function normalizeWebSearchCall(call: AgentSkillCall, userMessage: string, target?: StockSearchTarget): AgentSkillCall {
  const query = textArg(call.args, ['query'])
  const targetPrefix = target ? [target.name, target.code].filter(Boolean).join(' ') : ''
  const baseQuery = stripUrls(query || userMessage) || userMessage
  const shouldPrefix = targetPrefix && ![target?.name, target?.code].some((value) => value && baseQuery.includes(value))
  const normalizedQuery = [shouldPrefix ? targetPrefix : '', baseQuery].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  const queries = stringArrayArg(call.args, 'queries')
  const sourceHints = stringArrayArg(call.args, 'sourceHints')
  return {
    name: 'web.search',
    args: {
      ...call.args,
      query: normalizedQuery,
      ...(queries.length ? { queries } : {}),
      ...(sourceHints.length ? { sourceHints } : {}),
      limit: call.args.limit ?? 5,
      searchLimit: call.args.searchLimit ?? 10,
    },
    reason: call.reason || '模型判断需要公开网页补充上下文',
  }
}

function normalizeWebFetchCall(call: AgentSkillCall, userMessage: string): AgentSkillCall | null {
  const urls = extractUrls(userMessage)
  const url = textArg(call.args, ['url']) || urls[0] || ''
  if (!url) return null
  return {
    name: 'web.fetch',
    args: {
      ...call.args,
      url,
      method: call.args.method ?? 'GET',
      extractPrompt: textArg(call.args, ['extractPrompt']) || userMessage,
    },
    reason: call.reason || '模型判断需要抓取用户给出的外部页面',
  }
}

function normalizeWebBrowseCall(call: AgentSkillCall, userMessage: string): AgentSkillCall | null {
  const urls = extractUrls(userMessage)
  const url = textArg(call.args, ['url']) || urls[0] || ''
  if (!url) return null
  return {
    name: 'web.browse',
    args: {
      ...call.args,
      url,
      extractPrompt: textArg(call.args, ['extractPrompt']) || stripUrls(userMessage) || userMessage,
    },
    reason: call.reason || '模型判断需要用浏览器打开用户给出的外部页面',
  }
}

export function normalizeWebSkillCalls(plan: AgentPlan, userMessage: string, target?: StockSearchTarget) {
  const calls: AgentSkillCall[] = []
  for (const call of plan.requiredSkills) {
    if (call.name === 'web.search') {
      calls.push(normalizeWebSearchCall(call, userMessage, target))
      continue
    }
    if (call.name === 'web.browse') {
      const normalized = normalizeWebBrowseCall(call, userMessage)
      if (normalized) calls.push(normalized)
      continue
    }
    if (call.name === 'web.fetch') {
      const normalized = normalizeWebFetchCall(call, userMessage)
      if (normalized) calls.push(normalized)
    }
  }

  appendUrlBrowseCall(calls, userMessage)
  return dedupeSkillCalls(calls)
}
