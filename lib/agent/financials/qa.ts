import {
  chunkFinancialDocuments,
  cosineSimilarity,
  createEmbeddings,
  resolveEmbeddingEndpoint,
} from '@/lib/agent/financials/retrieval'
import { listFinancialDocChunks, replaceFinancialDocChunks } from '@/lib/sqlite/db'
import { streamCompletion } from '@/lib/external/llmProvider'
import { FINANCIAL_QA_SYSTEM_PROMPT, buildFinancialQaUserPrompt } from '@/lib/agent/financials/prompts'
import type { AiConfig, Market } from '@/types'
import type { FinancialAnalysisInput } from '@/lib/agent/financials/schema'

type FinancialDocument = FinancialAnalysisInput['documents'][number]

const QA_TOP_K = 8
const QA_TIMEOUT_MS = 30_000

/**
 * 将财报文档切分、向量化并持久化，供后续多轮问答检索。
 * embedding 不可用（如 anthropic 端点）或无文档时静默返回 indexed: 0。
 */
export async function indexFinancialDocuments(params: {
  userId: string
  analysisId?: string | null
  symbol: string
  market: Market
  documents: FinancialDocument[]
  config: AiConfig
}): Promise<{ indexed: number }> {
  const { userId, symbol, market, documents, config, analysisId } = params
  if (!documents.length) return { indexed: 0 }

  const endpoint = resolveEmbeddingEndpoint(config)
  const embeddings = createEmbeddings(config)
  if (!endpoint || !embeddings) return { indexed: 0 }

  const chunks = await chunkFinancialDocuments(documents)
  if (!chunks.length) return { indexed: 0 }

  const vectors = await embeddings.embedDocuments(chunks.map((chunk) => chunk.content))
  replaceFinancialDocChunks({
    userId,
    symbol,
    market,
    analysisId: analysisId ?? null,
    embeddingModel: endpoint.model,
    chunks: chunks.map((chunk, index) => ({
      sourceTitle: chunk.sourceTitle,
      publisher: chunk.publisher,
      content: chunk.content,
      embedding: vectors[index] ?? [],
    })),
  })
  return { indexed: chunks.length }
}

export type FinancialQaResult = {
  answer: string
  matched: number
  sources: Array<{ title: string | null; publisher: string | null }>
  /** false 表示无法检索；具体原因见 reason */
  retrieved: boolean
  /** retrieved 为 false 时的原因：无索引 / embedding 端点不可用 / 索引模型已变更 */
  reason?: 'no-index' | 'embedding-unavailable' | 'model-mismatch'
}

/**
 * 对已索引的某标的财报做检索增强问答。
 * 无向量或 embedding 不可用时返回 retrieved: false，由调用方提示用户先做财报分析。
 */
export async function askFinancialsRag(params: {
  userId: string
  symbol: string
  market: Market
  question: string
  config: AiConfig
  topK?: number
}): Promise<FinancialQaResult> {
  const { userId, symbol, market, config } = params
  const question = params.question?.trim()
  if (!question) throw new Error('请输入要追问的问题')

  const endpoint = resolveEmbeddingEndpoint(config)
  const embeddings = createEmbeddings(config)
  if (!endpoint || !embeddings) {
    return { answer: '', matched: 0, sources: [], retrieved: false, reason: 'embedding-unavailable' }
  }

  const stored = listFinancialDocChunks(userId, symbol, market)
  if (!stored.length) {
    return { answer: '', matched: 0, sources: [], retrieved: false, reason: 'no-index' }
  }

  // 模型漂移防护：索引时的 embedding 模型与当前不一致时，向量空间不可比，
  // 余弦分数会失真但不报错。此时要求重建索引，而非静默返回低质量结果。
  const indexedModel = stored.find((chunk) => chunk.embeddingModel)?.embeddingModel
  if (indexedModel && indexedModel !== endpoint.model) {
    return { answer: '', matched: 0, sources: [], retrieved: false, reason: 'model-mismatch' }
  }

  const queryVector = await embeddings.embedQuery(question)
  const ranked = stored
    .map((chunk) => ({ chunk, score: cosineSimilarity(queryVector, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, params.topK ?? QA_TOP_K))

  const context = ranked
    .map((item, index) => `【片段${index + 1}｜${item.chunk.sourceTitle ?? '财报'}】\n${item.chunk.content}`)
    .join('\n\n')

  let answer = ''
  await streamCompletion(
    config,
    [
      { role: 'system', content: FINANCIAL_QA_SYSTEM_PROMPT },
      { role: 'user', content: buildFinancialQaUserPrompt(context, question) },
    ],
    (chunk) => {
      answer += chunk
    },
    AbortSignal.timeout(QA_TIMEOUT_MS),
  )

  const seen = new Set<string>()
  const sources: FinancialQaResult['sources'] = []
  for (const item of ranked) {
    const key = `${item.chunk.sourceTitle ?? ''}::${item.chunk.publisher ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    sources.push({ title: item.chunk.sourceTitle, publisher: item.chunk.publisher })
  }

  return { answer: answer.trim(), matched: ranked.length, sources, retrieved: true }
}
