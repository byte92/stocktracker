// 免费数据源配置

import type { DataSourceConfig, DataSourceProvider } from '@/types/stockApi'
import type { Market } from '@/types'
import { THIRD_PARTY_API_BASES } from '@/lib/external/thirdPartyApis'

// 腾讯财经（默认，无需Key，支持A股/港股）
export const TENCENT_CONFIG: DataSourceConfig = {
  provider: 'tencent',
  rateLimit: 60,
  cacheTtl: 60,
}

// Alpha Vantage 备选
export const ALPHA_VANTAGE_CONFIG: DataSourceConfig = {
  provider: 'alpha-vantage',
  apiKey: process.env.ALPHA_VANTAGE_API_KEY || process.env.NEXT_PUBLIC_ALPHA_VANTAGE_API_KEY || '',
  baseUrl: THIRD_PARTY_API_BASES.alphaVantage,
  rateLimit: 5,
  cacheTtl: 300,
}

// 手动输入模式（Fallback）
export const MANUAL_CONFIG: DataSourceConfig = {
  provider: 'manual',
  rateLimit: 1000,
  cacheTtl: 0,
}

// Stooq legacy adapter：公开 CSV 端点当前不稳定，不进入默认 fallback 链。
export const STOOQ_CONFIG: DataSourceConfig = {
  provider: 'stooq',
  rateLimit: 120,
  cacheTtl: 60,
}

// 加密货币行情（聚合公开现货 API，无需 Key）
export const CRYPTO_CONFIG: DataSourceConfig = {
  provider: 'crypto',
  rateLimit: 120,
  cacheTtl: 15,
}

// 默认服务配置
export const DEFAULT_STOCK_SERVICE_CONFIG = {
  defaultProvider: 'tencent' as DataSourceProvider,
  sources: {
    'tencent': TENCENT_CONFIG,
    'alpha-vantage': ALPHA_VANTAGE_CONFIG,
    'crypto': CRYPTO_CONFIG,
    'manual': MANUAL_CONFIG,
  },
  cacheEnabled: true,
  cacheTtl: 60,
  fallbackChain: ['tencent', 'crypto', 'alpha-vantage', 'manual'] as DataSourceProvider[],
}

// 统一的代码转换规则：按市场 + 数据源生成标准代码，不维护硬编码映射表
export function normalizeSymbol(code: string, market: Market, provider: DataSourceProvider): string {
  const c = code.trim().toUpperCase()

  if (provider === 'tencent') {
    if (market === 'HK') return `hk${c.padStart(5, '0')}`
    if (market === 'A' || market === 'FUND') return c.startsWith('6') || c.startsWith('5') ? `sh${c}` : `sz${c}`
    if (market === 'US') return `us${c}`
    return c
  }

  if (provider === 'alpha-vantage') {
    if (market === 'HK') return `${c.padStart(4, '0')}.HK`
    if (market === 'A' || market === 'FUND') return c.startsWith('6') || c.startsWith('5') ? `${c}.SS` : `${c}.SZ`
    return c
  }

  if (provider === 'stooq') {
    if (market === 'US') return `${c.toLowerCase()}.us`
    return c.toLowerCase()
  }

  if (provider === 'crypto') {
    return c.replace(/[-_/\s]/g, '')
  }

  return c
}
