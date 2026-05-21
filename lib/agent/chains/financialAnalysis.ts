import { ChatPromptTemplate } from '@langchain/core/prompts'
import { ChatOpenAI } from '@langchain/openai'
import { callJsonCompletion } from '@/lib/external/llmProvider'
import { buildFinancialAnalysisUserPrompt, FINANCIAL_ANALYSIS_SYSTEM_PROMPT } from '@/lib/agent/financials/prompts'
import {
  buildFallbackFinancialAnalysis,
  financialAnalysisSchema,
  normalizeFinancialAnalysis,
  type FinancialAnalysis,
  type FinancialAnalysisInput,
} from '@/lib/agent/financials/schema'
import type { AiConfig } from '@/types'

const FINANCIAL_ANALYSIS_TIMEOUT_MS = 20_000

export type FinancialAnalysisChainResult = {
  analysis: FinancialAnalysis
  provider: 'langchain-openai' | 'native-json'
  degraded: boolean
  error?: string
}

function ensureApiBase(baseUrl: string) {
  const normalized = baseUrl.replace(/\/$/, '')
  if (!normalized) throw new Error('请先配置 AI Base URL')
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`
}

function compactInput(input: FinancialAnalysisInput) {
  return {
    ...input,
    documents: input.documents.slice(0, 5).map((doc) => ({
      ...doc,
      excerpt: doc.excerpt.length > 2500 ? `${doc.excerpt.slice(0, 2500)}\n[内容已截断]` : doc.excerpt,
    })),
  }
}

function parseJsonObject(raw: string) {
  const trimmed = raw.trim()
  const normalizeParsed = (value: unknown) => {
    if (Array.isArray(value)) {
      const firstObject = value.find((item) => item && typeof item === 'object' && !Array.isArray(item))
      if (firstObject) return firstObject
    }
    return value
  }

  try {
    return normalizeParsed(JSON.parse(trimmed))
  } catch {
    const arrayMatch = trimmed.match(/\[[\s\S]*\]/)
    if (arrayMatch) return normalizeParsed(JSON.parse(arrayMatch[0]))
    const objectMatch = trimmed.match(/\{[\s\S]*\}/)
    if (!objectMatch) throw new Error('模型未返回 JSON 对象')
    return JSON.parse(objectMatch[0])
  }
}

function shortChainError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (/Failed to parse|OUTPUT_PARSING_FAILURE|Expected object|received array|invalid_type/i.test(message)) {
    return '模型返回的结构化 JSON 格式不符合预期，已使用可用财报字段降级展示。'
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|timeout|timed out|aborted/i.test(message)) {
    return '财报分析模型暂时不可用，已使用可用财报字段降级展示。'
  }
  return '财报分析链暂时不可用，已使用可用财报字段降级展示。'
}

async function analyzeWithLangChain(input: FinancialAnalysisInput, config: AiConfig) {
  const llm = new ChatOpenAI({
    model: config.model,
    temperature: config.temperature,
    apiKey: config.apiKey,
    timeout: FINANCIAL_ANALYSIS_TIMEOUT_MS,
    configuration: {
      baseURL: ensureApiBase(config.baseUrl),
    },
  })

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', FINANCIAL_ANALYSIS_SYSTEM_PROMPT],
    ['human', '{input}'],
  ])
  const structured = llm.withStructuredOutput(financialAnalysisSchema, {
    name: 'financial_analysis',
    method: 'jsonMode',
  })
  const chain = prompt.pipe(structured)
  const result = await chain.invoke({
    input: buildFinancialAnalysisUserPrompt(JSON.stringify(compactInput(input))),
  })
  return normalizeFinancialAnalysis(result, input)
}

async function analyzeWithNativeJson(input: FinancialAnalysisInput, config: AiConfig) {
  const raw = await callJsonCompletion(
    config,
    FINANCIAL_ANALYSIS_SYSTEM_PROMPT,
    buildFinancialAnalysisUserPrompt(JSON.stringify(compactInput(input))),
    AbortSignal.timeout(FINANCIAL_ANALYSIS_TIMEOUT_MS),
    {
      logFailureLevel: 'info',
      logMetadata: {
        chain: 'financialAnalysis',
        symbol: input.security.symbol,
        market: input.security.market,
      },
    },
  )
  return normalizeFinancialAnalysis(parseJsonObject(raw), input)
}

export async function runFinancialAnalysisChain(input: FinancialAnalysisInput, config: AiConfig): Promise<FinancialAnalysisChainResult> {
  if (config.provider === 'openai-compatible') {
    try {
      return {
        analysis: await analyzeWithLangChain(input, config),
        provider: 'langchain-openai',
        degraded: false,
      }
    } catch (langChainError) {
      try {
        return {
          analysis: await analyzeWithNativeJson(input, config),
          provider: 'native-json',
          degraded: true,
          error: 'LangChain 结构化解析失败，已切换到 JSON 回退链路。',
        }
      } catch (nativeError) {
        const message = shortChainError(nativeError instanceof Error ? nativeError : langChainError)
        return {
          analysis: buildFallbackFinancialAnalysis(input, message),
          provider: 'langchain-openai',
          degraded: true,
          error: message,
        }
      }
    }
  }

  try {
    return {
      analysis: await analyzeWithNativeJson(input, config),
      provider: 'native-json',
      degraded: false,
    }
  } catch (error) {
    const message = shortChainError(error)
    return {
      analysis: buildFallbackFinancialAnalysis(input, message),
      provider: 'native-json',
      degraded: true,
      error: message,
    }
  }
}
