const queryString = (params: URLSearchParams | Record<string, string | number | boolean | null | undefined>) => {
  if (params instanceof URLSearchParams) return params.toString()

  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue
    searchParams.set(key, String(value))
  }
  return searchParams.toString()
}

function withQuery(baseUrl: string, params: URLSearchParams | Record<string, string | number | boolean | null | undefined>) {
  const qs = queryString(params)
  return qs ? `${baseUrl}?${qs}` : baseUrl
}

export const THIRD_PARTY_API_BASES = {
  alphaVantage: 'https://www.alphavantage.co/query',
  binance: [
    'https://api.binance.com',
    'https://api.binance.us',
  ],
  chinaHoliday: 'https://api.jiejiariapi.com/v1/holidays',
  coinbaseExchange: 'https://api.exchange.coinbase.com',
  exchangeRateLatestUsd: 'https://api.exchangerate-api.com/v4/latest/USD',
  googleNewsRss: 'https://news.google.com/rss/search',
  nasdaqQuote: 'https://api.nasdaq.com/api/quote',
  cninfoAnnouncementQuery: 'https://www.cninfo.com.cn/new/hisAnnouncement/query',
  eastmoneyDatacenter: 'https://datacenter-web.eastmoney.com/api/data/v1/get',
  eastmoneyReportList: 'https://reportapi.eastmoney.com/report/list',
  eastmoneySearch: 'https://searchapi.eastmoney.com/api/suggest/get',
  eastmoneyStockList: 'https://push2.eastmoney.com/api/qt/clist/get',
  eastmoneyStockGet: 'https://push2.eastmoney.com/api/qt/stock/get',
  eastmoneyStockFundFlow: 'https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get',
  secCompanyTickers: 'https://www.sec.gov/files/company_tickers.json',
  secData: 'https://data.sec.gov',
  sinaFinanceProfitStatement: 'https://vip.stock.finance.sina.com.cn/corp/go.php/vFD_ProfitStatement/stockid',
  sinaFinanceReport2022: 'https://quotes.sina.cn/cn/api/openapi.php/CompanyFinanceService.getFinanceReport2022',
  sinaHq: 'https://hq.sinajs.cn/list',
  stooqDaily: 'https://stooq.com/q/d/l/',
  stooqQuote: 'https://stooq.com/q/l/',
  thsWorth: 'https://basic.10jqka.com.cn/new',
  tencentFqKline: 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get',
  tencentMinuteKline: 'https://ifzq.gtimg.cn/appstock/app/kline/mkline',
  tencentQuote: 'https://qt.gtimg.cn',
  tencentSmartbox: 'https://smartbox.gtimg.cn/s3/',
  yahooCrumb: 'https://query2.finance.yahoo.com/v1/test/getcrumb',
  yahooFc: 'https://fc.yahoo.com',
  yahooFinanceSearch: 'https://query2.finance.yahoo.com/v1/finance/search',
  yahooOptions: 'https://query2.finance.yahoo.com/v7/finance/options',
  yahooQuoteSummary: 'https://query2.finance.yahoo.com/v10/finance/quoteSummary',
  yahooChart: 'https://query1.finance.yahoo.com/v8/finance/chart',
  yahooQuote: [
    'https://query1.finance.yahoo.com/v7/finance/quote',
    'https://query2.finance.yahoo.com/v7/finance/quote',
  ],
} as const

export const THIRD_PARTY_API_EXAMPLES = {
  openAiCompatibleBaseUrl: 'https://api.openai.com/v1',
} as const

export const THIRD_PARTY_SEARCH_URLS = {
  baidu: (query: string) => withQuery('https://www.baidu.com/s', { wd: query }),
  bing: (query: string) => withQuery('https://cn.bing.com/search', { q: query }),
  duckDuckGo: (query: string) => withQuery('https://duckduckgo.com/html/', { q: query }),
  google: (query: string, limit: number) => withQuery('https://www.google.com/search', {
    q: query,
    hl: 'zh-CN',
    num: limit,
  }),
  sogou: (query: string) => withQuery('https://www.sogou.com/web', { query }),
} as const

export const THIRD_PARTY_REQUEST_HEADERS = {
  nasdaq: {
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://www.nasdaq.com',
    Referer: 'https://www.nasdaq.com/',
    'User-Agent': 'Mozilla/5.0',
  },
  tencentFinance: {
    Referer: 'https://finance.qq.com',
  },
  yahooFinance: {
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0',
  },
  browserLike: {
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  },
} as const

