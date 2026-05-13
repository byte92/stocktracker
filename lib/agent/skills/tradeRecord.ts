import { DEFAULT_FEE_CONFIGS, parseMarket } from '@/config/defaults'
import { matchStocks } from '@/lib/agent/entity/stockMatcher'
import { resolveSecurityCandidates } from '@/lib/agent/entity/securityResolver'
import { autoCalcFees, calcStockSummary, estimateDeferredDividendTax, generateId } from '@/lib/finance'
import { getPortfolioByUserId, savePortfolioByUserId } from '@/lib/sqlite/db'
import type { AgentSkill } from '@/lib/agent/types'
import type { AppConfig, Market, Stock, Trade, TradeType } from '@/types'

export type TradeRecordDraft = {
  type: TradeType
  date: string
  stockId?: string
  code: string
  name: string
  market: Market
  price: number
  quantity: number
  commission: number
  tax: number
  deferredDividendTax?: number
  totalAmount: number
  netAmount: number
  note?: string
  sourceText: string
  assumptions: string[]
}

type PrepareTradeRecordInput = {
  text?: string
  correctionText?: string
  previousDraft?: TradeRecordDraft
}

type CommitTradeRecordInput = {
  draft?: TradeRecordDraft
}

const ACTION_WORDS = ['买入', '买进', '购入', '加仓', '卖出', '卖掉', '减仓', '清仓', '分红', '派息', '股息', '收到']
const CANCEL_WORDS = ['取消', '不录', '别录', '不要录', '作废']

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function localDateString(date = new Date()) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function inferTradeType(text: string): TradeType | null {
  if (/(分红|派息|股息|现金红利|收到.*红利)/.test(text)) return 'DIVIDEND'
  if (/(卖出|卖掉|减仓|清仓)/.test(text)) return 'SELL'
  if (/(买入|买进|购入|加仓)/.test(text)) return 'BUY'
  return null
}

function inferDate(text: string) {
  const iso = text.match(/(20\d{2}|19\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (iso) {
    const [, year, month, day] = iso
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  if (/(昨日|昨天)/.test(text)) return localDateString(addDays(new Date(), -1))
  if (/(前天)/.test(text)) return localDateString(addDays(new Date(), -2))
  return localDateString()
}

function parseFirstNumber(pattern: RegExp, text: string) {
  const match = text.match(pattern)
  if (!match?.[1]) return null
  const value = Number(match[1].replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
}

function inferQuantity(text: string) {
  return parseFirstNumber(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:股|份|枚|手|shares?|coins?)/i, text)
}

function inferTradePrice(text: string) {
  return parseFirstNumber(/(?:成本价|成本|成交价|价格|价|@)\s*(?:是|为|=|:|：)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i, text)
    ?? parseFirstNumber(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:元|块|港币|美元|USDT|usd|hkd|cny)\s*(?:每股|一股|\/股|\/份)?/i, text)
}

function inferDividendTotal(text: string) {
  return parseFirstNumber(/(?:到账|收到|分红|派息|红利|股息)\s*(?:合计|总计|总额|金额)?\s*(?:是|为|=|:|：)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)/, text)
    ?? parseFirstNumber(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:元|块|港币|美元|USDT|usd|hkd|cny)/i, text)
}

function inferDividendPerUnit(text: string) {
  return parseFirstNumber(/(?:每股|每份|每枚|\/股|\/份)\s*(?:分红|派息|红利|股息)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)/, text)
    ?? parseFirstNumber(/(?:分红|派息|红利|股息)\s*(?:每股|每份|每枚)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:元|块).*?(?:每股|每份|每枚|\/股|\/份)/, text)
}

