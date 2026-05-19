import test from 'node:test'
import assert from 'node:assert/strict'
import { autoCalcFees, calcBuyNetAmount, calcSellNetAmount, calcStockSummary, estimateDeferredDividendTax, formatPnl, generateId } from '@/lib/finance'
import { DEFAULT_FEE_CONFIGS } from '@/config/defaults'
import type { FeeConfig, Stock } from '@/types'

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function createStock(trades: Stock['trades']): Stock {
  return {
    id: 'stock-1',
    code: '000001',
    name: '平安银行',
    market: 'A',
    trades,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function restoreGlobalCrypto(descriptor: PropertyDescriptor | undefined) {
  if (descriptor) {
    Object.defineProperty(globalThis, 'crypto', descriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'crypto')
  }
}

test('generateId 在 crypto.randomUUID 不可用时回退到 v4 UUID', () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')

  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      getRandomValues(bytes: Uint8Array) {
        for (let index = 0; index < bytes.length; index++) {
          bytes[index] = index
        }
        return bytes
      },
    },
  })

  try {
    const id = generateId()
    assert.match(id, UUID_V4_PATTERN)
    assert.equal(id, '00010203-0405-4607-8809-0a0b0c0d0e0f')
  } finally {
    restoreGlobalCrypto(originalCrypto)
  }
})

test('港股买入自动手续费包含印花税和结算费', () => {
  const fees = autoCalcFees('BUY', 100, 100, 'HK', '00700')

  assert.equal(fees.commission, 50)
  assert.equal(fees.tax, 13.2)
  assert.equal(fees.netAmount, 10063.2)
})

test('A股普通股票买入自动手续费包含佣金和双向过户费', () => {
  const fees = calcBuyNetAmount(10, 1000, DEFAULT_FEE_CONFIGS.A, 'A', '600519')

  assert.equal(fees.commission, 5)
  assert.equal(fees.tax, 0.1)
  assert.equal(Number(fees.netAmount.toFixed(2)), 10005.1)
})

test('A股普通股票卖出自动手续费包含印花税和过户费', () => {
  const fees = calcSellNetAmount(10, 1000, DEFAULT_FEE_CONFIGS.A, '600519')

  assert.equal(fees.commission, 5)
  assert.equal(fees.tax, 5.1)
  assert.equal(Number(fees.netAmount.toFixed(2)), 9989.9)
})

test('A股 ETF 自动手续费只收佣金，不收印花税和过户费', () => {
  const fees = autoCalcFees('SELL', 5, 10000, 'A', '510300')

  assert.equal(fees.commission, 5)
  assert.equal(fees.tax, 0)
  assert.equal(fees.netAmount, 49995)
})

test('自动手续费会读取用户配置的佣金率，而不是写死默认值', () => {
  const customAConfig: FeeConfig = {
    ...DEFAULT_FEE_CONFIGS.A,
    commissionRate: 0.0002,
    minCommission: 0,
  }
  const fees = autoCalcFees('BUY', 10, 1000, 'A', '600519', customAConfig)

  assert.equal(fees.commission, 2)
  assert.equal(fees.tax, 0.1)
  assert.equal(fees.netAmount, 10002.1)
})

test('formatPnl keeps sign before currency symbol', () => {
  assert.equal(formatPnl(123.45, 'CNY'), '+¥123.45')
  assert.equal(formatPnl(-123.45, 'CNY'), '-¥123.45')
  assert.equal(formatPnl(-123.45, 'HKD'), '-HK$123.45')
})

