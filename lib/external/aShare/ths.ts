import { THIRD_PARTY_REQUEST_HEADERS, thirdPartyApiUrls } from '@/lib/external/thirdPartyApis'
import { loggedFetch } from '@/lib/observability/fetch'
import { logger } from '@/lib/observability/logger'
import { normalizeAStockCode, parseNumber, stripHtml } from '@/lib/external/aShare/utils'
import type { AShareEpsForecast } from '@/lib/external/aShare/types'

function decodeTableCells(rowHtml: string) {
  return Array.from(rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi))
    .map((match) => stripHtml(match[1] ?? ''))
    .filter(Boolean)
}

export function parseThsEpsForecastHtml(html: string): AShareEpsForecast[] {
  const normalized = html.replace(/\s+/g, ' ')
  const rows = Array.from(normalized.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)).map((match) => decodeTableCells(match[1] ?? ''))
  const result: AShareEpsForecast[] = []

  for (const cells of rows) {
    const joined = cells.join(' ')
    if (!/(20\d{2}|每股收益|EPS|预测机构|均值)/i.test(joined)) continue
    const year = cells.find((cell) => /20\d{2}/.test(cell))?.match(/20\d{2}/)?.[0]
    if (!year) continue
    const numeric = cells
      .filter((cell) => !/^20\d{2}$/.test(cell.trim()))
      .map(parseNumber)
      .filter((item): item is number => item !== null)
    if (!numeric.length) continue
    result.push({
      year,
      institutionCount: numeric.length >= 4 ? numeric[0] : null,
      min: numeric.length >= 4 ? numeric[1] : numeric[0] ?? null,
      avg: numeric.length >= 4 ? numeric[2] : numeric[1] ?? numeric[0] ?? null,
      max: numeric.length >= 4 ? numeric[3] : numeric[2] ?? null,
      source: 'ths-worth',
    })
  }

  const deduped = new Map<string, AShareEpsForecast>()
  for (const item of result) {
    if (!deduped.has(item.year)) deduped.set(item.year, item)
  }
  return Array.from(deduped.values()).slice(0, 5)
}

export async function fetchThsEpsForecast(code: string): Promise<AShareEpsForecast[]> {
  const normalized = normalizeAStockCode(code)
  try {
    const res = await loggedFetch(thirdPartyApiUrls.thsWorth(normalized), {
      headers: {
        ...THIRD_PARTY_REQUEST_HEADERS.browserLike,
        Referer: 'https://basic.10jqka.com.cn/',
      },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    }, {
      operation: 'ashare.ths.epsForecast',
      provider: 'ths-worth',
      resource: normalized,
      failureLevel: 'warn',
    })
    if (!res.ok) return []
    const buffer = Buffer.from(await res.arrayBuffer())
    const iconv = await import('iconv-lite')
    const html = iconv.decode(buffer, 'gb18030')
    return parseThsEpsForecastHtml(html)
  } catch (error) {
    logger.warn('ashare.ths.epsForecast.failed', { error, code: normalized })
    return []
  }
}
