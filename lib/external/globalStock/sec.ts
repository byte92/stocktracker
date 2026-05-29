import { THIRD_PARTY_REQUEST_HEADERS, thirdPartyApiUrls } from '@/lib/external/thirdPartyApis'
import { loggedFetch } from '@/lib/observability/fetch'
import { logger } from '@/lib/observability/logger'
import { parseDate, parseNumber, toSecCik } from '@/lib/external/globalStock/utils'
import type { SecCompanyFact, SecCompanyFacts, SecFiling, SecFilings } from '@/lib/external/globalStock/types'

let tickerCikCache: Record<string, { cik_str: number; ticker: string; title: string }> | null = null

const SEC_HEADERS = {
  ...THIRD_PARTY_REQUEST_HEADERS.browserLike,
  'User-Agent': 'StockTracker/1.0 contact@example.com',
}

export async function tickerToCik(ticker: string) {
  const normalized = ticker.trim().toUpperCase()
  try {
    if (!tickerCikCache) {
      const res = await loggedFetch(thirdPartyApiUrls.secCompanyTickers(), {
        headers: SEC_HEADERS,
        signal: AbortSignal.timeout(15_000),
        cache: 'no-store',
      }, {
        operation: 'global.sec.companyTickers',
        provider: 'sec-edgar',
        failureLevel: 'warn',
      })
      if (!res.ok) return null
      tickerCikCache = await res.json().catch(() => null)
    }
    const row = Object.values(tickerCikCache ?? {}).find((item) => item.ticker?.toUpperCase() === normalized)
    return row ? { ticker: normalized, cik: toSecCik(row.cik_str), company: row.title } : null
  } catch (error) {
    logger.warn('global.sec.tickerToCik.failed', { error, ticker: normalized })
    return null
  }
}

export async function fetchSecFilingsByCik(cik: string, formType?: string): Promise<SecFilings | null> {
  const normalized = toSecCik(cik)
  try {
    const res = await loggedFetch(thirdPartyApiUrls.secSubmissions(normalized), {
      headers: SEC_HEADERS,
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    }, {
      operation: 'global.sec.submissions',
      provider: 'sec-edgar',
      resource: normalized,
      failureLevel: 'warn',
    })
    if (!res.ok) return null
    const json = await res.json().catch(() => null) as {
      name?: string
      tickers?: string[]
      filings?: { recent?: Record<string, unknown[]> }
    } | null
    const recent = json?.filings?.recent ?? {}
    const forms = Array.isArray(recent.form) ? recent.form : []
    const dates = Array.isArray(recent.filingDate) ? recent.filingDate : []
    const accessions = Array.isArray(recent.accessionNumber) ? recent.accessionNumber : []
    const docs = Array.isArray(recent.primaryDocument) ? recent.primaryDocument : []
    const descriptions = Array.isArray(recent.primaryDocDescription) ? recent.primaryDocDescription : []
    const filings: SecFiling[] = []
    for (let i = 0; i < forms.length; i += 1) {
      const form = String(forms[i] ?? '')
      if (formType && form !== formType) continue
      const accession = String(accessions[i] ?? '')
      const primaryDocument = String(docs[i] ?? '')
      filings.push({
        form,
        date: parseDate(dates[i]),
        accessionNumber: accession,
        primaryDocument,
        description: String(descriptions[i] ?? ''),
        url: accession && primaryDocument
          ? `https://www.sec.gov/Archives/edgar/data/${Number(normalized)}/${accession.replace(/-/g, '')}/${primaryDocument}`
          : null,
      })
    }
    return {
      companyName: json?.name ?? null,
      cik: normalized,
      ticker: json?.tickers?.[0] ?? null,
      filings: filings.slice(0, 50),
      source: 'sec-edgar-submissions',
    }
  } catch (error) {
    logger.warn('global.sec.submissions.failed', { error, cik: normalized })
    return null
  }
}

export async function fetchSecFilings(ticker: string, formType?: string) {
  const mapping = await tickerToCik(ticker)
  return mapping ? fetchSecFilingsByCik(mapping.cik, formType) : null
}

function parseFactEntries(entries: unknown[]): SecCompanyFact[] {
  return entries
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .filter((item) => item.form === '10-K' || item.form === '10-Q')
    .slice(-20)
    .map((item) => ({
      end: parseDate(item.end),
      value: parseNumber(item.val),
      form: item.form ? String(item.form) : null,
      filed: parseDate(item.filed),
      fiscalYear: parseNumber(item.fy),
      fiscalPeriod: item.fp ? String(item.fp) : null,
    }))
}

export async function fetchSecCompanyFactsByCik(cik: string, metrics: string[] = [
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'Revenues',
  'NetIncomeLoss',
  'EarningsPerShareDiluted',
  'EarningsPerShareBasic',
  'Assets',
  'Liabilities',
  'StockholdersEquity',
  'NetCashProvidedByOperatingActivities',
]): Promise<SecCompanyFacts | null> {
  const normalized = toSecCik(cik)
  try {
    const res = await loggedFetch(thirdPartyApiUrls.secCompanyFacts(normalized), {
      headers: SEC_HEADERS,
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    }, {
      operation: 'global.sec.companyFacts',
      provider: 'sec-edgar',
      resource: normalized,
      failureLevel: 'warn',
    })
    if (!res.ok) return null
    const json = await res.json().catch(() => null) as { entityName?: string; facts?: { 'us-gaap'?: Record<string, { units?: Record<string, unknown[]> }> } } | null
    const gaap = json?.facts?.['us-gaap'] ?? {}
    const result: Record<string, SecCompanyFact[]> = {}
    for (const metric of metrics) {
      const units = gaap[metric]?.units ?? {}
      const unitKey = units.USD ? 'USD' : units['USD/shares'] ? 'USD/shares' : Object.keys(units)[0]
      result[metric] = unitKey && Array.isArray(units[unitKey]) ? parseFactEntries(units[unitKey]) : []
    }
    return {
      company: json?.entityName ?? null,
      metrics: result,
      source: 'sec-edgar-companyfacts',
    }
  } catch (error) {
    logger.warn('global.sec.companyFacts.failed', { error, cik: normalized })
    return null
  }
}

export async function fetchSecCompanyFacts(ticker: string, metrics?: string[]) {
  const mapping = await tickerToCik(ticker)
  return mapping ? fetchSecCompanyFactsByCik(mapping.cik, metrics) : null
}
