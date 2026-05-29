import type { Market } from '@/types'

export type GlobalStockMarket = Extract<Market, 'US' | 'HK'>

export type GlobalStockSearchResult = {
  code: string
  name: string
  market: GlobalStockMarket
  secid: string
  secucode: string
  mktNum: number | null
  securityType: string | null
}

export type GlobalFinancialStatementRow = {
  reportDate: string | null
  report: string | null
  itemName: string
  amount: number | null
  yoyRatio: number | null
  currency: string | null
  values: Record<string, unknown>
}

export type GlobalKeyIndicator = {
  reportDate: string | null
  revenue: number | null
  netProfit: number | null
  eps: number | null
  roe: number | null
  roa: number | null
  grossMargin: number | null
  netMargin: number | null
  debtAssetRatio: number | null
  values: Record<string, unknown>
}

export type YahooKeyStatistics = {
  currentPrice: number | null
  targetHigh: number | null
  targetLow: number | null
  targetMean: number | null
  recommendation: string | null
  trailingPe: number | null
  forwardPe: number | null
  pegRatio: number | null
  priceToBook: number | null
  enterpriseValue: number | null
  evToEbitda: number | null
  evToRevenue: number | null
  profitMargin: number | null
  operatingMargin: number | null
  grossMargin: number | null
  returnOnEquity: number | null
  returnOnAssets: number | null
  earningsGrowth: number | null
  revenueGrowth: number | null
  beta: number | null
  dividendYield: number | null
  marketCap: number | null
  totalRevenue: number | null
  totalCash: number | null
  totalDebt: number | null
}

export type YahooAnalystEstimate = {
  epsTrend: Array<{
    period: string | null
    endDate: string | null
    epsEstimate: number | null
    epsHigh: number | null
    epsLow: number | null
    revenueEstimate: number | null
    numAnalysts: number | null
  }>
  ratingTrend: Array<Record<string, unknown>>
  upgradeDowngrade: Array<Record<string, unknown>>
}

export type YahooInstitutionalHolders = {
  overview: Record<string, unknown>
  topHolders: Array<Record<string, unknown>>
}

export type YahooOptionContract = {
  strike: number | null
  lastPrice: number | null
  bid: number | null
  ask: number | null
  volume: number | null
  openInterest: number | null
  impliedVolatility: number | null
  inTheMoney: boolean | null
  expiration: string | null
  contractSymbol: string | null
}

export type YahooOptionsChain = {
  expirationDates: number[]
  calls: YahooOptionContract[]
  puts: YahooOptionContract[]
  underlyingPrice: number | null
  source: 'yahoo-options'
}

export type SecFiling = {
  form: string
  date: string | null
  accessionNumber: string
  primaryDocument: string
  description: string
  url: string | null
}

export type SecFilings = {
  companyName: string | null
  cik: string
  ticker: string | null
  filings: SecFiling[]
  source: 'sec-edgar-submissions'
}

export type SecCompanyFact = {
  end: string | null
  value: number | null
  form: string | null
  filed: string | null
  fiscalYear: number | null
  fiscalPeriod: string | null
}

export type SecCompanyFacts = {
  company: string | null
  metrics: Record<string, SecCompanyFact[]>
  source: 'sec-edgar-companyfacts'
}

export type GlobalFundFlowDaily = {
  date: string | null
  mainNet: number | null
  smallNet: number | null
  mediumNet: number | null
  largeNet: number | null
  superLargeNet: number | null
  mainPercent: number | null
}

export type GlobalStockNews = {
  title: string
  publisher: string | null
  link: string | null
  publishTime: number | null
  thumbnail: string | null
}

export type GlobalMarketListItem = {
  code: string
  name: string
  price: number | null
  changePercent: number | null
  changeAmount: number | null
  volume: number | null
  amount: number | null
  amplitude: number | null
  high: number | null
  low: number | null
  open: number | null
  prevClose: number | null
}

export type GlobalFinancialContext = {
  target: GlobalStockSearchResult
  statements: {
    balance: GlobalFinancialStatementRow[]
    income: GlobalFinancialStatementRow[]
    cashflow: GlobalFinancialStatementRow[]
  }
  keyIndicators: GlobalKeyIndicator[]
  yahooKeyStatistics: YahooKeyStatistics | null
  analystEstimates: YahooAnalystEstimate | null
  institutionalHolders: YahooInstitutionalHolders | null
  secFilings?: SecFilings | null
  secCompanyFacts?: SecCompanyFacts | null
}

export type GlobalStockSignals = {
  target: GlobalStockSearchResult
  fundFlow: GlobalFundFlowDaily[]
  options?: YahooOptionsChain | null
  secFilings?: SecFilings | null
  news: GlobalStockNews[]
  marketRank?: {
    market: string
    total: number
    stocks: GlobalMarketListItem[]
  }
  sources: string[]
}
