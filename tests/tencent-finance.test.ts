import test from 'node:test'
import assert from 'node:assert/strict'
import iconv from 'iconv-lite'
import { TencentFinanceSource } from '@/lib/dataSources/TencentFinanceSource'

const originalFetch = globalThis.fetch

function createTencentQuoteLine(symbol: string, fields: Record<number, string>) {
  const parts = Array.from({ length: 80 }, () => '')
  parts[0] = '1'
  parts[1] = symbol
  parts[3] = '10.00'
  parts[4] = '9.50'
  parts[5] = '9.60'
  parts[6] = '12345'
  parts[30] = '20260415'
  parts[31] = '153000'

  for (const [index, value] of Object.entries(fields)) {
    parts[Number(index)] = value
  }

  return `v_mock="${parts.join('~')}";`
}

function createTencentResponse(line: string) {
  return new Response(iconv.encode(line, 'GBK') as unknown as BodyInit)
}

test('腾讯行情源会解析 A 股估值字段', async () => {
  const source = new TencentFinanceSource({ provider: 'tencent' })
  const quoteLine = createTencentQuoteLine('贵州茅台', {
    1: '贵州茅台',
    3: '1467.50',
    4: '1450.00',
    44: '18377.07',
    46: '8.09',
    53: '21.31',
  })

  globalThis.fetch = async () => createTencentResponse(quoteLine)

  try {
    const quote = await source.getQuote('600519', 'A')

    assert.ok(quote)
    assert.equal(quote.peTtm, 21.31)
    assert.equal(quote.pb, 8.09)
    assert.equal(quote.marketCap, 1837707000000)
    assert.equal(quote.valuationSource, 'tencent')
    assert.equal(quote.currency, 'CNY')
    assert.equal(quote.epsTtm, 68.8644)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('腾讯行情源会解析港股估值字段', async () => {
  const source = new TencentFinanceSource({ provider: 'tencent' })
  const quoteLine = createTencentQuoteLine('腾讯控股', {
    1: '腾讯控股',
    3: '499.00',
    4: '495.20',
    44: '45536.7322',
    57: '18.29',
    58: '3.59',
  })

  globalThis.fetch = async () => createTencentResponse(quoteLine)

  try {
    const quote = await source.getQuote('00700', 'HK')

    assert.ok(quote)
    assert.equal(quote.peTtm, 18.29)
    assert.equal(quote.pb, 3.59)
    assert.equal(quote.marketCap, 4553673220000)
    assert.equal(quote.valuationSource, 'tencent')
    assert.equal(quote.currency, 'HKD')
    assert.equal(quote.epsTtm, 27.2827)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('腾讯行情源会解析美股中文名称', async () => {
  const source = new TencentFinanceSource({ provider: 'tencent' })
  const quoteLine = createTencentQuoteLine('携程', {
    1: '携程',
    3: '50.10',
    4: '49.32',
  })

  globalThis.fetch = async () => createTencentResponse(quoteLine)

  try {
    const quote = await source.getQuote('TCOM', 'US')

    assert.ok(quote)
    assert.equal(quote.name, '携程')
    assert.equal(quote.symbol, 'TCOM')
    assert.equal(quote.currency, 'USD')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('腾讯行情源对基金不返回 PE 和 PB', async () => {
  const source = new TencentFinanceSource({ provider: 'tencent' })
  const quoteLine = createTencentQuoteLine('沪深300ETF', {
    1: '沪深300ETF',
    3: '4.10',
    4: '4.08',
    44: '999.99',
    46: '8.09',
    53: '21.31',
  })

  globalThis.fetch = async () => createTencentResponse(quoteLine)

  try {
    const quote = await source.getQuote('510300', 'FUND')

    assert.ok(quote)
    assert.equal(quote.peTtm, undefined)
    assert.equal(quote.pb, undefined)
    assert.equal(quote.marketCap, undefined)
    assert.equal(quote.valuationSource, undefined)
    assert.equal(quote.currency, 'CNY')
  } finally {
    globalThis.fetch = originalFetch
  }
})
