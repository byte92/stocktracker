'use client'

import Link from 'next/link'
import { ChevronRight, Sparkles } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { useStockStore } from '@/store/useStockStore'
import { calcStockSummary } from '@/lib/finance'
import { useI18n } from '@/lib/i18n'

export default function AiStockNavigator() {
  const { stocks } = useStockStore()
  const { t, getAssetUnit, numberLocale } = useI18n()

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{t('标的分析入口')}</h2>
        <div className="mt-1 text-xs text-muted-foreground">{t('从这里直接进入对应资产详情页，触发 AI 深度分析。')}</div>
      </div>

      {stocks.length === 0 ? (
        <Card className="border-border bg-card">
          <div className="p-5 text-sm text-muted-foreground">{t('当前没有持仓，先添加资产后再使用标的 AI 分析。')}</div>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {stocks.map((stock) => {
            const summary = calcStockSummary(stock)
            const assetUnit = getAssetUnit(stock.market)
            return (
              <Link
                key={stock.id}
                href={`/stock/${stock.id}`}
                className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30 hover:bg-card/80"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{stock.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground font-mono">{stock.code}</div>
                  </div>
                  <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                </div>
                <div className="mt-4 space-y-1 text-xs text-muted-foreground">
                  <div>{t('当前持仓 {quantity} {unit}', { quantity: formatQuantity(summary.currentHolding, numberLocale), unit: assetUnit })}</div>
                  <div>{t('已实现收益')} {summary.realizedPnl.toFixed(2)}</div>
                  <div>{t('交易记录 {count} 条', { count: stock.trades.length })}</div>
                </div>
                <div className="mt-4 inline-flex items-center text-xs font-medium text-primary">
                  {t('进入详情分析')}
                  <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </section>
  )
}

function formatQuantity(value: number, locale: string) {
  return value.toLocaleString(locale, {
    maximumFractionDigits: 8,
  })
}
