'use client'

import { useEffect, useMemo, useState } from 'react'
import { Clock, Filter, RefreshCw, Search, Trash2, TrendingUp } from 'lucide-react'
import ConfirmDialog from '@/components/ConfirmDialog'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { Select } from '@/components/ui/select'
import { describeClientRequestError, readJsonResponse } from '@/lib/api/client'
import { nextApiUrls } from '@/lib/api/endpoints'
import { useI18n } from '@/lib/i18n'
import { useStockStore } from '@/store/useStockStore'
import type { AiAnalysisHistoryRecord, AiConfidence } from '@/types'

const CONFIDENCE_LABELS: Record<AiConfidence, string> = {
  high: '高信心',
  medium: '中等信心',
  low: '低信心',
}

type HistoryView = 'recent' | 'stocks' | 'review'
type FreshnessFilter = 'ALL' | 'fresh' | 'stale'
type AnalysisTypeFilter = 'ALL' | 'stock' | 'portfolio' | 'market'
type ActionFilter = 'ALL' | '买入' | '加仓' | '继续持有' | '减仓' | '卖出' | '观望' | '回避'

const ACTION_OPTIONS: ActionFilter[] = ['ALL', '买入', '加仓', '继续持有', '减仓', '卖出', '观望', '回避']
const HISTORY_UNAVAILABLE_MESSAGE = 'AI 分析历史服务暂时不可用，请稍后重试。'

