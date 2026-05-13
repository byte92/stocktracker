'use client'

import { useState, useEffect } from 'react'
import { X, TrendingUp, TrendingDown, Gift } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useStockStore } from '@/store/useStockStore'
import { autoCalcFees, calcStockSummary, estimateDeferredDividendTax, todayStr } from '@/lib/finance'
import { CURRENCY_SYMBOLS, MARKET_CURRENCY } from '@/lib/ExchangeRateService'
import { getMarketMinQuantity, getMarketQuantityStep } from '@/config/defaults'
import { useI18n } from '@/lib/i18n'
import type { Market, TradeType, Trade } from '@/types'

interface AddTradeModalProps {
  stockId: string
  stockCode: string
  stockName: string
  market: Market
  editTrade?: Trade  // 如果传入，则为编辑模式
  onClose: () => void
}

export default function AddTradeModal({ stockId, stockCode, stockName, market, editTrade, onClose }: AddTradeModalProps) {
  const { addTrade, updateTrade, stocks, config } = useStockStore()
  const { t, getAssetUnit, numberLocale } = useI18n()
  const isEdit = !!editTrade
  const currentStock = stocks.find((stock) => stock.id === stockId)
  const stockWithoutEditingTrade = currentStock
    ? {
        ...currentStock,
        trades: editTrade
          ? currentStock.trades.filter((trade) => trade.id !== editTrade.id)
          : currentStock.trades,
      }
    : null
  const availableHolding = stockWithoutEditingTrade
    ? calcStockSummary(stockWithoutEditingTrade).currentHolding
    : 0
  const [type, setType] = useState<TradeType>('BUY')
  const [date, setDate] = useState(todayStr())
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('')
  // 现金收益专用字段（分红、派息、加密资产收益等）
  const [dividendPerShare, setDividendPerShare] = useState('')
  const [dividendShares, setDividendShares] = useState('')
  const [autoFee, setAutoFee] = useState(true)
  const [commission, setCommission] = useState('')
  const [tax, setTax] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const marketCurrency = MARKET_CURRENCY[market] || 'CNY'
  const currencySymbol = CURRENCY_SYMBOLS[marketCurrency]
  const currencyUnitLabel = getCurrencyUnitLabel(marketCurrency, t)
  const assetUnit = getAssetUnit(market)
  const quantityStep = getMarketQuantityStep(market)
  const minQuantity = getMarketMinQuantity(market)
  const incomeLabel = market === 'CRYPTO' ? t('收益') : t('分红')

  // 编辑模式：初始化表单数据
  useEffect(() => {
    if (editTrade) {
      setType(editTrade.type)
      setDate(editTrade.date)
      if (editTrade.type === 'DIVIDEND') {
        // 现金收益：price=每单位收益, quantity=持有数量
        setDividendPerShare(editTrade.price.toString())
        setDividendShares(editTrade.quantity.toString())
      } else {
        // 买入/卖出
        setPrice(editTrade.price.toString())
        setQuantity(editTrade.quantity.toString())
        // 如果税费不是自动计算的（可能用户之前手动输入过），则禁用自动计算
        // 这里简单处理：总是先尝试自动计算，如果用户修改过则可能需要手动
        setCommission(editTrade.commission.toString())
        setTax(editTrade.tax.toString())
      }
      setNote(editTrade.note || '')
    }
  }, [editTrade])

  useEffect(() => {
    if (type !== 'DIVIDEND' || editTrade?.type === 'DIVIDEND' || dividendShares) return
    if (availableHolding > 0) {
      setDividendShares(String(availableHolding))
    }
  }, [type, availableHolding, editTrade?.type, dividendShares])

  const priceNum = parseFloat(price) || 0
  const quantityNum = parseFloat(quantity) || 0
  const totalAmount = priceNum * quantityNum
  const deferredDividendTax = type === 'SELL' && stockWithoutEditingTrade
    ? estimateDeferredDividendTax(stockWithoutEditingTrade, date, quantityNum)
    : 0

  // 现金收益计算
  const dividendPerShareNum = parseFloat(dividendPerShare) || 0
  const dividendSharesNum = parseFloat(dividendShares) || 0
  const grossDividend = dividendPerShareNum * dividendSharesNum
  const dividendTaxAmount = calcDividendTaxAmount(market, grossDividend)
  const netDividend = grossDividend - dividendTaxAmount  // 税后实收

  // 买卖手续费计算
  const calcFees = () => {
    if (priceNum > 0 && quantityNum > 0 && (type === 'BUY' || type === 'SELL')) {
      const baseFees = autoCalcFees(type, priceNum, quantityNum, market, stockCode, config.feeConfigs[market])
      if (type !== 'SELL' || deferredDividendTax <= 0) return baseFees
      return {
        commission: baseFees.commission,
        tax: baseFees.tax + deferredDividendTax,
        netAmount: baseFees.netAmount - deferredDividendTax,
      }
    }
    return { commission: 0, tax: 0, netAmount: 0 }
  }

  const fees = autoFee ? calcFees() : {
    commission: parseFloat(commission) || 0,
    tax: parseFloat(tax) || 0,
    netAmount: type === 'BUY'
      ? totalAmount + (parseFloat(commission) || 0) + (parseFloat(tax) || 0)
      : totalAmount - (parseFloat(commission) || 0) - (parseFloat(tax) || 0)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const tradeData: Omit<Trade, 'id' | 'stockId' | 'createdAt' | 'updatedAt'> = {
      type,
      date,
      price: 0,
      quantity: 0,
      commission: 0,
      tax: 0,
      totalAmount: 0,
      netAmount: 0,
      note,
    }

    if (type === 'DIVIDEND') {
      if (!dividendPerShare || dividendPerShareNum <= 0) {
        setError(t('请填写有效的每{unit}{incomeLabel}金额', { unit: assetUnit, incomeLabel }))
        return
      }
      if (!dividendShares || dividendSharesNum <= 0) {
        setError(t('请填写{incomeLabel}时的持有数量', { incomeLabel }))
        return
      }
      if (dividendSharesNum > availableHolding) {
        setError(t('{incomeLabel}数量不能超过当前持仓 {quantity} {unit}', { incomeLabel, quantity: formatQuantity(availableHolding, numberLocale), unit: assetUnit }))
        return
      }
      // 收益记录：price=每单位收益, quantity=持有数量, netAmount=税后实收
      tradeData.price = dividendPerShareNum
      tradeData.quantity = dividendSharesNum
      tradeData.commission = 0
      tradeData.tax = dividendTaxAmount
      tradeData.totalAmount = grossDividend
      tradeData.netAmount = netDividend
      tradeData.note = note || t('每{unit}{incomeLabel}{amount}', {
        unit: assetUnit,
        incomeLabel,
        amount: `${currencySymbol}${dividendPerShareNum}`,
      })
    } else {
      if (!price || !quantity || priceNum <= 0 || quantityNum <= 0) {
        setError(t('请填写有效的价格和数量'))
        return
      }
      if (type === 'SELL' && quantityNum > availableHolding) {
        setError(t('当前最多可卖出 {quantity} {unit}，请先检查持仓或交易顺序', { quantity: formatQuantity(availableHolding, numberLocale), unit: assetUnit }))
        return
      }
      tradeData.price = priceNum
      tradeData.quantity = quantityNum
      tradeData.commission = fees.commission
      tradeData.tax = fees.tax
      tradeData.deferredDividendTax = type === 'SELL' && deferredDividendTax > 0 ? deferredDividendTax : undefined
      tradeData.totalAmount = totalAmount
      tradeData.netAmount = fees.netAmount
    }

    if (isEdit && editTrade) {
      updateTrade(stockId, editTrade.id, tradeData)
    } else {
      addTrade(stockId, tradeData)
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md rounded-xl border border-border bg-card shadow-2xl animate-fade-in max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-5">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {isEdit ? t('编辑交易记录') : t('添加交易记录')}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">{stockName}（{stockCode}）</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 hover:bg-secondary transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* 类型切换：买入 / 卖出 / 现金收益 */}
          <div className="flex gap-2">
            <button type="button" onClick={() => setType('BUY')}
              className={`flex-1 h-10 rounded-lg text-sm font-medium transition-all border ${
                type === 'BUY' ? 'border-profit bg-profit/10 text-profit' : 'border-border bg-transparent text-muted-foreground hover:bg-secondary'
              }`}>
              <TrendingUp className="inline h-4 w-4 mr-1.5" />{t('买入')}
            </button>
            <button type="button" onClick={() => setType('SELL')}
              className={`flex-1 h-10 rounded-lg text-sm font-medium transition-all border ${
                type === 'SELL' ? 'border-loss bg-loss/10 text-loss' : 'border-border bg-transparent text-muted-foreground hover:bg-secondary'
              }`}>
              <TrendingDown className="inline h-4 w-4 mr-1.5" />{t('卖出')}
            </button>
            <button type="button" onClick={() => setType('DIVIDEND')}
              className={`flex-1 h-10 rounded-lg text-sm font-medium transition-all border ${
                type === 'DIVIDEND' ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-transparent text-muted-foreground hover:bg-secondary'
              }`}>
              <Gift className="inline h-4 w-4 mr-1.5" />{incomeLabel}
            </button>
          </div>

          {/* 日期（通用） */}
          <div className="space-y-1.5">
            <Label htmlFor="date">{t('交易日期')}</Label>
            <DatePicker id="date" value={date} onChange={setDate} placeholder={t('选择交易日期')} />
          </div>

          {/* 买入/卖出表单 */}
          {(type === 'BUY' || type === 'SELL') && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="price">{t('成交价格（{unit}）', { unit: currencyUnitLabel })}</Label>
                  <Input id="price" type="number" step="0.001" min="0" placeholder="0.00"
                    value={price} onChange={(e) => setPrice(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="quantity">{t('成交数量（{unit}）', { unit: assetUnit })}</Label>
                  <Input id="quantity" type="number" min={minQuantity} step={quantityStep} placeholder={market === 'CRYPTO' ? '0.01' : '100'}
                    value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label>{t('成交金额')}</Label>
                  <div className="h-9 flex items-center px-3 rounded-md border border-border bg-muted text-sm text-foreground font-mono">
                    {currencySymbol}{totalAmount.toLocaleString(numberLocale, { minimumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              {/* 手续费区域 */}
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">{t('手续费')}</span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <span className="text-xs text-muted-foreground">{t('自动计算')}</span>
                    <input type="checkbox" checked={autoFee} onChange={(e) => setAutoFee(e.target.checked)} className="rounded accent-primary" />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('佣金（{unit}）', { unit: currencyUnitLabel })}</Label>
                    <Input type="number" step="0.01" min="0" placeholder="0.00"
                      value={autoFee ? fees.commission.toFixed(2) : commission}
                      onChange={(e) => setCommission(e.target.value)}
                      disabled={autoFee} className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('税费（{unit}）', { unit: currencyUnitLabel })}</Label>
                    <Input type="number" step="0.01" min="0" placeholder="0.00"
                      value={autoFee ? fees.tax.toFixed(2) : tax}
                      onChange={(e) => setTax(e.target.value)}
                      disabled={autoFee} className="h-8 text-xs" />
                  </div>
                </div>
                <div className="flex justify-between items-center pt-1 border-t border-border">
                  <span className="text-xs text-muted-foreground">
                    {type === 'BUY' ? t('实际买入成本') : t('实际到账金额')}
                  </span>
                  <span className={`text-sm font-bold font-mono ${type === 'BUY' ? 'text-profit' : 'text-loss'}`}>
                    {currencySymbol}{fees.netAmount.toLocaleString(numberLocale, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </>
          )}

          {/* 现金收益表单 */}
          {type === 'DIVIDEND' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                <p className="text-xs text-muted-foreground mb-2">
                  {t('录入{incomeLabel}后，系统会用税后到账摊低当前持仓成本；清仓后不会影响下一轮持仓', { incomeLabel })}
                </p>
                <p className="text-xs text-muted-foreground mb-3">
                  {t('当前可记录数量：{quantity} {unit}', { quantity: formatQuantity(availableHolding, numberLocale), unit: assetUnit })}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="dps">{t('每{unit}{incomeLabel}（{currencyUnit}）', { unit: assetUnit, incomeLabel, currencyUnit: currencyUnitLabel })}</Label>
                    <Input id="dps" type="number" step="0.0001" min="0" placeholder="0.10"
                      value={dividendPerShare} onChange={(e) => setDividendPerShare(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="dshares">{t('持有数量（{unit}）', { unit: assetUnit })}</Label>
                    <Input id="dshares" type="number" min={minQuantity} step={quantityStep} placeholder={market === 'CRYPTO' ? '0.01' : '1000'}
                      value={dividendShares} onChange={(e) => setDividendShares(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label>{t('税额（{unit}）', { unit: currencyUnitLabel })}</Label>
                    <div className="h-9 flex items-center px-3 rounded-md border border-border bg-muted text-sm font-mono text-muted-foreground">
                      {currencySymbol}{dividendTaxAmount.toFixed(2)}
                    </div>
                  </div>
                </div>

                {grossDividend > 0 && (
                  <div className="mt-3 pt-3 border-t border-border grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">{t('税前{incomeLabel}', { incomeLabel })}</span>
                      <div className="font-mono text-foreground font-medium">{currencySymbol}{grossDividend.toFixed(2)}</div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">{t('税后实收')}</span>
                      <div className="font-mono text-primary font-bold">{currencySymbol}{netDividend.toFixed(2)}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="note">{t('备注（可选）')}</Label>
            <Textarea id="note" placeholder={t('记录交易理由、策略等...')} value={note}
              onChange={(e) => setNote(e.target.value)} className="h-16 resize-none" />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">{t('取消')}</Button>
            <Button type="submit" className={`flex-1 ${
              type === 'BUY' ? 'bg-profit hover:bg-profit/90 text-black'
              : type === 'SELL' ? 'bg-loss hover:bg-loss/90 text-white'
              : 'bg-primary hover:bg-primary/90'
            }`}>
              {isEdit ? t('保存修改') : type === 'BUY' ? t('确认买入') : type === 'SELL' ? t('确认卖出') : t('确认录入{incomeLabel}', { incomeLabel })}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function getCurrencyUnitLabel(currency: keyof typeof CURRENCY_SYMBOLS, t: (key: string) => string) {
  if (currency === 'USD') return t('美元')
  if (currency === 'HKD') return t('港元')
  if (currency === 'USDT') return 'USDT'
  return t('元')
}

function calcDividendTaxAmount(market: Market, grossDividend: number) {
  if (market === 'US') return Math.round(grossDividend * 0.3 * 100) / 100
  return 0
}

function formatQuantity(value: number, locale: string) {
  return value.toLocaleString(locale, {
    maximumFractionDigits: 8,
  })
}
