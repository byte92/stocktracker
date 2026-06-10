import test from 'node:test'
import assert from 'node:assert/strict'
import { StockPriceService } from '@/lib/StockPriceService'
import { DEFAULT_STOCK_SERVICE_CONFIG } from '@/config/dataSources'

test('default quote fallback chains exclude Stooq because the public CSV endpoint is no longer reliable', () => {
  const service = new StockPriceService()
  const usFallback = (service as unknown as { getFallbackChain: (market: string) => string[] }).getFallbackChain('US')

  assert.equal(usFallback.includes('stooq'), false)
  assert.equal(service.getConfig().fallbackChain.includes('stooq'), false)
  assert.equal(DEFAULT_STOCK_SERVICE_CONFIG.fallbackChain.includes('stooq'), false)
})