export const THIRD_PARTY_WEB_FETCH_ALLOWED_HOSTS = [
  'finance.yahoo.com',
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'qt.gtimg.cn',
  'web.ifzq.gtimg.cn',
  'ifzq.gtimg.cn',
  'api.nasdaq.com',
  'stooq.com',
  'www.alphavantage.co',
  'push2.eastmoney.com',
  'data.eastmoney.com',
  'datacenter-web.eastmoney.com',
  'emweb.securities.eastmoney.com',
  'datacenter.eastmoney.com',
  'reportapi.eastmoney.com',
  'searchapi.eastmoney.com',
  'push2his.eastmoney.com',
  'data.sec.gov',
  'www.sec.gov',
  'www.cninfo.com.cn',
  'api.exchangerate-api.com',
  'news.google.com',
  'vip.stock.finance.sina.com.cn',
  'quotes.sina.cn',
  'hq.sinajs.cn',
  'money.finance.sina.com.cn',
  'basic.10jqka.com.cn',
  'api.jiejiariapi.com',
] as const

export const thirdPartyApiUrls = {
  alphaVantageQuery(params: URLSearchParams | Record<string, string | number | boolean | null | undefined>) {
    return withQuery(THIRD_PARTY_API_BASES.alphaVantage, params)
  },
  binanceKlines(baseUrl: string, params: URLSearchParams | Record<string, string | number | boolean | null | undefined>) {
    return withQuery(`${baseUrl}/api/v3/klines`, params)
  },
  binanceTicker24h(baseUrl: string, symbol: string) {
    return withQuery(`${baseUrl}/api/v3/ticker/24hr`, { symbol })
  },
  chinaHolidayYear(year: number) {
    return `${THIRD_PARTY_API_BASES.chinaHoliday}/${year}`
  },
  coinbaseCandles(productId: string, params: URLSearchParams | Record<string, string | number | boolean | null | undefined>) {
    return withQuery(`${THIRD_PARTY_API_BASES.coinbaseExchange}/products/${encodeURIComponent(productId)}/candles`, params)
  },
  coinbaseStats(productId: string) {
    return `${THIRD_PARTY_API_BASES.coinbaseExchange}/products/${encodeURIComponent(productId)}/stats`
  },
  googleNewsRss(query: string) {
    return withQuery(THIRD_PARTY_API_BASES.googleNewsRss, {
      q: query,
      hl: 'zh-CN',
      gl: 'CN',
      ceid: 'CN:zh-Hans',
    })
  },
  llmChatCompletions(baseUrl: string) {
    return `${baseUrl}/chat/completions`
  },
  llmMessages(baseUrl: string) {
    return `${baseUrl}/messages`
  },
  nasdaqChart(symbol: string) {
    return `${THIRD_PARTY_API_BASES.nasdaqQuote}/${encodeURIComponent(symbol.toUpperCase())}/chart?assetclass=stocks`
  },
  nasdaqHistorical(symbol: string, fromDate: string) {
    return withQuery(`${THIRD_PARTY_API_BASES.nasdaqQuote}/${encodeURIComponent(symbol.toUpperCase())}/historical`, {
      assetclass: 'stocks',
      limit: 500,
      fromdate: fromDate,
    })
  },
  cninfoAnnouncementQuery() {
    return THIRD_PARTY_API_BASES.cninfoAnnouncementQuery
  },
  eastmoneyDatacenter(params: URLSearchParams | Record<string, string | number | boolean | null | undefined>) {
    return withQuery(THIRD_PARTY_API_BASES.eastmoneyDatacenter, params)
  },
  eastmoneyReportList(params: URLSearchParams | Record<string, string | number | boolean | null | undefined>) {
    return withQuery(THIRD_PARTY_API_BASES.eastmoneyReportList, params)
  },
  eastmoneyStockGet(params: URLSearchParams | Record<string, string | number | boolean | null | undefined>) {
    return withQuery(THIRD_PARTY_API_BASES.eastmoneyStockGet, params)
  },
  eastmoneyStockFundFlow(params: URLSearchParams | Record<string, string | number | boolean | null | undefined>) {
    return withQuery(THIRD_PARTY_API_BASES.eastmoneyStockFundFlow, params)
  },
  sinaProfitStatement(symbol: string) {
    return `${THIRD_PARTY_API_BASES.sinaFinanceProfitStatement}/${encodeURIComponent(symbol)}/ctrl/part/displaytype/4.phtml`
  },
  sinaFinanceReport2022(params: URLSearchParams | Record<string, string | number | boolean | null | undefined>) {
    return withQuery(THIRD_PARTY_API_BASES.sinaFinanceReport2022, params)
  },
  stooqDailyDownload(symbol: string) {
    return withQuery(THIRD_PARTY_API_BASES.stooqDaily, { s: symbol, i: 'd' })
  },
  stooqQuote(symbol: string, interval = '5') {
    return withQuery(THIRD_PARTY_API_BASES.stooqQuote, { s: symbol, i: interval })
  },
  tencentDailyKline(code: string, limit: number) {
    return withQuery(THIRD_PARTY_API_BASES.tencentFqKline, { param: `${code},day,,,${limit},qfq` })
  },
  tencentMinuteKline(code: string, interval: string, bars: number) {
    return withQuery(THIRD_PARTY_API_BASES.tencentMinuteKline, { param: `${code},${interval},,${bars}` })
  },
  tencentQuote(codes: string | string[], cacheBust?: number) {
    const codeList = Array.isArray(codes) ? codes.join(',') : codes
    return `${THIRD_PARTY_API_BASES.tencentQuote}/q=${codeList}${cacheBust ? `&r=${cacheBust}` : ''}`
  },
  tencentSmartbox(query: string) {
    return withQuery(THIRD_PARTY_API_BASES.tencentSmartbox, { t: 'all', q: query })
  },
  thsWorth(code: string) {
    return `${THIRD_PARTY_API_BASES.thsWorth}/${encodeURIComponent(code)}/worth.html`
  },
  yahooChart(symbol: string, range = '1d', interval = '1d') {
    return withQuery(`${THIRD_PARTY_API_BASES.yahooChart}/${encodeURIComponent(symbol)}`, { range, interval })
  },
  yahooCrumb() {
    return THIRD_PARTY_API_BASES.yahooCrumb
  },
  yahooFc() {
    return THIRD_PARTY_API_BASES.yahooFc
  },
  yahooFinanceSearch(params: URLSearchParams | Record<string, string | number | boolean | null | undefined>) {
    return withQuery(THIRD_PARTY_API_BASES.yahooFinanceSearch, params)
  },
  yahooOptions(symbol: string, params?: URLSearchParams | Record<string, string | number | boolean | null | undefined>) {
    const base = `${THIRD_PARTY_API_BASES.yahooOptions}/${encodeURIComponent(symbol)}`
    return params ? withQuery(base, params) : base
  },
  yahooQuoteSummary(symbol: string, params: URLSearchParams | Record<string, string | number | boolean | null | undefined>) {
    return withQuery(`${THIRD_PARTY_API_BASES.yahooQuoteSummary}/${encodeURIComponent(symbol)}`, params)
  },
  yahooQuoteUrls(query: string) {
    return THIRD_PARTY_API_BASES.yahooQuote.map((baseUrl) => `${baseUrl}?${query}`)
  },
  eastmoneySearch(params: URLSearchParams | Record<string, string | number | boolean | null | undefined>) {
    return withQuery(THIRD_PARTY_API_BASES.eastmoneySearch, params)
  },
  eastmoneyStockList(params: URLSearchParams | Record<string, string | number | boolean | null | undefined>) {
    return withQuery(THIRD_PARTY_API_BASES.eastmoneyStockList, params)
  },
  secCompanyTickers() {
    return THIRD_PARTY_API_BASES.secCompanyTickers
  },
  secSubmissions(cik: string) {
    return `${THIRD_PARTY_API_BASES.secData}/submissions/CIK${encodeURIComponent(cik)}.json`
  },
  secCompanyFacts(cik: string) {
    return `${THIRD_PARTY_API_BASES.secData}/api/xbrl/companyfacts/CIK${encodeURIComponent(cik)}.json`
  },
  sinaHq(symbols: string | string[]) {
    const list = Array.isArray(symbols) ? symbols.join(',') : symbols
    return `${THIRD_PARTY_API_BASES.sinaHq}=${list}`
  },
} as const
