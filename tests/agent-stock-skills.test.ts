import test from 'node:test'
import assert from 'node:assert/strict'
import { securityResolveSkill } from '@/lib/agent/skills/security'
import { stockGetExternalQuoteSkill, stockGetFinancialsSkill } from '@/lib/agent/skills/stock'
import { stockPriceService } from '@/lib/StockPriceService'
import type { AgentExecutionContext } from '@/lib/agent/types'
import type { AiConfig } from '@/types'
import type { StockQuote } from '@/types/stockApi'

const aiConfig: AiConfig = {
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

const ctx: AgentExecutionContext = {
  userId: 'user-1',
  sessionId: 'session-1',
  stocks: [],
  aiConfig,
  maxContextTokens: 128000,
}

test('external quote skill treats a symbol without market as a resolvable name', async () => {
  const originalFetch = globalThis.fetch
  const originalGetQuote = stockPriceService.getQuote
  globalThis.fetch = async () => new Response('v_hint="sz~002414~\\u9ad8\\u5fb7\\u7ea2\\u5916~gdhw~GP-A"')
  stockPriceService.getQuote = async (symbol, market) => ({
    symbol,
    name: '高德红外',
    price: 6.66,
    change: 0.12,
    changePercent: 1.83,
    volume: 1000,
    peTtm: 88.2,
    epsTtm: null,
    pb: 2.1,
    marketCap: null,
    currency: 'CNY',
    source: 'test',
    timestamp: '2026-05-03T01:40:00.000Z',
  } satisfies StockQuote)

  try {
    const result = await stockGetExternalQuoteSkill.execute({ symbol: '高德红外' }, ctx)
    const data = result.data as { candidates?: Array<{ symbol: string; market: string; quote: { price: number } | null }> }

    assert.equal(result.ok, true)
    assert.equal(data.candidates?.[0]?.symbol, '002414')
    assert.equal(data.candidates?.[0]?.market, 'A')
    assert.equal(data.candidates?.[0]?.quote?.price, 6.66)
    assert.equal(result.needsFollowUp, true)
    assert.deepEqual(result.suggestedSkills?.[0]?.args, { symbol: '002414', market: 'A' })
  } finally {
    globalThis.fetch = originalFetch
    stockPriceService.getQuote = originalGetQuote
  }
})

test('security.resolve is the canonical resolver for portfolio and external names', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('v_hint="sz~002414~\\u9ad8\\u5fb7\\u7ea2\\u5916~gdhw~GP-A"')

  try {
    const localResult = await securityResolveSkill.execute({ query: '成都银行' }, {
      ...ctx,
      stocks: [{
        id: 'stock-1',
        code: '601838',
        name: '成都银行',
        market: 'A',
        trades: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }],
    })
    const externalResult = await securityResolveSkill.execute({ query: '高德红外最近表现怎么样' }, ctx)

    const local = (localResult.data as { candidates: Array<{ code: string; inPortfolio: boolean; stockId?: string; source: string }> }).candidates[0]
    const external = (externalResult.data as { candidates: Array<{ code: string; inPortfolio: boolean; source: string }> }).candidates[0]

    assert.equal(local.code, '601838')
    assert.equal(local.inPortfolio, true)
    assert.equal(local.stockId, 'stock-1')
    assert.equal(local.source, 'portfolio')
    assert.equal(external.code, '002414')
    assert.equal(external.inPortfolio, false)
    assert.equal(external.source, 'tencent.smartbox')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('stock.getFinancials rejects fund and ETF products', async () => {
  const fundResult = await stockGetFinancialsSkill.execute({ symbol: '510300', market: 'FUND' }, ctx)
  const etfResult = await stockGetFinancialsSkill.execute({ symbol: '510300', market: 'A' }, ctx)

  assert.equal(fundResult.ok, false)
  assert.match(fundResult.error ?? '', /没有公司财报/)
  assert.equal(etfResult.ok, false)
  assert.match(etfResult.error ?? '', /没有公司财报/)
})
