import { calcStockSummary } from '@/lib/finance'
import type { AgentSkill } from '@/lib/agent/types'
import type { Stock } from '@/types'

function summarizeStock(stock: Stock) {
  const summary = calcStockSummary(stock)
  return {
    id: stock.id,
    code: stock.code,
    name: stock.name,
    market: stock.market,
    note: stock.note ?? '',
    currentHolding: summary.currentHolding,
    avgCostPrice: summary.avgCostPrice,
    realizedPnl: summary.realizedPnl,
    unrealizedPnl: summary.unrealizedPnl,
    totalPnl: summary.totalPnl,
    totalPnlPercent: summary.totalPnlPercent,
    totalCommission: summary.totalCommission,
    totalDividend: summary.totalDividend,
    tradeCount: summary.tradeCount,
    lastTradeDate: stock.trades.at(-1)?.date ?? null,
    lastTradeType: stock.trades.at(-1)?.type ?? null,
  }
}

export const portfolioGetSummarySkill: AgentSkill = {
  name: 'portfolio.getSummary',
  description: '读取当前组合的轻量摘要，包括持仓数量、活跃持仓列表、盈亏结构和交易概览。',
  inputSchema: {},
  requiredScopes: ['portfolio.read'],
  async execute(_args, ctx) {
    const summaries = ctx.stocks.map(summarizeStock)
    const active = summaries.filter((item) => item.currentHolding > 0)
    const totalRealizedPnl = summaries.reduce((sum, item) => sum + item.realizedPnl, 0)
    const totalUnrealizedPnl = summaries.reduce((sum, item) => sum + item.unrealizedPnl, 0)
    const totalPnl = summaries.reduce((sum, item) => sum + item.totalPnl, 0)
    const profitableCount = summaries.filter((item) => item.totalPnl > 0).length
    const losingCount = summaries.filter((item) => item.totalPnl < 0).length

    return {
      skillName: 'portfolio.getSummary',
      ok: true,
      data: {
        stockCount: ctx.stocks.length,
        activeHoldingCount: active.length,
        totalRealizedPnl,
        totalUnrealizedPnl,
        totalPnl,
        profitableCount,
        losingCount,
        totalTradeCount: summaries.reduce((sum, item) => sum + item.tradeCount, 0),
        holdings: active.map((item) => ({
          id: item.id,
          code: item.code,
          name: item.name,
          market: item.market,
          note: item.note,
          currentHolding: item.currentHolding,
          avgCostPrice: item.avgCostPrice,
          estimatedCostValue: Number((item.currentHolding * item.avgCostPrice).toFixed(2)),
          totalPnl: item.totalPnl,
          totalPnlPercent: item.totalPnlPercent,
          lastTradeDate: item.lastTradeDate,
          lastTradeType: item.lastTradeType,
        })),
      },
    }
  },
}

export const portfolioGetTopPositionsSkill: AgentSkill<{ limit?: number }> = {
  name: 'portfolio.getTopPositions',
  description: '读取组合中最值得关注的持仓，包括最大仓位、最大盈利、最大亏损和近期活跃标的。',
  inputSchema: { limit: 'number' },
  requiredScopes: ['portfolio.read'],
  async execute(args, ctx) {
    const limit = Math.max(1, Math.min(Number(args.limit ?? 8), 20))
    const summaries = ctx.stocks.map(summarizeStock)
    const active = summaries.filter((item) => item.currentHolding > 0)
    const byPosition = [...active].sort((a, b) => Math.abs(b.currentHolding * b.avgCostPrice) - Math.abs(a.currentHolding * a.avgCostPrice)).slice(0, limit)
    const byProfit = [...summaries].sort((a, b) => b.totalPnl - a.totalPnl).slice(0, limit)
    const byLoss = [...summaries].sort((a, b) => a.totalPnl - b.totalPnl).slice(0, limit)
    const recentlyActive = [...summaries]
      .filter((item) => item.lastTradeDate)
      .sort((a, b) => String(b.lastTradeDate).localeCompare(String(a.lastTradeDate)))
      .slice(0, limit)

    return {
      skillName: 'portfolio.getTopPositions',
      ok: true,
      data: {
        byPosition,
        byProfit,
        byLoss,
        recentlyActive,
      },
    }
  },
}
