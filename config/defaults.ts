// 默认费用配置 - 可由用户在配置页修改
import type { AiConfig, AppConfig, FeeConfig, Market } from '@/types'

export const DEFAULT_FEE_CONFIGS: Record<Market, FeeConfig> = {
  A: {
    market: 'A',
    commissionRate: 0.0001,    // 万一（可按券商实际费率调整）
    minCommission: 5,           // 最低5元
    stampDutyRate: 0.0005,      // 万五（A 股普通股票卖出）
    transferFeeRate: 0.00001,   // 万0.1（A 股普通股票双向）
  },
  HK: {
    market: 'HK',
    commissionRate: 0.0003,
    minCommission: 50,          // 港币
    stampDutyRate: 0.0013,      // 港股印花税 1.3‱ 买卖均收
    transferFeeRate: 0,
    settlementFeeRate: 0.00002,
  },
  US: {
    market: 'US',
    commissionRate: 0,          // 美股通常零佣金
    minCommission: 0,
    stampDutyRate: 0,
    transferFeeRate: 0,
  },
  FUND: {
    market: 'FUND',
    commissionRate: 0.001,      // 基金申购费
    minCommission: 0,
    stampDutyRate: 0,
    transferFeeRate: 0,
  },
  CRYPTO: {
    market: 'CRYPTO',
    commissionRate: 0.001,      // 交易所手续费 万十
    minCommission: 0,
    stampDutyRate: 0,
    transferFeeRate: 0,
  },
}

export const DEFAULT_AI_CONFIG: AiConfig = {
  enabled: false,
  provider: 'openai-compatible',
  baseUrl: '',
  model: '',
  apiKey: '',
  temperature: 0.3,
  maxContextTokens: 128000,
  newsEnabled: true,
  analysisLanguage: 'zh-CN',
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  version: '1.0.0',
  defaultMarket: 'A',
  feeConfigs: DEFAULT_FEE_CONFIGS,
  aiConfig: DEFAULT_AI_CONFIG,
  currency: {
    A: 'CNY',
    HK: 'HKD',
    US: 'USD',
    FUND: 'CNY',
    CRYPTO: 'USDT',
  },
}

export const MARKET_LABELS: Record<Market, string> = {
  A: 'A股',
  HK: '港股',
  US: '美股',
  FUND: '基金',
  CRYPTO: '加密货币',
}

export const SUPPORTED_MARKETS = ['A', 'HK', 'US', 'FUND', 'CRYPTO'] as const satisfies readonly Market[]

export const MARKET_ASSET_UNITS: Record<Market, string> = {
  A: '股',
  HK: '股',
  US: '股',
  FUND: '份',
  CRYPTO: '枚',
}

export const MARKET_CODE_PLACEHOLDERS: Record<Market, string> = {
  A: '如：000001 或 510300',
  HK: '如：00700',
  US: '如：AAPL',
  FUND: '如：510300',
  CRYPTO: '如：BTC、ETH 或 BTC-USDT',
}

const SUPPORTED_MARKET_SET = new Set<string>(SUPPORTED_MARKETS)

export function parseMarket(value: string | null | undefined): Market | null {
  return value && SUPPORTED_MARKET_SET.has(value) ? (value as Market) : null
}

export function getMarketAssetUnit(market: Market) {
  return MARKET_ASSET_UNITS[market]
}

export function getMarketQuantityStep(market: Market) {
  if (market === 'CRYPTO') return '0.00000001'
  if (market === 'FUND') return '0.0001'
  return '1'
}

export function getMarketMinQuantity(market: Market) {
  if (market === 'CRYPTO') return '0.00000001'
  if (market === 'FUND') return '0.0001'
  return '1'
}

export function getMarketCodeMinLength(market: Market) {
  if (market === 'CRYPTO' || market === 'US') return 1
  if (market === 'HK' || market === 'A' || market === 'FUND') return 4
  return 1
}

export function marketSupportsValuation(market: Market, code?: string) {
  if (market === 'FUND' || market === 'CRYPTO') return false
  if (market !== 'A' || !code) return true
  return !['5', '15', '16', '18'].some((prefix) => code.startsWith(prefix))
}