export default function AiHistoryView() {
  const { userId } = useStockStore()
  const { t, formatDateTime } = useI18n()
  const [records, setRecords] = useState<AiAnalysisHistoryRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<HistoryView>('recent')
  const [typeFilter, setTypeFilter] = useState<AnalysisTypeFilter>('ALL')
  const [confidenceFilter, setConfidenceFilter] = useState<'ALL' | AiConfidence>('ALL')
  const [freshnessFilter, setFreshnessFilter] = useState<FreshnessFilter>('ALL')
  const [actionFilter, setActionFilter] = useState<ActionFilter>('ALL')
  const [stockQuery, setStockQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AiAnalysisHistoryRecord | null>(null)

  useEffect(() => {
    if (!userId) return
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ userId })
        if (confidenceFilter !== 'ALL') params.set('confidence', confidenceFilter)
        if (dateFrom) params.set('dateFrom', dateFrom)
        if (dateTo) params.set('dateTo', dateTo)
        const res = await fetch(nextApiUrls.ai.history(params), { cache: 'no-store' })
        const data = await readJsonResponse<{ records?: AiAnalysisHistoryRecord[] }>(res, {
          fallbackMessage: t('获取历史失败'),
          unavailableMessage: t(HISTORY_UNAVAILABLE_MESSAGE),
        })
        setRecords(data.records ?? [])
      } catch (err) {
        console.error('Load AI analysis history failed:', err)
        setError(describeClientRequestError(err, t('获取历史失败'), t(HISTORY_UNAVAILABLE_MESSAGE)))
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [confidenceFilter, dateFrom, dateTo, userId])

  const filteredRecords = useMemo(() => {
    const normalizedQuery = stockQuery.trim().toLowerCase()
    return records.filter((record) => {
      if (activeView === 'stocks' && record.type !== 'stock') return false
      if (activeView === 'review' && record.type !== 'portfolio' && record.type !== 'market') return false
      if (typeFilter !== 'ALL' && record.type !== typeFilter) return false

      if (freshnessFilter !== 'ALL') {
        const fresh = isFresh(record.generatedAt)
        if (freshnessFilter === 'fresh' && !fresh) return false
        if (freshnessFilter === 'stale' && fresh) return false
      }

      if (actionFilter !== 'ALL' && getPrimaryAction(record) !== actionFilter) return false

      if (normalizedQuery) {
        const haystack = `${record.stockName ?? ''} ${record.stockCode ?? ''} ${record.result.summary} ${record.result.stance}`.toLowerCase()
        return haystack.includes(normalizedQuery)
      }

      return true
    })
  }, [activeView, actionFilter, freshnessFilter, records, stockQuery, typeFilter])

  const overviewStats = useMemo(() => {
    const freshRecords = records.filter((record) => isFresh(record.generatedAt))
    const stockCodes = new Set(records.filter((record) => record.type === 'stock' && record.stockCode).map((record) => record.stockCode))
    const latest = records[0] ?? null

    return {
      latestGeneratedAt: latest?.generatedAt ?? null,
      fresh: freshRecords.length,
      stale: Math.max(0, records.length - freshRecords.length),
      stockCoverage: stockCodes.size,
    }
  }, [records])

  const stockDossiers = useMemo(() => {
    const grouped = new Map<string, AiAnalysisHistoryRecord[]>()
    for (const record of filteredRecords) {
      if (record.type !== 'stock') continue
      const key = record.stockCode || record.stockId || record.id
      const bucket = grouped.get(key) ?? []
      bucket.push(record)
      grouped.set(key, bucket)
    }

    return Array.from(grouped.values())
      .map((items) => {
        const sorted = [...items].sort(sortByGeneratedAtDesc)
        return {
          latest: sorted[0],
          previous: sorted[1] ?? null,
          count: sorted.length,
        }
      })
      .filter((item) => !!item.latest)
      .sort((a, b) => sortByGeneratedAtDesc(a.latest, b.latest))
  }, [filteredRecords])

  const visibleRecords = useMemo(() => {
    if (activeView === 'stocks') return []
    return [...filteredRecords].sort(sortByGeneratedAtDesc)
  }, [activeView, filteredRecords])

  const resetFilters = () => {
    setTypeFilter('ALL')
    setConfidenceFilter('ALL')
    setFreshnessFilter('ALL')
    setActionFilter('ALL')
    setStockQuery('')
    setDateFrom('')
    setDateTo('')
    setExpandedId(null)
  }

  const handleDeleteRecord = async () => {
    if (!deleteTarget || !userId) return
    try {
      const res = await fetch(nextApiUrls.ai.history(), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, id: deleteTarget.id }),
      })
      await readJsonResponse<{ ok: true }>(res, {
        fallbackMessage: t('删除分析记录失败'),
        unavailableMessage: t(HISTORY_UNAVAILABLE_MESSAGE),
      })
      setRecords((current) => current.filter((record) => record.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (err) {
      console.error('Delete AI analysis history failed:', err)
      setError(describeClientRequestError(err, t('删除分析记录失败'), t(HISTORY_UNAVAILABLE_MESSAGE)))
    }
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('最近分析')}
          value={overviewStats.latestGeneratedAt ? formatRelativeTime(overviewStats.latestGeneratedAt, t) : t('暂无')}
          detail={overviewStats.latestGeneratedAt ? formatDateTime(overviewStats.latestGeneratedAt) : t('尚未生成报告')}
        />
        <StatCard label={t('有效期内')} value={`${overviewStats.fresh}`} detail={t('1 小时内生成的报告')} />
        <StatCard label={t('待刷新')} value={`${overviewStats.stale}`} detail={t('超过 1 小时的历史快照')} />
        <StatCard label={t('覆盖标的')} value={`${overviewStats.stockCoverage}`} detail={t('有过标的分析的资产')} />
      </section>

      <Card className="border-border bg-card">
        <div className="p-4">
          <div className="grid gap-2 md:grid-cols-3">
            <ViewTab
              active={activeView === 'recent'}
              title={t('最近报告')}
              detail={t('按时间查看所有分析结论')}
              count={records.length}
              onClick={() => {
                setActiveView('recent')
                setTypeFilter('ALL')
              }}
            />
            <ViewTab
              active={activeView === 'stocks'}
              title={t('标的档案')}
              detail={t('按资产查看结论变化')}
              count={stockDossiers.length}
              onClick={() => {
                setActiveView('stocks')
                setTypeFilter('stock')
              }}
            />
            <ViewTab
              active={activeView === 'review'}
              title={t('组合复盘')}
              detail={t('回看组合和大盘判断')}
              count={records.filter((record) => record.type === 'portfolio' || record.type === 'market').length}
              onClick={() => {
                setActiveView('review')
                setTypeFilter('ALL')
              }}
            />
          </div>
        </div>
      </Card>

      <Card className="border-border bg-card">
        <div className="space-y-4 p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" />
              <div>
                <div className="text-sm font-medium text-foreground">{t('筛选报告')}</div>
                <div className="mt-1 text-xs text-muted-foreground">{t('按对象、状态、动作和时间快速缩小历史范围。')}</div>
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={resetFilters}>
              {t('重置筛选')}
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="relative xl:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={stockQuery}
                onChange={(e) => setStockQuery(e.target.value)}
                placeholder={t('搜索标的、代码或结论关键词')}
                className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <Select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as AnalysisTypeFilter)}
              className="h-10 bg-background"
              disabled={activeView === 'stocks'}
            >
              <option value="ALL">{t('全部类型')}</option>
              <option value="stock">{t('标的')}</option>
              <option value="portfolio">{t('组合')}</option>
              <option value="market">{t('大盘')}</option>
            </Select>
            <Select
              value={freshnessFilter}
              onChange={(e) => setFreshnessFilter(e.target.value as FreshnessFilter)}
              className="h-10 bg-background"
            >
              <option value="ALL">{t('全部时效')}</option>
              <option value="fresh">{t('有效期内')}</option>
              <option value="stale">{t('待刷新')}</option>
            </Select>
            <Select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value as ActionFilter)}
              className="h-10 bg-background"
            >
              {ACTION_OPTIONS.map((action) => (
                <option key={action} value={action}>{action === 'ALL' ? t('全部动作') : t(action)}</option>
              ))}
            </Select>
            <Select
              value={confidenceFilter}
              onChange={(e) => setConfidenceFilter(e.target.value as typeof confidenceFilter)}
              className="h-10 bg-background"
            >
              <option value="ALL">{t('全部信心')}</option>
              <option value="high">{t('高信心')}</option>
              <option value="medium">{t('中等信心')}</option>
              <option value="low">{t('低信心')}</option>
            </Select>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <DatePicker value={dateFrom} onChange={setDateFrom} placeholder={t('开始日期')} allowClear />
            <DatePicker value={dateTo} onChange={setDateTo} placeholder={t('结束日期')} allowClear />
          </div>
        </div>
      </Card>

      <Card className="border-border bg-card">
        <div className="space-y-4 p-5">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-medium text-foreground">{t(getViewTitle(activeView))}</div>
              <div className="mt-1 text-xs text-muted-foreground">{t(getViewDescription(activeView))}</div>
            </div>
            <div className="text-xs text-muted-foreground">
              {loading ? t('加载中...') : activeView === 'stocks' ? t('{count} 个标的', { count: stockDossiers.length }) : t('共 {count} 条', { count: visibleRecords.length })}
            </div>
          </div>

          {error && <div className="text-sm text-destructive">{error}</div>}

          {!error && activeView === 'stocks' && stockDossiers.length === 0 && (
            <EmptyState text={t('当前筛选条件下暂无标的档案。')} />
          )}

          {!error && activeView !== 'stocks' && visibleRecords.length === 0 && (
            <EmptyState text={t('当前筛选条件下暂无分析报告。')} />
          )}

          {activeView === 'stocks' ? (
            <div className="grid gap-3 xl:grid-cols-2">
              {stockDossiers.map((item) => (
                <StockDossierCard
                  key={item.latest.stockCode ?? item.latest.id}
                  latest={item.latest}
                  previous={item.previous}
                  count={item.count}
                  expanded={expandedId === item.latest.id}
                  onToggle={() => setExpandedId((current) => current === item.latest.id ? null : item.latest.id)}
                  onDelete={() => setDeleteTarget(item.latest)}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {visibleRecords.map((record) => (
                <ReportSummaryCard
                  key={record.id}
                  record={record}
                  expanded={expandedId === record.id}
                  onToggle={() => setExpandedId((current) => current === record.id ? null : record.id)}
                  onDelete={() => setDeleteTarget(record)}
                />
              ))}
            </div>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('确认删除分析记录')}
        description={deleteTarget ? t('确定删除 {title} 吗？删除后无法恢复。', { title: getRecordTitle(deleteTarget) }) : undefined}
        confirmText={t('删除')}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        onConfirm={handleDeleteRecord}
      />
    </div>
  )
}

function ViewTab({
  active,
  title,
  detail,
  count,
  onClick,
}: {
  active: boolean
  title: string
  detail: string
  count: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-4 py-3 text-left transition-colors ${
        active
          ? 'border-primary/40 bg-primary/10'
          : 'border-border/70 bg-muted/20 hover:border-primary/30 hover:bg-card'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <span className="rounded-full border border-border/70 bg-card px-2 py-0.5 text-xs text-muted-foreground">{count}</span>
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </button>
  )
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-3 text-xl font-semibold leading-7 text-foreground line-clamp-2">{value}</div>
      <div className="mt-2 text-xs text-muted-foreground">{detail}</div>
    </div>
  )
}

function ReportSummaryCard({
  record,
  expanded,
  onToggle,
  onDelete,
}: {
  record: AiAnalysisHistoryRecord
  expanded: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  const { t, formatDateTime } = useI18n()
  const reasons = getReasons(record)
  const actions = getActions(record)
  const risks = getRisks(record)
  const primaryAction = getPrimaryAction(record)

  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{getRecordTitle(record)}</span>
            <FreshnessTag generatedAt={record.generatedAt} />
            <StaticTag>{t(CONFIDENCE_LABELS[record.confidence])}</StaticTag>
            <ActionTag action={t(primaryAction)} />
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {formatDateTime(record.generatedAt)} · {record.result.stance}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onToggle}>
            {expanded ? t('收起') : t('展开详情')}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-3 text-sm leading-6 text-foreground">{record.result.summary}</div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <SmallBlock title={t('关键理由')} items={reasons.slice(0, 2)} />
        <SmallBlock title={t('操作计划')} items={actions.slice(0, 2)} />
        <SmallBlock title={t('风险提醒')} items={risks.slice(0, 1)} />
      </div>

      {expanded && (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <SmallBlock title={t('失效条件')} items={record.result.invalidationSignals.slice(0, 3)} />
          <SmallBlock title={t('关键价位/指标')} items={record.result.keyLevels.concat(record.result.technicalSignals.map((signal) => `${signal.name}: ${signal.value}，${signal.interpretation}`)).slice(0, 4)} />
        </div>
      )}
    </div>
  )
}

function StockDossierCard({
  latest,
  previous,
  count,
  expanded,
  onToggle,
  onDelete,
}: {
  latest: AiAnalysisHistoryRecord
  previous: AiAnalysisHistoryRecord | null
  count: number
  expanded: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  const { t, formatDateTime } = useI18n()
  const latestAction = getPrimaryAction(latest)
  const previousAction = previous ? getPrimaryAction(previous) : t('暂无')
  const changed = previous ? latestAction !== previousAction : false

  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {latest.stockName ?? t('标的')} · {latest.stockCode ?? ''}
            </span>
            <FreshnessTag generatedAt={latest.generatedAt} />
            <StaticTag>{t(CONFIDENCE_LABELS[latest.confidence])}</StaticTag>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {t('共 {count} 次分析 · 最近 {time}', { count, time: formatDateTime(latest.generatedAt) })}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onToggle}>
            {expanded ? t('收起') : t('展开详情')}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <ConclusionBox label={t('当前结论')} value={t(latestAction)} detail={latest.result.stance} />
        <ConclusionBox
          label={t('上次结论')}
          value={t(previousAction)}
          detail={previous ? (changed ? `${t(previousAction)} -> ${t(latestAction)}` : t('结论未变化')) : t('暂无可比记录')}
          highlight={changed}
        />
      </div>

      <div className="mt-3 text-sm leading-6 text-foreground">{latest.result.summary}</div>

      {expanded && (
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <SmallBlock title={t('关键理由')} items={getReasons(latest).slice(0, 2)} />
          <SmallBlock title={t('操作计划')} items={getActions(latest).slice(0, 2)} />
          <SmallBlock title={t('风险提醒')} items={getRisks(latest).slice(0, 2)} />
        </div>
      )}
    </div>
  )
}

