import test from 'node:test'
import assert from 'node:assert/strict'
import { runAgent } from '@/lib/agent/runtime'
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

test('runAgent preserves candidate data when clarification is required', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/chat/completions')) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              intent: 'stock_analysis',
              entities: [{ type: 'stock', raw: '银行', confidence: 0.55 }],
              requiredSkills: [{ name: 'security.resolve', args: { query: '银行' }, reason: '用户标的不明确，需要候选列表' }],
              responseMode: 'clarify',
              clarifyQuestion: '你想分析的是成都银行还是平安银行？',
            }),
          },
        }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return originalFetch(input, init)
  }
  try {
  const result = await runAgent({
    userId: 'user-1',
    sessionId: 'session-1',
    aiConfig: mockAiConfig,
    stocks: [
      stock('stock-1', '601838', '成都银行'),
      stock('stock-2', '000001', '平安银行'),
    ],
    history: [],
    userMessage: '银行',
  })

  assert.equal(result.plan.responseMode, 'clarify')

  const candidatesResult = result.skillResults.find((item) => item.skillName === 'security.resolve')
  assert.equal(candidatesResult?.ok, true)
  assert.deepEqual(
    (candidatesResult?.data as { candidates: Array<{ code: string }> }).candidates.map((item) => item.code),
    ['601838', '000001'],
  )
  assert.equal(result.skillResults.at(-1)?.skillName, 'agent.clarify')
  } finally {
    globalThis.fetch = originalFetch
  }
})
