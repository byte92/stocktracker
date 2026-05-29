import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchGlobalFinancialContext, fetchGlobalStockSignals, searchGlobalStocks } from '@/lib/external/globalStock'

const originalFetch = globalThis.fetch

function jsonResponse(data: unknown, headers?: HeadersInit) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json', ...headers } })
}

test('searchGlobalStocks maps Eastmoney markets to app markets', async () => {
  globalThis.fetch = async () => jsonResponse({
    QuotationCodeTable: {
      Data: [
        { Code: 'AAPL', Name: '苹果', MktNum: '105', SecurityTypeName: '美股' },
        { Code: '00700', Name: '腾讯控股', MktNum: '116', SecurityTypeName: '港股' },
      ],
    },
  })

  try {
    const rows = await searchGlobalStocks('apple')

    assert.equal(rows[0]?.market, 'US')
    assert.equal(rows[0]?.secid, '105.AAPL')
    assert.equal(rows[1]?.market, 'HK')
    assert.equal(rows[1]?.secucode, '00700.HK')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchGlobalFinancialContext aggregates Eastmoney Yahoo and SEC sources', async () => {
  globalThis.fetch = async (input) => {
    const url = decodeURIComponent(String(input))
    if (url.includes('searchapi.eastmoney.com')) {
      return jsonResponse({ QuotationCodeTable: { Data: [{ Code: 'AAPL', Name: '苹果', MktNum: '105', SecurityTypeName: '美股' }] } })
    }
    if (url.includes('RPT_USF10_FN_BALANCE')) {
      return jsonResponse({ result: { data: [{ REPORT_DATE: '2026-03-31', ITEM_NAME: '资产总计', AMOUNT: 1000, CURRENCY: '美元' }] } })
    }
    if (url.includes('RPT_USF10_FN_INCOME')) {
      return jsonResponse({ result: { data: [{ REPORT_DATE: '2026-03-31', ITEM_NAME: '营业收入', AMOUNT: 500, CURRENCY: '美元' }] } })
    }
    if (url.includes('RPT_USSK_FN_CASHFLOW')) {
      return jsonResponse({ result: { data: [{ REPORT_DATE: '2026-03-31', ITEM_NAME: '经营现金流', AMOUNT: 120, CURRENCY: '美元' }] } })
    }
    if (url.includes('RPT_USF10_FN_GMAININDICATOR')) {
      return jsonResponse({ result: { data: [{ REPORT_DATE: '2026-03-31', OPERATE_INCOME: 500, BASIC_EPS: 1.2, ROE_AVG: 20 }] } })
    }
    if (url.includes('fc.yahoo.com')) {
      return new Response('', { headers: { 'set-cookie': 'A=B;' } })
    }
    if (url.includes('getcrumb')) {
      return new Response('crumb')
    }
    if (url.includes('quoteSummary')) {
      return jsonResponse({ quoteSummary: { result: [{ financialData: { currentPrice: { raw: 190 }, recommendationKey: 'buy' }, defaultKeyStatistics: { forwardPE: { raw: 25 } }, summaryDetail: { marketCap: { raw: 3000000000000 } } }] } })
    }
    if (url.includes('company_tickers')) {
      return jsonResponse({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } })
    }
    if (url.includes('/submissions/')) {
      return jsonResponse({ name: 'Apple Inc.', tickers: ['AAPL'], filings: { recent: { form: ['10-Q'], filingDate: ['2026-05-01'], accessionNumber: ['0000320193-26-000001'], primaryDocument: ['aapl-20260331.htm'], primaryDocDescription: ['10-Q'] } } })
    }
    if (url.includes('/companyfacts/')) {
      return jsonResponse({ entityName: 'Apple Inc.', facts: { 'us-gaap': { Revenues: { units: { USD: [{ end: '2026-03-31', val: 1000, form: '10-Q', filed: '2026-05-01', fy: 2026, fp: 'Q2' }] } } } } })
    }
    throw new Error(`Unexpected URL ${url}`)
  }

  try {
    const context = await fetchGlobalFinancialContext('AAPL', 'US')

    assert.equal(context?.target.secid, '105.AAPL')
    assert.equal(context?.statements.income[0]?.itemName, '营业收入')
    assert.equal(context?.keyIndicators[0]?.eps, 1.2)
    assert.equal(context?.yahooKeyStatistics?.forwardPe, 25)
    assert.equal(context?.secFilings?.filings[0]?.form, '10-Q')
    assert.equal(context?.secCompanyFacts?.metrics.Revenues?.[0]?.value, 1000)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchGlobalStockSignals maps options SEC news and fund flow', async () => {
  globalThis.fetch = async (input) => {
    const url = decodeURIComponent(String(input))
    if (url.includes('searchapi.eastmoney.com')) {
      return jsonResponse({ QuotationCodeTable: { Data: [{ Code: 'AAPL', Name: '苹果', MktNum: '105', SecurityTypeName: '美股' }] } })
    }
    if (url.includes('fflow/daykline')) {
      return jsonResponse({ data: { klines: ['2026-05-20,100,-20,30,40,60,1.2'] } })
    }
    if (url.includes('fc.yahoo.com')) return new Response('', { headers: { 'set-cookie': 'A=B;' } })
    if (url.includes('getcrumb')) return new Response('crumb')
    if (url.includes('/finance/options/')) {
      return jsonResponse({ optionChain: { result: [{ expirationDates: [1780000000], quote: { regularMarketPrice: 190 }, options: [{ calls: [{ strike: 200, lastPrice: 3, inTheMoney: false, contractSymbol: 'AAPL260101C00200000' }], puts: [{ strike: 180, lastPrice: 2, inTheMoney: false, contractSymbol: 'AAPL260101P00180000' }] }] }] } })
    }
    if (url.includes('/finance/search')) {
      return jsonResponse({ news: [{ title: 'Apple news', publisher: 'Yahoo', link: 'https://example.com', providerPublishTime: 1780000000 }] })
    }
    if (url.includes('company_tickers')) {
      return jsonResponse({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } })
    }
    if (url.includes('/submissions/')) {
      return jsonResponse({ name: 'Apple Inc.', tickers: ['AAPL'], filings: { recent: { form: ['8-K'], filingDate: ['2026-05-02'], accessionNumber: ['0000320193-26-000002'], primaryDocument: ['aapl-8k.htm'], primaryDocDescription: ['8-K'] } } })
    }
    throw new Error(`Unexpected URL ${url}`)
  }

  try {
    const signals = await fetchGlobalStockSignals('AAPL', 'US')

    assert.equal(signals?.fundFlow[0]?.mainNet, 100)
    assert.equal(signals?.options?.calls[0]?.strike, 200)
    assert.equal(signals?.secFilings?.filings[0]?.form, '8-K')
    assert.equal(signals?.news[0]?.title, 'Apple news')
  } finally {
    globalThis.fetch = originalFetch
  }
})
