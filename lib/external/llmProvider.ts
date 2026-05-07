import type { AiConfig } from '@/types'
import { thirdPartyApiUrls } from '@/lib/external/thirdPartyApis'
import { loggedFetch } from '@/lib/observability/fetch'
import { logger } from '@/lib/observability/logger'

export type LlmProviderMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const ANTHROPIC_RESPONSE_TOKEN_LIMIT = 4096
type LlmJsonCompletionOptions = {
  logFailureLevel?: 'debug' | 'info' | 'warn' | 'error'
  logMetadata?: Record<string, unknown>
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high'
}

function ensureApiBase(baseUrl: string) {
  const normalized = baseUrl.replace(/\/$/, '')
  if (!normalized) throw new Error('请先配置 AI Base URL')
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`
}

function normalizeStreamContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(normalizeStreamContent).join('')
  if (!value || typeof value !== 'object') return ''

  const part = value as Record<string, unknown>
  if (typeof part.text === 'string') return part.text
  if (typeof part.content === 'string') return part.content
  if (Array.isArray(part.content)) return part.content.map(normalizeStreamContent).join('')
  return ''
}

function extractOpenAiStreamText(choice: unknown): string {
  if (!choice || typeof choice !== 'object') return ''

  const item = choice as Record<string, unknown>
  const delta = item.delta && typeof item.delta === 'object' ? (item.delta as Record<string, unknown>) : null
  const message = item.message && typeof item.message === 'object' ? (item.message as Record<string, unknown>) : null
  const candidates = [delta?.content, delta?.text, message?.content, item.text]
  return candidates.map(normalizeStreamContent).join('')
}

function getProviderErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object') return null
  const payload = error as Record<string, unknown>
  if (typeof payload.message === 'string') return payload.message
  if (typeof payload.error === 'string') return payload.error
  if (payload.error && typeof payload.error === 'object') {
    const nested = payload.error as Record<string, unknown>
    if (typeof nested.message === 'string') return nested.message
  }
  return null
}

function parseStreamPayload(data: string) {
  try {
    return JSON.parse(data)
  } catch {
    throw new Error('LLM 返回了无法解析的流式数据')
  }
}

function providerHost(baseUrl: string) {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

function describeLlmConnectionError(error: unknown, baseUrl: string) {
  const host = providerHost(baseUrl)
  if (error instanceof Error && /timeout|timed out|aborted due to timeout/i.test(error.message)) {
    return `AI 服务响应超时：${host} 未在预期时间内返回，请检查模型网关或稍后重试。`
  }
  if (error instanceof Error && /fetch failed|failed to fetch|ECONNREFUSED|ENOTFOUND|ECONNRESET|EHOSTUNREACH|Couldn'?t connect/i.test(error.message)) {
    return `AI 服务不可用：无法连接到 ${host}，请检查 AI_BASE_URL 或本地模型网关是否已启动。`
  }
  return null
}

async function fetchLlm(input: string, init: RequestInit, context: Parameters<typeof loggedFetch>[2]) {
  try {
    return await loggedFetch(input, init, context)
  } catch (error) {
    const message = describeLlmConnectionError(error, input)
    if (message) throw new Error(message)
    throw error
  }
}

function assertNormalFinish(finishReason: string | null, receivedText: boolean, onChunk: (chunk: string) => void) {
  if (!finishReason) {
    if (receivedText) {
      logger.warn('llm.stream.missingFinishReason')
      return
    }
    throw new Error('AI 未返回有效内容')
  }

  if (['stop', 'end_turn', 'complete'].includes(finishReason)) return

  if (['length', 'max_tokens'].includes(finishReason)) {
    if (receivedText) {
      onChunk('\n\n（本次回复已达到模型单次输出上限，后续内容停止生成。可以拆成更具体的问题继续追问。）')
      return
    }
    throw new Error('AI 回复达到模型单次输出上限，未返回有效内容。请缩小问题范围后重试。')
  }

  if (['content_filter', 'safety', 'blocked'].includes(finishReason)) {
    throw new Error('AI 回复被安全策略提前终止，请调整问题后重试。')
  }

  throw new Error(`AI 回复被提前终止：${finishReason}`)
}

export async function callJsonCompletion(config: AiConfig, systemPrompt: string, userPrompt: string, signal?: AbortSignal, options: LlmJsonCompletionOptions = {}) {
  if (config.provider === 'anthropic-compatible') {
    const baseUrl = ensureApiBase(config.baseUrl)
    const res = await fetchLlm(thirdPartyApiUrls.llmMessages(baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        system: systemPrompt,
        temperature: config.temperature,
        max_tokens: ANTHROPIC_RESPONSE_TOKEN_LIMIT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal,
    }, {
      operation: 'llm.jsonCompletion',
      provider: config.provider,
      resource: config.model,
      metadata: options.logMetadata,
      failureLevel: options.logFailureLevel,
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`LLM 请求失败 (${res.status}): ${text.slice(0, 200)}`)
    }

    const payload = await res.json()
    const contentBlocks = payload?.content
    if (!Array.isArray(contentBlocks)) throw new Error('Anthropic 响应格式无效')
    const text = contentBlocks
      .map((block) => (block?.type === 'text' ? block.text : ''))
      .filter(Boolean)
      .join('\n')
      .trim()

    if (!text) throw new Error('LLM 未返回有效内容')
    return text
  }

  const baseUrl = ensureApiBase(config.baseUrl)
  const res = await fetchLlm(thirdPartyApiUrls.llmChatCompletions(baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
      body: JSON.stringify({
        model: config.model,
        temperature: config.temperature,
        ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
        response_format: { type: 'json_object' },
        messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal,
  }, {
    operation: 'llm.jsonCompletion',
    provider: config.provider,
    resource: config.model,
    metadata: options.logMetadata,
    failureLevel: options.logFailureLevel,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`LLM 请求失败 (${res.status}): ${text.slice(0, 200)}`)
  }

  const payload = await res.json()
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('LLM 未返回有效内容')
  return content
}

async function streamOpenAiCompatible(config: AiConfig, messages: LlmProviderMessage[], onChunk: (chunk: string) => void, signal?: AbortSignal) {
  const baseUrl = ensureApiBase(config.baseUrl)
  const res = await fetchLlm(thirdPartyApiUrls.llmChatCompletions(baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: config.temperature,
      stream: true,
      messages,
    }),
    signal,
  }, {
    operation: 'llm.streamCompletion',
    provider: config.provider,
    resource: config.model,
  })

  if (!res.ok || !res.body) {
    const text = await res.text()
    throw new Error(`LLM 请求失败 (${res.status}): ${text.slice(0, 200)}`)
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let finishReason: string | null = null
  let receivedText = false
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (!data || data === '[DONE]') continue
      const payload = parseStreamPayload(data)
      const providerError = getProviderErrorMessage(payload?.error)
      if (providerError) throw new Error(`LLM 流式返回错误：${providerError}`)

      const choice = payload?.choices?.[0]
      if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason

      const text = extractOpenAiStreamText(choice)
      if (text) {
        receivedText = true
        onChunk(text)
      }
    }
  }

  assertNormalFinish(finishReason, receivedText, onChunk)
}

async function streamAnthropicCompatible(config: AiConfig, messages: LlmProviderMessage[], onChunk: (chunk: string) => void, signal?: AbortSignal) {
  const baseUrl = ensureApiBase(config.baseUrl)
  const system = messages.find((message) => message.role === 'system')?.content ?? ''
  const rest = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    }))

  const res = await fetchLlm(thirdPartyApiUrls.llmMessages(baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      system,
      temperature: config.temperature,
      max_tokens: ANTHROPIC_RESPONSE_TOKEN_LIMIT,
      stream: true,
      messages: rest,
    }),
    signal,
  }, {
    operation: 'llm.streamCompletion',
    provider: config.provider,
    resource: config.model,
  })

  if (!res.ok || !res.body) {
    const text = await res.text()
    throw new Error(`LLM 请求失败 (${res.status}): ${text.slice(0, 200)}`)
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let finishReason: string | null = null
  let receivedText = false
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (!data) continue
      const payload = parseStreamPayload(data)
      const providerError = getProviderErrorMessage(payload?.error)
      if (providerError) throw new Error(`LLM 流式返回错误：${providerError}`)

      const text = payload?.delta?.text
      if (typeof text === 'string') {
        receivedText = true
        onChunk(text)
      }
      if (typeof payload?.delta?.stop_reason === 'string') finishReason = payload.delta.stop_reason
    }
  }

  assertNormalFinish(finishReason, receivedText, onChunk)
}

export async function streamCompletion(config: AiConfig, messages: LlmProviderMessage[], onChunk: (chunk: string) => void, signal?: AbortSignal) {
  if (config.provider === 'anthropic-compatible') {
    await streamAnthropicCompatible(config, messages, onChunk, signal)
    return
  }
  await streamOpenAiCompatible(config, messages, onChunk, signal)
}
