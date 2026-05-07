import type { AgentAnswerDraft, AgentAnswerItem, AgentPlan, AgentSkillResult } from '@/lib/agent/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function addItem(items: AgentAnswerItem[], label: string, value: unknown, source: string, note?: string) {
  if (value === undefined || value === null || value === '') return
  items.push({ label, value, source, note })
}

function findResult(skillResults: AgentSkillResult[], name: string) {
  return skillResults.find((result) => result.skillName === name)
}

function findResults(skillResults: AgentSkillResult[], name: string) {
  return skillResults.filter((result) => result.skillName === name)
}

function getData(result: AgentSkillResult | undefined) {
  return result?.ok && isRecord(result.data) ? result.data : null
}

function getSummary(data: Record<string, unknown> | null) {
  return isRecord(data?.summary) ? data.summary : null
}

function getQuote(data: Record<string, unknown> | null) {
  return isRecord(data?.quote) ? data.quote : null
}

function getIndicators(data: Record<string, unknown> | null) {
  return isRecord(data?.indicators) ? data.indicators : null
}

function quoteSummary(data: Record<string, unknown>) {
  const quote = getQuote(data)
  if (!quote) return null

  return {
    symbol: textValue(data.symbol) || textValue(quote.symbol),
    name: textValue(data.name) || textValue(quote.name),
    market: textValue(data.market),
    price: quote.price,
    changePercent: quote.changePercent,
    peTtm: quote.peTtm ?? null,
    pb: quote.pb ?? null,
    timestamp: quote.timestamp,
    source: quote.source,
  }
}

function indicatorSummary(data: Record<string, unknown>) {
  const indicators = getIndicators(data)
  if (!indicators) return null

  return {
    symbol: textValue(data.symbol),
    name: textValue(data.name),
    market: textValue(data.market),
    trendBias: indicators.trendBias,
    rsi14: indicators.rsi14,
    supportLevel: indicators.supportLevel,
    resistanceLevel: indicators.resistanceLevel,
    candleCount: data.candleCount,
  }
}