function stripKnownFragments(text: string) {
  return text
    .replace(/(20\d{2}|19\d{2})[-/.年]\d{1,2}[-/.月]\d{1,2}日?/g, ' ')
    .replace(/今日|今天|昨日|昨天|前天/g, ' ')
    .replace(/\d+(?:,\d{3})*(?:\.\d+)?\s*(?:股|份|枚|手|元|块|港币|美元|USDT|usd|hkd|cny|shares?|coins?)/gi, ' ')
    .replace(/成本价|成本|成交价|价格|每股|每份|每枚|合计|总计|总额|金额|到账|收到/g, ' ')
    .replace(/[，。！？、,.!?;；:：()[\]{}"'“”‘’@=]/g, ' ')
}

function inferSecurityQuery(text: string) {
  const actionPattern = ACTION_WORDS.join('|')
  const afterAction = text.match(new RegExp(`(?:${actionPattern})\\s*([\\u4e00-\\u9fa5A-Za-z0-9.\\- ]{2,30}?)(?=\\s*\\d|\\s*(?:成本|成交|价格|价|每股|合计|总额|金额|到账)|$)`))
  const candidate = afterAction?.[1]?.trim()
  if (candidate) return candidate

  const stripped = stripKnownFragments(text)
  const spans = stripped.match(/[\u4e00-\u9fa5A-Za-z0-9. -]{2,30}/g) ?? []
  return spans
    .map((item) => item.replace(new RegExp(ACTION_WORDS.join('|'), 'g'), '').trim())
    .find((item) => item.length >= 2) ?? ''
}

function mergeCorrection(input: PrepareTradeRecordInput) {
  const previous = input.previousDraft
  const correction = input.correctionText?.trim()
  if (!previous || !correction) return input.text?.trim() ?? correction ?? ''
  return [
    `${previous.date} ${previous.type === 'BUY' ? '买入' : previous.type === 'SELL' ? '卖出' : '分红'} ${previous.name} ${previous.quantity} 股 ${previous.price} 元`,
    correction,
  ].join('，')
}

async function resolveStock(text: string, stocks: Stock[]) {
  const query = inferSecurityQuery(text)
  if (!query) return { query: '', candidates: [] }
  const local = matchStocks(query, stocks, 3).map((match) => ({
    code: match.stock.code,
    name: match.stock.name,
    market: match.stock.market,
    stockId: match.stock.id,
    confidence: match.confidence,
    inPortfolio: true,
  }))
  if (local.length) return { query, candidates: local }
  const candidates = await resolveSecurityCandidates(query, stocks, 3)
  return { query, candidates }
}

function configForMarket(config: AppConfig | undefined, market: Market) {
  return config?.feeConfigs?.[market] ?? DEFAULT_FEE_CONFIGS[market]
}

function getPayload(ctx: { userId: string; stocks: Stock[] }) {
  const payload = getPortfolioByUserId(ctx.userId)
  return {
    stocks: payload.stocks.length ? payload.stocks : ctx.stocks,
    config: payload.config,
  }
}

function buildMissing(missing: string[], query: string, candidateCount: number) {
  if (!query) missing.push('标的名称或代码')
  if (candidateCount > 1) missing.push('唯一标的')
  return Array.from(new Set(missing))
}

export const tradePrepareRecordSkill: AgentSkill<PrepareTradeRecordInput> = {
  name: 'trade.prepareRecord',
  description: '从用户自然语言中整理买入、卖出或分红记录草稿；只返回待确认数据，不写入数据库。',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      correctionText: { type: 'string' },
      previousDraft: { type: 'object' },
    },
  },
  requiredScopes: ['stock.read', 'trade.read'],
  async execute(args, ctx) {
    const text = mergeCorrection(args)
    if (!text) return { skillName: 'trade.prepareRecord', ok: false, error: '缺少要整理的交易或分红文本' }
    if (CANCEL_WORDS.some((word) => text.includes(word))) {
      return { skillName: 'trade.prepareRecord', ok: true, data: { status: 'cancelled' } }
    }

    const payload = getPayload(ctx)
    const type = inferTradeType(text)
    const date = inferDate(text)
    const { query, candidates } = await resolveStock(text, payload.stocks)
    const selected = candidates.length === 1 ? candidates[0] : null
    const missing: string[] = []
    if (!type) missing.push('交易类型（买入/卖出/分红）')

    let quantity = inferQuantity(text)
    const price = type === 'DIVIDEND' ? inferDividendPerUnit(text) : inferTradePrice(text)
    const dividendTotal = type === 'DIVIDEND' ? inferDividendTotal(text) : null
    const heldStock = selected?.stockId ? payload.stocks.find((stock) => stock.id === selected.stockId) : null
    const assumptions: string[] = []

    if (type === 'DIVIDEND' && !quantity && heldStock) {
      quantity = calcStockSummary(heldStock).currentHolding
      if (quantity > 0) assumptions.push('分红未说明数量，已按当前持仓数量生成草稿。')
    }

    if (!isFinitePositive(quantity)) missing.push(type === 'DIVIDEND' ? '分红对应数量或当前持仓数量' : '数量')
    if (type === 'DIVIDEND') {
      if (!isFinitePositive(price) && !isFinitePositive(dividendTotal)) missing.push('每股分红或分红总额')
    } else if (!isFinitePositive(price)) {
      missing.push('成交价格')
    }

    const normalizedMissing = buildMissing(missing, query, candidates.length)
    if (!selected || normalizedMissing.length) {
      return {
        skillName: 'trade.prepareRecord',
        ok: true,
        data: {
          status: 'needs_more_info',
          missing: normalizedMissing,
          query,
          candidates,
          sourceText: text,
          message: `还需要补充：${normalizedMissing.join('、')}`,
        },
      }
    }

    const finalType = type
    if (!finalType) return { skillName: 'trade.prepareRecord', ok: false, error: '缺少交易类型，无法生成草稿。' }

    const market = selected.market
    const feeConfig = configForMarket(payload.config, market)
    const finalQuantity = quantity as number
    let finalPrice = price ?? 0
    if (finalType === 'DIVIDEND' && !isFinitePositive(finalPrice) && isFinitePositive(dividendTotal)) {
      finalPrice = roundMoney(dividendTotal / finalQuantity)
      assumptions.push('分红只提供总额，已按数量反推单位到账金额。')
    }

    const totalAmount = roundMoney(finalPrice * finalQuantity)
    const baseFees = finalType === 'BUY' || finalType === 'SELL'
      ? autoCalcFees(finalType, finalPrice, finalQuantity, market, selected.code, feeConfig)
      : { commission: 0, tax: 0, netAmount: totalAmount }
    const deferredDividendTax = finalType === 'SELL' && heldStock
      ? estimateDeferredDividendTax(heldStock, date, finalQuantity)
      : 0
    const fees = finalType === 'SELL' && deferredDividendTax > 0
      ? {
          commission: baseFees.commission,
          tax: roundMoney(baseFees.tax + deferredDividendTax),
          netAmount: roundMoney(baseFees.netAmount - deferredDividendTax),
        }
      : baseFees

    const draft: TradeRecordDraft = {
      type: finalType,
      date,
      stockId: selected.stockId,
      code: selected.code,
      name: selected.name,
      market,
      price: finalPrice,
      quantity: finalQuantity,
      commission: fees.commission,
      tax: fees.tax,
      deferredDividendTax: deferredDividendTax > 0 ? deferredDividendTax : undefined,
      totalAmount,
      netAmount: finalType === 'DIVIDEND' ? totalAmount : fees.netAmount,
      sourceText: text,
      assumptions,
    }

    return {
      skillName: 'trade.prepareRecord',
      ok: true,
      data: {
        status: 'pending_confirmation',
        confirmationRequired: true,
        draft,
        message: '请用户核对草稿，确认无误后才能写入数据库。',
      },
    }
  },
}

