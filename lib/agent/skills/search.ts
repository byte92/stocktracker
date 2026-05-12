import type { AgentSkill } from '@/lib/agent/types'
import { THIRD_PARTY_SEARCH_URLS } from '@/lib/external/thirdPartyApis'

export type WebSearchInput = {
  query: string
  queries?: string[]
  sourceHints?: string[]
  limit?: number
  searchLimit?: number
}

export type WebSearchItem = {
  title: string
  snippet: string
  url: string
  content?: string
  source?: string
}

export type WebSearchResult = {
  query: string
  queries?: string[]
  sourceHints?: string[]
  results: WebSearchItem[]
  searchedAt: string
}

type NormalizedWebSearchRequest = {
  query: string
  queries: string[]
  sourceHints: string[]
}

type PlaywrightBrowser = import('playwright').Browser
type PlaywrightBrowserContext = import('playwright').BrowserContext
type PlaywrightPage = import('playwright').Page

export const webSearchSkill: AgentSkill<WebSearchInput, WebSearchResult> = {
  name: 'web.search',
  description: '通过搜索引擎查找公开信息，并用浏览器抓取二级页面内容',
  inputSchema: { query: 'string', queries: 'string[]?', sourceHints: 'string[]?', limit: 'number?', searchLimit: 'number?' },
  requiredScopes: ['network.fetch'],
  async execute(args) {
    const query = String(args.query ?? '').trim()
    if (!query) return { skillName: 'web.search', ok: false, error: '缺少搜索关键词' }
    const request = normalizeWebSearchRequest(args, query)

    const resultLimit = clampNumber(args.limit, 5, 1, 10)
    const searchLimit = Math.max(resultLimit, clampNumber(args.searchLimit, 10, 1, 20))

    let browser: PlaywrightBrowser | null = null
    let context: PlaywrightBrowserContext | null = null

    try {
      // 动态导入避免 SSR 时加载原生模块。
      const { chromium } = await import('playwright')

      browser = await chromium.launch({ headless: true })
      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        locale: 'zh-CN',
      })

      const searchPage = await context.newPage()
      const candidates = await collectSearchCandidates(searchPage, request, searchLimit)
      await searchPage.close().catch(() => {})

      const rankedCandidates = sortByRelevance(request, dedupeResults(candidates)).slice(0, searchLimit)
      const enriched = await enrichResults(context, rankedCandidates, request, searchLimit)
      const relevant = filterRelevantResults(request, enriched)
      const results = (relevant.length ? relevant : sortByRelevance(request, enriched)).slice(0, resultLimit)

      return buildSearchResult(request, results, resultLimit)
    } catch (error) {
      return { skillName: 'web.search', ok: false, error: describeWebSearchError(error) }
    } finally {
      await context?.close().catch(() => {})
      await browser?.close().catch(() => {})
    }
  },
}

function buildSearchResult(request: NormalizedWebSearchRequest, results: WebSearchItem[], limit: number) {
  return {
    skillName: 'web.search',
    ok: true,
    data: {
      query: request.query,
      queries: request.queries.length ? request.queries : undefined,
      sourceHints: request.sourceHints.length ? request.sourceHints : undefined,
      results: results.slice(0, limit),
      searchedAt: new Date().toISOString(),
    },
  }
}

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .map((item) => (typeof item === 'string' ? item.replace(/\s+/g, ' ').trim() : ''))
      .filter(Boolean),
  ))
}

function normalizeWebSearchRequest(args: WebSearchInput, query: string): NormalizedWebSearchRequest {
  return {
    query,
    queries: normalizeStringList(args.queries),
    sourceHints: normalizeStringList(args.sourceHints),
  }
}

function clampNumber(value: unknown, defaultValue: number, min: number, max: number) {
  const parsed = Number(value ?? defaultValue)
  if (!Number.isFinite(parsed)) return defaultValue
  return Math.max(min, Math.min(parsed, max))
}

export function describeWebSearchError(error: unknown) {
  if (!(error instanceof Error)) return '搜索请求失败'
  if (isMissingPlaywrightBrowserError(error.message)) {
    return '未找到 Playwright Chromium 浏览器，请先安装 Playwright 浏览器依赖'
  }
  return error.message || '搜索请求失败'
}

