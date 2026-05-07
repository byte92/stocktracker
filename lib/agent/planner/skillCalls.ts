import type { AgentSkillCall } from '@/lib/agent/types'
import type { SecurityCandidate } from '@/lib/agent/entity/securityResolver'
import type { Stock } from '@/types'
import { dedupeSkillCalls, includesAny } from '@/lib/agent/planner/text'
import {
  appendUrlBrowseFallback,
  buildFallbackSearchQuery,
  hasWebSkill,
  type StockSearchTarget,
} from '@/lib/agent/planner/web'

const PUBLIC_DISCLOSURE_KEYWORDS = ['公告', '新闻', '政策', '财报', '年报', '季报', '业绩', '利好', '利空', '回购', '减持', '增持', '监管', '诉讼', '处罚', '重组', '并购']
const CORPORATE_ACTION_KEYWORDS = ['分红', '派息', '股息', '除权', '除息', '股权登记', '利润分配']
const EXTERNAL_TIMING_KEYWORDS = ['最新', '最近', '下一次', '下次', '什么时候', '哪天', '时间', '要', '即将', '预案', '实施']
const DIVIDEND_ESTIMATE_PATTERNS = [
  /(预计|预估|估算|估计|大概).*(分红|派息|股息|现金收益|能分|能拿|到账)/,
  /(分红|派息|股息|现金收益).*(我|持仓|手里|这次|下次|下一次|预计|预估|估算|估计|大概|能分|能拿|到账)/,
  /(我)?能分多少|分多少|能拿多少|到账多少|派多少钱/,
]

type ExternalStockTarget = Pick<SecurityCandidate, 'code' | 'name' | 'market'>

export function buildStockSkillCalls(stock: Stock, userMessage: string): AgentSkillCall[] {
  const skills: AgentSkillCall[] = buildDefaultStockSkillCalls(stock)
  appendUrlBrowseFallback(skills, userMessage)
  appendExternalResearchFallback(skills, userMessage, stock)
  appendDomainCalculationFallback(skills, userMessage, stock)
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
  appendUrlBrowseFallback(skills, userMessage)
  appendExternalResearchFallback(skills, userMessage, target)
  return dedupeSkillCalls(skills)
}

export function buildDefaultExternalStockSkillCalls(target: ExternalStockTarget): AgentSkillCall[] {
  return [
    { name: 'stock.getExternalQuote', args: { symbol: target.code, market: target.market }, reason: '用户询问未持仓标的，需要抓取外部行情和估值数据' },
    { name: 'stock.getTechnicalSnapshot', args: { symbol: target.code, market: target.market }, reason: '用户询问未持仓标的走势，需要抓取外部 K 线并计算技术指标' },
  ]
}

function needsExternalResearch(content: string) {
  const asksPublicDisclosure = includesAny(content, PUBLIC_DISCLOSURE_KEYWORDS)
  const asksCorporateActionTiming = includesAny(content, CORPORATE_ACTION_KEYWORDS)
    && includesAny(content, EXTERNAL_TIMING_KEYWORDS)
  return asksPublicDisclosure || asksCorporateActionTiming
}

function needsDividendEstimate(content: string) {
  return DIVIDEND_ESTIMATE_PATTERNS.some((pattern) => pattern.test(content))
}

function hasFinanceCalculationSkill(calls: AgentSkillCall[]) {
  return calls.some((call) => call.name === 'finance.calculate')
}

export function appendDomainCalculationFallback(calls: AgentSkillCall[], userMessage: string, stock: Stock) {
  if (!needsDividendEstimate(userMessage) || hasFinanceCalculationSkill(calls)) return
  calls.push({
    name: 'finance.calculate',
    args: { type: 'dividend.estimate', stockId: stock.id },
    reason: '用户询问持仓相关的分红现金估算，需要执行受控业务域计算',
  })
}

export function appendExternalResearchFallback(calls: AgentSkillCall[], userMessage: string, target?: StockSearchTarget) {
  if (!needsExternalResearch(userMessage) || hasWebSkill(calls)) return
  calls.push({
    name: 'web.search',
    args: {
      query: target ? buildFallbackSearchQuery(target, userMessage) : userMessage,
      limit: 5,
      searchLimit: 10,
    },
    reason: '用户询问系统本地持仓/行情之外的公开财务或披露信息，需要用公开搜索补充上下文',
  })
}
