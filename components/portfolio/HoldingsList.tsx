'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import ConfirmDialog from '@/components/ConfirmDialog'
import AddStockModal from '@/components/AddStockModal'
import { useCurrency } from '@/hooks/useCurrency'
import { useMarketHolidayCalendars } from '@/hooks/useMarketHolidayCalendars'
import { useStockQuote } from '@/hooks/useStockQuote'
import { useStockStore } from '@/store/useStockStore'
import { nextApiUrls } from '@/lib/api/endpoints'
import { calcStockSummary, formatPercent, formatPnl } from '@/lib/finance'
import { CURRENCY_SYMBOLS, MARKET_CURRENCY, type Currency } from '@/lib/ExchangeRateService'
import { getDailyQuotePnl, needsMarketHolidayCalendar, type MarketHolidayCalendar } from '@/lib/quoteDailyPnl'
import { useI18n } from '@/lib/i18n'
import type { Stock } from '@/types'
import type { StockQuote } from '@/types/stockApi'

type SortOption =
  | 'default'
  | 'today-pnl-desc'
  | 'today-pnl-asc'
  | 'today-rate-desc'
  | 'total-pnl-desc'
  | 'cost-desc'
  | 'name-asc'

type QuoteByStockId = Record<string, StockQuote | null>

export default function HoldingsList({
  limit,
  showAddButton = true,
  title,
  description,
}: {
  limit?: number
  showAddButton?: boolean
  title?: string
  description?: string
}) {
  const router = useRouter()
  const { t } = useI18n()
  const { stocks, deleteStock } = useStockStore()
  const { convertAmountSync } = useCurrency()
  const [showAddStock, setShowAddStock] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; code: string } | null>(null)
  const [sortBy, setSortBy] = useState<SortOption>('default')
  const [quotesByStockId, setQuotesByStockId] = useState<QuoteByStockId>({})
  const calendarMarkets = useMemo(() => Array.from(new Set(stocks.map((stock) => stock.market))), [stocks])
  const { calendars: holidayCalendars, loading: holidayCalendarLoading } = useMarketHolidayCalendars(calendarMarkets)

  useEffect(() => {
    let cancelled = false

    async function loadQuotes() {
      const activeHoldings = stocks.filter((stock) =>
        calcStockSummary(stock).currentHolding > 0
      )

      if (activeHoldings.length === 0) {
        setQuotesByStockId({})
        return
      }

      try {
        const responses = await Promise.all(
          activeHoldings.map(async (stock) => {
            const res = await fetch(
              nextApiUrls.stock.quote(stock.code, stock.market),
              { cache: 'no-store' },
            )
            const data = await res.json()
            return [stock.id, (data?.quote ?? null) as StockQuote | null] as const
          }),
        )

        if (!cancelled) {
          setQuotesByStockId(Object.fromEntries(responses))
        }
      } catch (error) {
        console.error('Failed to preload holdings quotes:', error)
        if (!cancelled) {
          setQuotesByStockId({})
        }
      }
    }

    void loadQuotes()
    const timer = window.setInterval(loadQuotes, 60000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [stocks])

  const visibleStocks = useMemo(() => {
    const now = new Date()
    const sorted = sortBy === 'default'
      ? [...stocks]
      : [...stocks].sort((left, right) => {
          if (sortBy === 'name-asc') {
            return left.code.localeCompare(right.code, 'zh-CN')
          }

          const leftQuote = quotesByStockId[left.id]
          const rightQuote = quotesByStockId[right.id]
          const leftSummary = calcStockSummary(left, leftQuote?.price)
          const rightSummary = calcStockSummary(right, rightQuote?.price)
          const leftCalendarPending = needsMarketHolidayCalendar(left.market) && !holidayCalendars[left.market] && holidayCalendarLoading
          const rightCalendarPending = needsMarketHolidayCalendar(right.market) && !holidayCalendars[right.market] && holidayCalendarLoading
          const leftDailyPnl = leftCalendarPending ? null : getDailyQuotePnl(leftSummary.currentHolding, leftQuote, left.market, now, holidayCalendars[left.market])
          const rightDailyPnl = rightCalendarPending ? null : getDailyQuotePnl(rightSummary.currentHolding, rightQuote, right.market, now, holidayCalendars[right.market])

          const leftTodayPnl = leftQuote && leftDailyPnl ? convertAmountSync(leftDailyPnl.amount, left.market) : Number.NEGATIVE_INFINITY
          const rightTodayPnl = rightQuote && rightDailyPnl ? convertAmountSync(rightDailyPnl.amount, right.market) : Number.NEGATIVE_INFINITY

          const leftPrevValueRaw = leftQuote && leftDailyPnl ? leftDailyPnl.previousValue : 0
          const rightPrevValueRaw = rightQuote && rightDailyPnl ? rightDailyPnl.previousValue : 0
          const leftPrevValue = leftPrevValueRaw > 0 ? convertAmountSync(leftPrevValueRaw, left.market) : 0
          const rightPrevValue = rightPrevValueRaw > 0 ? convertAmountSync(rightPrevValueRaw, right.market) : 0
          const leftTodayRate = leftPrevValue > 0 ? leftTodayPnl / leftPrevValue : Number.NEGATIVE_INFINITY
          const rightTodayRate = rightPrevValue > 0 ? rightTodayPnl / rightPrevValue : Number.NEGATIVE_INFINITY

          const leftTotalPnl = leftQuote
            ? convertAmountSync(leftSummary.totalPnl, left.market)
            : convertAmountSync(leftSummary.realizedPnl, left.market)
          const rightTotalPnl = rightQuote
            ? convertAmountSync(rightSummary.totalPnl, right.market)
            : convertAmountSync(rightSummary.realizedPnl, right.market)

          const leftCost = convertAmountSync(leftSummary.avgCostPrice * leftSummary.currentHolding, left.market)
          const rightCost = convertAmountSync(rightSummary.avgCostPrice * rightSummary.currentHolding, right.market)

          switch (sortBy) {
            case 'today-pnl-desc':
              return rightTodayPnl - leftTodayPnl
            case 'today-pnl-asc':
              return leftTodayPnl - rightTodayPnl
            case 'today-rate-desc':
              return rightTodayRate - leftTodayRate
            case 'total-pnl-desc':
              return rightTotalPnl - leftTotalPnl
            case 'cost-desc':
              return rightCost - leftCost
            default:
              return 0
          }
        })

    return typeof limit === 'number' ? sorted.slice(0, limit) : sorted
  }, [convertAmountSync, holidayCalendars, holidayCalendarLoading, limit, quotesByStockId, sortBy, stocks])

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold">{title ?? t('持仓列表')}</h2>
          <div className="text-xs text-muted-foreground mt-1">
            {description ?? (limit ? t('展示前 {count} 条持仓，点击进入详情。', { count: visibleStocks.length }) : t('共 {count} 个资产，支持删除与进入详情。', { count: stocks.length }))}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as SortOption)}
            containerClassName="w-[176px]"
            aria-label={t('持仓排序')}
          >
            <option value="default">{t('默认顺序')}</option>
            <option value="today-pnl-desc">{t('今日盈亏从高到低')}</option>
            <option value="today-pnl-asc">{t('今日盈亏从低到高')}</option>
            <option value="today-rate-desc">{t('今日盈亏率从高到低')}</option>
            <option value="total-pnl-desc">{t('总盈亏从高到低')}</option>
            <option value="cost-desc">{t('持仓成本从高到低')}</option>
            <option value="name-asc">{t('代码顺序')}</option>
          </Select>
          {limit && stocks.length > visibleStocks.length && (
            <Button size="sm" variant="outline" onClick={() => router.push('/portfolio')}>
              {t('查看全部')}
            </Button>
          )}
          {showAddButton && (
            <Button size="sm" onClick={() => setShowAddStock(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t('添加资产')}
            </Button>
          )}
        </div>
      </div>

      {visibleStocks.length === 0 ? (
        <Card className="border-border bg-card">
          <div className="p-6 text-sm text-muted-foreground">
            {t('还没有添加资产，点击右上角“添加资产”开始记录。')}
          </div>
        </Card>
      ) : (
        <Card className="border-border bg-card/60 overflow-hidden">
          <div className="hidden md:grid grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_auto] gap-4 px-4 py-3 border-b border-border/70">
            <div className="text-xs text-muted-foreground">{t('名称')}</div>
            <div className="text-xs text-muted-foreground">{t('持仓成本')}</div>
            <div className="text-xs text-muted-foreground">{t('今日盈亏')}</div>
            <div className="text-xs text-muted-foreground">{t('总盈亏')}</div>
            <div className="text-xs text-muted-foreground text-right">{t('操作')}</div>
          </div>
          <div className="divide-y divide-border/70">
            {visibleStocks.map((stock) => (
              <StockListRow
                key={stock.id}
                stock={stock}
                preloadedQuote={quotesByStockId[stock.id] ?? null}
                holidayCalendar={holidayCalendars[stock.market] ?? null}
                holidayCalendarLoading={holidayCalendarLoading}
                onOpen={() => router.push(`/stock/${stock.id}`)}
                onDelete={() => setDeleteTarget({ id: stock.id, name: stock.name, code: stock.code })}
              />
            ))}
          </div>
        </Card>
      )}

      {showAddStock && (
        <AddStockModal
          onClose={() => setShowAddStock(false)}
          onAdded={(id) => router.push(`/stock/${id}`)}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('确认删除持仓')}
        description={deleteTarget ? t('确定删除 {name}（{code}）？该操作不可恢复。', { name: deleteTarget.name, code: deleteTarget.code }) : undefined}
        confirmText={t('删除')}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        onConfirm={async () => {
          if (!deleteTarget) return
          await deleteStock(deleteTarget.id)
          setDeleteTarget(null)
        }}
      />
    </section>
  )
}

