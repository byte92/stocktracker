import { buildTradeReviewMethodologySummary } from '@/lib/agent/knowledge/tradingMethodology'
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
    recentIndicators: isRecord(data.recentIndicators) ? data.recentIndicators.summary : null,
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

function toWebBrowseSource(data: Record<string, unknown>) {
  const url = textValue(data.finalUrl) || textValue(data.url)
  if (!url) return null
  const summary = textValue(data.summary)
  const content = textValue(data.content)
  return {
    title: textValue(data.title),
    url,
    status: data.status,
    capturedAt: textValue(data.capturedAt),
    summary: (summary || content).slice(0, 900),
  }
}

function inferAnswerType(plan: AgentPlan): AgentAnswerDraft['answerType'] {
  if (plan.responseMode === 'refuse') return 'refusal'
  if (plan.responseMode === 'clarify') return 'clarify'
  if (plan.intent === 'trade_record') return 'trade_review'
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
    const recentIndicators = getData(findResult(skillResults, 'stock.getTechnicalSnapshot'))?.recentIndicators
    if (isRecord(recentIndicators)) {
      addItem(facts, '近期技术指标', recentIndicators, 'stock.getTechnicalSnapshot')
    }
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

  for (const result of findResults(skillResults, 'stock.getAshareSignals')) {
    const data = getData(result)
    if (!data) continue
    addItem(facts, 'A股信号数据', {
      symbol: data.symbol,
      dragonTiger: isRecord(data.dragonTiger) ? {
        records: Array.isArray(data.dragonTiger.records) ? data.dragonTiger.records.slice(0, 5) : [],
        seats: data.dragonTiger.seats,
      } : null,
      lockupExpiry: Array.isArray(data.lockupExpiry) ? data.lockupExpiry.slice(0, 5) : [],
      marginTrading: Array.isArray(data.marginTrading) ? data.marginTrading.slice(0, 5) : [],
      blockTrades: Array.isArray(data.blockTrades) ? data.blockTrades.slice(0, 5) : [],
      holderChanges: Array.isArray(data.holderChanges) ? data.holderChanges.slice(0, 5) : [],
      dividends: Array.isArray(data.dividends) ? data.dividends.slice(0, 5) : [],
      fundFlow120d: Array.isArray(data.fundFlow120d) ? data.fundFlow120d.slice(-20) : [],
    }, 'stock.getAshareSignals', 'A 股信号来自公开数据源，适合用于资金面、筹码和事件风险分析；缺失数组代表对应来源未返回数据，不应编造。')
  }

  for (const result of findResults(skillResults, 'stock.getGlobalSignals')) {
    const data = getData(result)
    if (!data) continue
    addItem(facts, '港美股扩展信号', {
      target: data.target,
      fundFlow: Array.isArray(data.fundFlow) ? data.fundFlow.slice(-20) : [],
      options: isRecord(data.options) ? {
        underlyingPrice: data.options.underlyingPrice,
        expirationDates: data.options.expirationDates,
        calls: Array.isArray(data.options.calls) ? data.options.calls.slice(0, 10) : [],
        puts: Array.isArray(data.options.puts) ? data.options.puts.slice(0, 10) : [],
      } : null,
      secFilings: isRecord(data.secFilings) ? {
        companyName: data.secFilings.companyName,
        filings: Array.isArray(data.secFilings.filings) ? data.secFilings.filings.slice(0, 10) : [],
      } : null,
      news: Array.isArray(data.news) ? data.news.slice(0, 8) : [],
      marketRank: data.marketRank,
    }, 'stock.getGlobalSignals', '港美股扩展信号来自公开数据源；Yahoo/SEC/东财各来源可能独立为空，回答时要说明资料边界。')
  }

  const portfolioSummary = getData(findResult(skillResults, 'portfolio.getSummary'))
  if (portfolioSummary) {
    addItem(facts, '组合标的数', portfolioSummary.stockCount, 'portfolio.getSummary')
    addItem(facts, '活跃持仓数', portfolioSummary.activeHoldingCount, 'portfolio.getSummary')
    addItem(facts, '活跃持仓列表', portfolioSummary.holdings, 'portfolio.getSummary', '用于回答“持仓里是否包含某类标的/某个主题/某个市场”等语义分类问题；分类判断应基于名称、代码、市场和备注，不要编造未提供的行业字段。')
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

  const tradeDraftData = getData(findResult(skillResults, 'trade.prepareRecord'))
  if (tradeDraftData) {
    addItem(facts, '录入状态', tradeDraftData.status, 'trade.prepareRecord')
    addItem(facts, '待确认草稿', tradeDraftData.draft, 'trade.prepareRecord', '确认前不得写入数据库；需要请用户核对并明确确认。')
    addItem(missingData, '待补充字段', tradeDraftData.missing, 'trade.prepareRecord')
    addItem(recommendations, '确认流程', '先把草稿字段返回给用户核对；只有用户明确确认无误后，系统才能录入数据库。', 'trade.prepareRecord')
  }

  const tradeCommitData = getData(findResult(skillResults, 'trade.commitRecord'))
  if (tradeCommitData) {
    addItem(facts, '录入结果', tradeCommitData.status, 'trade.commitRecord')
    addItem(facts, '写入标的', tradeCommitData.stock, 'trade.commitRecord')
    addItem(facts, '写入记录', tradeCommitData.trade, 'trade.commitRecord')
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

  for (const result of findResults(skillResults, 'web.browse')) {
    const data = getData(result)
    if (!data) continue

    const source = toWebBrowseSource(data)
    if (source) {
      addItem(facts, '浏览器页面访问', source, 'web.browse', '这是 Playwright 浏览器实际打开并抽取到的页面内容，应优先用于回答用户给定链接的问题。')
    } else {
      addItem(missingData, '浏览器页面访问', '未抽取到可用页面正文。', 'web.browse')
    }
  }

  if (answerType === 'trade_review') {
    addItem(facts, '交易复盘方法论', buildTradeReviewMethodologySummary(), 'agent.knowledge.tradingMethodology')
    addItem(inferences, '评价框架', '交易记录是已发生事实；复盘需要从事实账本、成本收益、仓位风险、行情位置和行为纪律五个维度拆开看。', 'answer.builder')
    addItem(recommendations, '回答方式', '先直接回应用户的判断诉求，给出条件化结论，再列事实和计算；明确区分已发生交易事实、单笔结果、累计收益、当前行情和不可倒推的历史入场依据。用户提到具体交易理论时，再按该框架展开。', 'answer.builder')
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
