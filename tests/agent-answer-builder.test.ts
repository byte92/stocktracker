import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAgentAnswerDraft } from '@/lib/agent/answer/builder'
import type { AgentPlan, AgentSkillResult } from '@/lib/agent/types'

const tradeReviewPlan: AgentPlan = {
  intent: 'trade_review',
  entities: [{
    type: 'stock',
    raw: '成都银行最后一笔卖出合理吗',
    stockId: 'stock-1',
    code: '601838',
    name: '成都银行',
    market: 'A',
    confidence: 0.9,
  }],
  requiredSkills: [],
  responseMode: 'answer',
}

test('answer builder creates quality warnings for trade review context', () => {
  const skillResults: AgentSkillResult[] = [
    {
      skillName: 'stock.getHolding',
      ok: true,
      data: {
        stock: { id: 'stock-1', code: '601838', name: '成都银行', market: 'A' },
        summary: {
          currentHolding: 11600,
          avgCostPrice: 16.58,
          marketPrice: 18.97,
          marketValue: 220052,
          realizedPnl: 2492.7807,
          unrealizedPnl: 27724.12,
          totalPnl: 30216.9007,
          totalCommission: 108.14,
          totalDividend: 0,
          tradeCount: 7,
          pnlIncludesMarketPrice: true,
        },
      },
    },
    {
      skillName: 'stock.getRecentTrades',
      ok: true,
      data: {
        stockId: 'stock-1',
        trades: [
          { type: 'BUY', date: '2026-01-10', price: 16.1, quantity: 5500, commission: 5, tax: 0, netAmount: 88555 },
          { type: 'SELL', date: '2026-04-24', price: 18.33, quantity: 5500, commission: 10, tax: 0, netAmount: 100805 },
        ],
      },
    },
    {
      skillName: 'stock.getTechnicalSnapshot',
      ok: true,
      data: {
        stockId: 'stock-1',
        indicators: {
          trendBias: 'bullish',
          rsi14: 79.4,
          supportLevel: 18.2,
          resistanceLevel: 19.1,
        },
      },
    },
  ]

  const draft = buildAgentAnswerDraft(tradeReviewPlan, skillResults)

  assert.equal(draft.answerType, 'trade_review')
  assert.equal(draft.confidence, 'medium')
  assert.ok(draft.facts.some((item) => item.label === '最近交易' && String(item.value).includes('SELL')))
  assert.ok(draft.facts.some((item) => item.label === '交易复盘方法论' && item.source === 'agent.knowledge.tradingMethodology'))
  assert.ok(draft.calculations.some((item) => item.label === '已实现收益' && item.source === 'stock.getHolding'))
  assert.ok(draft.qualityWarnings.some((item) => item.label === '单笔收益缺口'))
  assert.ok(draft.qualityWarnings.some((item) => item.label === '时间口径提醒'))
  assert.ok(draft.recommendations.some((item) => item.label === '回答方式'))
})

test('answer builder exposes methodology even without trade plan fields', () => {
  const draft = buildAgentAnswerDraft(tradeReviewPlan, [
    {
      skillName: 'stock.getRecentTrades',
      ok: true,
      data: {
        stockId: 'stock-1',
        trades: [
          {
            type: 'BUY',
            date: '2026-05-01',
            price: 12,
            quantity: 1000,
            commission: 5,
            tax: 0,
            netAmount: 12005,
          },
        ],
      },
    },
  ])

  const methodology = draft.facts.find((item) => item.label === '交易复盘方法论')

  assert.match(JSON.stringify(methodology?.value), /道氏理论/)
  assert.match(JSON.stringify(methodology?.value), /事实账本/)
})

test('answer builder records failed skills as missing data', () => {
  const draft = buildAgentAnswerDraft(tradeReviewPlan, [
    { skillName: 'stock.getQuote', ok: false, error: '行情源不可用' },
  ])

  assert.equal(draft.confidence, 'medium')
  assert.deepEqual(draft.missingData.map((item) => item.label), ['stock.getQuote'])
})

