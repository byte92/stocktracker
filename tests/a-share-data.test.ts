import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchAShareFinancialContext, fetchAShareSignals, normalizeAStockCode } from '@/lib/external/aShare'
import { parseThsEpsForecastHtml } from '@/lib/external/aShare/ths'

const originalFetch = globalThis.fetch

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
}

test('normalizeAStockCode accepts common A-share ticker formats', () => {
  assert.equal(normalizeAStockCode('SH688017'), '688017')
  assert.equal(normalizeAStockCode('688017.SH'), '688017')
  assert.equal(normalizeAStockCode('sz000001'), '000001')
})

test('parseThsEpsForecastHtml reads EPS forecast rows', () => {
  const rows = parseThsEpsForecastHtml(`
    <table>
      <tr><th>年度</th><th>预测机构数</th><th>最小值</th><th>均值</th><th>最大值</th></tr>
      <tr><td>2026</td><td>12</td><td>1.20</td><td>1.50</td><td>1.80</td></tr>
      <tr><td>2027</td><td>10</td><td>1.45</td><td>1.90</td><td>2.20</td></tr>
    </table>
  `)

  assert.equal(rows.length, 2)
  assert.equal(rows[0]?.year, '2026')
  assert.equal(rows[0]?.institutionCount, 12)
  assert.equal(rows[0]?.avg, 1.5)
})

test('fetchAShareFinancialContext aggregates no-key HTTP sources', async () => {
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes('api/qt/stock/get')) {
      return jsonResponse({ data: { f57: '688017', f58: '绿的谐波', f127: '通用设备', f116: 12300000000, f117: 10000000000, f84: 1000, f85: 800, f189: '20200828', f43: 120.5 } })
    }
    if (url.includes('reportapi.eastmoney.com/report/list')) {
      return jsonResponse({ data: [{ title: '业绩增长点评', publishDate: '2026-05-01 00:00:00', orgSName: '测试证券', emRatingName: '买入', indvInduName: '机械', infoCode: 'ABC123', predictThisYearEps: '1.5', predictNextYearEps: '2.0' }] })
    }
    if (url.includes('quotes.sina.cn')) {
      const source = new URL(url).searchParams.get('source') ?? 'lrb'
      return jsonResponse({ result: { data: { [source]: [{ 报告日: '2026-03-31', 营业收入: '1000000000', 净利润: '100000000' }] } } })
    }
    if (url.includes('basic.10jqka.com.cn')) {
      return new Response('<table><tr><td>2026</td><td>12</td><td>1.2</td><td>1.5</td><td>1.8</td></tr></table>')
    }
    if (url.includes('cninfo.com.cn')) {
      return jsonResponse({ announcements: [{ announcementTitle: '2026年第一季度报告', announcementTypeName: '定期报告', announcementTime: 1777392000000, announcementId: '1212' }] })
    }
    throw new Error(`Unexpected URL ${url}`)
  }

  try {
    const context = await fetchAShareFinancialContext('SH688017')

    assert.equal(context.stockInfo?.name, '绿的谐波')
    assert.equal(context.reports[0]?.epsForecasts.nextYear, 2)
    assert.equal(context.statements.profit[0]?.reportDate, '2026-03-31')
    assert.equal(context.epsForecasts[0]?.avg, 1.5)
    assert.equal(context.announcements[0]?.title, '2026年第一季度报告')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchAShareSignals maps Eastmoney signal rows', async () => {
  globalThis.fetch = async (input) => {
    const url = decodeURIComponent(String(input))
    if (url.includes('RPT_DAILYBILLBOARD_DETAILSNEW')) {
      return jsonResponse({ result: { data: [{ TRADE_DATE: '2026-05-20', EXPLANATION: '日涨幅偏离值达7%', BILLBOARD_NET_AMT: 12300000, TURNOVERRATE: 12.3 }] } })
    }
    if (url.includes('RPT_BILLBOARD_DAILYDETAILSBUY')) {
      return jsonResponse({ result: { data: [{ OPERATEDEPT_NAME: '机构专用', BUY: 20000000, SELL: 1000000, NET: 19000000 }] } })
    }
    if (url.includes('RPT_BILLBOARD_DAILYDETAILSSELL')) {
      return jsonResponse({ result: { data: [{ OPERATEDEPT_NAME: '某营业部', BUY: 1000000, SELL: 5000000, NET: -4000000 }] } })
    }
    if (url.includes('RPT_LIFT_STAGE')) {
      return jsonResponse({ result: { data: [{ LIFT_DATE: '2026-06-01', LIFT_NUM: 1000, FREE_RATIO: 1.2 }] } })
    }
    if (url.includes('RPTA_WEB_RZRQ_GGMX')) {
      return jsonResponse({ result: { data: [{ DATE: '2026-05-20', RZYE: 100000000, RZMRE: 2000000, RZCHE: 1000000, RQYE: 500000 }] } })
    }
    if (url.includes('RPT_BLOCKTRADE_DET')) {
      return jsonResponse({ result: { data: [{ TRADE_DATE: '2026-05-18', DEAL_PRICE: 10, DEAL_VOLUME: 100, DEAL_AMT: 1000 }] } })
    }
    if (url.includes('RPT_HOLDERNUM_DET')) {
      return jsonResponse({ result: { data: [{ END_DATE: '2026-03-31', HOLDER_NUM: 12000, HOLDER_NUM_RATIO: -3.2 }] } })
    }
    if (url.includes('RPT_SHAREBONUS_DET')) {
      return jsonResponse({ result: { data: [{ EX_DIVIDEND_DATE: '2026-05-10', IMPL_PLAN_PROFILE: '10派3元', PRETAX_BONUS_RMB: 3 }] } })
    }
    if (url.includes('stock/fflow/daykline')) {
      return jsonResponse({ data: { klines: ['2026-05-20,100,1,50,1,30,1,10,1,-90,1'] } })
    }
    throw new Error(`Unexpected URL ${url}`)
  }

  try {
    const signals = await fetchAShareSignals('688017')

    assert.equal(signals.dragonTiger.records[0]?.netBuyWan, 1230)
    assert.equal(signals.dragonTiger.seats.buy[0]?.name, '机构专用')
    assert.equal(signals.lockupExpiry[0]?.ratio, 1.2)
    assert.equal(signals.marginTrading[0]?.financingBalance, 100000000)
    assert.equal(signals.dividends[0]?.cashPerShare, 0.3)
    assert.equal(signals.fundFlow120d[0]?.mainNet, 100)
  } finally {
    globalThis.fetch = originalFetch
  }
})