function isMissingPlaywrightBrowserError(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes("executable doesn't exist") || normalized.includes('playwright install')
}

async function collectSearchCandidates(page: PlaywrightPage, request: NormalizedWebSearchRequest, searchLimit: number): Promise<WebSearchItem[]> {
  const items: WebSearchItem[] = []
  const variants = buildQueryVariants(request).slice(0, 4)

  for (const item of variants) {
    items.push(...await searchGoogle(page, item, searchLimit).catch(() => []))
    if (hasEnoughCandidates(items, searchLimit)) break

    items.push(...await searchBaidu(page, item, searchLimit).catch(() => []))
    if (hasEnoughCandidates(items, searchLimit)) break

    items.push(...await searchSogou(page, item, searchLimit).catch(() => []))
    if (hasEnoughCandidates(items, searchLimit)) break

    items.push(...await searchDuckDuckGo(page, item, searchLimit).catch(() => []))
    if (hasEnoughCandidates(items, searchLimit)) break

    items.push(...await searchBing(page, item, searchLimit).catch(() => []))
    if (hasEnoughCandidates(items, searchLimit)) break
  }

  return sortByRelevance(request, dedupeResults(items)).slice(0, searchLimit)
}

async function searchGoogle(page: PlaywrightPage, query: string, limit: number): Promise<WebSearchItem[]> {
  await page.goto(THIRD_PARTY_SEARCH_URLS.google(query, limit), {
    waitUntil: 'domcontentloaded',
    timeout: 12_000,
  })
  await page.waitForSelector('#search', { timeout: 5_000 }).catch(() => {})

  const bodyText = await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '')
  if (bodyText.includes('异常流量') || bodyText.toLowerCase().includes('unusual traffic')) return []

  const results = await page.evaluate((maxItems) => {
    const items: Array<{ title: string; snippet: string; url: string; source: string }> = []
    const nodes = document.querySelectorAll('#search .g, #search .MjjYud')
    Array.from(nodes).forEach((node) => {
      if (items.length >= maxItems) return
      const titleEl = node.querySelector('h3')
      const snippetEl = node.querySelector('.VwiC3b, .lEBKkf, div[data-sncf], span.st')
      const linkEl = node.querySelector<HTMLAnchorElement>('a[href^="http"]')
      const url = linkEl?.href ?? ''
      if (titleEl?.textContent && url) {
        items.push({
          title: titleEl.textContent.trim(),
          snippet: snippetEl?.textContent?.trim() ?? '',
          url,
          source: 'google',
        })
      }
    })
    return items
  }, limit)

  return dedupeResults(results)
}

async function searchBaidu(page: PlaywrightPage, query: string, limit: number): Promise<WebSearchItem[]> {
  await page.goto(THIRD_PARTY_SEARCH_URLS.baidu(query), {
    waitUntil: 'domcontentloaded',
    timeout: 12_000,
  })
  await page.waitForSelector('#content_left, .result, .result-op', { timeout: 5_000 }).catch(() => {})

  const results = await page.evaluate((maxItems) => {
    const items: Array<{ title: string; snippet: string; url: string; source: string }> = []
    const nodes = document.querySelectorAll('#content_left .result, #content_left .result-op, #content_left [tpl]')
    Array.from(nodes).forEach((node) => {
      if (items.length >= maxItems) return
      const linkEl = node.querySelector<HTMLAnchorElement>('h3 a, .c-title a, a[href^="http"]')
      const title = linkEl?.textContent?.trim() ?? ''
      const url = linkEl?.href ?? ''
      const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      const snippet = text.startsWith(title) ? text.slice(title.length).trim() : text
      if (title && url) {
        items.push({ title, snippet, url, source: 'baidu' })
      }
    })
    return items
  }, limit)

  return dedupeResults(results)
}

