import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cosineSimilarity,
  topKByCosine,
  resolveEmbeddingEndpoint,
} from '@/lib/agent/financials/retrieval'
import { askFinancialsRag } from '@/lib/agent/financials/qa'
import type { AiConfig } from '@/types'

function makeConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    enabled: true,
    provider: 'openai-compatible',
    baseUrl: 'https://api.example.com',
    model: 'gpt-4o-mini',
    apiKey: 'sk-test',
    temperature: 0.2,
    maxContextTokens: 128000,
    newsEnabled: false,
    analysisLanguage: 'zh-CN',
    ...overrides,
  }
}

// ---- cosineSimilarity ----

test('cosineSimilarity 相同方向向量返回 1', () => {
  assert.equal(cosineSimilarity([1, 2, 3], [1, 2, 3]), 1)
  assert.equal(cosineSimilarity([1, 0], [2, 0]), 1)
})

test('cosineSimilarity 正交向量返回 0', () => {
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0)
})

test('cosineSimilarity 零向量返回 0（避免除零）', () => {
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0)
  assert.equal(cosineSimilarity([], []), 0)
})

test('cosineSimilarity 长度不一致时按较短长度截断计算', () => {
  // 只比较前两维，结果应约等于 [1,2] 与 [1,2] 的相似度 = 1
  assert.ok(Math.abs(cosineSimilarity([1, 2], [1, 2, 99]) - 1) < 1e-9)
})

// ---- topKByCosine ----

test('topKByCosine 按相似度降序返回索引', () => {
  const query = [1, 0]
  const vectors = [
    [0, 1], // 正交，分低
    [1, 0], // 完全一致，分最高
    [1, 1], // 中间
  ]
  assert.deepEqual(topKByCosine(query, vectors, 2), [1, 2])
})

test('topKByCosine topK 大于向量数时返回全部', () => {
  const result = topKByCosine([1, 0], [[1, 0], [0, 1]], 10)
  assert.equal(result.length, 2)
})

// ---- resolveEmbeddingEndpoint ----

test('resolveEmbeddingEndpoint openai-compatible 自动补 /v1 并用默认模型', () => {
  const endpoint = resolveEmbeddingEndpoint(makeConfig())
  assert.ok(endpoint)
  assert.equal(endpoint.baseURL, 'https://api.example.com/v1')
  assert.equal(endpoint.model, 'text-embedding-3-small')
})

test('resolveEmbeddingEndpoint 已含 /v1 不重复追加', () => {
  const endpoint = resolveEmbeddingEndpoint(makeConfig({ baseUrl: 'https://api.example.com/v1' }))
  assert.equal(endpoint?.baseURL, 'https://api.example.com/v1')
})

test('resolveEmbeddingEndpoint 使用自定义 embeddingModel / embeddingBaseUrl', () => {
  const endpoint = resolveEmbeddingEndpoint(makeConfig({
    embeddingBaseUrl: 'https://embed.example.com',
    embeddingModel: 'bge-m3',
  }))
  assert.equal(endpoint?.baseURL, 'https://embed.example.com/v1')
  assert.equal(endpoint?.model, 'bge-m3')
})

test('resolveEmbeddingEndpoint anthropic 无独立 embedding 端点时降级返回 null', () => {
  const endpoint = resolveEmbeddingEndpoint(makeConfig({ provider: 'anthropic-compatible' }))
  assert.equal(endpoint, null)
})

test('resolveEmbeddingEndpoint anthropic 配置了 embeddingBaseUrl 时可用', () => {
  const endpoint = resolveEmbeddingEndpoint(makeConfig({
    provider: 'anthropic-compatible',
    embeddingBaseUrl: 'https://embed.example.com',
  }))
  assert.equal(endpoint?.baseURL, 'https://embed.example.com/v1')
})

test('resolveEmbeddingEndpoint 缺少 apiKey 返回 null', () => {
  assert.equal(resolveEmbeddingEndpoint(makeConfig({ apiKey: '' })), null)
})

// ---- askFinancialsRag 降级分支 ----

test('askFinancialsRag embedding 不可用时返回 embedding-unavailable', async () => {
  const result = await askFinancialsRag({
    userId: 'local:rag-test-user',
    symbol: 'AAPL',
    market: 'US',
    question: '现金流是否恶化？',
    config: makeConfig({ provider: 'anthropic-compatible' }),
  })

  assert.equal(result.retrieved, false)
  assert.equal(result.reason, 'embedding-unavailable')
  assert.equal(result.matched, 0)
})

test('askFinancialsRag 没有索引时返回 no-index 且不调用问答模型', async () => {
  const result = await askFinancialsRag({
    userId: `local:missing-rag-index-${Date.now()}`,
    symbol: 'MSFT',
    market: 'US',
    question: '营收增长来自哪里？',
    config: makeConfig(),
  })

  assert.equal(result.retrieved, false)
  assert.equal(result.reason, 'no-index')
  assert.equal(result.answer, '')
})
