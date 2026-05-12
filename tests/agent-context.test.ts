import test from 'node:test'
import assert from 'node:assert/strict'
import { composeAgentContext } from '@/lib/agent/context'
import type { AgentPlan, AgentSkillResult } from '@/lib/agent/types'
import type { AiConfig } from '@/types'

const mockAiConfig: AiConfig = {
  enabled: true,
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:8080/v1',
  model: 'test-model',
  apiKey: 'test-key',
  temperature: 0,
  maxContextTokens: 4096,
  newsEnabled: false,
  analysisLanguage: 'zh-CN',
}

test('agent context compresses oversized skill results before sending them to the model', () => {
  const plan: AgentPlan = {
    intent: 'market_question',
    entities: [],
    requiredSkills: [{ name: 'web.fetch', args: { url: 'https://finance.yahoo.com' }, reason: '抓取页面' }],
    responseMode: 'answer',
  }
  const hugeBody = `${'正文'.repeat(6000)}TAIL_MARKER`
  const skillResults: AgentSkillResult[] = [{
    skillName: 'web.fetch',
    ok: true,
    data: {
      url: 'https://finance.yahoo.com',
      status: 200,
      body: hugeBody,
    },
  }]

  const result = composeAgentContext({
    aiConfig: mockAiConfig,
    history: [],
    userMessage: '总结一下这个页面',
    plan,
    skillResults,
  })
  const context = result.messages[1]?.content ?? ''

  assert.match(context, /内容已截断/)
  assert.doesNotMatch(context, /TAIL_MARKER/)
  assert.ok(context.length < hugeBody.length)
})

test('agent context tells answer model not to expose internal skill identifiers', () => {
  const plan: AgentPlan = {
    intent: 'portfolio_summary',
    entities: [{ type: 'portfolio', raw: '当前持仓', confidence: 1 }],
    requiredSkills: [{ name: 'portfolio.getSummary', args: {}, reason: '读取组合摘要' }],
    responseMode: 'answer',
  }
  const skillResults: AgentSkillResult[] = [{
    skillName: 'portfolio.getSummary',
    ok: true,
    data: {
      stockCount: 2,
      activeHoldingCount: 2,
      totalPnl: 100,
      holdings: [
        { code: '601398', name: '工商银行', market: 'A', currentHolding: 1000 },
      ],
    },
  }]

  const result = composeAgentContext({
    aiConfig: mockAiConfig,
    history: [],
    userMessage: '我的持仓里还有银行吗',
    plan,
    skillResults,
  })

  const system = result.messages[0]?.content ?? ''
  const context = result.messages[1]?.content ?? ''

  assert.match(system, /严禁在面向用户的最终回复中原样提及/)
  assert.match(system, /根据你的当前持仓数据/)
  assert.match(context, /最终回复不得出现这些内部标识/)
})
