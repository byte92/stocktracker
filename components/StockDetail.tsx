'use client'

import { useMemo, useState } from 'react'
import { ArrowLeft, Plus, Trash2, TrendingUp, TrendingDown, DollarSign, RefreshCw, Gift, Edit } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { useStockStore } from '@/store/useStockStore'
import { calcStockSummary, formatPnl, formatPercent } from '@/lib/finance'
import { marketSupportsValuation } from '@/config/defaults'
import { useStockQuote } from '@/hooks/useStockQuote'
import { CURRENCY_SYMBOLS, MARKET_CURRENCY } from '@/lib/ExchangeRateService'
import { useI18n } from '@/lib/i18n'
import AddTradeModal from '@/components/AddTradeModal'
import AddStockModal from '@/components/AddStockModal'
import StockKline from '@/components/StockKline'
import ConfirmDialog from '@/components/ConfirmDialog'
import PageHeader from '@/components/layout/PageHeader'
import StockAnalysisPanel from '@/components/ai/StockAnalysisPanel'
import type { Stock, Trade, TradePnlDetail } from '@/types'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'

interface StockDetailProps {
  stock: Stock
  onBack: () => void
}

export default function StockDetail({ stock, onBack }: StockDetailProps) {
  const { deleteTrade, config } = useStockStore()
  const { t, getAssetUnit, getMarketLabel, formatDateTime, numberLocale } = useI18n()
  const [showAddTrade, setShowAddTrade] = useState(false)
  const [showEditStock, setShowEditStock] = useState(false)
  const [editTrade, setEditTrade] = useState<Trade | undefined>(undefined)
  const [manualPrice, setManualPrice] = useState('')
  const [deleteTradeTarget, setDeleteTradeTarget] = useState<Trade | null>(null)
  const [tradeKeyword, setTradeKeyword] = useState('')
  const [tradeTypeFilter, setTradeTypeFilter] = useState<'ALL' | 'BUY' | 'SELL' | 'DIVIDEND'>('ALL')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [specialFilter, setSpecialFilter] = useState<'ALL' | 'CLOSING' | 'OPEN_BUY' | 'CLOSED_BUY' | 'REALIZED'>('ALL')
  const [resultFilter, setResultFilter] = useState<'ALL' | 'PROFIT' | 'LOSS' | 'BREAKEVEN'>('ALL')
  const [noteFilter, setNoteFilter] = useState<'ALL' | 'WITH_NOTE' | 'WITHOUT_NOTE'>('ALL')
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc')

  const { quote, loading, error, forceRefresh } = useStockQuote(
    stock.code, stock.market,
    { autoRefresh: true, refreshInterval: 60000 }
  )

  const currentPriceNum = quote?.price || parseFloat(manualPrice) || undefined
  const summary = calcStockSummary(stock, currentPriceNum, { matchMode: config.tradeMatchMode })
  const nativeCurrency = MARKET_CURRENCY[stock.market] || 'CNY'
  const quoteTimeLabel = quote?.timestamp ? formatQuoteTimestamp(quote.timestamp, t, formatDateTime) : null
  const formatAmountWithNative = (amount: number) => formatWithNativeCurrency(amount, nativeCurrency, numberLocale)
  const formatPriceWithNative = (amount: number) => formatWithNativeCurrency(amount, nativeCurrency, numberLocale, 4)
  const formatPnlWithNative = (amount: number) => formatPnl(amount, nativeCurrency)
  const assetUnit = getAssetUnit(stock.market)
  const marketLabel = getMarketLabel(stock.market)
  const supportsValuation = marketSupportsValuation(stock.market, stock.code)
  const incomeLabel = stock.market === 'CRYPTO' ? t('收益') : t('分红')

  const sortedTrades = [...stock.trades].sort((a, b) => b.date.localeCompare(a.date))
  // 构建 tradeId -> pnlDetail 的映射（finance.ts 按时间正序计算）
  const pnlMap = new Map<string, TradePnlDetail>(
    summary.tradePnlDetails.map((d) => [d.tradeId, d])
  )
  const closingTradeIds = (() => {
    const sorted = [...stock.trades].sort((a, b) => a.date.localeCompare(b.date))
    let holding = 0
    const ids = new Set<string>()

    for (const trade of sorted) {
      if (trade.type === 'BUY') {
        holding += trade.quantity
      } else if (trade.type === 'SELL') {
        const nextHolding = holding - trade.quantity
        if (holding > 0 && nextHolding === 0) {
          ids.add(trade.id)
        }
        holding = nextHolding
      }
    }

    return ids
  })()

  // 构建盈亏曲线数据（按时间正序，只显示有盈亏变化的点）
  const chartData = (() => {
    const sorted = [...stock.trades].sort((a, b) => a.date.localeCompare(b.date))
    let cumPnl = 0
    const pts: Array<{ date: string; pnl: number; type: string }> = []
    // 添加起始点（显示为0）
    pts.push({ date: t('起始'), pnl: 0, type: 'START' })
    for (const t of sorted) {
      const detail = pnlMap.get(t.id)
      if (t.type === 'SELL' && detail) {
        cumPnl += detail.pnl
        pts.push({ date: t.date, pnl: cumPnl, type: 'SELL' })
      } else if (t.type === 'DIVIDEND' && detail) {
        cumPnl += detail.pnl
        pts.push({ date: t.date, pnl: cumPnl, type: 'DIVIDEND' })
      }
    }
    return pts
  })()

  const isProfitable = summary.realizedPnl >= 0
  const tradeRows = useMemo(() => {
    const rows = stock.trades.map((trade) => {
      const pnlDetail = pnlMap.get(trade.id)
      const typeLabel = trade.type === 'BUY' ? t('买入') : trade.type === 'SELL' ? t('卖出') : incomeLabel
      const feeTotal = trade.commission + trade.tax
      const realizedAmount = trade.type === 'SELL' || trade.type === 'DIVIDEND' ? pnlDetail?.pnl ?? 0 : null
      const buyRemaining = trade.type === 'BUY' ? (pnlDetail?.remainingQuantity ?? 0) : null
      const buySold = trade.type === 'BUY' ? (pnlDetail?.soldQuantity ?? 0) : null
      const holdingAfterTrade = pnlDetail?.holdingAfterTrade ?? 0
      const isClosingTrade = closingTradeIds.has(trade.id)
      const buyLotState = trade.type === 'BUY'
        ? (buyRemaining && buyRemaining > 0 ? t('持有中') : t('已卖完'))
        : null

      return {
        trade,
        pnlDetail,
        typeLabel,
        feeTotal,
        realizedAmount,
        buyRemaining,
        buySold,
        holdingAfterTrade,
        isClosingTrade,
        buyLotState,
      }
    })

    return rows
      .filter((row) => {
        if (tradeTypeFilter !== 'ALL' && row.trade.type !== tradeTypeFilter) return false
        if (dateFrom && row.trade.date < dateFrom) return false
        if (dateTo && row.trade.date > dateTo) return false
        if (specialFilter === 'CLOSING' && !row.isClosingTrade) return false
        if (specialFilter === 'OPEN_BUY' && !(row.trade.type === 'BUY' && (row.buyRemaining ?? 0) > 0)) return false
        if (specialFilter === 'CLOSED_BUY' && !(row.trade.type === 'BUY' && (row.buyRemaining ?? 0) === 0)) return false
        if (specialFilter === 'REALIZED' && !(row.trade.type === 'SELL' || row.trade.type === 'DIVIDEND')) return false
        if (resultFilter === 'PROFIT' && !((row.realizedAmount ?? 0) > 0)) return false
        if (resultFilter === 'LOSS' && !((row.realizedAmount ?? 0) < 0)) return false
        if (resultFilter === 'BREAKEVEN' && row.realizedAmount !== 0) return false
        if (noteFilter === 'WITH_NOTE' && !row.trade.note?.trim()) return false
        if (noteFilter === 'WITHOUT_NOTE' && !!row.trade.note?.trim()) return false

        if (tradeKeyword.trim()) {
          const keyword = tradeKeyword.trim().toLowerCase()
          const haystacks = [
            row.trade.date,
            row.typeLabel,
            row.trade.note ?? '',
            row.buyLotState ?? '',
            row.isClosingTrade ? t('清仓') : '',
          ]
          if (!haystacks.some((item) => item.toLowerCase().includes(keyword))) return false
        }

        return true
      })
      .sort((a, b) => {
        const delta = a.trade.date.localeCompare(b.trade.date)
        return sortDirection === 'desc' ? -delta : delta
      })
  }, [stock.trades, pnlMap, closingTradeIds, tradeTypeFilter, dateFrom, dateTo, specialFilter, resultFilter, noteFilter, tradeKeyword, sortDirection, incomeLabel, t])

  return (
    <div className="min-h-screen">
      <PageHeader
        title={`${stock.name} · ${stock.code}`}
        description={t('市场：{market}，可在此查看交易、K 线{valuation}与 AI 深度分析。', {
          market: marketLabel,
          valuation: supportsValuation ? t('、估值') : '',
        })}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={onBack}>
              <ArrowLeft className="h-3.5 w-3.5 mr-1" />
              {t('返回持仓')}
            </Button>
            <Button size="sm" onClick={() => setShowAddTrade(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              {t('添加交易')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowEditStock(true)}>
              <Edit className="h-3.5 w-3.5 mr-1" />
              {t('编辑资产')}
            </Button>
          </>
        }
      />

      <main className="mx-auto max-w-6xl px-4 py-6 lg:px-6 space-y-6">
        {/* 汇总卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="stat-card border-border">
            <div className="text-xs text-muted-foreground mb-1">{t('总收益')}</div>
            <div className={`text-xl font-bold font-mono ${summary.totalPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
              {formatPnlWithNative(summary.totalPnl)}
            </div>
            {summary.currentHolding > 0 && currentPriceNum ? (
              <div className="text-xs text-muted-foreground mt-1">
                {t('已实现 + 浮动')}
              </div>
            ) : (
              <div className={`text-xs mt-1 ${summary.totalPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
                {formatPercent(summary.totalPnlPercent)}
              </div>
            )}
          </Card>

          <Card className="stat-card border-border">
            <div className="text-xs text-muted-foreground mb-1">{t('已实现收益')}</div>
            <div className={`text-lg font-bold font-mono ${summary.realizedPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
              {formatPnlWithNative(summary.realizedPnl)}
            </div>
            {summary.totalDividend > 0 && (
              <div className="text-xs text-primary mt-0.5">{t('累计{incomeLabel} {amount}', { incomeLabel, amount: formatAmountWithNative(summary.totalDividend) })}</div>
            )}
          </Card>

          <Card className="stat-card border-border">
            <div className="text-xs text-muted-foreground mb-1">{t('当前持仓')}</div>
            <div className="text-lg font-bold font-mono text-foreground">
              {formatQuantity(summary.currentHolding, numberLocale)} {assetUnit}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {t('均成本 {amount}', { amount: formatPriceWithNative(summary.avgCostPrice) })}
            </div>
          </Card>

          <Card className="stat-card border-border">
            <div className="text-xs text-muted-foreground mb-1">{t('总手续费')}</div>
            <div className="text-lg font-bold font-mono text-foreground">
              {formatAmountWithNative(summary.totalCommission)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{t('{count} 笔买卖', { count: summary.tradeCount })}</div>
          </Card>
        </div>

        {/* 当前价格 & 浮动盈亏 */}
        {summary.currentHolding > 0 && (
          <Card className="border-border bg-card">
            <CardContent className="p-4">
              <div className="flex items-center gap-3 flex-wrap">
                <DollarSign className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm text-muted-foreground whitespace-nowrap">{t('当前价格')}</span>

                {quote ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-foreground">{formatAmountWithNative(quote.price)}</span>
                    <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${quote.changePercent >= 0 ? 'bg-profit/15 profit-text' : 'bg-loss/15 loss-text'}`}>
                      {quote.changePercent >= 0 ? '↑' : '↓'} {Math.abs(quote.changePercent).toFixed(2)}%
                    </span>
                    <span className="text-xs text-muted-foreground">· {quote.source}</span>
                    {quoteTimeLabel && (
                      <span className="text-xs text-muted-foreground">· {quoteTimeLabel}</span>
                    )}
                  </div>
                ) : (
                  <Input
                    type="number" step="0.001" min="0"
                    placeholder={loading ? t('获取中...') : t('手动输入当前价格...')}
                    value={manualPrice} onChange={(e) => setManualPrice(e.target.value)}
                    className="max-w-44 h-8 text-sm"
                  />
                )}

                <div className="ml-auto flex items-center gap-2">
                  {error && !quote && (
                    <span className="text-xs text-muted-foreground">{t('{error}，请手动输入', { error })}</span>
                  )}
                  <Button size="sm" variant="ghost" onClick={forceRefresh} disabled={loading} className="h-8 px-2">
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </div>

              {currentPriceNum && currentPriceNum > 0 && (
                <div className="mt-3 pt-3 border-t border-border flex items-center gap-6">
                  <div>
                    <div className="text-xs text-muted-foreground">{t('浮动盈亏')}</div>
                    <div className={`text-base font-bold font-mono ${summary.unrealizedPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
                      {formatPnlWithNative(summary.unrealizedPnl)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t('市值')}</div>
                    <div className="text-base font-bold font-mono text-foreground">
                      {formatAmountWithNative(currentPriceNum * summary.currentHolding)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t('总收益')}</div>
                    <div className={`text-base font-bold font-mono ${summary.totalPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
                      {formatPnlWithNative(summary.totalPnl)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t('成本')}</div>
                    <div className="text-base font-bold font-mono text-foreground">
                      {formatAmountWithNative(summary.avgCostPrice * summary.currentHolding)}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {supportsValuation && (
          <Card className="border-border bg-card">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-foreground">{t('估值信息')}</div>
                {quote?.valuationSource && (
                  <div className="text-xs text-muted-foreground">{t('估值源：{source}', { source: quote.valuationSource })}</div>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard
                  label="PE(TTM)"
                  value={formatPeTtm(quote?.peTtm, quote?.epsTtm, t)}
                />
                <MetricCard
                  label="EPS(TTM)"
                  value={formatOptionalMoney(quote?.epsTtm, quote?.currency, t)}
                />
                <MetricCard
                  label="PB"
                  value={formatOptionalRatio(quote?.pb, t)}
                />
                <MetricCard
                  label={t('总市值')}
                  value={formatOptionalMarketCap(quote?.marketCap, quote?.currency, t)}
                />
              </div>
              <div className="text-xs text-muted-foreground">
                {t('`暂无数据` 表示当前行情源未返回该字段，`亏损` 表示 TTM 每股收益小于等于 0。')}
              </div>
            </CardContent>
          </Card>
        )}

        <StockAnalysisPanel stock={stock} />

        {/* 盈亏曲线 */}
        {chartData.length > 1 && (
          <Card className="border-border">
            <div className="p-5 pb-3">
              <h3 className="text-sm font-medium text-foreground">{t('已实现盈亏曲线')}</h3>
            </div>
            <div className="h-48 px-2 pb-4">
              <ResponsiveContainer width="100%" height="100%" className="focus:outline-none">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={isProfitable ? 'hsl(4 90% 58%)' : 'hsl(142 71% 45%)'} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={isProfitable ? 'hsl(4 90% 58%)' : 'hsl(142 71% 45%)'} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 12% 20%)" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(215 12% 52%)' }} tickFormatter={(v) => formatAmountWithNative(Number(v))} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      borderColor: 'hsl(var(--border))',
                      borderRadius: '0.5rem',
                      padding: '0.5rem 0.75rem',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                    }}
                    cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                    labelStyle={{ color: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                    itemStyle={{ color: 'hsl(var(--foreground))', fontSize: 12 }}
                    formatter={(value: any, name: any, props: any) => {
                      const pnlValue = Number(value) || 0
                      const sign = pnlValue >= 0 ? '+' : ''
                      const color = pnlValue >= 0 ? 'var(--profit)' : 'var(--loss)'
                      return [
                        <span style={{ color, fontWeight: 'bold' }}>
                          {sign}{formatAmountWithNative(Math.abs(pnlValue))}
                        </span>,
                        t('累计盈亏')
                      ]
                    }}
                    labelFormatter={(label: any) => {
                      return t('日期: {date}', { date: String(label) })
                    }}
                  />
                  <ReferenceLine y={0} stroke="hsl(215 12% 52%)" strokeDasharray="4 4" />
                  <Area type="monotone" dataKey="pnl"
                    stroke={isProfitable ? 'hsl(4 90% 58%)' : 'hsl(142 71% 45%)'}
                    fill="url(#pnlGradient)" strokeWidth={2}
                    dot={(props) => {
                      const { payload } = props
                      const color = payload.type === 'DIVIDEND' ? 'hsl(217 91% 60%)'
                        : payload.type === 'BUY' ? 'hsl(215 12% 52%)' : 'hsl(4 90% 58%)'
                      return <circle key={props.key} cx={props.cx} cy={props.cy} r={4} fill={color} stroke="none" />
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        )}

        <StockKline symbol={stock.code} market={stock.market} trades={stock.trades} matchMode={config.tradeMatchMode} />

        {stock.note && (
          <Card className="border-border bg-card">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground mb-2">{t('资产备注')}</div>
              <div className="text-sm text-foreground whitespace-pre-wrap">{stock.note}</div>
            </CardContent>
          </Card>
        )}

        {/* 交易记录列表 */}
        <div>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-sm font-medium text-foreground">{t('交易记录')}</h3>
            <div className="text-xs text-muted-foreground">{t('共 {shown} / {total} 条', { shown: tradeRows.length, total: stock.trades.length })}</div>
          </div>

          <Card className="border-border bg-card mb-3">
            <CardContent className="p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-8 gap-3">
                <Input
                  value={tradeKeyword}
                  onChange={(e) => setTradeKeyword(e.target.value)}
                  placeholder={t('搜索备注 / 操作 / 状态')}
                  className="xl:col-span-2"
                />
                <Select
                  value={tradeTypeFilter}
                  onChange={(e) => setTradeTypeFilter(e.target.value as typeof tradeTypeFilter)}
                  className="h-10 bg-background"
                >
                  <option value="ALL">{t('全部类型')}</option>
                  <option value="BUY">{t('买入')}</option>
                  <option value="SELL">{t('卖出')}</option>
                  <option value="DIVIDEND">{incomeLabel}</option>
                </Select>
                <Select
                  value={specialFilter}
                  onChange={(e) => setSpecialFilter(e.target.value as typeof specialFilter)}
                  className="h-10 bg-background"
                >
                  <option value="ALL">{t('全部状态')}</option>
                  <option value="CLOSING">{t('只看清仓')}</option>
                  <option value="OPEN_BUY">{t('只看仍持有批次')}</option>
                  <option value="CLOSED_BUY">{t('只看已卖完批次')}</option>
                  <option value="REALIZED">{t('只看已实现记录')}</option>
                </Select>
                <Select
                  value={resultFilter}
                  onChange={(e) => setResultFilter(e.target.value as typeof resultFilter)}
                  className="h-10 bg-background"
                >
                  <option value="ALL">{t('全部结果')}</option>
                  <option value="PROFIT">{t('只看盈利')}</option>
                  <option value="LOSS">{t('只看亏损')}</option>
                  <option value="BREAKEVEN">{t('只看持平')}</option>
                </Select>
                <Select
                  value={noteFilter}
                  onChange={(e) => setNoteFilter(e.target.value as typeof noteFilter)}
                  className="h-10 bg-background"
                >
                  <option value="ALL">{t('全部备注')}</option>
                  <option value="WITH_NOTE">{t('只看有备注')}</option>
                  <option value="WITHOUT_NOTE">{t('只看无备注')}</option>
                </Select>
                <DatePicker value={dateFrom} onChange={setDateFrom} placeholder={t('开始日期')} allowClear />
                <DatePicker value={dateTo} onChange={setDateTo} placeholder={t('结束日期')} allowClear />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSortDirection((current) => current === 'desc' ? 'asc' : 'desc')}
                >
                  {t('时间排序：{order}', { order: sortDirection === 'desc' ? t('最新在前') : t('最早在前') })}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setTradeKeyword('')
                    setTradeTypeFilter('ALL')
                    setDateFrom('')
                    setDateTo('')
                    setSpecialFilter('ALL')
                    setResultFilter('ALL')
                    setNoteFilter('ALL')
                    setSortDirection('desc')
                  }}
                >
                  {t('重置筛选')}
                </Button>
              </div>
            </CardContent>
          </Card>

          {sortedTrades.length === 0 ? (
            <Card className="border-border border-dashed">
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground text-sm">{t('暂无交易记录')}</p>
                <Button size="sm" className="mt-3" onClick={() => setShowAddTrade(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {t('添加第一笔')}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-border bg-card overflow-hidden">
              <div className="overflow-x-auto max-h-[720px]">
                <table className="min-w-[1180px] w-full text-sm">
                  <thead className="sticky top-0 z-[1] bg-muted/95 border-b border-border backdrop-blur">
                    <tr className="text-left">
                      <th className="px-4 py-3 font-medium text-muted-foreground">{t('日期')}</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">{t('操作')}</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">{t('价格 / 数量')}</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">{t('费用 / 金额')}</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">{t('批次 / 持仓状态')}</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">{t('已实现结果')}</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">{t('备注')}</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground text-right">{t('操作')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tradeRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">
                          {t('当前筛选条件下没有匹配的交易记录')}
                        </td>
                      </tr>
                    ) : (
                      tradeRows.map((row) => (
                        <TradeTableRow
                          key={row.trade.id}
                          row={row}
                          market={stock.market}
                          onEdit={() => setEditTrade(row.trade)}
                          onDelete={() => setDeleteTradeTarget(row.trade)}
                        />
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </main>

      {(showAddTrade || editTrade) && (
        <AddTradeModal
          stockId={stock.id}
          stockCode={stock.code}
          stockName={stock.name}
          market={stock.market}
          editTrade={editTrade}
          onClose={() => {
            setShowAddTrade(false)
            setEditTrade(undefined)
          }}
        />
      )}

      {showEditStock && (
        <AddStockModal
          editStock={{
            id: stock.id,
            code: stock.code,
            name: stock.name,
            market: stock.market,
            note: stock.note,
          }}
          onClose={() => setShowEditStock(false)}
        />
      )}

      <ConfirmDialog
        open={!!deleteTradeTarget}
        title={t('确认删除交易')}
        description={
          deleteTradeTarget
            ? t('确定删除 {date} 的{type}记录？删除后会重算后续持仓成本和 FIFO 盈亏，该操作不可恢复。', {
              date: deleteTradeTarget.date,
              type: deleteTradeTarget.type === 'BUY' ? t('买入') : deleteTradeTarget.type === 'SELL' ? t('卖出') : incomeLabel,
            })
            : undefined
        }
        confirmText={t('删除')}
        onOpenChange={(open) => {
          if (!open) setDeleteTradeTarget(null)
        }}
        onConfirm={async () => {
          if (!deleteTradeTarget) return
          await deleteTrade(stock.id, deleteTradeTarget.id)
          setDeleteTradeTarget(null)
        }}
      />
    </div>
  )
}

function formatQuoteTimestamp(raw: string, t: (key: string, params?: Record<string, string | number>) => string, formatDateTime: (value: string | Date, options?: Intl.DateTimeFormatOptions) => string) {
  const etMatch = raw.match(/^([A-Za-z]{3} \d{1,2}, \d{4} \d{1,2}:\d{2} (?:AM|PM) ET)$/i)
  if (etMatch) return t('更新于 {value}', { value: etMatch[1] })

  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return t('更新于 {value}', { value: raw })

  return t('更新于 {value}', { value: formatDateTime(parsed, {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }) })
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-mono font-semibold text-foreground">{value}</div>
    </div>
  )
}

function formatPeTtm(pe: number | null | undefined, eps: number | null | undefined, t: (key: string) => string): string {
  if (eps !== null && eps !== undefined && Number.isFinite(eps) && eps <= 0) return t('亏损')
  if (pe === null || pe === undefined) return t('暂无数据')
  if (!Number.isFinite(pe) || pe <= 0) return t('不适用')
  return pe.toFixed(2)
}

function formatOptionalRatio(value: number | null | undefined, t: (key: string) => string): string {
  if (value === null || value === undefined) return t('暂无数据')
  if (!Number.isFinite(value) || value <= 0) return t('不适用')
  return value.toFixed(2)
}

function formatOptionalMoney(value: number | null | undefined, currency = 'CNY', t: (key: string) => string): string {
  if (value === null || value === undefined) return t('暂无数据')
  if (!Number.isFinite(value)) return t('不适用')
  const symbols: Record<string, string> = {
    CNY: '¥',
    HKD: 'HK$',
    USD: '$',
    USDT: '$',
  }
  return `${symbols[currency] ?? ''}${value.toFixed(2)}`
}

function formatOptionalMarketCap(value: number | null | undefined, currency = 'CNY', t: (key: string) => string): string {
  if (value === null || value === undefined) return t('暂无数据')
  if (!Number.isFinite(value) || value <= 0) return t('不适用')
  const symbols: Record<string, string> = {
    CNY: '¥',
    HKD: 'HK$',
    USD: '$',
    USDT: '$',
  }
  const abs = Math.abs(value)
  const units = [
    { threshold: 1e12, suffix: 'T' },
    { threshold: 1e9, suffix: 'B' },
    { threshold: 1e6, suffix: 'M' },
    { threshold: 1e4, suffix: t('万') },
  ]
  const unit = units.find((item) => abs >= item.threshold)
  if (!unit) return `${symbols[currency] ?? ''}${value.toFixed(0)}`
  return `${symbols[currency] ?? ''}${(value / unit.threshold).toFixed(2)}${unit.suffix}`
}

function formatWithNativeCurrency(amount: number, currency: keyof typeof CURRENCY_SYMBOLS, locale: string, fractionDigits = 2) {
  const symbol = CURRENCY_SYMBOLS[currency] ?? '¥'
  return `${symbol}${amount.toLocaleString(locale, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })}`
}

function formatQuantity(value: number, locale: string) {
  return value.toLocaleString(locale, {
    maximumFractionDigits: 8,
  })
}

function TradeTableRow({
  row, market, onEdit, onDelete,
}: {
  row: {
    trade: Trade
    pnlDetail?: TradePnlDetail
    typeLabel: string
    feeTotal: number
    realizedAmount: number | null
    buyRemaining: number | null
    buySold: number | null
    holdingAfterTrade: number
    isClosingTrade: boolean
    buyLotState: string | null
  }
  market: Stock['market']
  onEdit: () => void
  onDelete: () => void
}) {
  const { t, getAssetUnit, numberLocale } = useI18n()
  const { trade, pnlDetail, isClosingTrade, typeLabel, feeTotal, realizedAmount, buyRemaining, buySold, holdingAfterTrade, buyLotState } = row
  const isBuy = trade.type === 'BUY'
  const isSell = trade.type === 'SELL'
  const isDividend = trade.type === 'DIVIDEND'
  const nativeCurrency = MARKET_CURRENCY[market] || 'CNY'
  const formatAmountWithNative = (amount: number) => formatWithNativeCurrency(amount, nativeCurrency, numberLocale)
  const formatPnlWithNative = (amount: number) => formatPnl(amount, nativeCurrency)
  const assetUnit = getAssetUnit(market)
  const incomeLabel = market === 'CRYPTO' ? t('收益') : t('分红')

  return (
    <tr className="border-b border-border last:border-b-0 align-top hover:bg-muted/20">
      <td className="px-4 py-3 font-mono text-foreground whitespace-nowrap">{trade.date}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
            isBuy ? 'bg-profit/15' : isDividend ? 'bg-primary/15' : 'bg-loss/15'
          }`}>
            {isBuy ? <TrendingUp className="h-3.5 w-3.5 text-profit" />
              : isDividend ? <Gift className="h-3.5 w-3.5 text-primary" />
              : <TrendingDown className="h-3.5 w-3.5 text-loss" />}
          </div>
          <div className="space-y-1">
            <div className={`font-medium ${isBuy ? 'profit-text' : isDividend ? 'text-primary' : 'loss-text'}`}>
              {typeLabel}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {isSell && isClosingTrade && (
                <span className="inline-flex items-center rounded-md bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
                  {t('清仓')}
                </span>
              )}
              {isBuy && buyLotState && (
                <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${
                  buyLotState === t('持有中') ? 'bg-profit/15 text-profit' : 'bg-muted text-muted-foreground'
                }`}>
                  {buyLotState}
                </span>
              )}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="space-y-1 text-xs">
          <div className="font-mono text-foreground">{formatAmountWithNative(trade.price)}</div>
          <div className="text-muted-foreground">{formatQuantity(trade.quantity, numberLocale)} {assetUnit}</div>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="space-y-1 text-xs">
          <div className="text-muted-foreground">{t('费用 {amount}', { amount: formatAmountWithNative(feeTotal) })}</div>
          <div className={`font-mono ${isBuy ? 'profit-text' : isDividend ? 'text-primary' : 'loss-text'}`}>
            {isBuy ? '-' : '+'}{formatAmountWithNative(Math.abs(trade.netAmount))}
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="space-y-1 text-xs text-muted-foreground">
          <div>{t('当时总持仓 {quantity} {unit}', { quantity: formatQuantity(holdingAfterTrade, numberLocale), unit: assetUnit })}</div>
          {isBuy ? (
            <>
              <div>{t('摊薄成本 {amount}', { amount: formatAmountWithNative(trade.netAmount / trade.quantity) })}</div>
              <div>{t('该笔已卖出 {quantity} {unit}', { quantity: formatQuantity(buySold ?? 0, numberLocale), unit: assetUnit })}</div>
              <div>{t('该笔剩余 {quantity} {unit}', { quantity: formatQuantity(buyRemaining ?? 0, numberLocale), unit: assetUnit })}</div>
            </>
          ) : isDividend ? (
            <div>{t('税前{incomeLabel} {amount}', { incomeLabel, amount: formatAmountWithNative(trade.totalAmount) })}</div>
          ) : (
            <div>{t('成本基础 {amount}', { amount: formatAmountWithNative(pnlDetail?.costBasis ?? 0) })}</div>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        {realizedAmount === null ? (
          <span className="text-xs text-muted-foreground">{t('未实现')}</span>
        ) : (
          <div className="space-y-1 text-xs">
            <div className={`font-mono ${realizedAmount >= 0 ? 'profit-text' : 'loss-text'}`}>
              {formatPnlWithNative(realizedAmount)}
            </div>
            {pnlDetail && (trade.type === 'SELL') && (
              <div className={`${pnlDetail.pnl >= 0 ? 'profit-text' : 'loss-text'}`}>
                {formatPercent(pnlDetail.pnlPercent)}
              </div>
            )}
          </div>
        )}
      </td>
      <td className="px-4 py-3 max-w-[260px]">
        <div className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
          {trade.note || '--'}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={onEdit}
            className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-all"
          >
            <Edit className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-all"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  )
}
