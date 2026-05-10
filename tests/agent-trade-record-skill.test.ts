import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_APP_CONFIG } from '@/config/defaults'
import { getPortfolioByUserId, savePortfolioByUserId } from '@/lib/sqlite/db'
import { tradeCommitRecordSkill, tradePrepareRecordSkill } from '@/lib/agent/skills/tradeRecord'
import type { AgentExecutionContext } from '@/lib/agent/types'
import type { AiConfig, Stock } from '@/types'

const aiConfig: AiConfig = {
  enabled: true,
  provider: 'openai-compatible',
  baseUrl: 'http://localhost:8080/v1',
  model: 'test-model',
  apiKey: 'test-key',
  temperature: 0,
  maxContextTokens: 128000,
  newsEnabled: false,
  analysisLanguage: 'zh-CN',
}

process.env.FINANCE_SQLITE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stocktracker-trade-record-')), 'finance.sqlite')

function stock(): Stock {
  return {
    id: 'stock-1',
    code: '601838',
    name: '成都银行',
    market: 'A',
    trades: [],
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  }
}

function createCtx(stocks: Stock[], userId: string): AgentExecutionContext {
  return {
    userId,
    sessionId: 'session-1',
    stocks,
    aiConfig,
    maxContextTokens: 128000,
  }
}

test('trade.prepareRecord extracts a pending buy draft without writing data', async () => {
  const userId = 'local:test-prepare'
  const stocks = [stock()]
  savePortfolioByUserId(userId, { stocks, config: DEFAULT_APP_CONFIG })

  const result = await tradePrepareRecordSkill.execute({
    text: '今日买入成都银行 1000 股，成本价是 10 块。',
  }, createCtx(stocks, userId))

  assert.equal(result.ok, true)
  const data = result.data as any
  assert.equal(data.status, 'pending_confirmation')
  assert.equal(data.draft.type, 'BUY')
  assert.equal(data.draft.code, '601838')
  assert.equal(data.draft.quantity, 1000)
  assert.equal(data.draft.price, 10)
  assert.equal(getPortfolioByUserId(userId).stocks[0]?.trades.length, 0)
})

test('trade.commitRecord writes a confirmed draft to sqlite portfolio payload', async () => {
  const userId = 'local:test-commit'
  const stocks = [stock()]
  savePortfolioByUserId(userId, { stocks, config: DEFAULT_APP_CONFIG })

  const prepared = await tradePrepareRecordSkill.execute({
    text: '今日买入成都银行 1000 股，成本价是 10 块。',
  }, createCtx(stocks, userId))
  const draft = (prepared.data as any).draft
  const committed = await tradeCommitRecordSkill.execute({ draft }, createCtx(stocks, userId))

  assert.equal(committed.ok, true)
  const saved = getPortfolioByUserId(userId)
  assert.equal(saved.stocks[0]?.trades.length, 1)
  assert.equal(saved.stocks[0]?.trades[0]?.type, 'BUY')
  assert.equal(saved.stocks[0]?.trades[0]?.quantity, 1000)
  assert.equal(saved.stocks[0]?.trades[0]?.price, 10)
})
