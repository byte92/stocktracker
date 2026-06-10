type QueryValue = string | number | boolean | null | undefined

function withQuery(path: string, params?: URLSearchParams | Record<string, QueryValue>) {
  if (!params) return path

  const searchParams = params instanceof URLSearchParams ? params : new URLSearchParams()
  if (!(params instanceof URLSearchParams)) {
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === undefined) continue
      searchParams.set(key, String(value))
    }
  }

  const query = searchParams.toString()
  return query ? `${path}?${query}` : path
}

export const NEXT_API_ROUTES = {
  ai: {
    chat: '/api/ai/chat',
    chatDebug: '/api/ai/chat/debug',
    chatMessages: '/api/ai/chat/messages',
    chatRuns: '/api/ai/chat/runs',
    chatSessions: '/api/ai/chat/sessions',
    configStatus: '/api/ai/config/status',
    financialAnalysis: '/api/ai/financial-analysis',
    financialQa: '/api/ai/financial-qa',
    history: '/api/ai/history',
    marketAnalysis: '/api/ai/market-analysis',
    portfolioAnalysis: '/api/ai/portfolio-analysis',
    stockAnalysis: '/api/ai/stock-analysis',
    test: '/api/ai/test',
  },
  market: {
    calendar: '/api/market/calendar',
    overview: '/api/market/overview',
  },
  stock: {
    kline: '/api/stock/kline',
    quote: '/api/stock/quote',
  },
  storage: '/api/storage',
} as const

export const nextApiUrls = {
  ai: {
    chat() {
      return NEXT_API_ROUTES.ai.chat
    },
    chatDebug(params: URLSearchParams | Record<string, QueryValue>) {
      return withQuery(NEXT_API_ROUTES.ai.chatDebug, params)
    },
    chatMessages(params?: URLSearchParams | Record<string, QueryValue>) {
      return withQuery(NEXT_API_ROUTES.ai.chatMessages, params)
    },
    chatRuns(params?: URLSearchParams | Record<string, QueryValue>) {
      return withQuery(NEXT_API_ROUTES.ai.chatRuns, params)
    },
    chatSessions(params?: URLSearchParams | Record<string, QueryValue>) {
      return withQuery(NEXT_API_ROUTES.ai.chatSessions, params)
    },
    configStatus() {
      return NEXT_API_ROUTES.ai.configStatus
    },
    financialAnalysis() {
      return NEXT_API_ROUTES.ai.financialAnalysis
    },
    financialQa() {
      return NEXT_API_ROUTES.ai.financialQa
    },
    history(params?: URLSearchParams | Record<string, QueryValue>) {
      return withQuery(NEXT_API_ROUTES.ai.history, params)
    },
    marketAnalysis() {
      return NEXT_API_ROUTES.ai.marketAnalysis
    },
    portfolioAnalysis() {
      return NEXT_API_ROUTES.ai.portfolioAnalysis
    },
    stockAnalysis() {
      return NEXT_API_ROUTES.ai.stockAnalysis
    },
    test() {
      return NEXT_API_ROUTES.ai.test
    },
  },
  market: {
    calendar(market: string, year: number) {
      return withQuery(NEXT_API_ROUTES.market.calendar, { market, year })
    },
    overview() {
      return NEXT_API_ROUTES.market.overview
    },
  },
  stock: {
    kline(symbol: string, market: string, range: string, interval: string) {
      return withQuery(NEXT_API_ROUTES.stock.kline, { symbol, market, range, interval })
    },
    quote(symbol: string, market: string, options: { forceRefresh?: boolean } = {}) {
      return withQuery(NEXT_API_ROUTES.stock.quote, {
        symbol,
        market,
        forceRefresh: options.forceRefresh ? 1 : undefined,
      })
    },
  },
  storage(params?: URLSearchParams | Record<string, QueryValue>) {
    return withQuery(NEXT_API_ROUTES.storage, params)
  },
} as const
