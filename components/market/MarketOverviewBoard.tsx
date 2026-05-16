'use client'

import { useEffect, useState } from 'react'
import { Newspaper, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { nextApiUrls } from '@/lib/api/endpoints'
import { useI18n } from '@/lib/i18n'
import type { MarketIndexSnapshot, MarketRegion, NewsItem } from '@/types'

type MarketGroup = {
  region: MarketRegion
  label: string
  indices: MarketIndexSnapshot[]
  upCount: number
  downCount: number
  flatCount: number
  strongestIndex: MarketIndexSnapshot | null
  weakestIndex: MarketIndexSnapshot | null
}

type MarketOverviewResponse = {
  groups: MarketGroup[]
  totalUpCount: number
  totalDownCount: number
  totalFlatCount: number
  strongestIndex: MarketIndexSnapshot | null
  weakestIndex: MarketIndexSnapshot | null
  summary: {
    marketTone: string
    riskBias: string
    focusRegion: string
    cautionRegion: string
  }
  news: NewsItem[]
  updatedAt: string
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥',
  HKD: 'HK$',
  USD: '$',
}

export default function MarketOverviewBoard() {
  const { t, formatTime, formatDateTime, numberLocale } = useI18n()
  const [overview, setOverview] = useState<MarketOverviewResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadOverview = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(nextApiUrls.market.overview(), { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(t(data?.error ?? '获取大盘数据失败'))
      }
      setOverview(data as MarketOverviewResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('获取大盘数据失败'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadOverview()
  }, [])

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{t('三地大盘概览')}</h2>
          <div className="mt-1 text-xs text-muted-foreground">
            {t('同时查看 A 股、港股和美股代表性指数，快速判断今天的大盘情绪和强弱结构。')}
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => loadOverview()} disabled={loading}>
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('刷新数据')}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-3">
        {overview?.groups.map((group) => (
          <StatCard
            key={group.region}
            label={group.label}
            value={`${group.upCount} / ${group.downCount} / ${group.flatCount}`}
            detail={t('上涨 / 下跌 / 平盘 · 最强 {strongest} · 最弱 {weakest}', {
              strongest: group.strongestIndex?.name ?? '--',
              weakest: group.weakestIndex?.name ?? '--',
            })}
          />
        ))}
      </div>

      {overview?.summary && (
        <Card className="border-border bg-card">
          <div className="p-5 grid gap-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{t('市场摘要')}</div>
              <div className="text-base font-medium text-foreground leading-7">{overview.summary.marketTone}</div>
              <div className="text-sm text-muted-foreground leading-6">{overview.summary.riskBias}</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <SummaryChip title={t('优先关注')} value={overview.summary.focusRegion} />
              <SummaryChip title={t('优先防范')} value={overview.summary.cautionRegion} />
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        {overview?.groups.map((group) => (
          <Card key={group.region} className="border-border bg-card">
            <div className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">{group.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t('上涨 {up} · 下跌 {down} · 平盘 {flat}', { up: group.upCount, down: group.downCount, flat: group.flatCount })}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {t('最强 {name} {value}', { name: group.strongestIndex?.name ?? '--', value: group.strongestIndex ? formatSignedPercent(group.strongestIndex.changePercent) : '' })}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t('最弱 {name} {value}', { name: group.weakestIndex?.name ?? '--', value: group.weakestIndex ? formatSignedPercent(group.weakestIndex.changePercent) : '' })}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {overview.updatedAt ? t('更新于 {time}', { time: formatTime(overview.updatedAt) }) : ''}
                </div>
              </div>

              <div className="space-y-3">
                {group.indices.map((index) => (
                  <div key={index.id} className="rounded-xl border border-border/70 bg-muted/20 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-foreground">{index.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{index.code}</div>
                      </div>
                      <div className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${index.change >= 0 ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'}`}>
                        {index.change >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                        {index.change >= 0 ? t('偏强') : t('偏弱')}
                      </div>
                    </div>

                    <div className="mt-4 flex items-end justify-between gap-3">
                      <div>
                        <div className="text-xl font-semibold font-mono text-foreground">
                          {formatIndexValue(index.price, index.currency, numberLocale)}
                        </div>
                        <div className={`mt-1 text-sm font-mono ${index.change >= 0 ? 'profit-text' : 'loss-text'}`}>
                          {formatSignedValue(index.change, index.currency, numberLocale)} · {formatSignedPercent(index.changePercent)}
                        </div>
                      </div>
                      <div className="text-right text-xs text-muted-foreground space-y-1">
                        <div>{t('开盘 {value}', { value: index.open ? formatIndexValue(index.open, index.currency, numberLocale) : '--' })}</div>
                        <div>{t('高低 {high} / {low}', {
                          high: index.high ? formatIndexValue(index.high, index.currency, numberLocale) : '--',
                          low: index.low ? formatIndexValue(index.low, index.currency, numberLocale) : '--',
                        })}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="border-border bg-card">
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Newspaper className="h-4 w-4 text-muted-foreground" />
            <div className="text-sm font-medium text-foreground">{t('市场重点新闻')}</div>
          </div>
          {overview?.news?.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {overview.news.map((item) => (
                <a
                  key={`${item.source}-${item.title}`}
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-border/70 bg-muted/20 p-4 transition-colors hover:bg-muted/35"
                >
                  <div className="text-sm font-medium text-foreground leading-6">{item.title}</div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {item.source} · {formatDateTime(item.publishedAt, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="mt-3 text-sm text-muted-foreground leading-6">
                    {item.summary || t('暂无摘要')}
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
              {t('暂无可用市场新闻，稍后刷新再试。')}
            </div>
          )}
        </div>
      </Card>
    </section>
  )
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-3 text-xl font-semibold text-foreground">{value}</div>
      <div className="mt-2 text-xs text-muted-foreground">{detail}</div>
    </div>
  )
}

function SummaryChip({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{title}</div>
      <div className="mt-3 text-sm font-medium text-foreground leading-6">{value}</div>
    </div>
  )
}

function formatIndexValue(value: number, currency: string, locale: string) {
  const symbol = CURRENCY_SYMBOLS[currency] ?? ''
  return `${symbol}${value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatSignedValue(value: number, currency: string, locale: string) {
  const symbol = CURRENCY_SYMBOLS[currency] ?? ''
  const sign = value >= 0 ? '+' : ''
  return `${sign}${symbol}${value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatSignedPercent(value: number) {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}
