import { callJsonCompletion } from '@/lib/external/llmProvider'
import { getSkillByName } from '@/lib/agent/skills/registry'
import type { TradeRecordDraft } from '@/lib/agent/skills/tradeRecord'
import type { AiConfig } from '@/types'

export type TradeConfirmationIntent = 'confirm' | 'cancel' | 'revise' | 'unknown'

const TRADE_CONFIRMATION_TIMEOUT_MS = 4_000

function stripJsonFence(raw: string) {
  return raw.replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim()
}

function normalizeIntent(value: unknown): TradeConfirmationIntent {
  if (value === 'confirm' || value === 'cancel' || value === 'revise' || value === 'unknown') return value
  return 'unknown'
}

function buildDraftSummary(draft: TradeRecordDraft) {
  return {
    type: draft.type,
    date: draft.date,
    code: draft.code,
    name: draft.name,
    market: draft.market,
    price: draft.price,
    quantity: draft.quantity,
    commission: draft.commission,
    tax: draft.tax,
    totalAmount: draft.totalAmount,
    netAmount: draft.netAmount,
    assumptions: draft.assumptions,
  }
}

function getTradeCommitSkillInstructions() {
  return getSkillByName('trade.commitRecord')?.documentation
    ?? [
      'trade.commitRecord 只能在用户明确确认待录入草稿无误后执行。',
      'cancel 表示取消不写入；revise 表示继续整理草稿；unknown 表示继续追问。',
      '模型判断失败或置信度不足时不得写入。',
    ].join('\n')
}

export async function classifyTradeConfirmationIntent({
  message,
  draft,
  aiConfig,
}: {
  message: string
  draft: TradeRecordDraft
  aiConfig: AiConfig
}): Promise<TradeConfirmationIntent> {
  if (!aiConfig.enabled || !aiConfig.baseUrl || !aiConfig.model || !aiConfig.apiKey) {
    throw new Error('AI 模型未配置，无法判断本次确认意图。请先完成 AI 配置后再确认录入。')
  }

  const systemPrompt = [
    '你是 StockTracker 的交易录入确认意图分类器。',
    '你的任务是根据 trade.commitRecord Skill 的安全规则，判断用户对一条待确认交易/分红草稿的回复属于哪一类。',
    '只输出 JSON，不要输出解释文字。',
    'JSON 格式：{"intent":"confirm|cancel|revise|unknown","confidence":0到1,"reason":"简短原因"}',
    '',
    '以下是必须遵守的 Skill 规则：',
    getTradeCommitSkillInstructions(),
  ].join('\n')

  const userPrompt = [
    '待确认草稿：',
    JSON.stringify(buildDraftSummary(draft)),
    '',
    `用户回复：${message}`,
  ].join('\n')

  try {
    const raw = await callJsonCompletion(aiConfig, systemPrompt, userPrompt, AbortSignal.timeout(TRADE_CONFIRMATION_TIMEOUT_MS), {
      reasoningEffort: 'none',
      logFailureLevel: 'info',
      logMetadata: {
        phase: 'trade.confirmation.classify',
        optional: true,
        timeoutMs: TRADE_CONFIRMATION_TIMEOUT_MS,
      },
    })
    const parsed = JSON.parse(stripJsonFence(raw)) as Record<string, unknown>
    const intent = normalizeIntent(parsed.intent)
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0
    if (confidence < 0.55) {
      throw new Error('AI 对确认意图判断置信度不足，请更明确地回复确认、取消或说明要更正的字段。')
    }
    return intent
  } catch (error) {
    if (error instanceof Error && error.message.includes('置信度不足')) throw error
    throw new Error(`AI 确认意图判断失败：${error instanceof Error ? error.message : '未知错误'}`)
  }
}