function StockListRow({
  stock,
  preloadedQuote,
  holidayCalendar,
  holidayCalendarLoading,
  onOpen,
  onDelete,
}: {
  stock: Stock
  preloadedQuote: StockQuote | null
  holidayCalendar: MarketHolidayCalendar | null
  holidayCalendarLoading: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  const { t, getAssetUnit, getMarketLabel, numberLocale } = useI18n()
  const { quote: liveQuote } = useStockQuote(stock.code, stock.market, { autoRefresh: true, refreshInterval: 60000 })
  const quote = liveQuote ?? preloadedQuote
  const summary = calcStockSummary(stock, quote?.price)
  const nativeCurrency = MARKET_CURRENCY[stock.market] || 'CNY'
  const assetUnit = getAssetUnit(stock.market)
  const marketLabel = getMarketLabel(stock.market)
  const formatNativeAmount = (amount: number) => formatWithNativeCurrency(amount, nativeCurrency, numberLocale)
  const formatNativePrice = (amount: number) => formatWithNativeCurrency(amount, nativeCurrency, numberLocale, 4)
  const totalCost = summary.avgCostPrice * summary.currentHolding
  const avgCost = summary.avgCostPrice
  const realizedPnl = summary.realizedPnl
  const unrealizedPnl = quote ? summary.unrealizedPnl : null
  const totalPnl = quote ? summary.totalPnl : null
  const calendarPending = needsMarketHolidayCalendar(stock.market) && !holidayCalendar && holidayCalendarLoading
  const dailyPnl = calendarPending ? null : getDailyQuotePnl(summary.currentHolding, quote, stock.market, new Date(), holidayCalendar)
  const todayPnl = quote && dailyPnl ? dailyPnl.amount : null
  const todayPnlRate = quote && dailyPnl ? dailyPnl.rate : null
  const currentPrice = quote ? quote.price : null
  const dailyHint = calendarPending
    ? t('正在确认交易日')
    : dailyPnl?.state === 'market-closed'
      ? t('今日休市')
      : dailyPnl?.state === 'stale-quote'
        ? t('暂无今日行情')
        : t('暂无当日行情')

  return (
    <div
      className="px-4 py-4 grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_auto] gap-3 md:gap-4 md:items-center group cursor-pointer hover:bg-secondary/30 transition-colors"
      onClick={onOpen}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <div className="font-semibold text-foreground truncate">{stock.name}</div>
          <span className="text-xs text-muted-foreground font-mono">{stock.code}</span>
          <span className="neutral-badge">{marketLabel}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {stock.code} · {marketLabel}
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-sm font-mono font-semibold text-foreground">
          {formatNativeAmount(totalCost)}
        </div>
        <div className="text-xs text-muted-foreground">
          {t('持仓 {quantity} {unit}', { quantity: formatQuantity(summary.currentHolding, numberLocale), unit: assetUnit })}
        </div>
        <div className="text-xs text-muted-foreground">
          {t('均价 {amount}', { amount: formatNativePrice(avgCost) })}
        </div>
      </div>

      <div className="space-y-1">
        <div className={`text-sm font-mono font-semibold ${(todayPnl ?? 0) >= 0 ? 'profit-text' : 'loss-text'}`}>
          {quote && !calendarPending ? formatPnl(todayPnl ?? 0, nativeCurrency) : '--'}
        </div>
        <div className={`text-xs ${(todayPnlRate ?? 0) >= 0 ? 'profit-text' : 'loss-text'}`}>
          {dailyPnl?.state === 'active' && todayPnlRate !== null ? formatPercent(todayPnlRate) : dailyHint}
        </div>
        <div className="text-xs text-muted-foreground">
          {quote ? t('现价 {amount}', { amount: formatNativeAmount(currentPrice ?? 0) }) : t('等待行情返回')}
        </div>
      </div>

      <div className="space-y-1">
        <div className={`text-sm font-mono font-semibold ${(totalPnl ?? realizedPnl) >= 0 ? 'profit-text' : 'loss-text'}`}>
          {formatPnl(totalPnl ?? realizedPnl, nativeCurrency)}
        </div>
        {totalPnl === null ? (
          <div className="text-xs text-muted-foreground">
            {t('已实现收益')}
          </div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground">
              {t('已实现 {realized} · 浮动 {unrealized}', { realized: formatPnl(realizedPnl, nativeCurrency), unrealized: formatPnl(unrealizedPnl ?? 0, nativeCurrency) })}
            </div>
            <div className="text-xs text-muted-foreground">
              {t('累计视角')}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between md:justify-end gap-1">
        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive opacity-70 md:opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function formatWithNativeCurrency(amount: number, currency: Currency, locale: string, fractionDigits = 2) {
  const symbol = CURRENCY_SYMBOLS[currency] ?? '¥'
  return `${symbol}${amount.toLocaleString(locale, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits })}`
}

function formatQuantity(value: number, locale: string) {
  return value.toLocaleString(locale, {
    maximumFractionDigits: 8,
  })
}
