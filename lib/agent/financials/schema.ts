import { z } from 'zod'
import type { Market } from '@/types'

const nullableNumber = z.number().finite().nullable()

export const financialAnalysisSchema = z.object({
  symbol: z.string().min(1),
  market: z.enum(['A', 'HK', 'US', 'FUND', 'CRYPTO']),
  companyName: z.string().optional(),
  reportPeriod: z.string().optional(),
  reportType: z.enum(['annual', 'quarterly', 'interim', 'unknown']).default('unknown'),
  currency: z.string().optional(),
  metrics: z.object({
    revenue: nullableNumber.optional(),
    revenueGrowth: nullableNumber.optional(),
    netProfit: nullableNumber.optional(),
    netProfitGrowth: nullableNumber.optional(),
    grossMargin: nullableNumber.optional(),
    operatingMargin: nullableNumber.optional(),
    operatingCashFlow: nullableNumber.optional(),
    freeCashFlow: nullableNumber.optional(),
    eps: nullableNumber.optional(),
    debtRatio: nullableNumber.optional(),
    peTtm: nullableNumber.optional(),
    pb: nullableNumber.optional(),
  }),
  highlights: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  trendSummary: z.string().default(''),
  valuationNotes: z.array(z.string()).default([]),
  portfolioImplications: z.array(z.string()).optional(),
  missingData: z.array(z.string()).default([]),
  sources: z.array(z.object({
    title: z.string(),
    url: z.string().optional(),
    publisher: z.string().optional(),
    date: z.string().optional(),
  })).default([]),
  confidence: z.enum(['low', 'medium', 'high']),
})

export type FinancialAnalysis = z.infer<typeof financialAnalysisSchema>

export type FinancialAnalysisInput = {
  security: {
    symbol: string
    market: Market
    name?: string
    inPortfolio: boolean
    stockId?: string
  }
  localHolding?: {
    currentHolding: number
    avgCostPrice: number
    marketPrice: number | null
    marketValue: number | null
    realizedPnl: number
    unrealizedPnl: number
    totalPnl: number
    totalPnlPercent: number
    tradeCount: number
  }
  structuredFinancials?: {
    reportPeriod?: string | null
    revenue?: number | null
    revenueGrowth?: number | null
    netProfit?: number | null
    netProfitGrowth?: number | null
    eps?: number | null
    source: string
    note?: string
  }
  quote?: {
    price?: number | null
    peTtm?: number | null
    pb?: number | null
    epsTtm?: number | null
    marketCap?: number | null
    currency?: string
    source?: string
  } | null
  documents: Array<{
    title: string
    url?: string
    publisher?: string
    date?: string
    excerpt: string
  }>
  userQuestion: string
  language: 'zh' | 'en'
}

function uniqueStrings(items: string[]) {
  return Array.from(new Set(items.map(cleanFinancialDisplayText).filter(Boolean)))
}

function decodeCommonEntities(text: string) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function formatLargeYuanText(raw: string) {
  return raw
    .replace(/(-?\d[\d,]*(?:\.\d+)?)\s*万元/g, (match, amountText: string) => {
      const amountWan = Number(amountText.replace(/,/g, ''))
      if (!Number.isFinite(amountWan) || Math.abs(amountWan) < 10_000) return match
      const yi = amountWan / 10_000
      return `${yi.toLocaleString(undefined, { maximumFractionDigits: 2 })} 亿`
    })
    .replace(/(-?\d[\d,]*(?:\.\d+)?)\s*元/g, (match, amountText: string) => {
      const amount = Number(amountText.replace(/,/g, ''))
      if (!Number.isFinite(amount) || Math.abs(amount) < 100_000_000) return match
      const yi = amount / 100_000_000
      return `${yi.toLocaleString(undefined, { maximumFractionDigits: 2 })} 亿`
    })
}

