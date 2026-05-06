import test from 'node:test'
import assert from 'node:assert/strict'
import { autoCalcFees, calcBuyNetAmount, calcSellNetAmount, calcStockSummary, formatPnl, generateId } from '@/lib/finance'
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
    delete (globalThis as typeof globalThis & { crypto?: Crypto }).crypto
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

test('FIFO 计算已实现盈亏和剩余持仓成本', () => {
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

  assert.equal(summary.tradeMatchMode, 'FIFO')
  assert.equal(summary.currentHolding, 50)
  assert.equal(Number(summary.avgCostPrice.toFixed(2)), 12.05)
  assert.equal(Number(summary.realizedPnl.toFixed(2)), 635.25)
  assert.equal(Number(summary.totalCommission.toFixed(2)), 17.25)
  assert.equal(summary.tradePnlDetails[0]?.remainingQuantity, 0)
  assert.equal(summary.tradePnlDetails[0]?.soldQuantity, 100)
  assert.equal(summary.tradePnlDetails[0]?.holdingAfterTrade, 100)
  assert.equal(summary.tradePnlDetails[1]?.remainingQuantity, 50)
  assert.equal(summary.tradePnlDetails[1]?.soldQuantity, 50)
  assert.equal(summary.tradePnlDetails[1]?.holdingAfterTrade, 200)
  assert.equal(summary.tradePnlDetails[2]?.holdingAfterTrade, 50)
})

test('RECENT_LOTS 优先匹配最近买入批次计算已实现盈亏', () => {
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

  const summary = calcStockSummary(stock, undefined, { matchMode: 'RECENT_LOTS' })

  assert.equal(summary.tradeMatchMode, 'RECENT_LOTS')
  assert.equal(summary.currentHolding, 50)
  assert.equal(Number(summary.avgCostPrice.toFixed(2)), 10.05)
  assert.equal(Number(summary.realizedPnl.toFixed(2)), 535.25)
  assert.equal(summary.tradePnlDetails[0]?.remainingQuantity, 50)
  assert.equal(summary.tradePnlDetails[0]?.soldQuantity, 50)
  assert.equal(summary.tradePnlDetails[1]?.remainingQuantity, 0)
  assert.equal(summary.tradePnlDetails[1]?.soldQuantity, 100)
  assert.equal(Number(summary.tradePnlDetails[2]?.costBasis.toFixed(2)), 1707.5)
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
  // 剩余 1 股成本 = 36.5 - 24.333334 = 12.166666 → roundMoney → 12.17
  assert.equal(summary.avgCostPrice, 12.17)
  // 盈亏 = 29.2 - 24.333334 = 4.866666 → roundMoney → 4.87
  assert.equal(Number(summary.realizedPnl.toFixed(2)), 4.87)
})

test('分红会计入已实现盈亏，但不会重复摊薄剩余持仓成本', () => {
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

  assert.equal(summary.totalDividend, 80)
  assert.equal(summary.realizedPnl, 80)
  assert.equal(summary.currentHolding, 100)
  assert.equal(Number(summary.avgCostPrice.toFixed(2)), 10.05)
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
  assert.equal(summary.avgCostPrice, 50050)
  assert.equal(Number(summary.realizedPnl.toFixed(2)), 296.7)
  assert.equal(Number(summary.unrealizedPnl.toFixed(2)), 1046.5)
  assert.equal(Number(summary.totalPnl.toFixed(2)), 1343.2)
  assert.equal(summary.tradePnlDetails[0]?.soldQuantity, 0.03)
  assert.equal(summary.tradePnlDetails[0]?.remainingQuantity, 0.07)
})
