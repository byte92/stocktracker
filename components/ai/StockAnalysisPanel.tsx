'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Clock, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { describeClientRequestError, readJsonResponse } from '@/lib/api/client'
import { nextApiUrls } from '@/lib/api/endpoints'
import { formatProbabilityScenario } from '@/lib/ai/display'
import { useI18n } from '@/lib/i18n'
import { useStockStore } from '@/store/useStockStore'
import type { AiAnalysisResult, Stock } from '@/types'

const AI_ANALYSIS_UNAVAILABLE_MESSAGE = '服务暂时不可用，请稍后重试或点击重新分析。'

export default function StockAnalysisPanel({ stock }: { stock: Stock }) {
  const { config, userId } = useStockStore()
  const { t, formatDateTime } = useI18n()
  const [result, setResult] = useState<AiAnalysisResult | null>(null)
  const [restoredFromHistory, setRestoredFromHistory] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [loading, setLoading] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!result) return

    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 60 * 1000)
    return () => window.clearInterval(timer)
  }, [result])

  useEffect(() => {
    if (!userId || !stock.id) return

    const currentUserId = userId
    const controller = new AbortController()
    async function loadLatestAnalysis() {
      setHistoryLoading(true)
      setError(null)
      setResult(null)
      setRestoredFromHistory(false)
      try {
        const params = new URLSearchParams({
          userId: currentUserId,
          type: 'stock',
          stockId: stock.id,
          limit: '1',
        })
        const res = await fetch(nextApiUrls.ai.history(params), { signal: controller.signal })
        const data = await readJsonResponse<{ records?: Array<{ result?: AiAnalysisResult }> }>(res, {
          fallbackMessage: t('读取标的 AI 历史失败'),
          unavailableMessage: t(AI_ANALYSIS_UNAVAILABLE_MESSAGE),
        })
        const latest = data.records?.[0]
        if (latest?.result) {
          setResult(latest.result)
          setRestoredFromHistory(true)
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        console.error('Load stock AI analysis history failed:', err)
        setError(describeClientRequestError(err, t('读取标的 AI 历史失败'), t(AI_ANALYSIS_UNAVAILABLE_MESSAGE)))
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false)
      }
    }

    loadLatestAnalysis()
    return () => controller.abort()
  }, [stock.id, userId])

  const runAnalysis = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(nextApiUrls.ai.stockAnalysis(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          stock,
          aiConfig: config.aiConfig,
          forceRefresh: true,
        }),
      })
      const data = await readJsonResponse<{ result: AiAnalysisResult }>(res, {
        fallbackMessage: t('标的 AI 分析失败'),
        unavailableMessage: t(AI_ANALYSIS_UNAVAILABLE_MESSAGE),
      })
      setResult(data.result as AiAnalysisResult)
      setRestoredFromHistory(false)
    } catch (err) {
      console.error('Run stock AI analysis failed:', err)
      setError(describeClientRequestError(err, t('标的 AI 分析失败'), t(AI_ANALYSIS_UNAVAILABLE_MESSAGE)))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-foreground">{t('AI 深度分析')}</div>
            <div className="mt-1 text-xs text-muted-foreground">{t('结合持仓、技术指标、估值和新闻驱动给出短中期观察建议。')}</div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={runAnalysis} disabled={loading} aria-busy={loading}>
              {loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
              {loading ? t('分析中...') : result ? t('重新分析') : t('开始分析')}
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!result && !error && (
          <div className="rounded-lg border border-border/70 bg-muted/30 p-4 text-sm text-muted-foreground">
            {historyLoading ? t('正在读取最近一次标的 AI 分析...') : t('点击“开始分析”后，系统会结合最新行情、估值、K 线技术指标和相关新闻生成结构化报告。')}
          </div>
        )}

        {result && (
          <>
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{t('AI 结论')}</div>
                <SnapshotAgeBadge generatedAt={result.generatedAt} now={now} />
              </div>
              <div className="mt-2 text-base font-medium text-foreground leading-7">{result.summary}</div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{t('分析时间：{time}', { time: formatDateTime(result.generatedAt) })}</span>
                {result.cached && <span>{t('命中缓存')}</span>}
                {restoredFromHistory && <span>{t('刷新后自动恢复最近一次结果')}</span>}
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <Block title={t('行动建议')} items={result.actionPlan} />
              <Block title={t('持仓建议')} items={result.positionAdvice ?? []} />
              <Block title={t('事实依据')} items={result.facts} />
              <Block title={t('核心判断')} items={result.inferences} />
              <Block title={t('失效信号')} items={result.invalidationSignals} />
              <Block title={t('概率分析')} items={result.probabilityAssessment.map(formatProbabilityScenario)} />
              <Block title={t('技术信号')} items={result.technicalSignals.map((item) => `${item.name}：${item.value}，${item.interpretation}`)} />
              <Block title={t('关键价位')} items={result.keyLevels} />
              <Block title={t('新闻驱动')} items={result.newsDrivers.map((item) => `${item.headline}（${item.source}）：${item.impact}`)} />
              <Block title={t('风险提示')} items={result.risks} />
            </div>

            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-200">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
              {result.disclaimer}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function SnapshotAgeBadge({ generatedAt, now }: { generatedAt: string; now: number }) {
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

function Block({ title, items }: { title: string; items: string[] }) {
  const { t } = useI18n()

  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{title}</div>
      <div className="mt-3 space-y-2">
        {items.length > 0 ? (
          items.map((item) => <div key={item} className="text-sm text-foreground leading-6">{item}</div>)
        ) : (
          <div className="text-sm text-muted-foreground">{t('暂无内容')}</div>
        )}
      </div>
    </div>
  )
}