async function searchSogou(page: PlaywrightPage, query: string, limit: number): Promise<WebSearchItem[]> {
  await page.goto(THIRD_PARTY_SEARCH_URLS.sogou(query), {
    waitUntil: 'domcontentloaded',
    timeout: 12_000,
  })
  await page.waitForSelector('.results, .vrwrap, .rb', { timeout: 5_000 }).catch(() => {})

  const results = await page.evaluate((maxItems) => {
    const items: Array<{ title: string; snippet: string; url: string; source: string }> = []
    const nodes = document.querySelectorAll('.results .vrwrap, .results .rb, .results > div')
    Array.from(nodes).forEach((node) => {
      if (items.length >= maxItems) return
      const linkEl = node.querySelector<HTMLAnchorElement>('h3 a, .vr-title a, a[href^="http"]')
      const title = linkEl?.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      const url = linkEl?.href ?? ''
      const text = node.textContent?.replace(/\s+/g, ' ').trim() ?? ''
      const snippet = text.startsWith(title) ? text.slice(title.length).trim() : text
      if (title && url) {
        items.push({ title, snippet, url, source: 'sogou' })
      }
    })
    return items
  }, limit)

  return dedupeResults(results)
}

async function searchDuckDuckGo(page: PlaywrightPage, query: string, limit: number): Promise<WebSearchItem[]> {
  await page.goto(THIRD_PARTY_SEARCH_URLS.duckDuckGo(query), {
    waitUntil: 'domcontentloaded',
    timeout: 12_000,
  })
  await page.waitForSelector('.result, .links_main', { timeout: 5_000 }).catch(() => {})

  const results = await page.evaluate((maxItems) => {
    const items: Array<{ title: string; snippet: string; url: string; source: string }> = []
    const nodes = document.querySelectorAll('.result, .links_main.result__body, .web-result')
    Array.from(nodes).forEach((node) => {
      if (items.length >= maxItems) return
      const titleEl = node.querySelector<HTMLAnchorElement>('.result__a, a.result__a, h2 a')
      const snippetEl = node.querySelector('.result__snippet, .result__body, .snippet')
      const rawUrl = titleEl?.getAttribute('href') ?? titleEl?.href ?? ''
      if (titleEl?.textContent && rawUrl) {
        items.push({
          title: titleEl.textContent.trim(),
          snippet: snippetEl?.textContent?.trim() ?? '',
          url: rawUrl,
          source: 'duckduckgo',
        })
      }
    })
    return items
  }, limit)

  return dedupeResults(results.map((item) => ({ ...item, url: normalizeDuckUrl(item.url) })))
}

async function searchBing(page: PlaywrightPage, query: string, limit: number): Promise<WebSearchItem[]> {
  await page.goto(THIRD_PARTY_SEARCH_URLS.bing(query), {
    waitUntil: 'domcontentloaded',
    timeout: 12_000,
  })
  await page.waitForSelector('li.b_algo', { timeout: 5_000 }).catch(() => {})

  const results = await page.evaluate((maxItems) => {
    const items: Array<{ title: string; snippet: string; url: string; source: string }> = []
    const nodes = document.querySelectorAll('li.b_algo')
    Array.from(nodes).forEach((node) => {
      if (items.length >= maxItems) return
      const linkEl = node.querySelector<HTMLAnchorElement>('h2 a')
      const snippetEl = node.querySelector('p')
      const url = linkEl?.href ?? ''
      if (linkEl?.textContent && url) {
        items.push({
          title: linkEl.textContent.trim(),
          snippet: snippetEl?.textContent?.trim() ?? '',
          url,
          source: 'bing',
        })
      }
    })
    return items
  }, limit)

  return dedupeResults(results)
}

async function enrichResults(
  context: PlaywrightBrowserContext,
  results: WebSearchItem[],
  request: NormalizedWebSearchRequest,
  searchLimit: number,
): Promise<WebSearchItem[]> {
  const top = sortByRelevance(request, dedupeResults(results)).slice(0, Math.min(searchLimit, 10))
  const enriched: WebSearchItem[] = []
  const batchSize = 3

  for (let index = 0; index < top.length; index += batchSize) {
    const batch = top.slice(index, index + batchSize)
    const items = await Promise.all(batch.map(async (item) => {
      const captured = await capturePageContentWithBrowser(context, item.url).catch(() => null)
      if (!captured?.content) return item
      return { ...item, url: captured.finalUrl || item.url, content: captured.content }
    }))
    enriched.push(...items)
  }

  return sortByRelevance(request, enriched)
}

