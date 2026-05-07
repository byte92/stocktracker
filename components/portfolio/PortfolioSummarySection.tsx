'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useStockStore } from '@/store/useStockStore'
import { useCurrency } from '@/hooks/useCurrency'
import { useMarketHolidayCalendars } from '@/hooks/useMarketHolidayCalendars'
import { nextApiUrls } from '@/lib/api/endpoints'
import { calcStockSummary, formatPnl, formatPercent } from '@/lib/finance'
import { MARKET_CURRENCY } from '@/lib/ExchangeRateService'
import { getDailyQuotePnl, needsMarketHolidayCalendar } from '@/lib/quoteDailyPnl'
import { useI18n } from '@/lib/i18n'
import type { StockQuote } from '@/types/stockApi'

type TodayPnlSnapshot = {
  amount: number
  rate: number
  marketValue: number
  costBasis: number
  unrealizedPnl: number
  unrealizedPnlPercent: number
  gainers: number
  losers: number
  flat: number
  quoted: number
  activeDaily: number
  closed: number
  stale: number
}

export default function PortfolioSummarySection() {
  const { stocks } = useStockStore()
  const { displayCurrency, convertAmountSync, formatWithCurrency, rates } = useCurrency()
  const { t, numberLocale } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const calendarMarkets = useMemo(() => Array.from(new Set(stocks.map((stock) => stock.market))), [stocks])
  const { calendars: holidayCalendars, loading: holidayCalendarLoading } = useMarketHolidayCalendars(calendarMarkets)
  const [todayPnl, setTodayPnl] = useState<TodayPnlSnapshot>({
    amount: 0,
    rate: 0,
    marketValue: 0,
    costBasis: 0,
    unrealizedPnl: 0,
    unrealizedPnlPercent: 0,
    gainers: 0,
    losers: 0,
    flat: 0,
    quoted: 0,
    activeDaily: 0,
    closed: 0,
    stale: 0,
  })
  const [todayPnlLoading, setTodayPnlLoading] = useState(false)

  const portfolio = useMemo(() => {
    let totalRealizedPnl = 0
    let totalInvested = 0
    let totalCommission = 0
    let totalDividend = 0
    let totalHolding = 0

    for (const stock of stocks) {
      const summary = calcStockSummary(stock)
      totalRealizedPnl += convertAmountSync(summary.realizedPnl, stock.market)
      totalInvested += convertAmountSync(summary.totalBuyAmount, stock.market)
      totalCommission += convertAmountSync(summary.totalCommission, stock.market)
      totalDividend += convertAmountSync(summary.totalDividend, stock.market)
      totalHolding += summary.currentHolding
    }

    const totalRealizedPnlPercent = totalInvested > 0 ? (totalRealizedPnl / totalInvested) * 100 : 0

    return {
      totalRealizedPnl,
      totalInvested,
      totalRealizedPnlPercent,
      totalCommission,
      totalDividend,
      totalHolding,
      stockCount: stocks.length,
    }
  }, [stocks, convertAmountSync])

  useEffect(() => {
    let cancelled = false

    const convertWithRates = (amount: number, market: string) => {
      const fromCurrency = MARKET_CURRENCY[market] || 'CNY'
      if (fromCurrency === displayCurrency) {
        return amount
      }
      const fromRate = rates[fromCurrency] || 1
      const toRate = rates[displayCurrency] || 1
      return (amount * fromRate) / toRate
    }

    async function loadTodayPnl() {
      const activeHoldings = stocks
        .map((stock) => ({ stock, summary: calcStockSummary(stock) }))
        .filter(({ summary }) => summary.currentHolding > 0)

      if (activeHoldings.length === 0) {
        setTodayPnl({ amount: 0, rate: 0, marketValue: 0, costBasis: 0, unrealizedPnl: 0, unrealizedPnlPercent: 0, gainers: 0, losers: 0, flat: 0, quoted: 0, activeDaily: 0, closed: 0, stale: 0 })
        return
      }

      const waitingForCalendar = activeHoldings.some(
        ({ stock }) => needsMarketHolidayCalendar(stock.market) && !holidayCalendars[stock.market] && holidayCalendarLoading,
      )
      if (waitingForCalendar) {
        setTodayPnlLoading(true)
        return
      }

      setTodayPnlLoading(true)

      try {
        const now = new Date()
        const responses = await Promise.all(
          activeHoldings.map(async ({ stock, summary }) => {
            const res = await fetch(
              nextApiUrls.stock.quote(stock.code, stock.market),
              { cache: 'no-store' },
            )
            const data = await res.json()
            const quote = (data?.quote ?? null) as StockQuote | null
            if (!quote) {
              return null
            }

            const quotedSummary = calcStockSummary(stock, quote.price)
            const dailyPnl = getDailyQuotePnl(summary.currentHolding, quote, stock.market, now, holidayCalendars[stock.market])
            const rawMarketValue = summary.currentHolding * quote.price
            const rawCostBasis = quotedSummary.avgCostPrice * quotedSummary.currentHolding
            return {
              todayPnl: convertWithRates(dailyPnl.amount, stock.market),
              previousValue: convertWithRates(dailyPnl.previousValue, stock.market),
              marketValue: convertWithRates(rawMarketValue, stock.market),
              costBasis: convertWithRates(rawCostBasis, stock.market),
              dailyState: dailyPnl.state,
            }
          }),
        )

        if (cancelled) {
          return
        }

        const next = responses.filter((item): item is { todayPnl: number; previousValue: number; marketValue: number; costBasis: number; dailyState: ReturnType<typeof getDailyQuotePnl>['state'] } => item !== null)
        const snapshot = next.reduce(
          (acc, item) => {
            if (item.dailyState === 'active') {
              acc.amount += item.todayPnl
              acc.rateBase += item.previousValue
              acc.activeDaily += 1
              if (item.todayPnl > 0) {
                acc.gainers += 1
              } else if (item.todayPnl < 0) {
                acc.losers += 1
              } else {
                acc.flat += 1
              }
            } else if (item.dailyState === 'market-closed') {
              acc.closed += 1
            } else if (item.dailyState === 'stale-quote') {
              acc.stale += 1
            }
            acc.marketValue += item.marketValue
            acc.costBasis += item.costBasis
            acc.quoted += 1
            return acc
          },
          { amount: 0, rateBase: 0, marketValue: 0, costBasis: 0, gainers: 0, losers: 0, flat: 0, quoted: 0, activeDaily: 0, closed: 0, stale: 0 },
        )
        const unrealizedPnl = snapshot.marketValue - snapshot.costBasis

        setTodayPnl({
          amount: snapshot.amount,
          rate: snapshot.rateBase > 0 ? (snapshot.amount / snapshot.rateBase) * 100 : 0,
          marketValue: snapshot.marketValue,
          costBasis: snapshot.costBasis,
          unrealizedPnl,
          unrealizedPnlPercent: snapshot.costBasis > 0 ? (unrealizedPnl / snapshot.costBasis) * 100 : 0,
          gainers: snapshot.gainers,
          losers: snapshot.losers,
          flat: snapshot.flat,
          quoted: snapshot.quoted,
          activeDaily: snapshot.activeDaily,
          closed: snapshot.closed,
          stale: snapshot.stale,
        })
      } catch (error) {
        console.error('Failed to load portfolio daily pnl:', error)
        if (!cancelled) {
          setTodayPnl({ amount: 0, rate: 0, marketValue: 0, costBasis: 0, unrealizedPnl: 0, unrealizedPnlPercent: 0, gainers: 0, losers: 0, flat: 0, quoted: 0, activeDaily: 0, closed: 0, stale: 0 })
        }
      } finally {
        if (!cancelled) {
          setTodayPnlLoading(false)
        }
      }
    }

    void loadTodayPnl()

    return () => {
      cancelled = true
    }
  }, [stocks, displayCurrency, rates, holidayCalendars, holidayCalendarLoading])

  const todayPnlStatus = (() => {
    if (todayPnlLoading) return t('正在刷新当日行情')
    if (todayPnl.activeDaily > 0) {
      const base = t('{gainers} 个上涨 · {losers} 个下跌', { gainers: todayPnl.gainers, losers: todayPnl.losers })
      return todayPnl.flat > 0 ? `${base} · ${t('{count} 个平盘', { count: todayPnl.flat })}` : base
    }
    if (todayPnl.quoted > 0 && todayPnl.closed > 0) return t('今日休市 · 最近行情不计入今日盈亏')
    if (todayPnl.quoted > 0 && todayPnl.stale > 0) return t('暂无今日行情 · 最近行情不计入今日盈亏')
    return t('暂无可用行情')
  })()

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">{t('资产概览')}</h2>
          <div className="mt-1 text-xs text-muted-foreground">{t('默认展示核心资产状态，展开可查看费用、现金收益和持仓数量')}</div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden text-xs text-muted-foreground sm:block">{t('共 {count} 个资产', { count: portfolio.stockCount })}</div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            {expanded ? t('收起详情') : t('展开详情')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="stat-card border-border">
          <div className="text-xs text-muted-foreground mb-1">{t('今日盈亏')}</div>
          <div className={`stat-value ${todayPnl.amount >= 0 ? 'profit-text' : 'loss-text'}`}>
            {formatPnl(todayPnl.amount, displayCurrency)}
          </div>
          <div className={`stat-subvalue ${todayPnl.amount >= 0 ? 'profit-text' : 'loss-text'}`}>
            {formatPercent(todayPnl.rate)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {todayPnlStatus}
          </div>
        </Card>

        <Card className="stat-card border-border">
          <div className="text-xs text-muted-foreground mb-1">{t('持有市值')}</div>
          <div className="stat-value text-foreground">
            {formatWithCurrency(todayPnl.marketValue)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {todayPnlLoading ? t('正在刷新行情') : todayPnl.quoted > 0 ? t('{count} 个持仓有最近行情', { count: todayPnl.quoted }) : t('暂无可用行情')}
          </div>
        </Card>

        <Card className="stat-card border-border">
          <div className="text-xs text-muted-foreground mb-1">{t('浮动盈亏')}</div>
          <div className={`stat-value ${todayPnl.unrealizedPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
            {formatPnl(todayPnl.unrealizedPnl, displayCurrency)}
          </div>
          <div className={`stat-subvalue ${todayPnl.unrealizedPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
            {formatPercent(todayPnl.unrealizedPnlPercent)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {t('成本 {amount}', { amount: formatWithCurrency(todayPnl.costBasis) })}
          </div>
        </Card>

        <Card className="stat-card border-border">
          <div className="text-xs text-muted-foreground mb-1">{t('累计已实现收益')}</div>
          <div className={`stat-value ${portfolio.totalRealizedPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
            {formatPnl(portfolio.totalRealizedPnl, displayCurrency)}
          </div>
          <div className={`stat-subvalue ${portfolio.totalRealizedPnl >= 0 ? 'profit-text' : 'loss-text'}`}>
            {formatPercent(portfolio.totalRealizedPnlPercent)}
          </div>
        </Card>
      </div>

      {expanded && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card className="stat-card border-border">
            <div className="text-xs text-muted-foreground mb-1">{t('总手续费')}</div>
            <div className="stat-value text-foreground">
              {formatWithCurrency(portfolio.totalCommission)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{t('累计手续费')}</div>
          </Card>

          <Card className="stat-card border-border">
            <div className="text-xs text-muted-foreground mb-1">{t('累计现金收益')}</div>
            <div className="stat-value text-foreground">
              {formatWithCurrency(portfolio.totalDividend)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{t('税后到账')}</div>
          </Card>

          <Card className="stat-card border-border">
            <div className="text-xs text-muted-foreground mb-1">{t('持仓数量')}</div>
            <div className="stat-value text-foreground">
              {portfolio.totalHolding.toLocaleString(numberLocale)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">{t('全部市场')}</div>
          </Card>
        </div>
      )}
    </section>
  )
}