function validateDraft(value: unknown): TradeRecordDraft | null {
  if (!value || typeof value !== 'object') return null
  const draft = value as Partial<TradeRecordDraft>
  const market = parseMarket(draft.market)
  if (!market) return null
  if (!draft.type || !['BUY', 'SELL', 'DIVIDEND'].includes(draft.type)) return null
  if (!draft.date || !draft.code || !draft.name) return null
  if (!isFinitePositive(draft.price) || !isFinitePositive(draft.quantity)) return null
  return { ...draft, market } as TradeRecordDraft
}

export const tradeCommitRecordSkill: AgentSkill<CommitTradeRecordInput> = {
  name: 'trade.commitRecord',
  description: '在用户明确确认后，将已确认的买入、卖出或分红草稿写入本地数据库。',
  inputSchema: {
    type: 'object',
    properties: {
      draft: { type: 'object' },
    },
    required: ['draft'],
  },
  requiredScopes: ['trade.write', 'stock.read'],
  async execute(args, ctx) {
    const draft = validateDraft(args.draft)
    if (!draft) return { skillName: 'trade.commitRecord', ok: false, error: '待写入草稿无效，无法录入。' }

    const payload = getPortfolioByUserId(ctx.userId)
    const now = new Date().toISOString()
    let targetStock = payload.stocks.find((stock) => stock.id === draft.stockId)
      ?? payload.stocks.find((stock) => stock.code.toUpperCase() === draft.code.toUpperCase() && stock.market === draft.market)

    const trade: Trade = {
      id: generateId(),
      stockId: targetStock?.id ?? generateId(),
      type: draft.type,
      date: draft.date,
      price: draft.price,
      quantity: draft.quantity,
      commission: draft.commission,
      tax: draft.tax,
      totalAmount: draft.totalAmount,
      netAmount: draft.netAmount,
      note: draft.note,
      createdAt: now,
      updatedAt: now,
    }

    let nextStocks: Stock[]
    if (targetStock) {
      trade.stockId = targetStock.id
      nextStocks = payload.stocks.map((stock) => stock.id === targetStock?.id
        ? { ...stock, updatedAt: now, trades: [...stock.trades, trade].sort((a, b) => a.date.localeCompare(b.date)) }
        : stock)
    } else {
      targetStock = {
        id: trade.stockId,
        code: draft.code,
        name: draft.name,
        market: draft.market,
        trades: [trade],
        createdAt: now,
        updatedAt: now,
      }
      nextStocks = [...payload.stocks, targetStock]
    }

    savePortfolioByUserId(ctx.userId, {
      stocks: nextStocks,
      config: payload.config,
    })

    return {
      skillName: 'trade.commitRecord',
      ok: true,
      data: {
        status: 'recorded',
        stock: {
          id: targetStock.id,
          code: targetStock.code,
          name: targetStock.name,
          market: targetStock.market,
        },
        trade: {
          id: trade.id,
          type: trade.type,
          date: trade.date,
          price: trade.price,
          quantity: trade.quantity,
          commission: trade.commission,
          tax: trade.tax,
          totalAmount: trade.totalAmount,
          netAmount: trade.netAmount,
        },
      },
    }
  },
}
