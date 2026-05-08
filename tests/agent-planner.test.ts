import test from 'node:test'
import assert from 'node:assert/strict'
import { planAgentResponse } from '@/lib/agent/planner'
import type { AiConfig, Stock } from '@/types'

const mockAiConfig: AiConfig = {
  enabled: true,
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:8080/v1',
  model: 'test-model',
  apiKey: 'test-key',
  temperature: 0,
  maxContextTokens: 128000,
  newsEnabled: false,
  analysisLanguage: 'zh-CN',
}

function stock(id: string, code: string, name: string): Stock {
  return {
    id,
    code,
    name,
    market: 'A',
    trades: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const stocks = [
  stock('stock-1', '601838', '成都银行'),
  stock('stock-2', '510300', '沪深300ETF'),
  stock('stock-3', '000001', '平安银行'),
  stock('stock-4', '601398', '工商银行'),
]

test('agent planner uses stock skills for a single-stock question', async () => {
  const plan = await planAgentResponse({
    userMessage: '成都银行现在走势健康吗',
    stocks,
    aiConfig: mockAiConfig,
  })

  assert.equal(plan.intent, 'stock_analysis')
  assert.equal(plan.responseMode, 'answer')
  assert.equal(plan.entities[0]?.stockId, 'stock-1')
  assert.deepEqual(plan.requiredSkills.map((item) => item.name), [
    'stock.getHolding',
    'stock.getRecentTrades',
    'stock.getQuote',
    'stock.getTechnicalSnapshot',
  ])
})

test('agent planner fallback adds generic web search for public announcement questions', async () => {
  const plan = await planAgentResponse({
    userMessage: '成都银行最近有什么公告？',
    stocks,
    aiConfig: mockAiConfig,
  })

  const webSearch = plan.requiredSkills.find((item) => item.name === 'web.search')

  assert.equal(plan.intent, 'stock_analysis')
  assert.equal(plan.responseMode, 'answer')
  assert.equal(plan.entities[0]?.stockId, 'stock-1')
  assert.equal(webSearch?.args.query, '成都银行 601838 成都银行最近有什么公告？')
})

test('agent planner keeps model extracted web search context', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).includes('/chat/completions')) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              intent: 'stock_analysis',
              entities: [{ type: 'stock', raw: '成都银行', code: '601838', name: '成都银行', market: 'A', confidence: 0.95 }],
              requiredSkills: [{
                name: 'web.search',
                args: {
                  query: '成都银行 601838 最新公告',
                  sourceHints: ['cninfo.com.cn', 'sse.com.cn'],
                  limit: 5,
                },
                reason: '用户询问公告，需要公开来源',
              }],
              responseMode: 'answer',
            }),
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return originalFetch(input)
  }

  try {
    const plan = await planAgentResponse({
      userMessage: '成都银行最近有什么公告？',
      stocks,
      aiConfig: mockAiConfig,
    })
    const webSearch = plan.requiredSkills.find((item) => item.name === 'web.search')

    assert.equal(plan.intent, 'stock_analysis')
    assert.equal(plan.entities[0]?.stockId, 'stock-1')
    assert.equal(webSearch?.args.query, '成都银行 601838 最新公告')
    assert.deepEqual(webSearch?.args.sourceHints, ['cninfo.com.cn', 'sse.com.cn'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('agent planner uses browser access for explicit URLs and keeps URLs out of search query', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).includes('/chat/completions')) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              intent: 'stock_analysis',
              entities: [{ type: 'stock', raw: '好太太', code: '603848', name: '好太太', market: 'A', confidence: 0.85 }],
              requiredSkills: [{
                name: 'web.search',
                args: {
                  query: 'https://news.10jqka.com.cn/field/v1/20260507/676491894.shtml#view_type=desktop_client&skin=black 这个新闻有什么启示',
                  limit: 5,
                },
                reason: '模型误把链接放入搜索词',
              }],
              responseMode: 'answer',
            }),
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return originalFetch(input)
  }

  try {
    const plan = await planAgentResponse({
      userMessage: 'https://news.10jqka.com.cn/field/v1/20260507/676491894.shtml#view_type=desktop_client&skin=black 这个新闻有什么启示',
      stocks,
      aiConfig: mockAiConfig,
    })
    const webBrowse = plan.requiredSkills.find((item) => item.name === 'web.browse')
    const webSearch = plan.requiredSkills.find((item) => item.name === 'web.search')

    assert.equal(webBrowse?.args.url, 'https://news.10jqka.com.cn/field/v1/20260507/676491894.shtml#view_type=desktop_client&skin=black')
    assert.equal(webBrowse?.args.extractPrompt, '这个新闻有什么启示')
    assert.equal(typeof webSearch?.args.query, 'string')
    assert.ok(!String(webSearch?.args.query).includes('https://'))
    assert.ok(String(webSearch?.args.query).includes('这个新闻有什么启示'))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('agent planner fallback adds generic web search for stock news questions', async () => {
  const plan = await planAgentResponse({
    userMessage: '成都银行今天发生了什么，有利空吗？',
    stocks,
    aiConfig: mockAiConfig,
  })

  const webSearch = plan.requiredSkills.find((item) => item.name === 'web.search')

  assert.equal(plan.intent, 'stock_analysis')
  assert.equal(plan.responseMode, 'answer')
  assert.equal(webSearch?.args.query, '成都银行 601838 成都银行今天发生了什么，有利空吗？')
})

test('agent planner uses portfolio skills for portfolio risk questions', async () => {
  const plan = await planAgentResponse({
    userMessage: '我现在组合最大的风险是什么',
    stocks,
    aiConfig: mockAiConfig,
  })

  assert.equal(plan.intent, 'portfolio_risk')
  assert.equal(plan.responseMode, 'answer')
  assert.deepEqual(plan.requiredSkills.map((item) => item.name), [
    'portfolio.getSummary',
    'portfolio.getTopPositions',
  ])
})

test('agent planner keeps recent stock focus for follow-up metric questions', async () => {
  const plan = await planAgentResponse({
    userMessage: '你看一下我平均收益是多少？',
    stocks,
    history: [{
      id: 'message-1',
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'assistant',
      content: '成都银行分析',
      contextSnapshot: {
        agent: {
          entities: [{
            type: 'stock',
            stockId: 'stock-1',
            code: '601838',
            name: '成都银行',
            market: 'A',
          }],
        },
      },
      tokenEstimate: 10,
      createdAt: '2026-01-01T00:00:00.000Z',
    }],
    aiConfig: mockAiConfig,
  })

  assert.equal(plan.intent, 'stock_analysis')
  assert.equal(plan.responseMode, 'answer')
  assert.equal(plan.entities[0]?.stockId, 'stock-1')
  assert.deepEqual(plan.requiredSkills.map((item) => item.name), [
    'stock.getHolding',
    'stock.getRecentTrades',
    'stock.getQuote',
    'stock.getTechnicalSnapshot',
  ])
})

test('agent planner uses web search fallback for recent focused dividend timing questions', async () => {
  const plan = await planAgentResponse({
    userMessage: '下一次分红时间是什么时候',
    stocks,
    history: [{
      id: 'message-1',
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'assistant',
      content: '工商银行分析',
      contextSnapshot: {
        agent: {
          entities: [{
            type: 'stock',
            stockId: 'stock-4',
            code: '601398',
            name: '工商银行',
            market: 'A',
          }],
        },
      },
      tokenEstimate: 10,
      createdAt: '2026-01-01T00:00:00.000Z',
    }],
    aiConfig: mockAiConfig,
  })

  const webSearch = plan.requiredSkills.find((item) => item.name === 'web.search')

  assert.equal(plan.intent, 'trade_review')
  assert.equal(plan.responseMode, 'answer')
  assert.equal(plan.entities[0]?.stockId, 'stock-4')
  assert.equal(webSearch?.args.query, '工商银行 601398 下一次分红时间是什么时候')
})

test('agent planner adds finance calculation for recent focused dividend estimate questions', async () => {
  const plan = await planAgentResponse({
    userMessage: '预计这次我能分多少',
    stocks,
    history: [{
      id: 'message-1',
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'assistant',
      content: '工商银行最近一次分红情况',
      contextSnapshot: {
        agent: {
          entities: [{
            type: 'stock',
            stockId: 'stock-4',
            code: '601398',
            name: '工商银行',
            market: 'A',
          }],
        },
      },
      tokenEstimate: 10,
      createdAt: '2026-01-01T00:00:00.000Z',
    }],
    aiConfig: mockAiConfig,
  })

  const calculation = plan.requiredSkills.find((item) => item.name === 'finance.calculate')

  assert.equal(plan.intent, 'stock_analysis')
  assert.equal(plan.responseMode, 'answer')
  assert.equal(plan.entities[0]?.stockId, 'stock-4')
  assert.deepEqual(calculation?.args, { type: 'dividend.estimate', stockId: 'stock-4' })
})

test('agent planner adds web search for A-share market event and policy questions', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).includes('/chat/completions')) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              intent: 'market_question',
              entities: [{ type: 'market', raw: 'A股大盘', market: 'A', confidence: 0.9 }],
              requiredSkills: [
                { name: 'market.getAnalysisContext', args: { market: 'A' }, reason: '读取大盘上下文' },
                {
                  name: 'web.search',
                  args: {
                    query: 'A股大盘 今天 政策新闻 盘面大事件',
                    sourceHints: ['证监会', '央行', '证券时报'],
                    limit: 5,
                  },
                  reason: '用户询问今日公开事件，需要检索公开来源',
                },
              ],
              responseMode: 'answer',
            }),
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return originalFetch(input)
  }

  try {
    const plan = await planAgentResponse({
      userMessage: 'A股大盘今天有什么政策新闻和盘面大事件？',
      stocks,
      aiConfig: mockAiConfig,
    })

    assert.equal(plan.intent, 'market_question')
    assert.equal(plan.responseMode, 'answer')
    assert.deepEqual(plan.requiredSkills.map((item) => item.name), [
      'market.getAnalysisContext',
      'web.search',
    ])
    assert.equal(plan.requiredSkills[1]?.args.query, 'A股大盘 今天 政策新闻 盘面大事件')
    assert.deepEqual(plan.requiredSkills[1]?.args.sourceHints, ['证监会', '央行', '证券时报'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('agent planner fetches external ETF data for broad 科创50 ETF questions', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).includes(encodeURIComponent('科创50'))) {
      return new Response('v_hint="sh~588000~\\u79d1\\u521b50ETF\\u534e\\u590f~kc50etfhx~ETF^sh~588080~\\u79d1\\u521b50ETF\\u6613\\u65b9\\u8fbe~kc50etfyfd~ETF"')
    }
    return new Response('v_hint="N";')
  }

  let plan
  try {
    plan = await planAgentResponse({
      userMessage: 'a股的科创50 你觉得还有上涨空间吗 我想买etf',
      stocks,
      aiConfig: mockAiConfig,
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  const externalQuotes = plan.requiredSkills.filter((item) => item.name === 'stock.getExternalQuote')
  const technicalSnapshots = plan.requiredSkills.filter((item) => item.name === 'stock.getTechnicalSnapshot')

  assert.equal(plan.intent, 'stock_analysis')
  assert.equal(plan.responseMode, 'answer')
  assert.deepEqual(externalQuotes.map((item) => item.args.symbol), ['588000', '588080'])
  assert.deepEqual(technicalSnapshots.map((item) => item.args.symbol), ['588000', '588080'])
})

test('agent planner prefers a held broad ETF candidate over external variants in fallback planning', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('v_hint="sh~510300~\\u6caa\\u6df1300ETF\\u534e\\u6cf0\\u67cf\\u745e~hs300etfhfbr~ETF^sh~510310~\\u6caa\\u6df1300ETF\\u6613\\u65b9\\u8fbe~hs300etfyfd~ETF^sz~159919~\\u6caa\\u6df1300ETF\\u5609\\u5b9e~hs300ETFjs~ETF"')

  try {
    const plan = await planAgentResponse({
      userMessage: '看一下，我现在卖出沪深 300 的 1/2，你觉得有问题吗？',
      stocks,
      aiConfig: { ...mockAiConfig, enabled: false },
    })

    assert.equal(plan.intent, 'trade_review')
    assert.equal(plan.responseMode, 'answer')
    assert.equal(plan.entities[0]?.stockId, 'stock-2')
    assert.deepEqual(plan.requiredSkills.map((item) => item.name), [
      'stock.getHolding',
      'stock.getRecentTrades',
      'stock.getQuote',
      'stock.getTechnicalSnapshot',
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('agent planner prefers a held broad ETF candidate after model-directed security resolution', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).includes('/chat/completions')) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              intent: 'stock_analysis',
              entities: [{ type: 'stock', raw: '沪深300', confidence: 0.72 }],
              requiredSkills: [{
                name: 'security.resolve',
                args: { query: '沪深300' },
                reason: '用户使用指数简称，需要解析具体 ETF',
              }],
              responseMode: 'answer',
            }),
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response('v_hint="sh~510300~\\u6caa\\u6df1300ETF\\u534e\\u6cf0\\u67cf\\u745e~hs300etfhfbr~ETF^sh~510310~\\u6caa\\u6df1300ETF\\u6613\\u65b9\\u8fbe~hs300etfyfd~ETF^sz~159919~\\u6caa\\u6df1300ETF\\u5609\\u5b9e~hs300ETFjs~ETF"')
  }

  try {
    const plan = await planAgentResponse({
      userMessage: '看一下，我现在卖出沪深 300 的 1/2，你觉得有问题吗？',
      stocks,
      aiConfig: mockAiConfig,
    })

    assert.equal(plan.intent, 'trade_review')
    assert.equal(plan.responseMode, 'answer')
    assert.equal(plan.entities[0]?.stockId, 'stock-2')
    assert.deepEqual(plan.requiredSkills.map((item) => item.name), [
      'stock.getHolding',
      'stock.getRecentTrades',
      'stock.getQuote',
      'stock.getTechnicalSnapshot',
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('agent planner fetches external quote for explicit non-holding A-share ETF code', async () => {
  const plan = await planAgentResponse({
    userMessage: '588000 还有上涨空间吗',
    stocks,
    aiConfig: mockAiConfig,
  })

  assert.equal(plan.intent, 'stock_analysis')
  assert.equal(plan.responseMode, 'answer')
  assert.deepEqual(plan.requiredSkills.map((item) => item.name), [
    'stock.getExternalQuote',
    'stock.getTechnicalSnapshot',
  ])
  assert.equal(plan.requiredSkills[0]?.args.symbol, '588000')
  assert.equal(plan.requiredSkills[0]?.args.market, 'A')
})

test('agent planner infers US market for explicit non-holding US ticker', async () => {
  const plan = await planAgentResponse({
    userMessage: 'PDD 最近怎么样',
    stocks,
    aiConfig: mockAiConfig,
  })

  assert.equal(plan.intent, 'stock_analysis')
  assert.equal(plan.responseMode, 'answer')
  assert.deepEqual(plan.requiredSkills.map((item) => item.name), [
    'stock.getExternalQuote',
    'stock.getTechnicalSnapshot',
  ])
  assert.equal(plan.requiredSkills[0]?.args.symbol, 'PDD')
  assert.equal(plan.requiredSkills[0]?.args.market, 'US')
})

test('agent planner uses market intent before code-shape fallback', async () => {
  const plan = await planAgentResponse({
    userMessage: '美股 00700 看一下',
    stocks,
    aiConfig: mockAiConfig,
  })

  assert.equal(plan.intent, 'stock_analysis')
  assert.equal(plan.responseMode, 'answer')
  assert.equal(plan.requiredSkills[0]?.args.symbol, '00700')
  assert.equal(plan.requiredSkills[0]?.args.market, 'US')
})

test('agent planner resolves non-holding A-share names before LLM fallback', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).includes(encodeURIComponent('五粮液'))) {
      return new Response('v_hint="sz~000858~\\u4e94\\u7cae\\u6db2~wly~GP-A"')
    }
    return new Response('v_hint="N";')
  }

  let plan
  try {
    plan = await planAgentResponse({
      userMessage: '五粮液现在表现如何',
      stocks,
      aiConfig: mockAiConfig,
    })
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(plan.intent, 'stock_analysis')
  assert.equal(plan.responseMode, 'answer')
  assert.deepEqual(plan.entities.map((item) => item.code), ['000858'])
  assert.deepEqual(plan.requiredSkills.map((item) => item.name), [
    'stock.getExternalQuote',
    'stock.getTechnicalSnapshot',
  ])
  assert.equal(plan.requiredSkills[0]?.args.symbol, '000858')
  assert.equal(plan.requiredSkills[0]?.args.market, 'A')
})

test('agent planner resolves smartbox candidates before LLM fallback', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).includes(encodeURIComponent('高德红外'))) {
      return new Response('v_hint="sz~002414~\\u9ad8\\u5fb7\\u7ea2\\u5916~gdhw~GP-A"')
    }
    return new Response('v_hint="N";')
  }

  try {
    const plan = await planAgentResponse({
      userMessage: '高德红外最近表现怎么样',
      stocks,
      aiConfig: mockAiConfig,
    })

    assert.equal(plan.intent, 'stock_analysis')
    assert.equal(plan.responseMode, 'answer')
    assert.deepEqual(plan.entities.map((item) => item.code), ['002414'])
    assert.deepEqual(plan.requiredSkills.map((item) => item.name), [
      'stock.getExternalQuote',
      'stock.getTechnicalSnapshot',
    ])
    assert.equal(plan.requiredSkills[0]?.args.symbol, '002414')
    assert.equal(plan.requiredSkills[0]?.args.market, 'A')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('agent planner keeps recent external ETF candidates for follow-up references', async () => {
  const plan = await planAgentResponse({
    userMessage: '这两只都分析一下',
    stocks,
    history: [{
      id: 'message-1',
      sessionId: 'session-1',
      userId: 'user-1',
      role: 'assistant',
      content: 'A股里可以看 588000.SH（华夏科创50ETF）和 588080.SH（易方达科创50ETF），这两个 ETF 代码都可以继续拉数据。',
      tokenEstimate: 20,
      createdAt: '2026-01-01T00:00:00.000Z',
    }],
    aiConfig: mockAiConfig,
  })

  const externalQuotes = plan.requiredSkills.filter((item) => item.name === 'stock.getExternalQuote')

  assert.equal(plan.intent, 'stock_analysis')
  assert.equal(plan.responseMode, 'answer')
  assert.deepEqual(externalQuotes.map((item) => item.args.symbol), ['588000', '588080'])
})

test('agent planner uses local holding skills for clarified portfolio candidates', async () => {
  const plan = await planAgentResponse({
    userMessage: '就看成都银行',
    stocks,
    resolvedSecurities: [{
      symbol: '601838',
      market: 'A',
      name: '成都银行',
      stockId: 'stock-1',
      inPortfolio: true,
    }],
    aiConfig: mockAiConfig,
  })

  assert.equal(plan.intent, 'stock_analysis')
  assert.equal(plan.responseMode, 'answer')
  assert.equal(plan.entities[0]?.stockId, 'stock-1')
  assert.deepEqual(plan.requiredSkills.map((item) => item.name), [
    'stock.getHolding',
    'stock.getRecentTrades',
    'stock.getQuote',
    'stock.getTechnicalSnapshot',
  ])
})

test('agent planner keeps original intent extras after a clarified candidate is selected', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).includes('/chat/completions')) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              intent: 'stock_analysis',
              entities: [{ type: 'stock', raw: '成都银行', code: '601838', market: 'A', confidence: 0.9 }],
              requiredSkills: [{
                name: 'web.search',
                args: { query: '成都银行 601838 最新公告', sourceHints: ['cninfo.com.cn'], limit: 5 },
                reason: '用户原问题询问公告',
              }],
              responseMode: 'answer',
            }),
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return originalFetch(input)
  }

  try {
    const plan = await planAgentResponse({
      userMessage: '成都银行最近有什么公告？\n用户澄清选择：成都银行',
      stocks,
      resolvedSecurities: [{
        symbol: '601838',
        market: 'A',
        name: '成都银行',
        stockId: 'stock-1',
        inPortfolio: true,
      }],
      aiConfig: mockAiConfig,
    })

    assert.equal(plan.intent, 'stock_analysis')
    assert.equal(plan.entities[0]?.stockId, 'stock-1')
    assert.ok(plan.requiredSkills.some((item) => item.name === 'stock.getHolding'))
    assert.equal(plan.requiredSkills.find((item) => item.name === 'web.search')?.args.query, '成都银行 601838 最新公告')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('agent planner refuses clearly out-of-scope questions', async () => {
  const plan = await planAgentResponse({
    userMessage: '帮我看看今天成都天气怎么样',
    stocks,
    aiConfig: mockAiConfig,
  })

  assert.equal(plan.intent, 'out_of_scope')
  assert.equal(plan.responseMode, 'refuse')
  assert.equal(plan.requiredSkills.length, 0)
})
