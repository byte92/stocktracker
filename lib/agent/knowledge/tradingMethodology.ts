export const TRADE_REVIEW_METHOD_DIMENSIONS = [
  '事实账本：成交日期、买卖方向、价格、数量、费用、分红和备注。',
  '成本收益：FIFO 单笔已实现盈亏、券商摊薄口径持仓成本、累计收益和当前行情盈亏。',
  '仓位风险：交易后仓位变化、是否降低集中度、是否扩大回撤暴露。',
  '行情位置：当前价格相对支撑、阻力、均线、估值和近期波动的位置。',
  '行为纪律：是否追涨杀跌、是否频繁补仓、是否把累计结果误读成单笔决策质量。',
] as const

export const TRADING_METHODOLOGY_FRAMEWORKS = [
  {
    name: '道氏理论',
    usage: '用于分析趋势结构、阶段高低点、量价确认和趋势反转信号；更偏技术分析框架，不是单一指标。',
  },
  {
    name: '趋势跟随',
    usage: '用于判断是否顺着已形成的趋势交易，以及趋势破坏后是否需要退出或降仓。',
  },
  {
    name: '均值回归',
    usage: '用于分析超跌、低估或偏离均值后的修复交易，重点检查是否有回归依据和失效条件。',
  },
  {
    name: '基本面投资',
    usage: '用于分析估值、业绩、现金流、行业格局和长期竞争力是否支撑交易。',
  },
  {
    name: '股息现金流',
    usage: '用于分析分红、派息、现金流回报和长期持有成本是否匹配。',
  },
  {
    name: '资产配置',
    usage: '用于分析组合权重、再平衡、市场分散和风险预算。',
  },
  {
    name: '风险控制',
    usage: '用于分析仓位、最大亏损、止损条件、回撤和单一标的暴露。',
  },
] as const

export function buildTradeReviewMethodologySummary() {
  return {
    dimensions: [...TRADE_REVIEW_METHOD_DIMENSIONS],
    frameworks: TRADING_METHODOLOGY_FRAMEWORKS.map((item) => `${item.name}：${item.usage}`),
  }
}