test('answer builder exposes web search sources and searched time', () => {
  const draft = buildAgentAnswerDraft({
    intent: 'market_question',
    entities: [{ type: 'market', raw: 'A股大盘', market: 'A', confidence: 0.8 }],
    requiredSkills: [],
    responseMode: 'answer',
  }, [
    {
      skillName: 'web.search',
      ok: true,
      data: {
        query: 'A股 今日政策 新闻',
        searchedAt: '2026-05-02T14:30:00.000Z',
        results: [
          {
            title: 'A股市场政策新闻',
            url: 'https://example.com/news',
            snippet: '证监会发布资本市场相关安排。',
            content: '证监会发布资本市场相关安排，市场关注后续政策落地节奏。',
            source: 'bing',
          },
        ],
      },
    },
  ])

  const searchedAt = draft.facts.find((item) => item.label === '公开搜索时间')
  const sources = draft.facts.find((item) => item.label === '公开搜索来源')

  assert.equal(draft.answerType, 'market_review')
  assert.equal(searchedAt?.value, '2026-05-02T14:30:00.000Z')
  assert.match(searchedAt?.note ?? '', /不是实时数据库事实/)
  assert.deepEqual(sources?.value, [{
    title: 'A股市场政策新闻',
    url: 'https://example.com/news',
    source: 'bing',
    summary: '证监会发布资本市场相关安排。',
    point: '证监会发布资本市场相关安排，市场关注后续政策落地节奏。',
  }])
})

test('answer builder exposes finance calculation formula and assumptions', () => {
  const draft = buildAgentAnswerDraft(tradeReviewPlan, [
    {
      skillName: 'finance.calculate',
      ok: true,
      data: {
        calculationType: 'dividend.estimate',
        stock: { id: 'stock-1', code: '601398', name: '工商银行', market: 'A' },
        quantity: 2000,
        currency: 'CNY',
        cashPerShare: 0.3064,
        grossCashPerShare: 0.3064,
        netCashPerShare: 0.3064,
        estimatedAmount: 612.8,
        grossEstimatedAmount: 612.8,
        netEstimatedAmount: 612.8,
        formula: '2000 × 0.3064 = 612.8',
        source: { kind: 'local_recent_dividend', tradeDate: '2025-07-10' },
        assumptions: ['按本地最近一次现金收益记录（2025-07-10）的实际口径估算。'],
      },
    },
  ])

  const calculation = draft.calculations.find((item) => item.label === '预计分红金额')
  const source = draft.facts.find((item) => item.label === '分红估算口径')

  assert.equal(calculation?.source, 'finance.calculate')
  assert.deepEqual(calculation?.value, {
    amount: 612.8,
    currency: 'CNY',
    quantity: 2000,
    cashPerShare: 0.3064,
    grossEstimatedAmount: 612.8,
    netEstimatedAmount: 612.8,
    formula: '2000 × 0.3064 = 612.8',
  })
  assert.match(calculation?.note ?? '', /最近一次现金收益/)
  assert.equal(source?.source, 'finance.calculate')
})

test('answer builder exposes web fetch content', () => {
  const draft = buildAgentAnswerDraft({
    intent: 'market_question',
    entities: [{ type: 'market', raw: '外部页面', confidence: 0.8 }],
    requiredSkills: [],
    responseMode: 'answer',
  }, [
    {
      skillName: 'web.fetch',
      ok: true,
      data: {
        url: 'https://www.cninfo.com.cn/new/disclosure',
        status: 200,
        summary: '按照要求从页面提取公告要点。',
        body: '原始公告页面正文',
      },
    },
  ])

  const fetchFact = draft.facts.find((item) => item.label === '公开页面抓取')
  assert.deepEqual(fetchFact?.value, {
    url: 'https://www.cninfo.com.cn/new/disclosure',
    status: 200,
    summary: '按照要求从页面提取公告要点。',
  })
  assert.equal(fetchFact?.source, 'web.fetch')
})

