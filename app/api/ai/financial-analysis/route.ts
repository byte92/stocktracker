import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { NEXT_API_ROUTES } from '@/lib/api/endpoints'
import { marketSupportsValuation } from '@/config/defaults'
import { safeReadJsonBody } from '@/lib/api/request'
import { resolveEffectiveAiConfig } from '@/lib/ai/config'
import { validateAiChatConfig } from '@/lib/ai/chat'
import { stockGetFinancialsSkill } from '@/lib/agent/skills/stock'
import { parseFinancialUploads } from '@/lib/agent/financials/uploads'
import { withApiLogging } from '@/lib/observability/api'
import { logger } from '@/lib/observability/logger'
import type { AiConfig, Market, Stock } from '@/types'

type Body = {
  userId?: string
  stocks?: Stock[]
  aiConfig?: AiConfig
  symbol?: string
  market?: Market
  researchQuery?: string
}

function parseJsonField<T>(value: FormDataEntryValue | null, field: string): T | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    return JSON.parse(value) as T
  } catch {
    throw new Error(`字段 ${field} 不是有效 JSON`)
  }
}

async function readRequestBody(request: Request) {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    const payload = await safeReadJsonBody<Body>(request)
    if (!payload.ok) return { ok: false as const, response: NextResponse.json({ error: payload.error }, { status: payload.status }) }
    return { ok: true as const, body: payload.body, documents: [], uploadErrors: [] }
  }

  const form = await request.formData()
  const body: Body = {
    userId: typeof form.get('userId') === 'string' ? String(form.get('userId')) : undefined,
    stocks: parseJsonField<Stock[]>(form.get('stocks'), 'stocks'),
    aiConfig: parseJsonField<AiConfig>(form.get('aiConfig'), 'aiConfig'),
    symbol: typeof form.get('symbol') === 'string' ? String(form.get('symbol')) : undefined,
    market: typeof form.get('market') === 'string' ? String(form.get('market')) as Market : undefined,
    researchQuery: typeof form.get('researchQuery') === 'string' ? String(form.get('researchQuery')) : undefined,
  }
  const files = form.getAll('files').filter((item): item is File => item instanceof File)
  const parsed = await parseFinancialUploads(files)
  return { ok: true as const, body, documents: parsed.documents, uploadErrors: parsed.errors }
}

async function handlePOST(request: Request) {
  try {
    const payload = await readRequestBody(request)
    if (!payload.ok) return payload.response

    const body = payload.body
    if (!body.userId) return NextResponse.json({ error: '缺少用户 ID' }, { status: 400 })
    if (!Array.isArray(body.stocks)) return NextResponse.json({ error: '缺少有效的持仓数据' }, { status: 400 })
    if (!body.aiConfig) return NextResponse.json({ error: '缺少 AI 配置' }, { status: 400 })

    const symbol = body.symbol?.trim()
    if (!symbol) return NextResponse.json({ error: '缺少标的代码' }, { status: 400 })
    if (!body.market) return NextResponse.json({ error: '缺少市场' }, { status: 400 })
    if (!marketSupportsValuation(body.market, symbol)) {
      return NextResponse.json({ error: '基金、ETF、加密资产等产品本身没有公司财报，无法进行财报分析。可以改问持仓表现、跟踪指数、费率、净值或组合风险。' }, { status: 400 })
    }

    const aiConfig = resolveEffectiveAiConfig(body.aiConfig)
    validateAiChatConfig(aiConfig)

    const result = await stockGetFinancialsSkill.execute({
      symbol,
      market: body.market,
      researchQuery: body.researchQuery || `${symbol} 最新财报 业绩 营收 利润 现金流`,
      documents: payload.documents,
    }, {
      userId: body.userId,
      sessionId: 'financial-analysis-page',
      stocks: body.stocks,
      aiConfig,
      maxContextTokens: Math.max(4096, aiConfig.maxContextTokens || 128000),
      allowedScopes: ['stock.read', 'quote.read', 'network.fetch'],
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? '财报分析失败' }, { status: 500 })
    }

    const analysisId = randomUUID()
    try {
      const data = result.data
      const stock = body.stocks.find((item) => item.code.toUpperCase() === symbol.toUpperCase() && item.market === body.market)
      const { saveAiAnalysis } = await import('@/lib/sqlite/db')
      saveAiAnalysis({
        id: analysisId,
        userId: body.userId,
        type: 'financial',
        stockId: stock?.id ?? null,
        stockCode: symbol,
        stockName: stock?.name ?? data?.analysis?.companyName ?? null,
        market: body.market,
        confidence: data?.analysis?.confidence ?? 'medium',
        tags: [
          '财报分析',
          body.market,
          data?.chain?.degraded ? '降级' : data?.chain?.provider ?? 'analysis',
          ...(payload.documents.length ? ['手动上传'] : []),
        ],
        generatedAt: new Date().toISOString(),
        result: data as unknown as Record<string, unknown>,
      })
    } catch (error) {
      logger.error('api.ai.financial-analysis.persist.failed', { error, userId: body.userId, symbol, market: body.market })
    }

    // RAG 二阶段：把财报文档向量化落库，供后续多轮问答检索。
    // 真正的 fire-and-forget：不 await，索引在后台完成，绝不增加分析响应延迟；失败仅记录日志。
    const documentsToIndex = result.data?.documents ?? []
    if (documentsToIndex.length) {
      const indexUserId = body.userId
      const indexMarket = body.market
      void (async () => {
        try {
          const { indexFinancialDocuments } = await import('@/lib/agent/financials/qa')
          await indexFinancialDocuments({
            userId: indexUserId,
            analysisId,
            symbol,
            market: indexMarket,
            documents: documentsToIndex,
            config: aiConfig,
          })
        } catch (error) {
          logger.error('api.ai.financial-analysis.index.failed', { error, userId: indexUserId, symbol, market: indexMarket })
        }
      })()
    }

    return NextResponse.json({ result: result.data, uploadErrors: payload.uploadErrors })
  } catch (error) {
    const message = error instanceof Error ? error.message : '财报分析失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const POST = withApiLogging(NEXT_API_ROUTES.ai.financialAnalysis, handlePOST)