function ConclusionBox({
  label,
  value,
  detail,
  highlight = false,
}: {
  label: string
  value: string
  detail: string
  highlight?: boolean
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-card/60 p-3">
      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-2 text-sm font-medium text-foreground">{value}</div>
      <div className={`mt-1 text-xs ${highlight ? 'text-amber-700 dark:text-amber-200' : 'text-muted-foreground'}`}>{detail}</div>
    </div>
  )
}

function FreshnessTag({ generatedAt }: { generatedAt: string }) {
  const { t } = useI18n()
  const fresh = isFresh(generatedAt)
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${
      fresh
        ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
        : 'border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-200'
    }`}>
      {fresh ? <Clock className="mr-1 h-3.5 w-3.5" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
      {fresh ? t('有效期内') : `${formatRelativeTime(generatedAt, t)} · ${t('待刷新')}`}
    </span>
  )
}

function ActionTag({ action }: { action: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs text-primary">
      <TrendingUp className="mr-1 h-3.5 w-3.5" />
      {action}
    </span>
  )
}

function StaticTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border/70 bg-card px-2.5 py-1 text-xs text-muted-foreground">
      {children}
    </span>
  )
}

function SmallBlock({ title, items }: { title: string; items: string[] }) {
  const { t } = useI18n()

  return (
    <div className="rounded-lg border border-border/70 bg-card/60 p-3">
      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{title}</div>
      <div className="mt-2 space-y-1.5">
        {items.length > 0 ? (
          items.map((item) => (
            <div key={item} className="text-sm leading-5 text-foreground">
              {item}
            </div>
          ))
        ) : (
          <div className="text-sm text-muted-foreground">{t('暂无内容')}</div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
      {text}
    </div>
  )
}

function getViewTitle(view: HistoryView) {
  if (view === 'stocks') return '标的档案'
  if (view === 'review') return '组合复盘'
  return '最近报告'
}

function getViewDescription(view: HistoryView) {
  if (view === 'stocks') return '按资产聚合最近分析，重点看当前结论、上次结论和判断变化。'
  if (view === 'review') return '集中回看组合与大盘分析，关注仓位建议、风险暴露和市场节奏。'
  return '按时间倒序查看 AI 历史报告，重点看动作结论、关键理由和风险提醒。'
}

function getRecordTitle(record: AiAnalysisHistoryRecord) {
  if (record.type === 'portfolio') return '组合分析'
  if (record.type === 'market') return '大盘分析'
  return `${record.stockName ?? '标的'} · ${record.stockCode ?? ''}`
}

function getReasons(record: AiAnalysisHistoryRecord) {
  return record.result.facts.length > 0 ? record.result.facts : record.result.evidence
}

function getActions(record: AiAnalysisHistoryRecord) {
  if (record.result.actionPlan.length > 0) return record.result.actionPlan
  if (record.result.positionAdvice && record.result.positionAdvice.length > 0) return record.result.positionAdvice
  return record.result.actionableObservations
}

function getRisks(record: AiAnalysisHistoryRecord) {
  if (record.result.risks.length > 0) return record.result.risks
  return record.result.portfolioRiskNotes ?? []
}

function sortByGeneratedAtDesc(a: AiAnalysisHistoryRecord, b: AiAnalysisHistoryRecord) {
  return new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
}

function isFresh(generatedAt: string) {
  const time = new Date(generatedAt).getTime()
  if (!Number.isFinite(time)) return false
  return Date.now() - time < 60 * 60 * 1000
}

function formatRelativeTime(generatedAt: string, t: (key: string, params?: Record<string, string | number>) => string) {
  const time = new Date(generatedAt).getTime()
  if (!Number.isFinite(time)) return t('时间未知')
  const ageMs = Math.max(0, Date.now() - time)
  const minuteMs = 60 * 1000
  const hourMs = 60 * minuteMs
  const dayMs = 24 * hourMs

  if (ageMs < minuteMs) return t('刚刚')
  if (ageMs < hourMs) return t('{count} 分钟前', { count: Math.floor(ageMs / minuteMs) })
  if (ageMs < dayMs) return t('{count} 小时前', { count: Math.floor(ageMs / hourMs) })
  const dayCount = Math.floor(ageMs / dayMs)
  if (dayCount < 30) return t('{count} 天前', { count: dayCount })
  const monthCount = Math.floor(dayCount / 30)
  if (monthCount < 12) return t('{count} 个月前', { count: monthCount })
  return t('{count} 年前', { count: Math.floor(dayCount / 365) })
}

function getPrimaryAction(record: AiAnalysisHistoryRecord): Exclude<ActionFilter, 'ALL'> | string {
  const candidates = [
    record.result.actionPlan[0],
    record.result.positionAdvice?.[0],
    record.result.actionableObservations[0],
    record.result.summary,
    record.result.stance,
  ].filter(Boolean) as string[]

  const text = candidates.join(' ')
  const actionWords: Exclude<ActionFilter, 'ALL'>[] = ['买入', '加仓', '继续持有', '减仓', '卖出', '观望', '回避']
  const found = actionWords.find((word) => text.includes(word))
  if (found) return found
  if (text.includes('持有')) return '继续持有'
  return record.result.stance ?? '暂无结论'
}
