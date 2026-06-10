import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { OpenAIEmbeddings } from '@langchain/openai'
import type { AiConfig } from '@/types'
import type { FinancialAnalysisInput } from '@/lib/agent/financials/schema'

type FinancialDocument = FinancialAnalysisInput['documents'][number]

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'
const DEFAULT_TOP_K = 8
const CHUNK_SIZE = 800
const CHUNK_OVERLAP = 100
const EMBEDDING_TIMEOUT_MS = 20_000
// 保守的批量大小：兼容自建/国产 openai-compatible embedding 端点对单批条数的限制，
// 避免数百 chunk 一次提交触发 413 / 400。
const EMBEDDING_BATCH_SIZE = 64
// 文档切分后 chunk 数不超过该值时，检索没有收益（内容本就不会被截断），直接跳过。
const MIN_CHUNKS_FOR_RETRIEVAL = 10

/**
 * 解析 embedding 端点。embeddings 仅 openai-compatible 端点提供，
 * anthropic-compatible 端点不支持；缺省复用 chat 的 baseUrl / apiKey。
 * 返回 null 表示当前配置无法做 embedding（应降级）。
 */
export function resolveEmbeddingEndpoint(config: AiConfig): { baseURL: string; apiKey: string; model: string } | null {
  const explicitBase = config.embeddingBaseUrl?.trim()
  // anthropic chat 端点不能拿来做 embedding；必须显式给一个 openai-compatible 端点。
  const baseSource = explicitBase || (config.provider === 'anthropic-compatible' ? '' : config.baseUrl?.trim())
  if (!baseSource) return null
  const apiKey = config.apiKey?.trim()
  if (!apiKey) return null

  const normalized = baseSource.replace(/\/$/, '')
  const baseURL = normalized.endsWith('/v1') ? normalized : `${normalized}/v1`
  const model = config.embeddingModel?.trim() || DEFAULT_EMBEDDING_MODEL
  return { baseURL, apiKey, model }
}

/** 构造 embeddings 客户端；配置不支持时返回 null。供一阶段检索与二阶段问答共用。 */
export function createEmbeddings(config: AiConfig): OpenAIEmbeddings | null {
  const endpoint = resolveEmbeddingEndpoint(config)
  if (!endpoint) return null
  return new OpenAIEmbeddings({
    model: endpoint.model,
    apiKey: endpoint.apiKey,
    timeout: EMBEDDING_TIMEOUT_MS,
    batchSize: EMBEDDING_BATCH_SIZE,
    configuration: { baseURL: endpoint.baseURL },
  })
}

/** 余弦相似度。空向量返回 0。供一阶段与二阶段持久化检索共用。 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** 取与 query 向量最相似的 topK 项索引（按相似度降序）。 */
export function topKByCosine(queryVector: number[], vectors: number[][], topK: number): number[] {
  return vectors
    .map((vec, index) => ({ index, score: cosineSimilarity(queryVector, vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((item) => item.index)
}

export type FinancialChunk = {
  docIndex: number
  content: string
  sourceTitle: string | null
  publisher: string | null
}

/** 把一组财报文档切分为带来源元信息的 chunk。一阶段检索与二阶段索引共用。 */
export async function chunkFinancialDocuments(documents: FinancialDocument[]): Promise<FinancialChunk[]> {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  })
  const chunks: FinancialChunk[] = []
  for (let docIndex = 0; docIndex < documents.length; docIndex += 1) {
    const doc = documents[docIndex]
    const excerpt = doc.excerpt?.trim()
    if (!excerpt) continue
    const pieces = await splitter.splitText(excerpt)
    for (const piece of pieces) {
      const content = piece.trim()
      if (content) {
        chunks.push({ docIndex, content, sourceTitle: doc.title ?? null, publisher: doc.publisher ?? null })
      }
    }
  }
  return chunks
}

export type RetrievalResult = {
  documents: FinancialDocument[]
  retrieved: boolean
  chunkCount?: number
  /** 命中并归并后的来源篇数 */
  matchedDocCount?: number
}

/**
 * 基于语义检索从（可能很长的）财报文档中挑出与问题最相关的片段，
 * 替换"截断前 2500 字"的粗暴策略。任何一步失败都会降级返回 retrieved: false，
 * 由调用方退回原 compactInput 截断逻辑，保证最坏不劣于改造前。
 */
export async function retrieveRelevantExcerpts(
  documents: FinancialDocument[],
  query: string,
  config: AiConfig,
  options?: { topK?: number },
): Promise<RetrievalResult> {
  if (!documents.length) return { documents, retrieved: false }

  const embeddings = createEmbeddings(config)
  if (!embeddings) return { documents, retrieved: false }

  try {
    const chunks = await chunkFinancialDocuments(documents)
    // 内容本就不长（不会被截断），检索无收益。
    if (chunks.length < MIN_CHUNKS_FOR_RETRIEVAL) {
      return { documents, retrieved: false, chunkCount: chunks.length }
    }

    const topK = Math.max(1, options?.topK ?? DEFAULT_TOP_K)
    const effectiveQuery = (query?.trim() || documents.map((doc) => doc.title).filter(Boolean).join(' ')).trim()
    // query 与所有文档标题都为空：无可检索的语义锚点，降级而非发一次注定失败的 embedQuery。
    if (!effectiveQuery) return { documents, retrieved: false, chunkCount: chunks.length }

    const [chunkVectors, queryVector] = await Promise.all([
      embeddings.embedDocuments(chunks.map((chunk) => chunk.content)),
      embeddings.embedQuery(effectiveQuery),
    ])

    const selected = topKByCosine(queryVector, chunkVectors, topK)
    if (!selected.length) return { documents, retrieved: false, chunkCount: chunks.length }

    // 命中片段按原文档归并，保留 title / publisher / url / date 元信息，
    // 并维持各文档在原数组中的相对顺序。
    const grouped = new Map<number, string[]>()
    for (const chunkIndex of selected) {
      const { docIndex, content } = chunks[chunkIndex]
      const bucket = grouped.get(docIndex) ?? []
      bucket.push(content)
      grouped.set(docIndex, bucket)
    }

    const merged: FinancialDocument[] = []
    for (let docIndex = 0; docIndex < documents.length; docIndex += 1) {
      const pieces = grouped.get(docIndex)
      if (!pieces?.length) continue
      merged.push({ ...documents[docIndex], excerpt: pieces.join('\n…\n') })
    }

    if (!merged.length) return { documents, retrieved: false, chunkCount: chunks.length }

    return { documents: merged, retrieved: true, chunkCount: chunks.length, matchedDocCount: merged.length }
  } catch {
    // embedding 端点不可用、网络异常等：降级，不让财报分析失败。
    return { documents, retrieved: false }
  }
}
