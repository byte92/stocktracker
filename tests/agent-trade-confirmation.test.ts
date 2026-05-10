import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyTradeConfirmationIntent } from '@/lib/agent/tradeConfirmation'
import type { TradeRecordDraft } from '@/lib/agent/skills/tradeRecord'
import type { AiConfig } from '@/types'

const draft: TradeRecordDraft = {
  type: 'BUY',
  date: '2026-05-10',
  stockId: 'stock-1',
  code: '601838',
  name: '成都银行',
  market: 'A',
  price: 10,
  quantity: 1000,
  commission: 5,
  tax: 0.1,
  totalAmount: 10000,
  netAmount: 10005.1,
  sourceText: '今日买入成都银行 1000 股，成本价是 10 块。',
  assumptions: [],
}

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

test('trade confirmation intent is classified by LLM response', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).includes('/chat/completions')) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              intent: 'confirm',
              confidence: 0.94,
              reason: '用户明确同意写入',
            }),
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return originalFetch(input)
  }

  try {
    const intent = await classifyTradeConfirmationIntent({
      message: '确认录入',
      draft,
      aiConfig,
    })
    assert.equal(intent, 'confirm')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('trade confirmation intent fails instead of using local fallback when LLM confidence is low', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    if (String(input).includes('/chat/completions')) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              intent: 'confirm',
              confidence: 0.2,
              reason: '不确定',
            }),
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return originalFetch(input)
  }

  try {
    await assert.rejects(
      classifyTradeConfirmationIntent({
        message: '确认',
        draft,
        aiConfig,
      }),
      /置信度不足/,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('trade confirmation intent fails when AI config is unavailable', async () => {
  await assert.rejects(
    classifyTradeConfirmationIntent({
      message: '确认',
      draft,
      aiConfig: { ...aiConfig, enabled: false },
    }),
    /AI 模型未配置/,
  )
})
