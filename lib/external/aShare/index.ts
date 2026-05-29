import { fetchCninfoAnnouncements } from '@/lib/external/aShare/cninfo'
import {
  fetchBlockTrades,
  fetchDividendHistory,
  fetchDragonTigerBoard,
  fetchEastmoneyResearchReports,
  fetchEastmoneyStockInfo,
  fetchFundFlow120d,
  fetchHolderChanges,
  fetchLockupExpiry,
  fetchMarginTrading,
} from '@/lib/external/aShare/eastmoney'
import { fetchSinaFinancialStatements } from '@/lib/external/aShare/sina'
import { fetchThsEpsForecast } from '@/lib/external/aShare/ths'
import { normalizeAStockCode } from '@/lib/external/aShare/utils'
import type { AShareFinancialContext, AShareSignals } from '@/lib/external/aShare/types'

export async function fetchAShareFinancialContext(code: string): Promise<AShareFinancialContext> {
  const normalized = normalizeAStockCode(code)
  const [stockInfo, reports, announcements, statements, epsForecasts] = await Promise.all([
    fetchEastmoneyStockInfo(normalized),
    fetchEastmoneyResearchReports(normalized),
    fetchCninfoAnnouncements(normalized),
    fetchSinaFinancialStatements(normalized),
    fetchThsEpsForecast(normalized),
  ])
  return { stockInfo, reports, announcements, statements, epsForecasts }
}

export async function fetchAShareSignals(code: string): Promise<AShareSignals> {
  const normalized = normalizeAStockCode(code)
  const [
    dragonTiger,
    lockupExpiry,
    marginTrading,
    blockTrades,
    holderChanges,
    dividends,
    fundFlow120d,
  ] = await Promise.all([
    fetchDragonTigerBoard(normalized),
    fetchLockupExpiry(normalized),
    fetchMarginTrading(normalized),
    fetchBlockTrades(normalized),
    fetchHolderChanges(normalized),
    fetchDividendHistory(normalized),
    fetchFundFlow120d(normalized),
  ])

  return {
    symbol: normalized,
    dragonTiger,
    lockupExpiry,
    marginTrading,
    blockTrades,
    holderChanges,
    dividends,
    fundFlow120d,
    sources: [
      'eastmoney-datacenter',
      'eastmoney-push2his',
    ],
  }
}

export {
  fetchCninfoAnnouncements,
  fetchDragonTigerBoard,
  fetchEastmoneyResearchReports,
  fetchEastmoneyStockInfo,
  fetchSinaFinancialStatements,
  fetchThsEpsForecast,
  normalizeAStockCode,
}

export type * from '@/lib/external/aShare/types'