test('answer builder exposes browser page content', () => {
  const draft = buildAgentAnswerDraft({
    intent: 'market_question',
    entities: [{ type: 'market', raw: '外部页面', confidence: 0.8 }],
    requiredSkills: [],
    responseMode: 'answer',
  }, [
    {
      skillName: 'web.browse',
      ok: true,
      data: {
        url: 'https://news.10jqka.com.cn/field/v1/20260507/676491894.shtml',
        finalUrl: 'https://news.10jqka.com.cn/field/v1/20260507/676491894.shtml#view_type=desktop_client',
        title: '同花顺新闻标题',
        status: 200,
        capturedAt: '2026-05-07T06:24:15.000Z',
        summary: '按照用户问题提取出的新闻启示。',
        content: '浏览器抽取的新闻正文。',
      },
    },
  ])

  const browseFact = draft.facts.find((item) => item.label === '浏览器页面访问')
  assert.deepEqual(browseFact?.value, {
    title: '同花顺新闻标题',
    url: 'https://news.10jqka.com.cn/field/v1/20260507/676491894.shtml#view_type=desktop_client',
    status: 200,
    capturedAt: '2026-05-07T06:24:15.000Z',
    summary: '按照用户问题提取出的新闻启示。',
  })
  assert.equal(browseFact?.source, 'web.browse')
})

test('answer builder exposes external quote facts', () => {
  const draft = buildAgentAnswerDraft({
    intent: 'stock_analysis',
    entities: [{ type: 'stock', raw: '588000', code: '588000', market: 'A', confidence: 0.8 }],
    requiredSkills: [],
    responseMode: 'answer',
  }, [
    {
      skillName: 'stock.getExternalQuote',
      ok: true,
      data: {
        symbol: '588000',
        name: '华夏科创50ETF',
        market: 'A',
        inPortfolio: false,
        quote: {
          symbol: '588000',
          name: '华夏科创50ETF',
          price: 1.02,
          change: 0.01,
          changePercent: 0.99,
          peTtm: null,
          pb: null,
          timestamp: '2026-05-04T10:00:00+08:00',
          currency: 'CNY',
          source: 'tencent',
        },
      },
    },
  ])

  const externalQuote = draft.facts.find((item) => item.label === '未持仓标的行情')

  assert.equal(draft.answerType, 'stock_holding_review')
  assert.deepEqual(externalQuote?.value, {
    symbol: '588000',
    name: '华夏科创50ETF',
    market: 'A',
    price: 1.02,
    changePercent: 0.99,
    peTtm: null,
    pb: null,
    timestamp: '2026-05-04T10:00:00+08:00',
    source: 'tencent',
  })
})

test('answer builder exposes external technical facts for multiple candidates', () => {
  const draft = buildAgentAnswerDraft({
    intent: 'stock_analysis',
    entities: [
      { type: 'stock', raw: '科创50ETF', code: '588000', name: '华夏科创50ETF', market: 'A', confidence: 0.9 },
      { type: 'stock', raw: '科创50ETF', code: '588080', name: '易方达科创50ETF', market: 'A', confidence: 0.82 },
    ],
    requiredSkills: [],
    responseMode: 'answer',
  }, [
    {
      skillName: 'stock.getTechnicalSnapshot',
      ok: true,
      data: {
        symbol: '588000',
        name: '华夏科创50ETF',
        market: 'A',
        indicators: {
          trendBias: 'neutral',
          rsi14: 52.1,
          supportLevel: 0.98,
          resistanceLevel: 1.08,
        },
        candleCount: 120,
      },
    },
    {
      skillName: 'stock.getTechnicalSnapshot',
      ok: true,
      data: {
        symbol: '588080',
        name: '易方达科创50ETF',
        market: 'A',
        indicators: {
          trendBias: 'bullish',
          rsi14: 61.4,
          supportLevel: 0.92,
          resistanceLevel: 1.01,
        },
        candleCount: 120,
      },
    },
  ])

  const externalTechnicals = draft.facts.filter((item) => item.label === '未持仓技术指标')

  assert.equal(externalTechnicals.length, 2)
  assert.deepEqual(externalTechnicals.map((item) => (item.value as { symbol: string }).symbol), ['588000', '588080'])
})
