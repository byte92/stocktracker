import { THIRD_PARTY_REQUEST_HEADERS, thirdPartyApiUrls } from '@/lib/external/thirdPartyApis'
import { loggedFetch } from '@/lib/observability/fetch'
import { logger } from '@/lib/observability/logger'
import { getAStockPrefix, normalizeAStockCode, parseDate, stripHtml } from '@/lib/external/aShare/utils'
import type { AShareAnnouncement } from '@/lib/external/aShare/types'

function getCninfoOrgId(code: string) {
  const normalized = normalizeAStockCode(code)
  const prefix = getAStockPrefix(normalized)
  if (prefix === 'sh') return `gssh0${normalized}`
  if (prefix === 'bj') return `gsbj0${normalized}`
  return `gssz0${normalized}`
}

export async function fetchCninfoAnnouncements(code: string, limit = 20): Promise<AShareAnnouncement[]> {
  const normalized = normalizeAStockCode(code)
  try {
    const body = new URLSearchParams({
      stock: `${normalized},${getCninfoOrgId(normalized)}`,
      tabName: 'fulltext',
      pageSize: String(limit),
      pageNum: '1',
      column: '',
      category: '',
      plate: '',
      seDate: '',
      searchkey: '',
      secid: '',
      sortName: '',
      sortType: '',
      isHLtitle: 'true',
    })
    const res = await loggedFetch(thirdPartyApiUrls.cninfoAnnouncementQuery(), {
      method: 'POST',
      headers: {
        ...THIRD_PARTY_REQUEST_HEADERS.browserLike,
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://www.cninfo.com.cn',
        Referer: 'https://www.cninfo.com.cn/new/disclosure',
      },
      body,
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    }, {
      operation: 'ashare.cninfo.announcements',
      provider: 'cninfo',
      resource: normalized,
    })
    if (!res.ok) return []
    const json = await res.json().catch(() => null) as { announcements?: Record<string, unknown>[] } | null
    const rows = Array.isArray(json?.announcements) ? json.announcements : []
    return rows.slice(0, limit).map((row) => {
      const announcementId = row.announcementId ? String(row.announcementId) : ''
      return {
        title: stripHtml(String(row.announcementTitle ?? '')),
        type: row.announcementTypeName ? String(row.announcementTypeName) : null,
        date: parseDate(row.announcementTime),
        url: announcementId ? `https://www.cninfo.com.cn/new/disclosure/detail?annoId=${announcementId}` : null,
        source: 'cninfo' as const,
      }
    }).filter((item) => item.title)
  } catch (error) {
    logger.warn('ashare.cninfo.announcements.failed', { error, code: normalized })
    return []
  }
}