export function cleanFinancialDisplayText(value: string) {
  return formatLargeYuanText(decodeCommonEntities(value))
    .replace(/�/g, '')
    .replace(/-{2,}>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeSourceTitle(title: string | undefined, fallback: string) {
  const normalized = title?.replace(/\s+/g, ' ').trim()
  return normalized || fallback
}

function normalizeSources(input: FinancialAnalysisInput, sources: FinancialAnalysis['sources']) {
  const fromModel = sources
    .map((source) => ({
      ...source,
      title: normalizeSourceTitle(source.title, ''),
      url: source.url?.trim() || undefined,
      publisher: source.publisher?.trim() || undefined,
      date: source.date?.trim() || undefined,
    }))
    .filter((source) => source.title)

  const fromDocuments = input.documents.map((doc) => ({
    title: normalizeSourceTitle(doc.title, '公开资料'),
    url: doc.url,
    publisher: doc.publisher,
    date: doc.date,
  }))

  const fromStructured = input.structuredFinancials
    ? [{
        title: `结构化财报数据：${input.structuredFinancials.source}`,
        url: undefined,
        publisher: input.structuredFinancials.source,
        date: undefined,
      }]
    : []

  const seen = new Set<string>()
  return [...fromModel, ...fromDocuments, ...fromStructured].filter((source) => {
    const key = `${source.title}::${source.url ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 8)
}

export function normalizeFinancialAnalysis(value: unknown, input: FinancialAnalysisInput): FinancialAnalysis {
  const parsed = financialAnalysisSchema.partial({
    symbol: true,
    market: true,
    metrics: true,
    confidence: true,
  }).parse(value)

  const sources = normalizeSources(input, parsed.sources ?? [])
  const missingData = uniqueStrings([
    ...(parsed.missingData ?? []),
    ...(!input.structuredFinancials && !input.documents.length ? ['缺少可核验的财报正文或结构化财报数据'] : []),
  ])
  const confidence = !sources.length ? 'low' : parsed.confidence ?? (input.documents.length || input.structuredFinancials ? 'medium' : 'low')

  return {
    symbol: parsed.symbol || input.security.symbol,
    market: parsed.market || input.security.market,
    companyName: parsed.companyName || input.security.name,
    reportPeriod: parsed.reportPeriod || input.structuredFinancials?.reportPeriod || undefined,
    reportType: parsed.reportType ?? 'unknown',
    currency: parsed.currency || input.quote?.currency,
    metrics: {
      revenue: parsed.metrics?.revenue ?? input.structuredFinancials?.revenue ?? null,
      revenueGrowth: parsed.metrics?.revenueGrowth ?? input.structuredFinancials?.revenueGrowth ?? null,
      netProfit: parsed.metrics?.netProfit ?? input.structuredFinancials?.netProfit ?? null,
      netProfitGrowth: parsed.metrics?.netProfitGrowth ?? input.structuredFinancials?.netProfitGrowth ?? null,
      grossMargin: parsed.metrics?.grossMargin ?? null,
      operatingMargin: parsed.metrics?.operatingMargin ?? null,
      operatingCashFlow: parsed.metrics?.operatingCashFlow ?? null,
      freeCashFlow: parsed.metrics?.freeCashFlow ?? null,
      eps: parsed.metrics?.eps ?? input.structuredFinancials?.eps ?? input.quote?.epsTtm ?? null,
      debtRatio: parsed.metrics?.debtRatio ?? null,
      peTtm: parsed.metrics?.peTtm ?? input.quote?.peTtm ?? null,
      pb: parsed.metrics?.pb ?? input.quote?.pb ?? null,
    },
    highlights: uniqueStrings(parsed.highlights ?? []),
    risks: uniqueStrings(parsed.risks ?? []),
    trendSummary: cleanFinancialDisplayText(parsed.trendSummary || '财报资料不足，暂无法形成可靠趋势判断。'),
    valuationNotes: uniqueStrings(parsed.valuationNotes ?? []),
    portfolioImplications: input.security.inPortfolio ? uniqueStrings(parsed.portfolioImplications ?? []) : undefined,
    missingData,
    sources,
    confidence,
  }
}

export function buildFallbackFinancialAnalysis(input: FinancialAnalysisInput, error?: string): FinancialAnalysis {
  const structured = input.structuredFinancials
  return normalizeFinancialAnalysis({
    symbol: input.security.symbol,
    market: input.security.market,
    companyName: input.security.name,
    reportPeriod: structured?.reportPeriod ?? undefined,
    reportType: 'unknown',
    metrics: {
      revenue: structured?.revenue ?? null,
      revenueGrowth: structured?.revenueGrowth ?? null,
      netProfit: structured?.netProfit ?? null,
      netProfitGrowth: structured?.netProfitGrowth ?? null,
      eps: structured?.eps ?? input.quote?.epsTtm ?? null,
      peTtm: input.quote?.peTtm ?? null,
      pb: input.quote?.pb ?? null,
    },
    highlights: structured?.note ? [structured.note] : [],
    risks: [],
    trendSummary: structured?.note || '财报分析链不可用，仅返回当前可取得的结构化字段。',
    valuationNotes: input.quote?.peTtm || input.quote?.pb
      ? [`当前估值字段：PE(TTM) ${input.quote?.peTtm ?? '缺失'}，PB ${input.quote?.pb ?? '缺失'}。`]
      : [],
    missingData: [
      !input.documents.length ? '缺少公开财报正文或公告材料' : '',
      !structured ? '缺少结构化财报指标' : '',
    ].filter(Boolean),
    sources: [],
    confidence: structured ? 'medium' : 'low',
  }, input)
}
