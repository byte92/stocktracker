'use client'

import PageHeader from '@/components/layout/PageHeader'
import MarketOverviewBoard from '@/components/market/MarketOverviewBoard'
import MarketAnalysisCard from '@/components/market/MarketAnalysisCard'
import { useI18n } from '@/lib/i18n'

export default function MarketsPage() {
  const { t } = useI18n()

  return (
    <div className="min-h-screen">
      <PageHeader
        title={t('大盘指标')}
        description={t('集中查看 A 股、港股和美股代表指数，并通过 AI 观察三地大盘的短中期节奏。')}
      />

      <div className="px-4 py-6 lg:px-6 space-y-6">
        <MarketAnalysisCard />
        <MarketOverviewBoard />
      </div>
    </div>
  )
}
