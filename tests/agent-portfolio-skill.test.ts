import test from 'node:test'
import assert from 'node:assert/strict'
import { portfolioGetSummarySkill } from '@/lib/agent/skills/portfolio'
import type { AgentExecutionContext } from '@/lib/agent/types'
import type { AiConfig, Stock, Trade } from '@/types'

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

function trade(stockId: string, type: Trade['type'], date: string, quantity: number, price: number): Trade {
  const totalAmount = Number((quantity * price).toFixed(2))
  return {
    id: `${stockId}-${type}-${date}`,
    stockId,
    type,
    date,
    price,
    quantity,
    commission: 0,
    tax: 0,
    totalAmount,
    netAmount: totalAmount,
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
  }
}

function stock(id: string, code: string, name: string, trades: Trade[]): Stock {
  return {
    id,
    code,
    name,
    market: 'A',
    trades,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

const context: AgentExecutionContext = {
  userId: 'user-1',
  sessionId: 'session-1',
  aiConfig: mockAiConfig,
  maxContextTokens: 128000,
  stocks: [
    stock('stock-1', '601398', '工商银行', [trade('stock-1', 'BUY', '2026-01-01', 1000, 5)]),
    stock('stock-2', '601838', '成都银行', [trade('stock-2', 'BUY', '2026-01-02', 2000, 15)]),
    stock('stock-3', '510300', '沪深300ETF', [
      trade('stock-3', 'BUY', '2026-01-03', 1000, 4),
      trade('stock-3', 'SELL', '2026-01-04', 1000, 4.2),
    ]),
  ],
}

test('portfolio.getSummary includes active holdings list for semantic holding questions', async () => {
  const result = await portfolioGetSummarySkill.execute({}, context)

  assert.equal(result.ok, true)
  const data = result.data as { activeHoldingCount: number; holdings: Array<{ code: string; name: string; currentHolding: number }> }

  assert.equal(data.activeHoldingCount, 2)
  assert.deepEqual(data.holdings.map((item) => item.name), ['工商银行', '成都银行'])
  assert.deepEqual(data.holdings.map((item) => item.code), ['601398', '601838'])
  assert.deepEqual(data.holdings.map((item) => item.currentHolding), [1000, 2000])
})
