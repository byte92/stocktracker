export type EastmoneyDatacenterRow = Record<string, unknown>

export type AShareStockInfo = {
  code: string
  name: string
  industry: string | null
  totalShares: number | null
  floatShares: number | null
  marketCap: number | null
  floatMarketCap: number | null
  listDate: string | null
  price: number | null
  source: 'eastmoney-stock-info'
}

export type AShareResearchReport = {
  title: string
  publishDate: string | null
  orgName: string | null
  rating: string | null
  industry: string | null
  infoCode: string | null
  pdfUrl: string | null
  epsForecasts: {
    currentYear: number | null
    nextYear: number | null
    nextTwoYear: number | null
  }
  source: 'eastmoney-reportapi'
}

export type AShareAnnouncement = {
  title: string
  type: string | null
  date: string | null
  url: string | null
  source: 'cninfo'
}

export type AShareFinancialStatementRow = {
  reportDate: string | null
  values: Record<string, unknown>
}

export type AShareFinancialStatements = {
  profit: AShareFinancialStatementRow[]
  balance: AShareFinancialStatementRow[]
  cashflow: AShareFinancialStatementRow[]
  source: 'sina-finance-report2022'
}

export type AShareEpsForecast = {
  year: string
  institutionCount: number | null
  min: number | null
  avg: number | null
  max: number | null
  source: 'ths-worth'
}

export type AShareFinancialContext = {
  stockInfo: AShareStockInfo | null
  reports: AShareResearchReport[]
  announcements: AShareAnnouncement[]
  statements: AShareFinancialStatements
  epsForecasts: AShareEpsForecast[]
}

export type DragonTigerRecord = {
  date: string | null
  reason: string
  netBuyWan: number | null
  turnoverPercent: number | null
}

export type DragonTigerSeat = {
  name: string
  buyWan: number | null
  sellWan: number | null
  netWan: number | null
}

export type DragonTigerBoard = {
  records: DragonTigerRecord[]
  seats: {
    buy: DragonTigerSeat[]
    sell: DragonTigerSeat[]
  }
  source: 'eastmoney-datacenter'
}

export type AShareLockupExpiry = {
  date: string | null
  shares: number | null
  marketValue: number | null
  ratio: number | null
  shareholder: string | null
}

export type AShareMarginTrading = {
  date: string | null
  financingBalance: number | null
  financingBuy: number | null
  financingRepay: number | null
  securitiesLendingBalance: number | null
}

export type AShareBlockTrade = {
  date: string | null
  price: number | null
  volume: number | null
  amount: number | null
  buyer: string | null
  seller: string | null
  discountRate: number | null
}

export type AShareHolderChange = {
  reportDate: string | null
  holderCount: number | null
  changeRatio: number | null
  avgHoldingMarketValue: number | null
}

export type AShareDividend = {
  exDividendDate: string | null
  plan: string
  cashPerShare: number | null
  bonusSharesPerShare: number | null
  transferSharesPerShare: number | null
}

export type AShareFundFlowDaily = {
  date: string | null
  mainNet: number | null
  superLargeNet: number | null
  largeNet: number | null
  mediumNet: number | null
  smallNet: number | null
}

export type AShareSignals = {
  symbol: string
  dragonTiger: DragonTigerBoard
  lockupExpiry: AShareLockupExpiry[]
  marginTrading: AShareMarginTrading[]
  blockTrades: AShareBlockTrade[]
  holderChanges: AShareHolderChange[]
  dividends: AShareDividend[]
  fundFlow120d: AShareFundFlowDaily[]
  sources: string[]
}
