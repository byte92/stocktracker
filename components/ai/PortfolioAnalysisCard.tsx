'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sparkles, AlertTriangle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { describeClientRequestError, readJsonResponse } from '@/lib/api/client'
import { nextApiUrls } from '@/lib/api/endpoints'
import { formatProbabilityScenario } from '@/lib/ai/display'
import { useI18n } from '@/lib/i18n'
import { useStockStore } from '@/store/useStockStore'
import type { AiAnalysisResult } from '@/types'

const AI_ANALYSIS_UNAVAILABLE_MESSAGE = '服务暂时不可用，请稍后重试或点击重新分析。'

export default function PortfolioAnalysisCard({ compact = false }: { compact?: boolean }) {
  const { stocks, config, userId } = useStockStore()
  const { t, formatDateTime } = useI18n()
  const [result, setResult] = useState<AiAnalysisResult | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [loading, setLoading] = useState(false)
  const [bootstrapping, setBootstrapping] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const topRisks = useMemo(() => result?.portfolioRiskNotes?.slice(0, compact ? 2 : 4) ?? [], [compact, result])

  useEffect(() => {
    if (!result) return

    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 60 * 1000)
    return () => window.clearInterval(timer)
  }, [result])

  useEffect(() => {
    if (!userId) return

    const today = new Date().toISOString().slice(0, 10)

    const loadLatestTodayResult = async () => {
      setBootstrapping(true)
      try {
        const params = new URLSearchParams({
          userId,
          type: 'portfolio',
          dateFrom: today,
          dateTo: today,
        })
        const res = await fetch(nextApiUrls.ai.history(params), { cache: 'no-store' })
        const data = await readJsonResponse<{ records?: Array<{ result?: AiAnalysisResult }> }>(res, {
          fallbackMessage: t('加载今日组合分析失败'),
          unavailableMessage: t(AI_ANALYSIS_UNAVAILABLE_MESSAGE),
        })
        const records = Array.isArray(data?.records) ? data.records : []
        const latest = records[0] as { result?: AiAnalysisResult } | undefined
        setResult(latest?.result ?? null)
      } catch (err) {
        console.error('Load portfolio AI analysis history failed:', err)
        setError(describeClientRequestError(err, t('加载今日组合分析失败'), t(AI_ANALYSIS_UNAVAILABLE_MESSAGE)))
      } finally {
        setBootstrapping(false)
      }
    }

    void loadLatestTodayResult()
  }, [userId])

  const runAnalysis = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(nextApiUrls.ai.portfolioAnalysis(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          stocks,
          aiConfig: config.aiConfig,
          totalCapital: config.portfolio.totalCapital,
          forceRefresh: true,
        }),
      })
      const data = await readJsonResponse<{ result: AiAnalysisResult }>(res, {
        fallbackMessage: t('组合 AI 分析失败'),
        unavailableMessage: t(AI_ANALYSIS_UNAVAILABLE_MESSAGE),
      })
      setResult(data.result as AiAnalysisResult)
    } catch (err) {
      console.error('Run portfolio AI analysis failed:', err)
      setError(describeClientRequestError(err, t('组合 AI 分析失败'), t(AI_ANALYSIS_UNAVAILABLE_MESSAGE)))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{t('AI 组合分析')}</h2>
          <div className="mt-1 text-xs text-muted-foreground">
            {t('结合持仓结构、当前盈亏与外部信息，给出短中期观察建议。')}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={runAnalysis} disabled={loading || stocks.length === 0}>
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            {result ? t('重新分析') : t('开始分析')}
          </Button>
        </div>
      </div>

      <Card className="border-border bg-card">
        <div className="p-5 space-y-4">
          {stocks.length === 0 && (
            <div className="text-sm text-muted-foreground">{t('当前没有持仓，先添加资产或交易后再进行组合分析。')}</div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {!result && !error && stocks.length > 0 && (
            <div className="rounded-lg border border-border/70 bg-muted/30 p-4 text-sm text-muted-foreground">
              {bootstrapping
                ? t('正在加载今天的组合分析结果...')
                : t('点击“开始分析”后，系统会结合你的持仓结构、实时行情、新闻和技术指标生成结构化投研摘要。')}
            </div>
          )}

          {result && (
            <>
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{t('AI 总结')}</div>
                    <PortfolioSnapshotAgeBadge generatedAt={result.generatedAt} now={now} />
                  </div>
                  <ConfidenceTag confidence={result.confidence} />
                </div>

                <div className="mt-3 text-base font-medium text-foreground leading-7">{result.summary}</div>

                {(result.stance || result.actionPlan[0] || topRisks[0]) && (
                  <div className="mt-4 rounded-lg border border-border/70 bg-background/60 p-3">
                    <div className="mb-2 text-xs font-medium text-muted-foreground">{t('重点标签')}</div>
                    <div className="flex flex-wrap gap-2">
                      {result.stance && (
                        <span className="rounded-full border border-primary/20 bg-background/70 px-2.5 py-1 text-xs text-foreground">
                          {t('当前判断：{value}', { value: result.stance })}
                        </span>
                      )}
                      {result.actionPlan[0] && (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-200">
                          {t('首要动作：{value}', { value: result.actionPlan[0] })}
                        </span>
                      )}
                      {topRisks[0] && (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-200">
                          {t('主要风险：{value}', { value: topRisks[0] })}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                <div className="mt-3 text-xs text-muted-foreground">
                  {t('生成于 {time} {cache}', { time: formatDateTime(result.generatedAt), cache: result.cached ? t('· 命中缓存') : '' })}
                </div>
              </div>

              <div className={`grid gap-3 ${compact ? 'md:grid-cols-2' : 'md:grid-cols-3'}`}>
                <InfoBlock title={t('事实依据')} items={result.facts.slice(0, compact ? 2 : 4)} />
                <InfoBlock title={t('核心判断')} items={result.inferences.slice(0, compact ? 2 : 4)} />
                <InfoBlock title={t('行动建议')} items={result.actionPlan.slice(0, compact ? 2 : 4)} />
                <InfoBlock title={t('概率分析')} items={result.probabilityAssessment.map(formatProbabilityScenario)} />
                <InfoBlock title={t('风险观察')} items={topRisks} emptyText={t('暂无额外风险提示')} />
                {!compact && <InfoBlock title={t('建议动作')} items={result.actionableObservations} emptyText={t('暂无动作建议')} />}
              </div>

              {!compact && <InfoBlock title={t('失效信号')} items={result.invalidationSignals} emptyText={t('暂无失效信号')} />}
              {!compact && result.evidence.length > 0 && <InfoBlock title={t('决策依据')} items={result.evidence} emptyText={t('暂无决策依据')} />}

              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-200">
                <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
                {result.disclaimer}
              </div>
            </>
          )}
        </div>
      </Card>
    </section>
  )
}

function InfoBlock({ title, items, emptyText = '暂无内容' }: { title: string; items: string[]; emptyText?: string }) {
  const { t } = useI18n()

  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{title}</div>
      <div className="mt-3 space-y-2">
        {items.length > 0 ? (
          items.map((item) => (
            <div key={item} className="text-sm text-foreground leading-6">{item}</div>
          ))
        ) : (
          <div className="text-sm text-muted-foreground">{t(emptyText)}</div>
        )}
      </div>
    </div>
  )
}

function PortfolioSnapshotAgeBadge({ generatedAt, now }: { generatedAt: string; now: number }) {
  const { t } = useI18n()
  const generatedTime = new Date(generatedAt).getTime()
  if (!Number.isFinite(generatedTime)) return null

  const ageMs = Math.max(0, now - generatedTime)
  const { label, stale } = formatSnapshotAge(ageMs, t)
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium normal-case tracking-normal ${
      stale
        ? 'border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-200'
        : 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
    }`}>
      <Clock className="mr-1 h-3.5 w-3.5" />
      {label}
    </span>
  )
}

function ConfidenceTag({ confidence }: { confidence: AiAnalysisResult['confidence'] }) {
  const { t } = useI18n()
  const className = confidence === 'high'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
    : confidence === 'low'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200'
      : 'border-primary/25 bg-primary/10 text-primary'

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>
      {t('信心：{value}', { value: t(formatConfidence(confidence)) })}
    </span>
  )
}

function formatSnapshotAge(ageMs: number, t: (key: string, params?: Record<string, string | number>) => string) {
  const hourMs = 60 * 60 * 1000
  const dayMs = 24 * hourMs
  if (ageMs < hourMs) return { label: t('有效期内'), stale: false }

  const hourCount = Math.floor(ageMs / hourMs)
  if (ageMs < dayMs) return { label: t('{count} 小时前 · 非实时', { count: hourCount }), stale: true }

  const dayCount = Math.floor(ageMs / dayMs)
  if (dayCount < 30) return { label: t('{count} 天前 · 非实时', { count: dayCount }), stale: true }

  const monthCount = Math.floor(dayCount / 30)
  if (monthCount < 12) return { label: t('{count} 个月前 · 非实时', { count: monthCount }), stale: true }

  return { label: t('{count} 年前 · 非实时', { count: Math.floor(dayCount / 365) }), stale: true }
}

function formatConfidence(confidence: AiAnalysisResult['confidence']) {
  if (confidence === 'high') return '较高'
  if (confidence === 'low') return '偏低'
  return '中等'
}
