import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createPortfolioStore } from '@/lib/sqlite/db'
import { DEFAULT_APP_CONFIG } from '@/config/defaults'
import type { AiAnalysisResult } from '@/types'

function createTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-sqlite-test-'))
  return path.join(dir, 'finance.sqlite')
}

test('sqlite store returns default payload for missing user', () => {
  const store = createPortfolioStore(createTempDbPath())

  try {
    const payload = store.getPortfolioByUserId('missing-user')
    assert.deepEqual(payload, { stocks: [], config: DEFAULT_APP_CONFIG })
  } finally {
    store.close()
  }
})

test('sqlite store persists and reloads portfolio payload', () => {
  const store = createPortfolioStore(createTempDbPath())

  try {
    const payload = {
      stocks: [
        {
          id: 'stock-1',
          code: '510300',
          name: '沪深300ETF华泰柏瑞',
          market: 'A' as const,
          trades: [],
          note: 'test',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      config: DEFAULT_APP_CONFIG,
    }

    store.savePortfolioByUserId('local:test-user', payload)
    const loaded = store.getPortfolioByUserId('local:test-user')

    assert.deepEqual(loaded, payload)
  } finally {
    store.close()
  }
})

test('sqlite store can recover latest non-empty local portfolio', () => {
  const store = createPortfolioStore(createTempDbPath())

  try {
    const emptyPayload = { stocks: [], config: DEFAULT_APP_CONFIG }
    const filledPayload = {
      stocks: [
        {
          id: 'stock-1',
          code: '601838',
          name: '成都银行',
          market: 'A' as const,
          trades: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      config: DEFAULT_APP_CONFIG,
    }

    store.savePortfolioByUserId('local:empty-device', emptyPayload)
    store.savePortfolioByUserId('local:filled-device', filledPayload)

    const recovered = store.getLatestNonEmptyLocalPortfolio()

    assert.equal(recovered?.userId, 'local:filled-device')
    assert.equal(recovered?.recovered, true)
    assert.deepEqual(recovered?.stocks, filledPayload.stocks)
  } finally {
    store.close()
  }
})

test('sqlite store falls back to default config when payload is invalid json', () => {
  const store = createPortfolioStore(createTempDbPath())
  const originalConsoleError = console.error
  console.error = () => {}

  try {
    store.rawInsert('broken-user', '{not-valid-json')
    const loaded = store.getPortfolioByUserId('broken-user')
    assert.deepEqual(loaded, { stocks: [], config: DEFAULT_APP_CONFIG })
  } finally {
    console.error = originalConsoleError
    store.close()
  }
})

function createAnalysisResult(summary: string, generatedAt: string): AiAnalysisResult {
  return {
    generatedAt,
    cached: false,
    analysisStrength: 'high',
    summary,
    stance: '中性偏观察',
    facts: [],
    inferences: [],
    actionPlan: [],
    invalidationSignals: [],
    timeHorizons: [],
    probabilityAssessment: [],
    technicalSignals: [],
    newsDrivers: [],
    keyLevels: [],
    actionableObservations: [],
    risks: [],
    confidence: 'medium',
    disclaimer: '仅供参考',
    evidence: [],
  }
}

test('sqlite ai history filters latest stock analysis by stock id', () => {
  const store = createPortfolioStore(createTempDbPath())

  try {
    store.saveAiAnalysis({
      id: 'record-1',
      userId: 'local:test-user',
      type: 'stock',
      stockId: 'stock-1',
      stockCode: '601838',
      stockName: '成都银行',
      market: 'A',
      confidence: 'medium',
      tags: ['个股分析', '601838'],
      generatedAt: '2026-04-20T08:00:00.000Z',
      result: createAnalysisResult('成都银行旧分析', '2026-04-20T08:00:00.000Z'),
    })
    store.saveAiAnalysis({
      id: 'record-2',
      userId: 'local:test-user',
      type: 'stock',
      stockId: 'stock-2',
      stockCode: '510300',
      stockName: '沪深300ETF',
      market: 'A',
      confidence: 'medium',
      tags: ['个股分析', '510300'],
      generatedAt: '2026-04-21T08:00:00.000Z',
      result: createAnalysisResult('ETF 分析', '2026-04-21T08:00:00.000Z'),
    })
    store.saveAiAnalysis({
      id: 'record-3',
      userId: 'local:test-user',
      type: 'stock',
      stockId: 'stock-1',
      stockCode: '601838',
      stockName: '成都银行',
      market: 'A',
      confidence: 'high',
      tags: ['个股分析', '601838'],
      generatedAt: '2026-04-22T08:00:00.000Z',
      result: createAnalysisResult('成都银行最新分析', '2026-04-22T08:00:00.000Z'),
    })

    const records = store.listAiAnalysisByUserId('local:test-user', { type: 'stock', stockId: 'stock-1', limit: 1 })

    assert.equal(records.length, 1)
    assert.equal(records[0]?.id, 'record-3')
    assert.equal(records[0]?.result.summary, '成都银行最新分析')
  } finally {
    store.close()
  }
})

test('sqlite ai history preserves financial analysis result shape', () => {
  const store = createPortfolioStore(createTempDbPath())

  try {
    const financialResult = {
      symbol: '601398',
      market: 'A',
      analysis: {
        companyName: '工商银行',
        reportPeriod: '2026-03-31',
        confidence: 'medium',
        trendSummary: '营收和利润保持增长。',
        metrics: { revenue: '2,303.7 亿', netProfit: '869.41 亿' },
        highlights: ['营收增长'],
        risks: ['利差压力'],
        valuationNotes: ['PB 偏低'],
        missingData: [],
      },
      chain: { provider: 'openai-compatible', degraded: false },
    }

    store.saveAiAnalysis({
      id: 'financial-record-1',
      userId: 'local:test-user',
      type: 'financial',
      stockId: 'stock-icbc',
      stockCode: '601398',
      stockName: '工商银行',
      market: 'A',
      confidence: 'medium',
      tags: ['财报分析', 'A'],
      generatedAt: '2026-05-21T08:00:00.000Z',
      result: financialResult,
    })

    const records = store.listAiAnalysisByUserId('local:test-user', { type: 'financial', limit: 1 })
    const result = records[0]?.result as typeof financialResult | undefined

    assert.equal(records.length, 1)
    assert.equal(records[0]?.type, 'financial')
    assert.equal(result?.analysis.companyName, '工商银行')
    assert.equal(result?.analysis.metrics.revenue, '2,303.7 亿')
  } finally {
    store.close()
  }
})

test('sqlite financial doc chunks replace and list latest index by symbol', () => {
  const store = createPortfolioStore(createTempDbPath())

  try {
    store.replaceFinancialDocChunks({
      userId: 'local:test-user',
      analysisId: 'financial-record-1',
      symbol: 'AAPL',
      market: 'US',
      embeddingModel: 'text-embedding-3-small',
      chunks: [
        { sourceTitle: 'Apple Q1', publisher: 'apple-ir', content: 'old revenue chunk', embedding: [1, 0] },
        { sourceTitle: 'Apple Q1', publisher: 'apple-ir', content: 'old cash flow chunk', embedding: [0, 1] },
      ],
    })

    assert.equal(store.listFinancialDocChunks('local:test-user', 'AAPL', 'US').length, 2)

    store.replaceFinancialDocChunks({
      userId: 'local:test-user',
      analysisId: 'financial-record-2',
      symbol: 'AAPL',
      market: 'US',
      embeddingModel: 'bge-m3',
      chunks: [
        { sourceTitle: 'Apple Q2', publisher: 'apple-ir', content: 'new margin chunk', embedding: [0.5, 0.5] },
      ],
    })

    const chunks = store.listFinancialDocChunks('local:test-user', 'AAPL', 'US')

    assert.equal(chunks.length, 1)
    assert.equal(chunks[0]?.sourceTitle, 'Apple Q2')
    assert.equal(chunks[0]?.content, 'new margin chunk')
    assert.deepEqual(chunks[0]?.embedding, [0.5, 0.5])
    assert.equal(chunks[0]?.embeddingModel, 'bge-m3')
  } finally {
    store.close()
  }
})

test('sqlite deleting a financial analysis also removes its indexed chunks', () => {
  const store = createPortfolioStore(createTempDbPath())

  try {
    store.saveAiAnalysis({
      id: 'financial-record-1',
      userId: 'local:test-user',
      type: 'financial',
      stockId: 'stock-aapl',
      stockCode: 'AAPL',
      stockName: 'Apple',
      market: 'US',
      confidence: 'medium',
      tags: ['财报分析', 'US'],
      generatedAt: '2026-05-21T08:00:00.000Z',
      result: {
        symbol: 'AAPL',
        market: 'US',
        analysis: { companyName: 'Apple', confidence: 'medium', trendSummary: 'ok', metrics: {}, highlights: [], risks: [], valuationNotes: [], missingData: [] },
        chain: { provider: 'native-json', degraded: false },
      },
    })
    store.replaceFinancialDocChunks({
      userId: 'local:test-user',
      analysisId: 'financial-record-1',
      symbol: 'AAPL',
      market: 'US',
      embeddingModel: 'text-embedding-3-small',
      chunks: [
        { sourceTitle: 'Apple Q1', publisher: 'apple-ir', content: 'revenue chunk', embedding: [1, 0] },
      ],
    })

    assert.equal(store.listFinancialDocChunks('local:test-user', 'AAPL', 'US').length, 1)

    const deleted = store.deleteAiAnalysisById('local:test-user', 'financial-record-1')

    assert.equal(deleted, true)
    assert.equal(store.listFinancialDocChunks('local:test-user', 'AAPL', 'US').length, 0)
  } finally {
    store.close()
  }
})

test('sqlite clearing AI data removes chat, analysis history and financial chunks for a user only', () => {
  const store = createPortfolioStore(createTempDbPath())

  try {
    store.saveAiChatSession({ id: 'session-1', userId: 'local:test-user', title: 'Test session' })
    store.saveAiChatMessage({
      id: 'message-1',
      sessionId: 'session-1',
      userId: 'local:test-user',
      role: 'user',
      content: 'hello',
    })
    store.saveAiAnalysis({
      id: 'financial-record-1',
      userId: 'local:test-user',
      type: 'financial',
      stockId: 'stock-aapl',
      stockCode: 'AAPL',
      stockName: 'Apple',
      market: 'US',
      confidence: 'medium',
      tags: ['财报分析', 'US'],
      generatedAt: '2026-05-21T08:00:00.000Z',
      result: {
        symbol: 'AAPL',
        market: 'US',
        analysis: { companyName: 'Apple', confidence: 'medium', trendSummary: 'ok', metrics: {}, highlights: [], risks: [], valuationNotes: [], missingData: [] },
        chain: { provider: 'native-json', degraded: false },
      },
    })
    store.replaceFinancialDocChunks({
      userId: 'local:test-user',
      analysisId: 'financial-record-1',
      symbol: 'AAPL',
      market: 'US',
      embeddingModel: 'text-embedding-3-small',
      chunks: [
        { sourceTitle: 'Apple Q1', publisher: 'apple-ir', content: 'revenue chunk', embedding: [1, 0] },
      ],
    })
    store.replaceFinancialDocChunks({
      userId: 'local:other-user',
      analysisId: 'other-record',
      symbol: 'MSFT',
      market: 'US',
      embeddingModel: 'text-embedding-3-small',
      chunks: [
        { sourceTitle: 'Microsoft Q1', publisher: 'msft-ir', content: 'other chunk', embedding: [0, 1] },
      ],
    })

    store.clearAiDataByUserId('local:test-user')

    assert.equal(store.listAiChatSessions('local:test-user').length, 0)
    assert.equal(store.listAiAnalysisByUserId('local:test-user').length, 0)
    assert.equal(store.listFinancialDocChunks('local:test-user', 'AAPL', 'US').length, 0)
    assert.equal(store.listFinancialDocChunks('local:other-user', 'MSFT', 'US').length, 1)
  } finally {
    store.close()
  }
})

test('sqlite persists and lists ai agent runs', () => {
  const store = createPortfolioStore(createTempDbPath())

  try {
    store.saveAiAgentRun({
      id: 'run-1',
      sessionId: 'session-1',
      userId: 'local:test-user',
      messageId: 'message-1',
      intent: 'stock_analysis',
      responseMode: 'answer',
      plan: { intent: 'stock_analysis', requiredSkills: [{ name: 'stock.getHolding' }] },
      skillCalls: [{ name: 'stock.getHolding', args: { stockId: 'stock-1' } }],
      skillResults: [{ skillName: 'stock.getHolding', ok: true }],
      contextStats: { tokenEstimate: 1200, maxContextTokens: 128000, level: 'short' },
    })

    const runs = store.listAiAgentRuns('local:test-user', 'session-1')

    assert.equal(runs.length, 1)
    assert.equal(runs[0].id, 'run-1')
    assert.equal(runs[0].intent, 'stock_analysis')
    assert.equal(runs[0].responseMode, 'answer')
    assert.deepEqual(runs[0].skillCalls, [{ name: 'stock.getHolding', args: { stockId: 'stock-1' } }])
    assert.equal(runs[0].contextStats.tokenEstimate, 1200)
  } finally {
    store.close()
  }
})