async function capturePageContentWithBrowser(context: PlaywrightBrowserContext, url: string) {
  if (/\.pdf(?:$|\?)/i.test(url)) return null

  const page = await context.newPage()
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    await page.waitForLoadState('networkidle', { timeout: 3_000 }).catch(() => {})

    const content = await page.evaluate(() => {
      const meta = document.querySelector<HTMLMetaElement>('meta[name="description"], meta[property="og:description"]')?.content ?? ''
      const root = document.querySelector('article, main, [role="main"]') ?? document.body
      const blocks = Array.from(root.querySelectorAll('h1, h2, h3, p, li'))
        .map((node) => node.textContent?.trim() ?? '')
        .filter((text) => text.length >= 20)
      return [meta, ...blocks].filter(Boolean).join('\n')
    })

    return {
      content: normalizeWhitespace(content).slice(0, 1800),
      finalUrl: page.url(),
    }
  } finally {
    await page.close().catch(() => {})
  }
}

export function buildQueryVariants(input: string | Partial<WebSearchInput> | NormalizedWebSearchRequest) {
  const query = typeof input === 'string' ? input : String(input.query ?? '')
  const request = typeof input === 'string'
    ? normalizeWebSearchRequest({ query }, query)
    : normalizeWebSearchRequest({
      query,
      queries: input.queries,
      sourceHints: input.sourceHints,
    }, query)
  const variants: string[] = []
  const push = (value: string | null | undefined) => {
    const normalized = value?.replace(/\s+/g, ' ').trim()
    if (normalized) variants.push(normalized)
  }

  if (request.sourceHints.length) {
    push(`${query} ${request.sourceHints.join(' ')}`)
  }
  push(query)
  for (const candidate of request.queries) push(candidate)
  return Array.from(new Set(variants.filter(Boolean)))
}

function hasEnoughCandidates(results: WebSearchItem[], searchLimit: number) {
  return dedupeResults(results).length >= searchLimit
}

function filterRelevantResults(request: NormalizedWebSearchRequest, results: WebSearchItem[]) {
  const sorted = sortByRelevance(request, dedupeResults(results))
  const relevant = sorted.filter((item) => scoreResult(request, item) >= 3)
  if (relevant.length) return relevant

  return sorted.filter((item) => scoreResult(request, item) >= 2)
}

function sortByRelevance(request: NormalizedWebSearchRequest, results: WebSearchItem[]) {
  return [...results].sort((a, b) => scoreResult(request, b) - scoreResult(request, a))
}

function scoreResult(request: NormalizedWebSearchRequest, result: WebSearchItem) {
  const haystack = `${result.title} ${result.snippet} ${result.url} ${result.content ?? ''}`.toLowerCase()
  const queryText = [request.query, ...request.queries, ...request.sourceHints].join(' ')
  const tokens = Array.from(new Set(queryText.toLowerCase().match(/[a-z0-9.]+|[\u4e00-\u9fa5]{2,}/g) ?? []))
    .filter((token) => token.length >= 2 && token !== 'site')
  const tokenScore = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0)
  const normalizedQuery = request.query.toLowerCase().replace(/\s+/g, ' ').trim()
  const phraseScore = normalizedQuery && haystack.includes(normalizedQuery) ? 3 : 0
  const sourceHintScore = request.sourceHints.reduce((sum, hint) => (
    haystack.includes(hint.toLowerCase()) ? sum + 2 : sum
  ), 0)
  const contentScore = result.content && result.content.length >= 80 ? 1 : 0
  return tokenScore + phraseScore + sourceHintScore + contentScore
}

function normalizeDuckUrl(raw: string) {
  const normalized = raw.startsWith('//') ? `https:${raw}` : raw
  try {
    const url = new URL(normalized)
    return url.searchParams.get('uddg') ?? normalized
  } catch {
    return normalized.startsWith('http') ? normalized : ''
  }
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function dedupeResults(items: WebSearchItem[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (!item.title || !item.url || seen.has(item.url)) return false
    seen.add(item.url)
    return true
  })
}
