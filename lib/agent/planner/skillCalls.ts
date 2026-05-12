import type { AgentSkillCall } from '@/lib/agent/types'
import type { SecurityCandidate } from '@/lib/agent/entity/securityResolver'
import type { Stock } from '@/types'
import { dedupeSkillCalls } from '@/lib/agent/planner/text'
import { appendUrlBrowseCall } from '@/lib/agent/planner/web'

type ExternalStockTarget = Pick<SecurityCandidate, 'code' | 'name' | 'market'>

export function buildStockSkillCalls(stock: Stock, userMessage: string): AgentSkillCall[] {
  const skills: AgentSkillCall[] = buildDefaultStockSkillCalls(stock)
  appendUrlBrowseCall(skills, userMessage)
  return dedupeSkillCalls(skills)
}

export function buildDefaultStockSkillCalls(stock: Stock): AgentSkillCall[] {
  return [
    { name: 'stock.getHolding', args: { stockId: stock.id }, reason: '用户询问单个标的，需要读取本地持仓摘要' },
    { name: 'stock.getRecentTrades', args: { stockId: stock.id, limit: 8 }, reason: '单个标的分析需要结合最近交易节奏' },
    { name: 'stock.getQuote', args: { stockId: stock.id }, reason: '单个标的分析需要读取最新行情和估值数据' },
    { name: 'stock.getTechnicalSnapshot', args: { stockId: stock.id }, reason: '走势健康度需要技术指标摘要' },
  ]
}

export function buildExternalStockSkillCalls(target: ExternalStockTarget, userMessage: string): AgentSkillCall[] {
  const skills: AgentSkillCall[] = buildDefaultExternalStockSkillCalls(target)
  appendUrlBrowseCall(skills, userMessage)
  return dedupeSkillCalls(skills)
}

export function buildDefaultExternalStockSkillCalls(target: ExternalStockTarget): AgentSkillCall[] {
  return [
    { name: 'stock.getExternalQuote', args: { symbol: target.code, market: target.market }, reason: '用户询问未持仓标的，需要抓取外部行情和估值数据' },
    { name: 'stock.getTechnicalSnapshot', args: { symbol: target.code, market: target.market }, reason: '用户询问未持仓标的走势，需要抓取外部 K 线并计算技术指标' },
  ]
}
