import test from 'node:test'
import assert from 'node:assert/strict'
import { buildFallbackFinancialAnalysis, cleanFinancialDisplayText, normalizeFinancialAnalysis, type FinancialAnalysisInput } from '@/lib/agent/financials/schema'

const baseInput: FinancialAnalysisInput = {
  security: {
    symbol: '00700',
    market: 'HK',
    name: '腾讯控股',
    inPortfolio: false,
  },
  quote: {
    price: 499,
    peTtm: 18.29,
    pb: 3.59,
    epsTtm: 27.2827,
    marketCap: 4553673220000,
    currency: 'HKD',
    source: 'tencent',
  },
  documents: [{
    title: 'Tencent Announces Results',
    url: 'https://example.com/tencent-results',
    publisher: 'company-ir',
    excerpt: 'Revenue increased while margin pressure remained visible.',
  }],
  userQuestion: '分析腾讯最新财报',
  language: 'zh',
}

test('financial analysis normalization fills quote metrics and sources', () => {
  const analysis = normalizeFinancialAnalysis({
    trendSummary: '收入增长，但利润率仍需观察。',
    highlights: ['收入继续增长'],
    risks: ['利润率承压'],
    valuationNotes: ['估值需要和利润增长匹配观察'],
    missingData: [],
    sources: [],
    confidence: 'high',
  }, baseInput)

  assert.equal(analysis.symbol, '00700')
  assert.equal(analysis.market, 'HK')
  assert.equal(analysis.metrics.peTtm, 18.29)
  assert.equal(analysis.metrics.pb, 3.59)
  assert.equal(analysis.sources[0]?.title, 'Tencent Announces Results')
  assert.equal(analysis.confidence, 'high')
  assert.equal(analysis.portfolioImplications, undefined)
})

test('financial analysis normalization lowers confidence without sources', () => {
  const analysis = normalizeFinancialAnalysis({
    trendSummary: '资料不足。',
    highlights: [],
    risks: [],
    valuationNotes: [],
    missingData: [],
    sources: [],
    confidence: 'high',
  }, { ...baseInput, documents: [] })

  assert.equal(analysis.confidence, 'low')
  assert.ok(analysis.missingData.includes('缺少可核验的财报正文或结构化财报数据'))
})

test('financial analysis fallback preserves structured fields', () => {
  const analysis = buildFallbackFinancialAnalysis({
    ...baseInput,
    security: { ...baseInput.security, inPortfolio: true, stockId: 'stock-1' },
    structuredFinancials: {
      reportPeriod: '2026-03-31',
      revenue: 100,
      revenueGrowth: 12.5,
      netProfit: 20,
      netProfitGrowth: 8,
      eps: 1.2,
      source: 'mock-financials',
      note: '营业收入 100；归母净利润 20',
    },
    documents: [],
  }, 'mock failure')

  assert.equal(analysis.reportPeriod, '2026-03-31')
  assert.equal(analysis.metrics.revenue, 100)
  assert.equal(analysis.metrics.netProfitGrowth, 8)
  assert.equal(analysis.sources[0]?.publisher, 'mock-financials')
  assert.ok(!analysis.missingData.some((item) => item.includes('mock failure')))
  assert.ok(analysis.missingData.includes('缺少公开财报正文或公告材料'))
})

test('financial display text cleans html residue and formats large amounts as yi', () => {
  const text = cleanFinancialDisplayText('营业收入 230370000000 元 &nbsp; --> 归母净利润 8,694,100.00 万元 �')

  assert.match(text, /2,303.7 亿/)
  assert.match(text, /869.41 亿/)
  assert.doesNotMatch(text, /&nbsp;|-->|�/)
})
