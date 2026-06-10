import { NextResponse } from 'next/server'
import { NEXT_API_ROUTES } from '@/lib/api/endpoints'
import { safeReadJsonBody } from '@/lib/api/request'
import { resolveEffectiveAiConfig } from '@/lib/ai/config'
import { validateAiChatConfig } from '@/lib/ai/chat'
import { askFinancialsRag } from '@/lib/agent/financials/qa'
import { withApiLogging } from '@/lib/observability/api'
import type { AiConfig, Market } from '@/types'

type Body = {
  userId?: string
  symbol?: string
  market?: Market
  question?: string
  aiConfig?: AiConfig
}

async function handlePOST(request: Request) {
  const payload = await safeReadJsonBody<Body>(request)
  if (!payload.ok) return NextResponse.json({ error: payload.error }, { status: payload.status })
  const body = payload.body

  if (!body.userId) return NextResponse.json({ error: '缺少用户 ID' }, { status: 400 })
  const symbol = body.symbol?.trim()
  if (!symbol) return NextResponse.json({ error: '缺少标的代码' }, { status: 400 })
  if (!body.market) return NextResponse.json({ error: '缺少市场' }, { status: 400 })
  const question = body.question?.trim()
  if (!question) return NextResponse.json({ error: '缺少问题' }, { status: 400 })
  if (!body.aiConfig) return NextResponse.json({ error: '缺少 AI 配置' }, { status: 400 })

  const aiConfig = resolveEffectiveAiConfig(body.aiConfig)
  validateAiChatConfig(aiConfig)

  try {
    const result = await askFinancialsRag({
      userId: body.userId,
      symbol,
      market: body.market,
      question,
      config: aiConfig,
    })
    if (!result.retrieved) {
      const message = result.reason === 'embedding-unavailable'
        ? '当前 AI 配置不支持向量检索（embedding）。请配置 openai-compatible 的 embedding 端点后重试。'
        : result.reason === 'model-mismatch'
          ? 'embedding 模型已变更，原财报索引失效。请在财报分析页重新生成一次分析以重建索引。'
          : '尚未建立该标的的财报检索索引，请先在财报分析页上传或生成一次财报分析。'
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return NextResponse.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : '财报问答失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const POST = withApiLogging(NEXT_API_ROUTES.ai.financialQa, handlePOST)
