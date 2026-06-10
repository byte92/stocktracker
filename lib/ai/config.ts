import type { AiConfig, AiProvider } from '@/types'

const PROVIDERS: AiProvider[] = ['openai-compatible', 'anthropic-compatible']

export type AiEnvStatus = {
  configured: boolean
  provider?: AiProvider
  baseUrl?: string
  baseUrlConfigured: boolean
  model?: string
  apiKeyConfigured: boolean
  apiKeyPreview?: string
}

function readEnvProvider(): AiProvider | undefined {
  const raw = process.env.AI_PROVIDER?.trim()
  if (!raw) return undefined
  return PROVIDERS.includes(raw as AiProvider) ? raw as AiProvider : undefined
}

function maskSecret(value: string) {
  const trimmed = value.trim()
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}...${trimmed.slice(-2)}`
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`
}

export function getAiEnvStatus(): AiEnvStatus {
  const provider = readEnvProvider()
  const baseUrl = process.env.AI_BASE_URL?.trim()
  const model = process.env.AI_MODEL?.trim()
  const apiKey = process.env.AI_API_KEY?.trim()

  return {
    configured: Boolean(provider && baseUrl && model && apiKey),
    provider,
    baseUrl: baseUrl || undefined,
    baseUrlConfigured: Boolean(baseUrl),
    model: model || undefined,
    apiKeyConfigured: Boolean(apiKey),
    apiKeyPreview: apiKey ? maskSecret(apiKey) : undefined,
  }
}

export function resolveEffectiveAiConfig(config: AiConfig): AiConfig {
  // embedding 端点独立注入：无论 chat 配置来自前端还是 env，财报 RAG 的
  // embedding override 都应生效。留空则由 resolveEmbeddingEndpoint 默认复用 baseUrl。
  const embeddingBaseUrl = process.env.AI_EMBEDDING_BASE_URL?.trim()
  const embeddingModel = process.env.AI_EMBEDDING_MODEL?.trim()
  const withEmbedding: AiConfig = {
    ...config,
    ...(embeddingBaseUrl ? { embeddingBaseUrl } : {}),
    ...(embeddingModel ? { embeddingModel } : {}),
  }

  const provider = readEnvProvider()
  const baseUrl = process.env.AI_BASE_URL?.trim()
  const model = process.env.AI_MODEL?.trim()
  const apiKey = process.env.AI_API_KEY?.trim()
  if (!provider || !baseUrl || !model || !apiKey) return withEmbedding

  return {
    ...withEmbedding,
    enabled: true,
    provider,
    baseUrl,
    model,
    apiKey,
  }
}