test('FIFO 计算已实现盈亏，当前成本价按券商摊薄口径展示', () => {
  const stock = createStock([
    {
      id: 't1',
      stockId: 'stock-1',
      type: 'BUY',
      date: '2026-01-01',
      price: 10,
      quantity: 100,
      commission: 5,
      tax: 0,
      totalAmount: 1000,
      netAmount: 1005,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 't2',
      stockId: 'stock-1',
      type: 'BUY',
      date: '2026-01-02',
      price: 12,
      quantity: 100,
      commission: 5,
      tax: 0,
      totalAmount: 1200,
      netAmount: 1205,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
    {
      id: 't3',
      stockId: 'stock-1',
      type: 'SELL',
      date: '2026-01-03',
      price: 15,
      quantity: 150,
      commission: 5,
      tax: 2.25,
      totalAmount: 2250,
      netAmount: 2242.75,
      createdAt: '2026-01-03T00:00:00.000Z',
      updatedAt: '2026-01-03T00:00:00.000Z',
    },
  ])

  const summary = calcStockSummary(stock)

  assert.equal(summary.currentHolding, 50)
  assert.equal(Number(summary.avgCostPrice.toFixed(2)), -0.66)
  assert.equal(Number(summary.realizedPnl.toFixed(2)), 635.25)
  assert.equal(Number(summary.totalCommission.toFixed(2)), 17.25)
  assert.equal(summary.tradePnlDetails[0]?.remainingQuantity, 0)
  assert.equal(summary.tradePnlDetails[0]?.soldQuantity, 100)
  assert.equal(summary.tradePnlDetails[0]?.holdingAfterTrade, 100)
  assert.equal(summary.tradePnlDetails[1]?.remainingQuantity, 50)
  assert.equal(summary.tradePnlDetails[1]?.soldQuantity, 50)
  assert.equal(summary.tradePnlDetails[1]?.holdingAfterTrade, 200)
  assert.equal(summary.tradePnlDetails[2]?.holdingAfterTrade, 50)
  assert.equal(Number(summary.tradePnlDetails[2]?.costBasis.toFixed(2)), 1607.5)
})

test('佣金精度：避免 JS 浮点乘法的舍入错误', () => {
  // 10000 * 0.0003 = 3，但 JS 原生会得到 2.9999999999999996
  const fees = autoCalcFees('SELL', 100, 100, 'A', '600519')
  assert.equal(fees.commission, 5)           // max(3, 5) → 5，乘法结果必须精确
  // 卖出：totalAmount=10000, commission=5, stampDuty=roundMoney(10000*0.0005)=5,
  // transferFee=roundMoney(10000*0.00001)=0.1, tax=5.1, netAmount=10000-5-5.1=9989.9
  assert.equal(fees.netAmount, 9989.9)
})

test('手续费含不可约除法的精确计算', () => {
  // 36.5 / 3 在 JS 中产生无限小数，验证乘法不累积误差
  const fees = autoCalcFees('BUY', 36.5 / 3, 3 * 10, 'A', '600519')
  // 12.166667 * 30 ≈ 365.00001 → big.js mul 精确 → 365.00001
  // commission = max(365.00001 * 0.0003, 5) = max(0.1095, 5) = 5
  // transferFee(A股买入) = roundMoney(365.00001 * 0.00001) = roundMoney(0.00365) = 0
  // 关键：如果用 JS 原生乘法 12.166666666666666 * 30 = 365.0 (恰好补偿)
  // 这里用 big.js mul(12.166667, 30) = 365.00001，结果也正确
  assert.equal(fees.commission, 5)
  // A 股买入无印花税，过户费 rate=0.00001，金额太小舍为 0
  assert.equal(fees.tax, 0)
  // netAmount = 365.00001 + 5 + 0 = 370.00001 → roundMoney → 370
  assert.equal(fees.netAmount, 370)
})

test('FIFO 成本计算在除不尽场景下保持精确', () => {
  // 买入 3 股，总成本 36.5 含费，每股成本 = 36.5/3 ≈ 12.166667
  // 卖出 2 股（FIFO），成本基础应为 12.166667 * 2 ≈ 24.333334
  // 旧代码用原生 JS 会得到 24.333333333333332
  const stock = createStock([
    {
      id: 't1',
      stockId: 'stock-1',
      type: 'BUY',
      date: '2026-01-01',
      price: 12,
      quantity: 3,
      commission: 0.5,
      tax: 0,
      totalAmount: 36,
      netAmount: 36.5,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 't2',
      stockId: 'stock-1',
      type: 'SELL',
      date: '2026-01-02',
      price: 15,
      quantity: 2,
      commission: 0.5,
      tax: 0.3,
      totalAmount: 30,
      netAmount: 29.2,  // 买入 2 股成本 ≈ 24.333334，卖出实收 29.2，盈亏 ≈ 4.866666
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
  ])

  const summary = calcStockSummary(stock)

  assert.equal(summary.currentHolding, 1)
  // 当前成本价按券商摊薄口径：36.5 - 29.2 = 7.3
  assert.equal(summary.avgCostPrice, 7.3)
  // 盈亏 = 29.2 - 24.333334 = 4.866666 → roundMoney → 4.87
  assert.equal(Number(summary.realizedPnl.toFixed(2)), 4.87)
})

test('A股分红派息时不扣税，按税前现金摊低当前持仓成本', () => {
  const stock = createStock([
    {
      id: 't1',
      stockId: 'stock-1',
      type: 'BUY',
      date: '2026-01-01',
      price: 10,
      quantity: 100,
      commission: 5,
      tax: 0,
      totalAmount: 1000,
      netAmount: 1005,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 't2',
      stockId: 'stock-1',
      type: 'DIVIDEND',
      date: '2026-01-10',
      price: 1,
      quantity: 100,
      commission: 0,
      tax: 20,
      totalAmount: 100,
      netAmount: 80,
      createdAt: '2026-01-10T00:00:00.000Z',
      updatedAt: '2026-01-10T00:00:00.000Z',
    },
  ])

  const summary = calcStockSummary(stock)

  assert.equal(summary.totalDividend, 100)
  assert.equal(summary.realizedPnl, 0)
  assert.equal(summary.currentHolding, 100)
  assert.equal(summary.avgCostPrice, 9.05)
})

test('A股分红个税递延到卖出时按 FIFO 持股期限补扣', () => {
  const stock = createStock([
    {
      id: 'buy-1',
      stockId: 'stock-1',
      type: 'BUY',
      date: '2026-01-01',
      price: 10,
      quantity: 100,
      commission: 0,
      tax: 0,
      totalAmount: 1000,
      netAmount: 1000,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'dividend-1',
      stockId: 'stock-1',
      type: 'DIVIDEND',
      date: '2026-01-10',
      price: 1,
      quantity: 100,
      commission: 0,
      tax: 0,
      totalAmount: 100,
      netAmount: 100,
      createdAt: '2026-01-10T00:00:00.000Z',
      updatedAt: '2026-01-10T00:00:00.000Z',
    },
    {
      id: 'sell-1',
      stockId: 'stock-1',
      type: 'SELL',
      date: '2026-01-20',
      price: 12,
      quantity: 50,
      commission: 0,
      tax: 0,
      totalAmount: 600,
      netAmount: 600,
      createdAt: '2026-01-20T00:00:00.000Z',
      updatedAt: '2026-01-20T00:00:00.000Z',
    },
  ])

  assert.equal(estimateDeferredDividendTax(stock, '2026-01-20', 50), 10)

  const summary = calcStockSummary(stock)
  assert.equal(summary.totalDividend, 100)
  assert.equal(summary.totalSellAmount, 590)
  assert.equal(summary.totalCommission, 10)
  assert.equal(Number(summary.realizedPnl.toFixed(2)), 140)
  assert.equal(summary.currentHolding, 50)
  assert.equal(summary.avgCostPrice, 6.2)
})

test('A股分红个税持股超过一年免税', () => {
  const stock = createStock([
    {
      id: 'buy-1',
      stockId: 'stock-1',
      type: 'BUY',
      date: '2025-01-01',
      price: 10,
      quantity: 100,
      commission: 0,
      tax: 0,
      totalAmount: 1000,
      netAmount: 1000,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    },
    {
      id: 'dividend-1',
      stockId: 'stock-1',
      type: 'DIVIDEND',
      date: '2025-07-01',
      price: 1,
      quantity: 100,
      commission: 0,
      tax: 0,
      totalAmount: 100,
      netAmount: 100,
      createdAt: '2025-07-01T00:00:00.000Z',
      updatedAt: '2025-07-01T00:00:00.000Z',
    },
  ])

  assert.equal(estimateDeferredDividendTax(stock, '2026-01-02', 100), 0)
})

test('清仓后的新持仓成本不会被旧交易和旧分红影响', () => {
  const stock = createStock([
    {
      id: 'old-buy',
      stockId: 'stock-1',
      type: 'BUY',
      date: '2022-01-01',
      price: 10,
      quantity: 100,
      commission: 0,
      tax: 0,
      totalAmount: 1000,
      netAmount: 1000,
      createdAt: '2022-01-01T00:00:00.000Z',
      updatedAt: '2022-01-01T00:00:00.000Z',
    },
    {
      id: 'old-dividend',
      stockId: 'stock-1',
      type: 'DIVIDEND',
      date: '2022-02-01',
      price: 1,
      quantity: 100,
      commission: 0,
      tax: 0,
      totalAmount: 100,
      netAmount: 100,
      createdAt: '2022-02-01T00:00:00.000Z',
      updatedAt: '2022-02-01T00:00:00.000Z',
    },
    {
      id: 'old-sell',
      stockId: 'stock-1',
      type: 'SELL',
      date: '2022-03-01',
      price: 10,
      quantity: 100,
      commission: 0,
      tax: 0,
      totalAmount: 1000,
      netAmount: 1000,
      createdAt: '2022-03-01T00:00:00.000Z',
      updatedAt: '2022-03-01T00:00:00.000Z',
    },
    {
      id: 'new-buy-1',
      stockId: 'stock-1',
      type: 'BUY',
      date: '2025-01-01',
      price: 8,
      quantity: 100,
      commission: 0,
      tax: 0,
      totalAmount: 800,
      netAmount: 800,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    },
    {
      id: 'current-dividend',
      stockId: 'stock-1',
      type: 'DIVIDEND',
      date: '2025-02-01',
      price: 0.5,
      quantity: 100,
      commission: 0,
      tax: 0,
      totalAmount: 50,
      netAmount: 50,
      createdAt: '2025-02-01T00:00:00.000Z',
      updatedAt: '2025-02-01T00:00:00.000Z',
    },
    {
      id: 'new-buy-2',
      stockId: 'stock-1',
      type: 'BUY',
      date: '2025-03-01',
      price: 7,
      quantity: 100,
      commission: 0,
      tax: 0,
      totalAmount: 700,
      netAmount: 700,
      createdAt: '2025-03-01T00:00:00.000Z',
      updatedAt: '2025-03-01T00:00:00.000Z',
    },
  ])

  const summary = calcStockSummary(stock)

  assert.equal(summary.currentHolding, 200)
  assert.equal(summary.avgCostPrice, 7.25)
  assert.equal(summary.realizedPnl, 90)
  assert.equal(summary.totalDividend, 150)
  assert.equal(summary.tradePnlDetails.find((detail) => detail.tradeId === 'old-buy')?.remainingQuantity, 0)
  assert.equal(summary.tradePnlDetails.find((detail) => detail.tradeId === 'new-buy-1')?.remainingQuantity, 100)
  assert.equal(summary.tradePnlDetails.find((detail) => detail.tradeId === 'new-buy-2')?.remainingQuantity, 100)
})

test('工商银行当前持仓成本会扣除本轮持仓期分红', () => {
  const stock: Stock = {
    ...createStock([]),
    code: '601398',
    name: '工商银行',
    trades: [
      {
        id: 'buy-2025-08-14',
        stockId: 'stock-1',
        type: 'BUY',
        date: '2025-08-14',
        price: 7.71,
        quantity: 6500,
        commission: 8.02,
        tax: 0,
        totalAmount: 50115,
        netAmount: 50123.02,
        createdAt: '2025-08-14T00:00:00.000Z',
        updatedAt: '2025-08-14T00:00:00.000Z',
      },
      {
        id: 'buy-2025-08-20',
        stockId: 'stock-1',
        type: 'BUY',
        date: '2025-08-20',
        price: 7.59,
        quantity: 6600,
        commission: 8.01,
        tax: 0,
        totalAmount: 50094,
        netAmount: 50102.01,
        createdAt: '2025-08-20T00:00:00.000Z',
        updatedAt: '2025-08-20T00:00:00.000Z',
      },
      {
        id: 'dividend-2025-12-12',
        stockId: 'stock-1',
        type: 'DIVIDEND',
        date: '2025-12-12',
        price: 0,
        quantity: 13100,
        commission: 0,
        tax: 0,
        totalAmount: 1852.34,
        netAmount: 1852.34,
        createdAt: '2025-12-12T00:00:00.000Z',
        updatedAt: '2025-12-12T00:00:00.000Z',
      },
      {
        id: 'buy-2026-05-06',
        stockId: 'stock-1',
        type: 'BUY',
        date: '2026-05-06',
        price: 7.36,
        quantity: 13600,
        commission: 10.01,
        tax: 1,
        totalAmount: 100096,
        netAmount: 100107.01,
        createdAt: '2026-05-06T00:00:00.000Z',
        updatedAt: '2026-05-06T00:00:00.000Z',
      },
    ],
  }

  const summary = calcStockSummary(stock)

  assert.equal(summary.currentHolding, 26700)
  assert.equal(Number(summary.avgCostPrice.toFixed(4)), 7.4337)
})

test('成都银行部分卖出后成本价按券商摊薄口径计算', () => {
  const stock: Stock = {
    ...createStock([]),
    code: '601838',
    name: '成都银行',
    trades: [
      {
        id: 'buy-2025-08-01',
        stockId: 'stock-1',
        type: 'BUY',
        date: '2025-08-01',
        price: 18.55,
        quantity: 2700,
        commission: 8.01,
        tax: 0,
        totalAmount: 50085,
        netAmount: 50093.01,
        createdAt: '2025-08-01T00:00:00.000Z',
        updatedAt: '2025-08-01T00:00:00.000Z',
      },
      {
        id: 'buy-2025-09-30',
        stockId: 'stock-1',
        type: 'BUY',
        date: '2025-09-30',
        price: 17.2,
        quantity: 3000,
        commission: 8.26,
        tax: 0,
        totalAmount: 51600,
        netAmount: 51608.26,
        createdAt: '2025-09-30T00:00:00.000Z',
        updatedAt: '2025-09-30T00:00:00.000Z',
      },
      {
        id: 'buy-2025-10-29',
        stockId: 'stock-1',
        type: 'BUY',
        date: '2025-10-29',
        price: 17.24,
        quantity: 2900,
        commission: 8,
        tax: 0,
        totalAmount: 49996,
        netAmount: 50004,
        createdAt: '2025-10-29T00:00:00.000Z',
        updatedAt: '2025-10-29T00:00:00.000Z',
      },
      {
        id: 'buy-2025-10-31',
        stockId: 'stock-1',
        type: 'BUY',
        date: '2025-10-31',
        price: 16.76,
        quantity: 3000,
        commission: 8.04,
        tax: 0,
        totalAmount: 50280,
        netAmount: 50288.04,
        createdAt: '2025-10-31T00:00:00.000Z',
        updatedAt: '2025-10-31T00:00:00.000Z',
      },
      {
        id: 'buy-2026-01-14-a',
        stockId: 'stock-1',
        type: 'BUY',
        date: '2026-01-14',
        price: 16.12,
        quantity: 2000,
        commission: 9.01,
        tax: 0,
        totalAmount: 32240,
        netAmount: 32249.01,
        createdAt: '2026-01-14T00:00:00.000Z',
        updatedAt: '2026-01-14T00:00:00.000Z',
      },
      {
        id: 'buy-2026-01-14-b',
        stockId: 'stock-1',
        type: 'BUY',
        date: '2026-01-14',
        price: 16.1,
        quantity: 3500,
        commission: 5.32,
        tax: 0,
        totalAmount: 56350,
        netAmount: 56355.32,
        createdAt: '2026-01-14T00:00:01.000Z',
        updatedAt: '2026-01-14T00:00:01.000Z',
      },
      {
        id: 'sell-2026-04-24',
        stockId: 'stock-1',
        type: 'SELL',
        date: '2026-04-24',
        price: 18.33,
        quantity: 5500,
        commission: 10.08,
        tax: 51.42,
        totalAmount: 100815,
        netAmount: 100753.5,
        createdAt: '2026-04-24T00:00:00.000Z',
        updatedAt: '2026-04-24T00:00:00.000Z',
      },
      {
        id: 'sell-2026-05-07',
        stockId: 'stock-1',
        type: 'SELL',
        date: '2026-05-07',
        price: 19.01,
        quantity: 5800,
        commission: 11.03,
        tax: 56.23,
        totalAmount: 110258,
        netAmount: 110190.74,
        createdAt: '2026-05-07T00:00:00.000Z',
        updatedAt: '2026-05-07T00:00:00.000Z',
      },
    ],
  }

  const summary = calcStockSummary(stock)

  assert.equal(summary.currentHolding, 5800)
  assert.equal(Number(summary.avgCostPrice.toFixed(4)), 13.7333)
  assert.equal(Number(summary.fifoAvgCostPrice.toFixed(4)), 16.1436)
})

test('加密资产支持小数数量和交易所手续费', () => {
  const buyFees = autoCalcFees('BUY', 50000, 0.1, 'CRYPTO', 'BTC')
  const sellFees = autoCalcFees('SELL', 60000, 0.03, 'CRYPTO', 'BTC')

  assert.equal(buyFees.commission, 5)
  assert.equal(buyFees.tax, 0)
  assert.equal(buyFees.netAmount, 5005)
  assert.equal(sellFees.commission, 1.8)
  assert.equal(sellFees.tax, 0)
  assert.equal(sellFees.netAmount, 1798.2)

  const stock: Stock = {
    id: 'crypto-1',
    code: 'BTC',
    name: 'BTC/USDT',
    market: 'CRYPTO',
    trades: [
      {
        id: 't1',
        stockId: 'crypto-1',
        type: 'BUY',
        date: '2026-01-01',
        price: 50000,
        quantity: 0.1,
        commission: buyFees.commission,
        tax: buyFees.tax,
        totalAmount: 5000,
        netAmount: buyFees.netAmount,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 't2',
        stockId: 'crypto-1',
        type: 'SELL',
        date: '2026-01-02',
        price: 60000,
        quantity: 0.03,
        commission: sellFees.commission,
        tax: sellFees.tax,
        totalAmount: 1800,
        netAmount: sellFees.netAmount,
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  const summary = calcStockSummary(stock, 65000)

  assert.equal(summary.currentHolding, 0.07)
  assert.equal(summary.avgCostPrice, 45811.428571)
  assert.equal(Number(summary.realizedPnl.toFixed(2)), 296.7)
  assert.equal(Number(summary.unrealizedPnl.toFixed(2)), 1343.2)
  assert.equal(Number(summary.totalPnl.toFixed(2)), 1343.2)
  assert.equal(summary.tradePnlDetails[0]?.soldQuantity, 0.03)
  assert.equal(summary.tradePnlDetails[0]?.remainingQuantity, 0.07)
})
