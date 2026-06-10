// 行情服务主类 - 管理多个数据源和故障转移
import type { StockQuote, StockServiceConfig, DataSourceProvider, QuoteCacheItem, StockDataSource } from '@/types/stockApi'
import type { Market } from '@/types'
import { TencentFinanceSource } from '@/lib/dataSources/TencentFinanceSource'
import { NasdaqSource } from '@/lib/dataSources/NasdaqSource'
import { AlphaVantageDataSource } from '@/lib/dataSources/AlphaVantageSource'
import { YahooFinanceSource } from '@/lib/dataSources/YahooFinanceSource'
import { StooqSource } from '@/lib/dataSources/StooqSource'
import { CryptoSource } from '@/lib/dataSources/CryptoSource'
import { ManualDataSource } from '@/lib/dataSources/ManualSource'
import { logger } from '@/lib/observability/logger'

const DEFAULT_CONFIG: StockServiceConfig = {
  defaultProvider: 'tencent',
  sources: {
    tencent: { provider: 'tencent', rateLimit: 60, cacheTtl: 60 },
    nasdaq: { provider: 'nasdaq', rateLimit: 60, cacheTtl: 30 },
    'yahoo-finance': { provider: 'yahoo-finance', rateLimit: 30, cacheTtl: 60 },
    'alpha-vantage': {
      provider: 'alpha-vantage',
      apiKey: process.env.ALPHA_VANTAGE_API_KEY ?? process.env.NEXT_PUBLIC_ALPHA_VANTAGE_API_KEY ?? '',
      rateLimit: 5,
      cacheTtl: 300,
    },
    crypto: { provider: 'crypto', rateLimit: 120, cacheTtl: 15 },
    manual: { provider: 'manual', rateLimit: 1000, cacheTtl: 0 },
  },
  cacheEnabled: true,
  cacheTtl: 60,
  fallbackChain: ['tencent', 'nasdaq', 'yahoo-finance', 'crypto', 'alpha-vantage', 'manual'],
}

/**
 * 行情报价聚合服务，负责管理多个数据源、按市场选择 fallback 链路，并对报价结果做短期缓存。
 */
export class StockPriceService {
  private config: StockServiceConfig
  private sources: Map<DataSourceProvider, StockDataSource> = new Map()
  private cache: Map<string, QuoteCacheItem> = new Map()

  constructor(config: Partial<StockServiceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.initSources()
  }

  private initSources() {
    const s = this.config.sources
    if (s.tencent) this.sources.set('tencent', new TencentFinanceSource(s.tencent))
    if (s.nasdaq) this.sources.set('nasdaq', new NasdaqSource(s.nasdaq))
    if (s['yahoo-finance']) this.sources.set('yahoo-finance', new YahooFinanceSource(s['yahoo-finance']))
    if (s.stooq) this.sources.set('stooq', new StooqSource(s.stooq))
    if (s.crypto) this.sources.set('crypto', new CryptoSource(s.crypto))
    if (s['alpha-vantage']) this.sources.set('alpha-vantage', new AlphaVantageDataSource(s['alpha-vantage']))
    if (s.manual) this.sources.set('manual', new ManualDataSource(s.manual))
  }

  async getQuote(symbol: string, market: Market): Promise<StockQuote | null> {
    const key = `${symbol}_${market}`
    // 检查缓存
    if (this.config.cacheEnabled) {
      const cached = this.cache.get(key)
      if (cached && Date.now() < cached.expiresAt) return cached.quote
    }
    for (const provider of this.getFallbackChain(market)) {
      const source = this.sources.get(provider)
      if (!source) continue
      try {
        const quote = await source.getQuote(symbol, market)
        if (quote) {
          const localizedQuote = await this.withPreferredChineseName(quote, symbol, market)
          this.setCache(key, localizedQuote, provider)
          return localizedQuote
        }
      } catch (e) {
        logger.warn('quote.provider.failed', { error: e, provider, symbol, market })
      }
    }
    return null
  }

  async getBatchQuotes(symbols: string[], market: Market): Promise<StockQuote[]> {
    const results: StockQuote[] = []
    for (const s of symbols) {
      const q = await this.getQuote(s, market)
      if (q) results.push(q)
    }
    return results
  }

  clearCache(symbol?: string, market?: Market) {
    if (symbol && market) this.cache.delete(`${symbol}_${market}`)
    else this.cache.clear()
  }

  getConfig() { return this.config }

  private getFallbackChain(market: Market) {
    if (market === 'US') {
      return ['nasdaq', 'tencent', 'yahoo-finance', 'alpha-vantage', 'manual'] as DataSourceProvider[]
    }
    if (market === 'CRYPTO') {
      return ['crypto', 'manual'] as DataSourceProvider[]
    }
    return this.config.fallbackChain
  }

  private async withPreferredChineseName(quote: StockQuote, symbol: string, market: Market): Promise<StockQuote> {
    if (market !== 'US' && market !== 'HK') return quote
    if (hasChineseText(quote.name)) return quote

    const tencent = this.sources.get('tencent')
    if (!tencent) return quote

    try {
      const localizedQuote = await tencent.getQuote(symbol, market)
      const localizedName = localizedQuote?.name?.trim()
      if (!localizedName || !hasChineseText(localizedName)) return quote
      return { ...quote, name: localizedName }
    } catch (error) {
      logger.warn('quote.localizedName.failed', { error, symbol, market })
      return quote
    }
  }

  private setCache(key: string, quote: StockQuote, provider: DataSourceProvider) {
    const ttl = this.config.sources[provider]?.cacheTtl ?? this.config.cacheTtl
    this.cache.set(key, { quote, timestamp: Date.now(), expiresAt: Date.now() + ttl * 1000 })
  }
}

function hasChineseText(value: string) {
  return /[\u3400-\u9fff]/.test(value)
}

export const stockPriceService = new StockPriceService()
