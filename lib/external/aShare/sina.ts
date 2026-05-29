import { THIRD_PARTY_REQUEST_HEADERS, thirdPartyApiUrls } from '@/lib/external/thirdPartyApis'
import { loggedFetch } from '@/lib/observability/fetch'
import { logger } from '@/lib/observability/logger'
import { normalizeAStockCode, parseDate, toSinaPaperCode } from '@/lib/external/aShare/utils'
import type { AShareFinancialStatementRow, AShareFinancialStatements } from '@/lib/external/aShare/types'

type SinaReportType = 'lrb' | 'fzb' | 'llb'

function normalizeStatementRows(rows: unknown[]): AShareFinancialStatementRow[] {
  return rows
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .map((item) => ({
      reportDate: parseDate(item['报告日'] ?? item.reportDate ?? item.REPORT_DATE),
      values: item,
    }))
}

export async function fetchSinaFinancialReport(code: string, reportType: SinaReportType, limit = 20): Promise<AShareFinancialStatementRow[]> {
  const normalized = normalizeAStockCode(code)
  try {
    const url = thirdPartyApiUrls.sinaFinanceReport2022({
      paperCode: toSinaPaperCode(normalized),
      source: reportType,
      type: 0,
      page: 1,
      num: limit,
    })
    const res = await loggedFetch(url, {
      headers: THIRD_PARTY_REQUEST_HEADERS.browserLike,
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    }, {
      operation: 'ashare.sina.financeReport2022',
      provider: 'sina-finance',
      resource: `${normalized}:${reportType}`,
    })
    if (!res.ok) return []
    const json = await res.json().catch(() => null) as { result?: { data?: Record<string, unknown> } } | null
    const data = json?.result?.data
    const rows = data?.[reportType]
    return Array.isArray(rows) ? normalizeStatementRows(rows).slice(0, limit) : []
  } catch (error) {
    logger.warn('ashare.sina.financeReport2022.failed', { error, code: normalized, reportType })
    return []
  }
}

export async function fetchSinaFinancialStatements(code: string): Promise<AShareFinancialStatements> {
  const [profit, balance, cashflow] = await Promise.all([
    fetchSinaFinancialReport(code, 'lrb'),
    fetchSinaFinancialReport(code, 'fzb'),
    fetchSinaFinancialReport(code, 'llb'),
  ])
  return {
    profit,
    balance,
    cashflow,
    source: 'sina-finance-report2022',
  }
}
