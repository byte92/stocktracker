export function normalizeAStockCode(input: string) {
  const trimmed = input.trim().toUpperCase()
  const withoutPrefix = trimmed.replace(/^(SH|SZ|BJ)/, '')
  const suffixMatch = withoutPrefix.match(/^(\d{6})\.(SH|SZ|BJ)$/)
  if (suffixMatch) return suffixMatch[1]
  const directMatch = withoutPrefix.match(/\d{6}/)
  return directMatch?.[0] ?? withoutPrefix
}

export function getAStockPrefix(code: string): 'sh' | 'sz' | 'bj' {
  const normalized = normalizeAStockCode(code)
  if (normalized.startsWith('6') || normalized.startsWith('9')) return 'sh'
  if (normalized.startsWith('8') || normalized.startsWith('4')) return 'bj'
  return 'sz'
}

export function getEastmoneySecId(code: string) {
  const normalized = normalizeAStockCode(code)
  const prefix = getAStockPrefix(normalized)
  if (prefix === 'sh') return `1.${normalized}`
  if (prefix === 'bj') return `0.${normalized}`
  return `0.${normalized}`
}

export function toSinaPaperCode(code: string) {
  const normalized = normalizeAStockCode(code)
  return `${getAStockPrefix(normalized)}${normalized}`
}

export function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const normalized = String(value).replace(/,/g, '').replace(/%$/, '').trim()
  if (!normalized || normalized === '-' || normalized === '--') return null
  const num = Number(normalized)
  return Number.isFinite(num) ? num : null
}

export function parseDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const raw = String(value).trim()
  const ymd = raw.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}/)?.[0]
  if (ymd) {
    const [year, month, day] = ymd.replace(/\//g, '-').split('-')
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }
  const compact = raw.match(/\d{8}/)?.[0]
  if (compact) return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
  return raw.slice(0, 10) || null
}

export function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}