function hasSkill(skillResults: AgentSkillResult[], name: string) {
  return skillResults.some((result) => result.skillName === name)
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function toWebSearchSource(item: Record<string, unknown>) {
  const title = textValue(item.title)
  const url = textValue(item.url)
  if (!title || !url) return null

  const snippet = textValue(item.snippet)
  const content = textValue(item.content)
  return {
    title,
    url,
    source: textValue(item.source) || 'web',
    summary: (snippet || content).slice(0, 280),
    point: content && content !== snippet ? content.slice(0, 360) : undefined,
  }
}

function toWebFetchSource(data: Record<string, unknown>) {
  const url = textValue(data.url)
  if (!url) return null
  const summary = textValue(data.summary)
  const body = textValue(data.body)
  return {
    url,
    status: data.status,
    summary: (summary || body).slice(0, 720),
  }
}

function inferAnswerType(plan: AgentPlan): AgentAnswerDraft['answerType'] {
  if (plan.responseMode === 'refuse') return 'refusal'
  if (plan.responseMode === 'clarify') return 'clarify'
  if (plan.intent === 'trade_review') return 'trade_review'
  if (plan.intent === 'portfolio_risk' || plan.intent === 'portfolio_summary') return 'portfolio_review'
  if (plan.intent === 'market_question') return 'market_review'
  if (plan.intent === 'stock_analysis') return 'stock_holding_review'
  return 'general'
}

function computeConfidence(missingData: AgentAnswerItem[], qualityWarnings: AgentAnswerItem[]) {
  if (missingData.length >= 2 || qualityWarnings.length >= 3) return 'low'
  if (missingData.length || qualityWarnings.length) return 'medium'
  return 'high'
}

export function buildAgentAnswerDraft(plan: AgentPlan, skillResults: AgentSkillResult[]): AgentAnswerDraft {
  const answerType = inferAnswerType(plan)
  const facts: AgentAnswerItem[] = []
  const calculations: AgentAnswerItem[] = []
  const inferences: AgentAnswerItem[] = []
  const missingData: AgentAnswerItem[] = []
  const recommendations: AgentAnswerItem[] = []
  const qualityWarnings: AgentAnswerItem[] = []

  for (const result of skillResults) {
    if (!result.ok) {
      addItem(missingData, result.skillName, result.error ?? 'Skill 执行失败', result.skillName)
    }
  }

  const holdingData = getData(findResult(skillResults, 'stock.getHolding'))
  const holdingSummary = getSummary(holdingData)
  if (holdingData) {
    const stock = isRecord(holdingData.stock) ? holdingData.stock : null
    addItem(facts, '标的', stock?.name ? `${stock.name} (${stock.code ?? 'unknown'})` : stock?.code, 'stock.getHolding')
  }
  if (holdingSummary) {
    addItem(facts, '当前持仓', holdingSummary.currentHolding, 'stock.getHolding')
    addItem(calculations, '平均成本价', holdingSummary.avgCostPrice, 'stock.getHolding')
    addItem(calculations, '已实现收益', holdingSummary.realizedPnl, 'stock.getHolding', '来自本地交易记录；现金收益会优先摊低仍持有批次的成本。')
    addItem(calculations, '未实现收益', holdingSummary.unrealizedPnl, 'stock.getHolding', holdingSummary.pnlIncludesMarketPrice ? '按最新行情价计算。' : '未提供最新行情价时为 0。')
    addItem(calculations, '总收益', holdingSummary.totalPnl, 'stock.getHolding', holdingSummary.pnlIncludesMarketPrice ? '已实现收益 + 按最新行情价计算的未实现收益。' : '仅本地交易记录口径，未包含实时行情变化。')
    addItem(calculations, '手续费合计', holdingSummary.totalCommission, 'stock.getHolding')
    addItem(calculations, '现金收益合计', holdingSummary.totalDividend, 'stock.getHolding')
    addItem(facts, '行情价格', holdingSummary.marketPrice, 'stock.getHolding')
    addItem(facts, '市值', holdingSummary.marketValue, 'stock.getHolding')
    if (!holdingSummary.pnlIncludesMarketPrice) {
      addItem(missingData, '实时行情价', '缺少行情价，不能计算当前未实现盈亏。', 'stock.getHolding')
    }
  }

  const tradesData = getData(findResult(skillResults, 'stock.getRecentTrades'))
  const trades = Array.isArray(tradesData?.trades) ? tradesData.trades.filter(isRecord) : []
  if (trades.length) {
    const lastTrade = trades.at(-1)
    addItem(facts, '最近交易', lastTrade ? `${lastTrade.date} ${lastTrade.type} ${lastTrade.quantity ?? ''} @ ${lastTrade.price ?? ''}` : null, 'stock.getRecentTrades')
    if (answerType === 'trade_review') {
      addItem(qualityWarnings, '单笔收益缺口', '当前上下文只有最近交易列表和持仓摘要，没有单笔 FIFO 盈亏明细；不要把累计收益说成这笔交易的收益。', 'stock.getRecentTrades')
    }
  } else if (hasSkill(skillResults, 'stock.getRecentTrades')) {
    addItem(missingData, '最近交易', '没有可用的最近交易记录。', 'stock.getRecentTrades')
  }

  const quote = getQuote(getData(findResult(skillResults, 'stock.getQuote')))
  if (quote) {
    addItem(facts, '当前价格', quote.price, 'stock.getQuote')
    addItem(facts, '涨跌幅', quote.changePercent, 'stock.getQuote')
    addItem(facts, 'PE TTM', quote.peTtm, 'stock.getQuote')
    addItem(facts, 'PB', quote.pb, 'stock.getQuote')
    addItem(facts, '行情时间', quote.timestamp, 'stock.getQuote')
  }

  for (const result of findResults(skillResults, 'stock.getExternalQuote')) {
    const data = getData(result)
    if (!data) continue

    const candidateSummaries = Array.isArray(data.candidates)
      ? data.candidates.filter(isRecord).map(quoteSummary).filter((item): item is NonNullable<ReturnType<typeof quoteSummary>> => item !== null)
      : []
    const singleSummary = quoteSummary(data)

    if (singleSummary) {
      addItem(facts, '未持仓标的行情', singleSummary, 'stock.getExternalQuote')
    } else if (candidateSummaries.length) {
      addItem(facts, '未持仓候选行情', candidateSummaries, 'stock.getExternalQuote')
    } else if (hasSkill(skillResults, 'stock.getExternalQuote')) {
      addItem(missingData, '外部行情', '行情源未返回可用报价。', 'stock.getExternalQuote')
    }
  }

  const indicators = getIndicators(getData(findResult(skillResults, 'stock.getTechnicalSnapshot')))
  if (indicators) {
    addItem(facts, '技术趋势', indicators.trendBias, 'stock.getTechnicalSnapshot')
    addItem(facts, 'RSI14', indicators.rsi14, 'stock.getTechnicalSnapshot')
    addItem(facts, '支撑位', indicators.supportLevel, 'stock.getTechnicalSnapshot')
    addItem(facts, '阻力位', indicators.resistanceLevel, 'stock.getTechnicalSnapshot')
    if (answerType === 'trade_review') {
      addItem(qualityWarnings, '时间口径提醒', '技术指标是当前快照，只能用于事后复盘，不能直接当作交易发生当天的依据。', 'stock.getTechnicalSnapshot')
    }
  }

  for (const result of findResults(skillResults, 'stock.getTechnicalSnapshot')) {
    const data = getData(result)
    if (!data) continue

    const singleExternalSummary = !data.stockId ? indicatorSummary(data) : null
    if (singleExternalSummary) {
      addItem(facts, '未持仓技术指标', singleExternalSummary, 'stock.getTechnicalSnapshot')
      continue
    }

    const candidateSummaries = Array.isArray(data.candidates)
      ? data.candidates.filter(isRecord).map(indicatorSummary).filter((item): item is NonNullable<ReturnType<typeof indicatorSummary>> => item !== null)
      : []
    if (candidateSummaries.length) {
      addItem(facts, '未持仓技术指标', candidateSummaries, 'stock.getTechnicalSnapshot')
    }
  }

  const portfolioSummary = getData(findResult(skillResults, 'portfolio.getSummary'))
  if (portfolioSummary) {
    addItem(facts, '组合标的数', portfolioSummary.stockCount, 'portfolio.getSummary')
    addItem(facts, '活跃持仓数', portfolioSummary.activeHoldingCount, 'portfolio.getSummary')
    addItem(calculations, '组合总收益', portfolioSummary.totalPnl, 'portfolio.getSummary')
    addItem(calculations, '组合已实现收益', portfolioSummary.totalRealizedPnl, 'portfolio.getSummary')
    addItem(calculations, '组合未实现收益', portfolioSummary.totalUnrealizedPnl, 'portfolio.getSummary')
    addItem(calculations, '组合交易笔数', portfolioSummary.totalTradeCount, 'portfolio.getSummary')
  }

  for (const result of findResults(skillResults, 'finance.calculate')) {
    const data = getData(result)
    if (!data || data.calculationType !== 'dividend.estimate') continue

    const source = isRecord(data.source) ? data.source : null
    const assumptions = Array.isArray(data.assumptions)
      ? data.assumptions.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : []
    const currency = textValue(data.currency)
    const note = assumptions.join('；')

    addItem(calculations, '预计分红金额', {
      amount: data.estimatedAmount,
      currency,
      quantity: data.quantity,
      cashPerShare: data.cashPerShare,
      grossEstimatedAmount: data.grossEstimatedAmount,
      netEstimatedAmount: data.netEstimatedAmount,
      formula: data.formula,
    }, 'finance.calculate', note)

    addItem(facts, '分红估算口径', {
      source: source?.kind,
      tradeDate: source?.tradeDate,
      grossCashPerShare: data.grossCashPerShare,
      netCashPerShare: data.netCashPerShare,
    }, 'finance.calculate', '回答时需要说明税前/实际到账口径，以及是否假设本次分红与历史记录相同。')
  }

  for (const result of findResults(skillResults, 'web.search')) {
    const data = getData(result)
    if (!data) continue

    const searchedAt = textValue(data.searchedAt)
    const query = textValue(data.query)
    const sources = (Array.isArray(data.results) ? data.results : [])
      .filter(isRecord)
      .map(toWebSearchSource)
      .filter((item): item is NonNullable<ReturnType<typeof toWebSearchSource>> => item !== null)

    addItem(facts, '公开搜索查询', query, 'web.search')
    addItem(facts, '公开搜索时间', searchedAt, 'web.search', '这是搜索执行时间；搜索结果是公开网页候选来源，不是实时数据库事实。')
    addItem(facts, '公开搜索来源', sources, 'web.search', '回答新闻、公告或政策问题时应列出标题、链接、摘要/要点和搜索时间，并使用“公开搜索结果显示/检索到”一类表述。')
    if (!sources.length) {
      addItem(missingData, '公开搜索结果', '没有检索到可用于引用的公开网页结果。', 'web.search')
    }
  }

  for (const result of findResults(skillResults, 'web.fetch')) {
    const data = getData(result)
    if (!data) continue

    const source = toWebFetchSource(data)
    if (source) {
      addItem(facts, '公开页面抓取', source, 'web.fetch', '这是受控抓取到的外部页面内容，应按页面来源和抓取状态引用。')
    } else {
      addItem(missingData, '公开页面抓取', '未抓取到可用页面内容。', 'web.fetch')
    }
  }

  if (answerType === 'trade_review') {
    addItem(inferences, '评价框架', '需要同时看是否锁定利润、是否降低仓位风险、是否符合分批计划，以及是否存在事后卖飞。', 'answer.builder')
    addItem(recommendations, '回答方式', '先给条件化结论，再列事实和计算；明确区分单笔、累计、当前行情三个口径。', 'answer.builder')
  } else if (answerType === 'stock_holding_review') {
    addItem(inferences, '评价框架', '需要区分持仓成本、已实现收益、未实现收益、估值与技术面，不要把某一项单独作为买卖结论。', 'answer.builder')
  } else if (answerType === 'portfolio_review') {
    addItem(inferences, '评价框架', '需要区分组合级收益、单只标的贡献、仓位集中度和风险来源。', 'answer.builder')
  }

  return {
    answerType,
    facts,
    calculations,
    inferences,
    missingData,
    recommendations,
    qualityWarnings,
    confidence: computeConfidence(missingData, qualityWarnings),
  }
}
