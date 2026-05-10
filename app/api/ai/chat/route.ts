import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { NEXT_API_ROUTES } from '@/lib/api/endpoints'
import { safeReadJsonBody } from '@/lib/api/request'
import { resolveEffectiveAiConfig } from '@/lib/ai/config'
import { buildChatTitle, estimateTokens, getContextStats, streamChatCompletion, validateAiChatConfig } from '@/lib/ai/chat'
import { executeAgentPlan } from '@/lib/agent/executor'
import { runAgent } from '@/lib/agent/runtime'
import { classifyTradeConfirmationIntent } from '@/lib/agent/tradeConfirmation'
import {
  buildClarificationQuestion,
  normalizeClarificationCandidates,
  normalizeClarificationState,
  resolveClarificationSelection,
} from '@/lib/agent/clarification'
import { withApiLogging } from '@/lib/observability/api'
import { logger } from '@/lib/observability/logger'
import { getAiChatSession, getSessionContext, listAiChatMessages, saveAiAgentRun, saveAiChatMessage, saveAiChatSession, setSessionContext, updateAiChatSessionTitle } from '@/lib/sqlite/db'
import type { AgentPlan, AgentResolvedSecurity } from '@/lib/agent/types'
import type { TradeRecordDraft } from '@/lib/agent/skills/tradeRecord'
import type { AiConfig, Market, Stock } from '@/types'

