import { executeAgentPlan } from '@/lib/agent/executor'
import type { MarketAnalysisSkillContext } from '@/lib/agent/skills/market'
import type { PortfolioAnalysisContext, StockAnalysisContext } from '@/lib/agent/skills/analysis'
import type { AgentPlan, AgentSkillResult } from '@/lib/agent/types'
import { getContextStats } from '@/lib/ai/chat'
import type { AiChatContextStats, AiConfig, AppConfig, Stock } from '@/types'

export type AnalysisAgentTaskResult<TContext> = {
  context: TContext
  plan: AgentPlan
  skillResults: AgentSkillResult[]
  contextStats: AiChatContextStats
}

export type AnalysisTaskOptions = {
  baseCurrency?: 'CNY' | 'HKD' | 'USD' | 'USDT'
  totalCapital?: AppConfig['portfolio']['totalCapital']
}

function estimateContextStats(context: unknown, aiConfig: AiConfig) {
  const sizeEstimate = Math.ceil(JSON.stringify(context).length * 0.8)
  return getContextStats(sizeEstimate, aiConfig.maxContextTokens)
}

function getRequiredContext<TContext>(result: AgentSkillResult | undefined, label: string): TContext {
  if (!result?.ok || !result.data) {
    throw new Error(`${label} Agent Skill 执行失败：${result?.error ?? '缺少上下文数据'}`)
  }
  return result.data as TContext
}

export async function runPortfolioAnalysisAgentTask(
  stocks: Stock[],
  aiConfig: AiConfig,
  options: AnalysisTaskOptions = {},
): Promise<AnalysisAgentTaskResult<PortfolioAnalysisContext>> {
  const plan: AgentPlan = {
    intent: 'portfolio_risk',
    entities: [{ type: 'portfolio', raw: '当前组合', confidence: 1 }],
    requiredSkills: [
      {
        name: 'portfolio.getAnalysisContext',
        args: { baseCurrency: options.baseCurrency ?? 'CNY', totalCapital: options.totalCapital ?? null },
        reason: '固定组合分析模板需要组合摘要、行情、仓位权重、盈亏结构和近期交易活动。',
      },
    ],
    responseMode: 'answer',
  }
  const skillResults = await executeAgentPlan(plan, {
    userId: 'analysis',
    sessionId: 'portfolio-analysis',
    stocks,
    aiConfig,
    maxContextTokens: Math.max(4096, aiConfig.maxContextTokens || 128000),
  })
  const context = getRequiredContext<PortfolioAnalysisContext>(skillResults[0], '组合分析')
  return {
    context,
    plan,
    skillResults,
    contextStats: estimateContextStats(context, aiConfig),
  }
}

export async function runMarketAnalysisAgentTask(
  aiConfig: AiConfig,
): Promise<AnalysisAgentTaskResult<MarketAnalysisSkillContext>> {
  const plan: AgentPlan = {
    intent: 'market_question',
    entities: [
      { type: 'market', raw: 'A股', market: 'A', confidence: 1 },
      { type: 'market', raw: '港股', market: 'HK', confidence: 1 },
      { type: 'market', raw: '美股', market: 'US', confidence: 1 },
    ],
    requiredSkills: [
      {
        name: 'market.getAnalysisContext',
        args: {},
        reason: '固定大盘分析模板需要三地代表指数、技术指标、强弱排序和新闻上下文。',
      },
    ],
    responseMode: 'answer',
  }
  const skillResults = await executeAgentPlan(plan, {
    userId: 'analysis',
    sessionId: 'market-analysis',
    stocks: [],
    aiConfig,
    maxContextTokens: Math.max(4096, aiConfig.maxContextTokens || 128000),
  })
  const context = getRequiredContext<MarketAnalysisSkillContext>(skillResults[0], '大盘分析')
  return {
    context,
    plan,
    skillResults,
    contextStats: estimateContextStats(context.context, aiConfig),
  }
}

export async function runStockAnalysisAgentTask(
  stock: Stock,
  aiConfig: AiConfig,
): Promise<AnalysisAgentTaskResult<StockAnalysisContext>> {
  const plan: AgentPlan = {
    intent: 'stock_analysis',
    entities: [{ type: 'stock', raw: stock.name, stockId: stock.id, code: stock.code, name: stock.name, market: stock.market, confidence: 1 }],
    requiredSkills: [
      {
        name: 'stock.getAnalysisContext',
        args: { stockId: stock.id },
        reason: '固定标的分析模板需要持仓、成本、行情、技术指标和新闻上下文。',
      },
    ],
    responseMode: 'answer',
  }
  const skillResults = await executeAgentPlan(plan, {
    userId: 'analysis',
    sessionId: `stock-analysis:${stock.id}`,
    stocks: [stock],
    aiConfig,
    maxContextTokens: Math.max(4096, aiConfig.maxContextTokens || 128000),
  })
  const context = getRequiredContext<StockAnalysisContext>(skillResults[0], '标的分析')
  return {
    context,
    plan,
    skillResults,
    contextStats: estimateContextStats(context, aiConfig),
  }
}
