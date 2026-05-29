import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { NEXT_API_ROUTES } from '@/lib/api/endpoints'
import { resolveEffectiveAiConfig } from '@/lib/ai/config'
import { buildAnalysisTags, generatePortfolioAnalysis } from '@/lib/ai/service'
import { safeReadJsonBody } from '@/lib/api/request'
import { withApiLogging } from '@/lib/observability/api'
import { logger } from '@/lib/observability/logger'
import type { AiConfig, AppConfig, Stock } from '@/types'

type Body = {
  userId?: string
  stocks?: Stock[]
  aiConfig?: AiConfig
  totalCapital?: AppConfig['portfolio']['totalCapital']
  forceRefresh?: boolean
}

async function handlePOST(request: Request) {
  try {
    const payload = await safeReadJsonBody<Body>(request)
    if (!payload.ok) {
      return NextResponse.json({ error: payload.error }, { status: payload.status })
    }
    const body = payload.body
    if (!body.userId) {
      return NextResponse.json({ error: '缺少用户 ID' }, { status: 400 })
    }
    if (!Array.isArray(body.stocks)) {
      return NextResponse.json({ error: '缺少有效的持仓数据' }, { status: 400 })
    }
    if (!body.aiConfig) {
      return NextResponse.json({ error: '缺少 AI 配置' }, { status: 400 })
    }
    const result = await generatePortfolioAnalysis(
      body.stocks,
      resolveEffectiveAiConfig(body.aiConfig),
      body.forceRefresh === true,
      body.totalCapital ?? null,
    )
    try {
      const { saveAiAnalysis } = await import('@/lib/sqlite/db')
      saveAiAnalysis({
        id: randomUUID(),
        userId: body.userId,
        type: 'portfolio',
        stockId: null,
        stockCode: null,
        stockName: null,
        market: null,
        confidence: result.confidence,
        tags: buildAnalysisTags('portfolio', result.confidence, result.analysisStrength),
        generatedAt: result.generatedAt,
        result,
      })
    } catch (error) {
      logger.error('api.ai.portfolio-analysis.persist.failed', { error, userId: body.userId })
    }
    return NextResponse.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : '组合 AI 分析失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const POST = withApiLogging(NEXT_API_ROUTES.ai.portfolioAnalysis, handlePOST)