type Body = {
  userId?: string
  sessionId?: string
  message?: string
  stocks?: Stock[]
  aiConfig?: AiConfig
  externalStocks?: Array<{ symbol: string; market: Market }>
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeTradeRecordDraft(value: unknown): TradeRecordDraft | null {
  if (!isRecord(value)) return null
  if (!['BUY', 'SELL', 'DIVIDEND'].includes(String(value.type))) return null
  if (!value.date || !value.code || !value.name || !value.market) return null
  return value as unknown as TradeRecordDraft
}

function normalizeTradeRecordState(value: unknown) {
  if (!isRecord(value) || value.type !== 'trade_record_confirmation') return null
  const draft = normalizeTradeRecordDraft(value.draft)
  return draft ? { draft } : null
}

function tradeTypeLabel(type: TradeRecordDraft['type']) {
  if (type === 'BUY') return '买入'
  if (type === 'SELL') return '卖出'
  return '分红'
}

function formatTradeDraft(draft: TradeRecordDraft) {
  return [
    '我整理出的待录入数据如下，请核对：',
    '',
    `- 类型：${tradeTypeLabel(draft.type)}`,
    `- 标的：${draft.name}（${draft.code}，${draft.market}）`,
    `- 日期：${draft.date}`,
    `- 数量：${draft.quantity}`,
    `- 单价/单位到账：${draft.price}`,
    `- 成交/现金收益总额：${draft.totalAmount}`,
    `- 佣金：${draft.commission}`,
    `- 税费：${draft.tax}`,
    `- 净额：${draft.netAmount}`,
    draft.assumptions?.length ? `- 口径说明：${draft.assumptions.join('；')}` : '',
    '',
    '确认无误请回复“确认”；如果有错误，直接说明要改哪里。',
  ].filter(Boolean).join('\n')
}

function formatTradeRecorded(data: Record<string, unknown>) {
  const stock = isRecord(data.stock) ? data.stock : {}
  const trade = isRecord(data.trade) ? data.trade : {}
  return [
    '已录入数据库。',
    '',
    `- 标的：${stock.name ?? ''}（${stock.code ?? ''}，${stock.market ?? ''}）`,
    `- 类型：${tradeTypeLabel(String(trade.type) as TradeRecordDraft['type'])}`,
    `- 日期：${trade.date ?? ''}`,
    `- 数量：${trade.quantity ?? ''}`,
    `- 单价/单位到账：${trade.price ?? ''}`,
    `- 净额：${trade.netAmount ?? ''}`,
  ].join('\n')
}

async function handlePOST(request: Request) {
  const startedAt = Date.now()
  const payload = await safeReadJsonBody<Body>(request)
  if (!payload.ok) {
    return NextResponse.json({ error: payload.error }, { status: payload.status })
  }

  const body = payload.body
  if (!body.userId) return NextResponse.json({ error: '缺少用户 ID' }, { status: 400 })
  if (!body.aiConfig) return NextResponse.json({ error: '缺少 AI 配置' }, { status: 400 })
  if (!Array.isArray(body.stocks)) return NextResponse.json({ error: '缺少有效的持仓数据' }, { status: 400 })

  const userMessage = body.message?.trim()
  if (!userMessage) return NextResponse.json({ error: '请输入对话内容' }, { status: 400 })

  const effectiveAiConfig = resolveEffectiveAiConfig(body.aiConfig)

  try {
    validateAiChatConfig(effectiveAiConfig)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 配置无效'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const encoder = new TextEncoder()
  const sessionId = body.sessionId || randomUUID()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantContent = ''
      let contextMs = 0
      let firstTokenMs: number | null = null
      let agentRunId: string | null = null
      try {
        const existingSession = getAiChatSession(body.userId!, sessionId)
        if (!existingSession) {
          saveAiChatSession({
            id: sessionId,
            userId: body.userId!,
            title: buildChatTitle(userMessage),
            scope: 'portfolio',
          })
        }

        controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify({ phase: 'planning' })}\n\n`))

        const rawSessionContext = existingSession ? getSessionContext(body.userId!, sessionId) : null
        const pendingTradeRecord = normalizeTradeRecordState(rawSessionContext)
        const tradeConfirmationIntent = pendingTradeRecord
          ? await classifyTradeConfirmationIntent({
            message: userMessage,
            draft: pendingTradeRecord.draft,
            aiConfig: effectiveAiConfig,
          })
          : null

        if (pendingTradeRecord && tradeConfirmationIntent === 'cancel') {
          setSessionContext(body.userId!, sessionId, null)
          const answer = '已取消本次录入，未写入数据库。'
          const userMessageId = randomUUID()
          const plan: AgentPlan = {
            intent: 'trade_record',
            entities: [],
            requiredSkills: [],
            responseMode: 'answer',
          }
          const skillResults = [{
            skillName: 'trade.prepareRecord',
            ok: true,
            data: { status: 'cancelled' },
          }]
          const stats = getContextStats(estimateTokens(userMessage) + estimateTokens(answer), effectiveAiConfig.maxContextTokens || 128000)
          const contextSnapshot = {
            generatedAt: new Date().toISOString(),
            agent: { version: 2, intent: plan.intent, responseMode: plan.responseMode, entities: [], requiredSkills: [] },
            skillResults,
          }
          saveAiChatMessage({ id: userMessageId, sessionId, userId: body.userId!, role: 'user', content: userMessage, contextSnapshot, tokenEstimate: estimateTokens(userMessage) })
          saveAiAgentRun({ id: randomUUID(), sessionId, userId: body.userId!, messageId: userMessageId, intent: plan.intent, responseMode: plan.responseMode, plan: plan as unknown as Record<string, unknown>, skillCalls: [], skillResults, contextStats: stats as unknown as Record<string, unknown> })
          saveAiChatMessage({ id: randomUUID(), sessionId, userId: body.userId!, role: 'assistant', content: answer, contextSnapshot, tokenEstimate: estimateTokens(answer) })
          controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({ sessionId, stats, timings: { contextMs }, agent: { intent: plan.intent, responseMode: plan.responseMode, skillCount: skillResults.length } })}\n\n`))
          controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify({ phase: 'generating' })}\n\n`))
          controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ token: answer })}\n\n`))
          controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ sessionId, timings: { contextMs, firstTokenMs: Date.now() - startedAt, totalMs: Date.now() - startedAt } })}\n\n`))
          controller.close()
          return
        }

        if (pendingTradeRecord && tradeConfirmationIntent === 'confirm') {
          const plan: AgentPlan = {
            intent: 'trade_record',
            entities: [],
            requiredSkills: [{ name: 'trade.commitRecord', args: { draft: pendingTradeRecord.draft }, reason: '用户已明确确认待录入草稿无误。' }],
            responseMode: 'answer',
          }
          const contextStartedAt = Date.now()
          const skillResults = await executeAgentPlan(plan, {
            userId: body.userId!,
            sessionId,
            stocks: body.stocks!,
            aiConfig: effectiveAiConfig,
            maxContextTokens: Math.max(4096, effectiveAiConfig.maxContextTokens || 128000),
            allowedScopes: ['stock.read', 'trade.write'],
          })
          contextMs = Date.now() - contextStartedAt
          const commitData = skillResults.find((result) => result.skillName === 'trade.commitRecord' && result.ok)?.data
          const answer = isRecord(commitData)
            ? formatTradeRecorded(commitData)
            : `录入失败：${skillResults.find((result) => !result.ok)?.error ?? '未知错误'}`
          if (isRecord(commitData)) setSessionContext(body.userId!, sessionId, null)
          const userMessageId = randomUUID()
          const stats = getContextStats(estimateTokens(JSON.stringify(skillResults)) + estimateTokens(userMessage) + estimateTokens(answer), effectiveAiConfig.maxContextTokens || 128000)
          const contextSnapshot = {
            generatedAt: new Date().toISOString(),
            agent: { version: 2, intent: plan.intent, responseMode: plan.responseMode, entities: [], requiredSkills: plan.requiredSkills },
            skillResults,
          }
          saveAiChatMessage({ id: userMessageId, sessionId, userId: body.userId!, role: 'user', content: userMessage, contextSnapshot, tokenEstimate: estimateTokens(userMessage) })
          saveAiAgentRun({ id: randomUUID(), sessionId, userId: body.userId!, messageId: userMessageId, intent: plan.intent, responseMode: plan.responseMode, plan: plan as unknown as Record<string, unknown>, skillCalls: plan.requiredSkills, skillResults, contextStats: stats as unknown as Record<string, unknown> })
          saveAiChatMessage({ id: randomUUID(), sessionId, userId: body.userId!, role: 'assistant', content: answer, contextSnapshot, tokenEstimate: estimateTokens(answer) })
          controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({ sessionId, stats, timings: { contextMs }, agent: { intent: plan.intent, responseMode: plan.responseMode, skillCount: skillResults.length } })}\n\n`))
          controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify({ phase: 'generating' })}\n\n`))
          controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ token: answer })}\n\n`))
          controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ sessionId, dataChanged: isRecord(commitData), timings: { contextMs, firstTokenMs: Date.now() - startedAt, totalMs: Date.now() - startedAt } })}\n\n`))
          controller.close()
          return
        }

        if (pendingTradeRecord && tradeConfirmationIntent === 'unknown') {
          const answer = '我还没有判断出你是要确认、取消，还是更正这条记录。确认无误请回复“确认”；如果要修改，直接说明要改的字段；如果不录入，请回复“取消”。'
          const userMessageId = randomUUID()
          const plan: AgentPlan = {
            intent: 'trade_record',
            entities: [],
            requiredSkills: [],
            responseMode: 'answer',
          }
          const skillResults = [{
            skillName: 'trade.confirmation.classify',
            ok: true,
            data: { status: 'unknown' },
          }]
          const stats = getContextStats(estimateTokens(userMessage) + estimateTokens(answer), effectiveAiConfig.maxContextTokens || 128000)
          const contextSnapshot = {
            generatedAt: new Date().toISOString(),
            agent: { version: 2, intent: plan.intent, responseMode: plan.responseMode, entities: [], requiredSkills: [] },
            skillResults,
          }
          saveAiChatMessage({ id: userMessageId, sessionId, userId: body.userId!, role: 'user', content: userMessage, contextSnapshot, tokenEstimate: estimateTokens(userMessage) })
          saveAiAgentRun({ id: randomUUID(), sessionId, userId: body.userId!, messageId: userMessageId, intent: plan.intent, responseMode: plan.responseMode, plan: plan as unknown as Record<string, unknown>, skillCalls: [], skillResults, contextStats: stats as unknown as Record<string, unknown> })
          saveAiChatMessage({ id: randomUUID(), sessionId, userId: body.userId!, role: 'assistant', content: answer, contextSnapshot, tokenEstimate: estimateTokens(answer) })
          controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({ sessionId, stats, timings: { contextMs }, agent: { intent: plan.intent, responseMode: plan.responseMode, skillCount: skillResults.length } })}\n\n`))
          controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify({ phase: 'generating' })}\n\n`))
          controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ token: answer })}\n\n`))
          controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ sessionId, timings: { contextMs, firstTokenMs: Date.now() - startedAt, totalMs: Date.now() - startedAt } })}\n\n`))
          controller.close()
          return
        }

        if (pendingTradeRecord) {
          const plan: AgentPlan = {
            intent: 'trade_record',
            entities: [],
            requiredSkills: [{
              name: 'trade.prepareRecord',
              args: { correctionText: userMessage, previousDraft: pendingTradeRecord.draft },
              reason: '用户正在更正待确认的交易或分红草稿。',
            }],
            responseMode: 'answer',
          }
          const contextStartedAt = Date.now()
          const skillResults = await executeAgentPlan(plan, {
            userId: body.userId!,
            sessionId,
            stocks: body.stocks!,
            aiConfig: effectiveAiConfig,
            maxContextTokens: Math.max(4096, effectiveAiConfig.maxContextTokens || 128000),
            allowedScopes: ['stock.read', 'trade.read'],
          })
          contextMs = Date.now() - contextStartedAt
          const prepareData = skillResults.find((result) => result.skillName === 'trade.prepareRecord' && result.ok)?.data
          let answer = '我还不能确认要录入的数据，请继续补充。'
          if (isRecord(prepareData) && prepareData.status === 'pending_confirmation') {
            const draft = normalizeTradeRecordDraft(prepareData.draft)
            if (draft) {
              setSessionContext(body.userId!, sessionId, { type: 'trade_record_confirmation', draft })
              answer = formatTradeDraft(draft)
            }
          } else if (isRecord(prepareData) && prepareData.status === 'needs_more_info') {
            const missing = Array.isArray(prepareData.missing) ? prepareData.missing.join('、') : '关键信息'
            answer = `还需要补充：${missing}。`
          }
          const userMessageId = randomUUID()
          const stats = getContextStats(estimateTokens(JSON.stringify(skillResults)) + estimateTokens(userMessage) + estimateTokens(answer), effectiveAiConfig.maxContextTokens || 128000)
          const contextSnapshot = {
            generatedAt: new Date().toISOString(),
            agent: { version: 2, intent: plan.intent, responseMode: plan.responseMode, entities: [], requiredSkills: plan.requiredSkills },
            skillResults,
          }
          saveAiChatMessage({ id: userMessageId, sessionId, userId: body.userId!, role: 'user', content: userMessage, contextSnapshot, tokenEstimate: estimateTokens(userMessage) })
          saveAiAgentRun({ id: randomUUID(), sessionId, userId: body.userId!, messageId: userMessageId, intent: plan.intent, responseMode: plan.responseMode, plan: plan as unknown as Record<string, unknown>, skillCalls: plan.requiredSkills, skillResults, contextStats: stats as unknown as Record<string, unknown> })
          saveAiChatMessage({ id: randomUUID(), sessionId, userId: body.userId!, role: 'assistant', content: answer, contextSnapshot, tokenEstimate: estimateTokens(answer) })
          controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({ sessionId, stats, timings: { contextMs }, agent: { intent: plan.intent, responseMode: plan.responseMode, skillCount: skillResults.length } })}\n\n`))
          controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify({ phase: 'generating' })}\n\n`))
          controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ token: answer })}\n\n`))
          controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ sessionId, timings: { contextMs, firstTokenMs: Date.now() - startedAt, totalMs: Date.now() - startedAt } })}\n\n`))
          controller.close()
          return
        }

        // 检查是否有待澄清的状态（多轮）。候选选择由 LLM 在对话内判断；
        // 识别不到时继续追问，不通过 UI 弹窗阻断对话。
        const pending = normalizeClarificationState(rawSessionContext)
        let externalStocks = body.externalStocks ?? []
        let resolvedSecurities: AgentResolvedSecurity[] = []
        let agentUserMessage = userMessage
        if (pending) {
          const resolution = await resolveClarificationSelection({
            userMessage,
            pending,
            aiConfig: effectiveAiConfig,
          })

          if (resolution.status === 'selected') {
            const candidate = resolution.candidate
            resolvedSecurities = [{
              symbol: candidate.code,
              market: candidate.market,
              name: candidate.name,
              stockId: candidate.stockId,
              inPortfolio: candidate.inPortfolio,
            }]
            if (pending.originalUserMessage) {
              agentUserMessage = `${pending.originalUserMessage}\n用户澄清选择：${userMessage}`
            }
            setSessionContext(body.userId!, sessionId, null)
          } else if (resolution.status === 'new_question') {
            setSessionContext(body.userId!, sessionId, null)
          } else {
            const candidates = normalizeClarificationCandidates(pending.candidates)
            const question = resolution.question || buildClarificationQuestion(candidates, pending.question)
            setSessionContext(body.userId!, sessionId, { ...pending, question })

            agentRunId = randomUUID()
            const userMessageId = randomUUID()
            const plan: AgentPlan = {
              intent: 'stock_analysis',
              entities: candidates.map((candidate) => ({
                type: 'stock',
                raw: candidate.name || candidate.code,
                code: candidate.code,
                name: candidate.name,
                market: candidate.market,
                stockId: candidate.stockId,
                confidence: candidate.confidence ?? 0.5,
              })),
              requiredSkills: [],
              responseMode: 'clarify',
              clarifyQuestion: question,
            }
            const skillResults = [{
              skillName: 'agent.clarify',
              ok: true,
              data: { question, candidates, reason: resolution.reason ?? null },
            }]
            const contextSnapshot = {
              generatedAt: new Date().toISOString(),
              agent: {
                version: 2,
                intent: plan.intent,
                responseMode: plan.responseMode,
                entities: plan.entities,
                requiredSkills: plan.requiredSkills,
              },
              skillResults,
            }
            const stats = getContextStats(
              estimateTokens(JSON.stringify(contextSnapshot)) + estimateTokens(userMessage) + estimateTokens(question),
              effectiveAiConfig.maxContextTokens || 128000,
            )

            saveAiChatMessage({
              id: userMessageId,
              sessionId,
              userId: body.userId!,
              role: 'user',
              content: userMessage,
              contextSnapshot,
              tokenEstimate: estimateTokens(userMessage),
            })
            saveAiAgentRun({
              id: agentRunId,
              sessionId,
              userId: body.userId!,
              messageId: userMessageId,
              intent: plan.intent,
              responseMode: plan.responseMode,
              plan: plan as unknown as Record<string, unknown>,
              skillCalls: plan.requiredSkills,
              skillResults,
              contextStats: stats as unknown as Record<string, unknown>,
            })
            saveAiChatMessage({
              id: randomUUID(),
              sessionId,
              userId: body.userId!,
              role: 'assistant',
              content: question,
              contextSnapshot,
              tokenEstimate: estimateTokens(question),
            })

            if (existingSession && existingSession.title === '新对话') {
              updateAiChatSessionTitle(body.userId!, sessionId, buildChatTitle(userMessage))
            }

            firstTokenMs = Date.now() - startedAt
            assistantContent = question
            controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({
              sessionId,
              stats,
              timings: { contextMs },
              agent: {
                runId: agentRunId,
                intent: plan.intent,
                responseMode: plan.responseMode,
                skillCount: skillResults.length,
              },
            })}\n\n`))
            controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify({ phase: 'generating' })}\n\n`))
            controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ token: question })}\n\n`))
            controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({
              sessionId,
              runId: agentRunId,
              timings: { contextMs, firstTokenMs, totalMs: Date.now() - startedAt },
            })}\n\n`))
            controller.close()
            return
          }
        }

        const history = listAiChatMessages(body.userId!, sessionId)

        const contextStartedAt = Date.now()
        const agent = await runAgent({
          userId: body.userId!,
          sessionId,
          aiConfig: effectiveAiConfig,
          stocks: body.stocks!,
          history,
          userMessage: agentUserMessage,
          resolvedSecurities,
          externalStocks,
        })
        contextMs = Date.now() - contextStartedAt
        agentRunId = randomUUID()

        const userMessageId = randomUUID()
        saveAiChatMessage({
          id: userMessageId,
          sessionId,
          userId: body.userId!,
          role: 'user',
          content: userMessage,
          contextSnapshot: agent.contextSnapshot,
          tokenEstimate: estimateTokens(userMessage),
        })
        saveAiAgentRun({
          id: agentRunId,
          sessionId,
          userId: body.userId!,
          messageId: userMessageId,
          intent: agent.plan.intent,
          responseMode: agent.plan.responseMode,
          plan: agent.plan as unknown as Record<string, unknown>,
          skillCalls: agent.plan.requiredSkills,
          skillResults: agent.skillResults,
          contextStats: agent.stats as unknown as Record<string, unknown>,
        })

        // 如果是澄清模式，保存候选列表供下一轮消费
        if (agent.plan.responseMode === 'clarify') {
          const candidatesResult = agent.skillResults.find((r) => r.skillName === 'security.resolve')
            ?? agent.skillResults.find((r) => r.skillName === 'market.resolveCandidate')
          if (candidatesResult?.ok && candidatesResult.data) {
            const data = candidatesResult.data as { candidates?: unknown }
            const candidates = normalizeClarificationCandidates(data.candidates)
            if (candidates.length) {
              const question = agent.plan.clarifyQuestion || buildClarificationQuestion(candidates)
              setSessionContext(body.userId!, sessionId, {
                type: 'clarify',
                candidates,
                question,
                originalUserMessage: userMessage,
              })
            }
          }
        }

        const tradePrepareResult = agent.skillResults.find((r) => r.skillName === 'trade.prepareRecord')
        if (tradePrepareResult?.ok && isRecord(tradePrepareResult.data)) {
          const draft = normalizeTradeRecordDraft(tradePrepareResult.data.draft)
          if (tradePrepareResult.data.status === 'pending_confirmation' && draft) {
            setSessionContext(body.userId!, sessionId, {
              type: 'trade_record_confirmation',
              draft,
            })
          }
        }

        if (existingSession && existingSession.title === '新对话') {
          updateAiChatSessionTitle(body.userId!, sessionId, buildChatTitle(userMessage))
        }

        controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({
          sessionId,
          stats: agent.stats,
          timings: { contextMs },
          agent: {
            runId: agentRunId,
            intent: agent.plan.intent,
            responseMode: agent.plan.responseMode,
            skillCount: agent.skillResults.length,
          },
        })}\n\n`))
        controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify({ phase: 'generating' })}\n\n`))

        await streamChatCompletion(effectiveAiConfig, agent.messages, (chunk) => {
          if (firstTokenMs === null) {
            firstTokenMs = Date.now() - startedAt
          }
          assistantContent += chunk
          controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ token: chunk })}\n\n`))
        }, request.signal)

        if (!assistantContent.trim()) {
          throw new Error('AI 未返回有效内容')
        }

        saveAiChatMessage({
          id: randomUUID(),
          sessionId,
          userId: body.userId!,
          role: 'assistant',
          content: assistantContent,
          contextSnapshot: agent.contextSnapshot,
          tokenEstimate: estimateTokens(assistantContent),
        })

        const totalMs = Date.now() - startedAt
        logger.info('api.ai.chat.stream.done', {
          sessionId,
          contextMs,
          firstTokenMs,
          totalMs,
          holdings: body.stocks?.length ?? 0,
          externalStocks: body.externalStocks?.length ?? 0,
          intent: agent.plan.intent,
          skillCount: agent.skillResults.length,
          provider: effectiveAiConfig.provider,
          model: effectiveAiConfig.model,
        })
        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify({ sessionId, runId: agentRunId, timings: { contextMs, firstTokenMs, totalMs } })}\n\n`))
        controller.close()
      } catch (error) {
        if (request.signal.aborted || isAbortError(error)) {
          logger.info('api.ai.chat.stream.aborted', {
            sessionId,
            contextMs,
            firstTokenMs,
            totalMs: Date.now() - startedAt,
            assistantChars: assistantContent.length,
          })
          if (assistantContent.trim()) {
            saveAiChatMessage({
              id: randomUUID(),
              sessionId,
              userId: body.userId!,
              role: 'assistant',
              content: assistantContent,
              contextSnapshot: null,
              tokenEstimate: estimateTokens(assistantContent),
            })
          }
          try {
            controller.close()
          } catch {
            // 客户端主动断开时 stream 可能已经关闭。
          }
          return
        }
        logger.error('api.ai.chat.stream.failed', {
          error,
          sessionId,
          contextMs,
          firstTokenMs,
          totalMs: Date.now() - startedAt,
          assistantChars: assistantContent.length,
        })
        const message = error instanceof Error ? error.message : 'AI 对话失败'
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}

export const POST = withApiLogging(NEXT_API_ROUTES.ai.chat, handlePOST)
