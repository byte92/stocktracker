'use client'

import { useEffect, useMemo, useState } from 'react'
import { BarChart3, Loader2, MessageCircleQuestion, Search, Send, Sparkles, Trash2 } from 'lucide-react'
import PageHeader from '@/components/layout/PageHeader'
import MarkdownMessage from '@/components/ai/MarkdownMessage'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { marketSupportsValuation } from '@/config/defaults'
import { describeClientRequestError, readJsonResponse } from '@/lib/api/client'
import { nextApiUrls } from '@/lib/api/endpoints'
import { useI18n } from '@/lib/i18n'
import { useStockStore } from '@/store/useStockStore'
import type { FinancialsData } from '@/lib/agent/skills/stock'
import type { AiAnalysisHistoryRecord, Market } from '@/types'

const MARKETS: Market[] = ['A', 'HK', 'US']

export default function FinancialAnalysisPage() {
  const { stocks, config, userId } = useStockStore()
  const { t, formatDateTime } = useI18n()
  const [activeTab, setActiveTab] = useState<'analyze' | 'history'>('analyze')
  const [mode, setMode] = useState<'holding' | 'external'>('holding')
  const [selectedStockId, setSelectedStockId] = useState(() => stocks[0]?.id ?? '')
  const [symbol, setSymbol] = useState('')
  const [market, setMarket] = useState<Market>('US')
  const [question, setQuestion] = useState('分析最新财报的亮点、风险和估值匹配度')
  const [files, setFiles] = useState<File[]>([])
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [result, setResult] = useState<FinancialsData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<AiAnalysisHistoryRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const financialStocks = useMemo(
    () => stocks.filter((stock) => marketSupportsValuation(stock.market, stock.code)),
    [stocks],
  )
  const selectedStock = useMemo(
    () => financialStocks.find((stock) => stock.id === selectedStockId) ?? financialStocks[0] ?? null,
    [selectedStockId, financialStocks],
  )
  const target = mode === 'holding'
    ? { symbol: selectedStock?.code ?? '', market: selectedStock?.market ?? 'A', name: selectedStock?.name ?? '' }
    : { symbol: symbol.trim(), market, name: '' }
  const analysis = result?.analysis ?? null

  const loadHistory = async () => {
    if (!userId) return
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const res = await fetch(nextApiUrls.ai.history({ userId, type: 'financial', limit: 50 }), { cache: 'no-store' })
      const data = await readJsonResponse<{ records?: AiAnalysisHistoryRecord[] }>(res, {
        fallbackMessage: t('加载财报分析历史失败'),
        unavailableMessage: t('AI 分析历史服务暂时不可用，请稍后重试。'),
      })
      setHistory(Array.isArray(data.records) ? data.records : [])
    } catch (err) {
      console.error('Load financial analysis history failed:', err)
      setHistoryError(describeClientRequestError(err, t('加载财报分析历史失败'), t('AI 分析历史服务暂时不可用，请稍后重试。')))
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'history') void loadHistory()
  }, [activeTab, userId])

  const runAnalysis = async () => {
    setLoading(true)
    setError(null)
    setUploadErrors([])
    setResult(null)
    try {
      const body = new FormData()
      body.set('userId', userId ?? '')
      body.set('stocks', JSON.stringify(stocks))
      body.set('aiConfig', JSON.stringify(config.aiConfig))
      body.set('symbol', target.symbol)
      body.set('market', target.market)
      body.set('researchQuery', `${target.name} ${target.symbol} ${question}`.trim())
      files.forEach((file) => body.append('files', file))

      const res = await fetch(nextApiUrls.ai.financialAnalysis(), {
        method: 'POST',
        body,
      })
      const data = await readJsonResponse<{ result: FinancialsData; uploadErrors?: string[] }>(res, {
        fallbackMessage: t('财报分析失败'),
        unavailableMessage: t('AI 服务暂时不可用，请稍后重试。'),
      })
      setResult(data.result)
      setUploadErrors(Array.isArray(data.uploadErrors) ? data.uploadErrors : [])
      void loadHistory()
    } catch (err) {
      console.error('Run financial analysis failed:', err)
      setError(describeClientRequestError(err, t('财报分析失败'), t('AI 服务暂时不可用，请稍后重试。')))
    } finally {
      setLoading(false)
    }
  }

  const targetSupported = Boolean(target.symbol && marketSupportsValuation(target.market, target.symbol))
  const disabled = loading || !userId || !target.symbol || !targetSupported || !config.aiConfig.enabled

  const deleteHistory = async (id: string) => {
    if (!userId) return
    setDeletingId(id)
    setHistoryError(null)
    try {
      const res = await fetch(nextApiUrls.ai.history(), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, id }),
      })
      await readJsonResponse<{ ok: true }>(res, {
        fallbackMessage: t('删除财报分析历史失败'),
        unavailableMessage: t('AI 分析历史服务暂时不可用，请稍后重试。'),
      })
      setHistory((items) => items.filter((item) => item.id !== id))
    } catch (err) {
      console.error('Delete financial analysis history failed:', err)
      setHistoryError(describeClientRequestError(err, t('删除财报分析历史失败'), t('AI 分析历史服务暂时不可用，请稍后重试。')))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="min-h-screen">
      <PageHeader
        title={t('财报分析')}
        description={t('使用 LangChain 子链整理公开财报资料，输出指标、亮点、风险、来源和缺失项。')}
      />

      <div className="px-4 py-6 lg:px-6 space-y-6">
        <div className="inline-grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/20 p-1">
          <button
            type="button"
            className={`rounded-md px-4 py-2 text-sm transition-colors ${activeTab === 'analyze' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setActiveTab('analyze')}
          >
            {t('开始分析')}
          </button>
          <button
            type="button"
            className={`rounded-md px-4 py-2 text-sm transition-colors ${activeTab === 'history' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setActiveTab('history')}
          >
            {t('历史记录')}
          </button>
        </div>

        {activeTab === 'analyze' ? (
          <section className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
            <Card className="border-border bg-card">
            <div className="space-y-4 p-5">
              <div>
                <div className="text-sm font-semibold text-foreground">{t('分析目标')}</div>
                <div className="mt-1 text-xs text-muted-foreground">{t('选择已有持仓，或输入未持仓标的代码。')}</div>
              </div>

              <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/20 p-1">
                <button
                  type="button"
                  className={`rounded-md px-3 py-2 text-sm transition-colors ${mode === 'holding' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setMode('holding')}
                >
                  {t('当前持仓')}
                </button>
                <button
                  type="button"
                  className={`rounded-md px-3 py-2 text-sm transition-colors ${mode === 'external' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setMode('external')}
                >
                  {t('外部标的')}
                </button>
              </div>

              {mode === 'holding' ? (
                <label className="block space-y-2">
                  <span className="text-xs font-medium text-muted-foreground">{t('持仓标的')}</span>
                  <select
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                    value={selectedStock?.id ?? ''}
                    onChange={(event) => setSelectedStockId(event.target.value)}
                  >
                    {financialStocks.length === 0 ? (
                      <option value="">{t('暂无可分析财报的股票持仓')}</option>
                    ) : financialStocks.map((stock) => (
                      <option key={stock.id} value={stock.id}>{stock.name} / {stock.code} / {stock.market}</option>
                    ))}
                  </select>
                  {stocks.length > 0 && financialStocks.length < stocks.length && (
                    <div className="text-xs text-muted-foreground">{t('已过滤基金、ETF、加密资产等没有公司财报的产品。')}</div>
                  )}
                </label>
              ) : (
                <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                  <label className="block space-y-2">
                    <span className="text-xs font-medium text-muted-foreground">{t('代码')}</span>
                    <input
                      className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                      value={symbol}
                      placeholder="AAPL / 00700 / 600519"
                      onChange={(event) => setSymbol(event.target.value)}
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-xs font-medium text-muted-foreground">{t('市场')}</span>
                    <select
                      className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
                      value={market}
                      onChange={(event) => setMarket(event.target.value as Market)}
                    >
                      {MARKETS.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </label>
                </div>
              )}

              <label className="block space-y-2">
                <span className="text-xs font-medium text-muted-foreground">{t('分析问题')}</span>
                <textarea
                  className="min-h-24 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                />
              </label>

              <label className="block space-y-2">
                <span className="text-xs font-medium text-muted-foreground">{t('上传财报文件')}</span>
                <input
                  className="block w-full cursor-pointer rounded-lg border border-border bg-background text-sm text-muted-foreground file:mr-3 file:h-10 file:border-0 file:bg-secondary file:px-3 file:text-sm file:text-foreground"
                  type="file"
                  multiple
                  accept=".pdf,.txt,.md,.csv,.json,.html,.htm,application/pdf,text/plain,text/markdown,text/csv,application/json,text/html"
                  onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, 3))}
                />
                <div className="text-xs text-muted-foreground">{t('支持 PDF、TXT、Markdown、HTML、CSV、JSON，最多 3 个文件，每个不超过 12MB。上传后会优先使用文件内容分析。')}</div>
                {files.length > 0 && (
                  <div className="space-y-1 text-xs text-muted-foreground">
                    {files.map((file) => <div key={`${file.name}-${file.size}`}>{file.name}</div>)}
                  </div>
                )}
              </label>

              {!config.aiConfig.enabled && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {t('AI 功能尚未启用，请先到设置中配置模型。')}
                </div>
              )}

              {target.symbol && !targetSupported && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                  {t('基金、ETF、加密资产等产品本身没有公司财报，不能进行财报分析。')}
                </div>
              )}

              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              {uploadErrors.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                  {uploadErrors.map((item) => <div key={item}>{item}</div>)}
                </div>
              )}

              <Button className="w-full" onClick={runAnalysis} disabled={disabled} aria-busy={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                {loading ? t('分析中...') : t('开始财报分析')}
              </Button>
            </div>
            </Card>

            <section className="space-y-4">
              {!analysis ? (
                <Card className="border-border bg-card">
                  <div className="flex min-h-[360px] flex-col items-center justify-center p-8 text-center">
                    <BarChart3 className="h-10 w-10 text-primary" />
                    <div className="mt-4 text-sm font-semibold text-foreground">{t('等待财报分析')}</div>
                    <div className="mt-2 max-w-md text-sm text-muted-foreground">
                      {t('运行后会展示核心指标、财报亮点、风险、估值解释、来源和缺失数据。')}
                    </div>
                  </div>
                </Card>
              ) : (
                <FinancialAnalysisResult result={result!} />
              )}
            </section>
          </section>
        ) : (
          <FinancialAnalysisHistory
            records={history}
            loading={historyLoading}
            error={historyError}
            deletingId={deletingId}
            formatDateTime={formatDateTime}
            onRefresh={loadHistory}
            onDelete={deleteHistory}
            onOpen={(item) => {
              const financialResult = item.result as unknown as FinancialsData
              setResult(financialResult)
              setActiveTab('analyze')
            }}
          />
        )}
      </div>
    </div>
  )
}

function FinancialAnalysisHistory({
  records,
  loading,
  error,
  deletingId,
  formatDateTime,
  onRefresh,
  onDelete,
  onOpen,
}: {
  records: AiAnalysisHistoryRecord[]
  loading: boolean
  error: string | null
  deletingId: string | null
  formatDateTime: (value: string) => string
  onRefresh: () => void
  onDelete: (id: string) => void
  onOpen: (item: AiAnalysisHistoryRecord) => void
}) {
  const { t } = useI18n()

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('财报分析历史')}</h2>
          <div className="mt-1 text-xs text-muted-foreground">{t('保存每次财报分析结果，不保存上传文件原文。')}</div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t('刷新')}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      {loading && !records.length ? (
        <Card className="border-border bg-card">
          <div className="p-5 text-sm text-muted-foreground">{t('正在加载财报分析历史...')}</div>
        </Card>
      ) : records.length === 0 ? (
        <Card className="border-border bg-card">
          <div className="p-5 text-sm text-muted-foreground">{t('暂无财报分析历史。')}</div>
        </Card>
      ) : (
        <div className="space-y-3">
          {records.map((record) => {
            const result = record.result as unknown as FinancialsData
            const analysis = result.analysis
            return (
              <Card key={record.id} className="border-border bg-card">
                <div className="flex flex-col gap-4 p-5 md:flex-row md:items-start md:justify-between">
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(record)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-foreground">
                        {record.stockName || analysis?.companyName || record.stockCode || '--'} / {record.stockCode || result.symbol || '--'} / {record.market || result.market || '--'}
                      </div>
                      {result.chain?.degraded && <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">{t('已降级')}</span>}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatDateTime(record.generatedAt)} · {t('置信度')}：{record.confidence}
                    </div>
                    <div className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                      {analysis?.trendSummary || t('暂无摘要')}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {record.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{tag}</span>
                      ))}
                    </div>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 rounded-lg border border-border/70 text-muted-foreground hover:text-destructive"
                    onClick={() => onDelete(record.id)}
                    disabled={deletingId === record.id}
                    title={t('删除')}
                  >
                    {deletingId === record.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </section>
  )
}

function FinancialAnalysisResult({ result }: { result: FinancialsData }) {
  const { t } = useI18n()
  const analysis = result.analysis
  const metrics: Array<{ label: string; value: string | null | number | undefined; kind?: 'money' }> = [
    { label: '营收', value: analysis.metrics.revenue, kind: 'money' },
    { label: '营收增速', value: formatPercent(analysis.metrics.revenueGrowth) },
    { label: '净利润', value: analysis.metrics.netProfit, kind: 'money' },
    { label: '净利润增速', value: formatPercent(analysis.metrics.netProfitGrowth) },
    { label: 'EPS', value: analysis.metrics.eps },
    { label: 'PE(TTM)', value: analysis.metrics.peTtm },
    { label: 'PB', value: analysis.metrics.pb },
  ]

  return (
    <div className="space-y-4">
      <Card className="border-border bg-card">
        <div className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">
                {analysis.companyName || result.symbol} / {result.symbol} / {result.market}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t('报告期')}：{analysis.reportPeriod || '--'} · {t('置信度')}：{analysis.confidence}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className={`rounded-full px-2.5 py-1 text-xs ${result.chain.degraded ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-primary/10 text-primary'}`}>
                {result.chain.degraded ? t('已降级') : result.chain.provider}
              </div>
              {result.chain.retrieval?.used && (
                <div className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-700 dark:text-emerald-300">
                  <Sparkles className="h-3 w-3" />
                  {t('语义检索')}
                </div>
              )}
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-foreground">{analysis.trendSummary}</p>
          {result.chain.retrieval?.used && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-700 dark:text-emerald-300">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {t('本次分析由 RAG 语义检索驱动：从财报中切分 {chunks} 块，命中 {matched} 篇最相关内容参与分析，而非简单截断全文。', {
                  chunks: result.chain.retrieval.chunkCount ?? 0,
                  matched: result.chain.retrieval.matchedDocCount ?? 0,
                })}
              </span>
            </div>
          )}
          {result.chain.degraded && result.chain.error && (
            <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
              {t('财报分析链已降级')}：{result.chain.error}
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {metrics.map((item) => (
          <div key={item.label} className="rounded-lg border border-border bg-card p-4">
            <div className="text-xs text-muted-foreground">{t(item.label)}</div>
            <div className="mt-2 text-sm font-semibold text-foreground">{formatMetricValue(item.value, item.kind)}</div>
          </div>
        ))}
      </div>

      <ResultList title={t('财报亮点')} items={analysis.highlights} emptyText={t('暂无可确认亮点。')} />
      <ResultList title={t('主要风险')} items={analysis.risks} emptyText={t('暂无可确认风险。')} />
      <ResultList title={t('估值观察')} items={analysis.valuationNotes} emptyText={t('暂无估值观察。')} />
      <ResultList title={t('持仓影响')} items={analysis.portfolioImplications ?? []} emptyText={t('该标的不在当前持仓中，暂无持仓影响。')} />
      <ResultList title={t('缺失数据')} items={analysis.missingData} emptyText={t('暂无缺失数据提示。')} />

      <Card className="border-border bg-card">
        <div className="p-5">
          <div className="text-sm font-semibold text-foreground">{t('来源')}</div>
          <div className="mt-3 space-y-2">
            {analysis.sources.length ? analysis.sources.map((source) => (
              <div key={`${source.title}-${source.url ?? ''}`} className="text-sm">
                {source.url ? (
                  <a className="text-primary hover:underline" href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                ) : (
                  <span className="text-foreground">{source.title}</span>
                )}
                <span className="ml-2 text-xs text-muted-foreground">{[source.publisher, source.date].filter(Boolean).join(' · ')}</span>
              </div>
            )) : (
              <div className="text-sm text-muted-foreground">{t('暂无来源。')}</div>
            )}
          </div>
        </div>
      </Card>

      <FinancialQaPanel symbol={result.symbol} market={result.market} />
    </div>
  )
}

type FinancialQaItem = {
  question: string
  answer: string
  sources: Array<{ title: string | null; publisher: string | null }>
  matched: number
}

const QA_SUGGESTIONS = [
  '毛利率和净利率的变化趋势如何？',
  '主要的经营风险有哪些？',
  '现金流和应收账款是否健康？',
  '收入增长的主要驱动因素是什么？',
]

function FinancialQaPanel({ symbol, market }: { symbol: string; market: Market }) {
  const { t } = useI18n()
  const { userId, config } = useStockStore()
  const [draft, setDraft] = useState('')
  const [items, setItems] = useState<FinancialQaItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 切换标的时清空上一只股票的问答记录
  useEffect(() => {
    setItems([])
    setError(null)
  }, [symbol, market])

  const ask = async (questionText: string) => {
    const question = questionText.trim()
    if (!question || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(nextApiUrls.ai.financialQa(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, symbol, market, question, aiConfig: config.aiConfig }),
      })
      const data = await readJsonResponse<{ result: { answer: string; sources: FinancialQaItem['sources']; matched: number } }>(res, {
        fallbackMessage: t('财报问答失败'),
        unavailableMessage: t('AI 服务暂时不可用，请稍后重试。'),
      })
      setItems((prev) => [
        { question, answer: data.result.answer, sources: data.result.sources ?? [], matched: data.result.matched ?? 0 },
        ...prev,
      ])
      setDraft('')
    } catch (err) {
      console.error('Financial QA failed:', err)
      setError(describeClientRequestError(err, t('财报问答失败'), t('AI 服务暂时不可用，请稍后重试。')))
    } finally {
      setLoading(false)
    }
  }

  const disabled = loading || !userId || !config.aiConfig.enabled || !symbol

  return (
    <Card className="border-border bg-card">
      <div className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <MessageCircleQuestion className="h-4 w-4 text-primary" />
          <div className="text-sm font-semibold text-foreground">{t('针对这份财报追问')}</div>
        </div>
        <div className="text-xs text-muted-foreground">
          {t('基于已索引的财报内容做 RAG 检索增强问答，回答只依据财报片段、不编造。若刚完成分析，索引可能需要几秒，可稍候重试。')}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <textarea
            className="min-h-[44px] flex-1 resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
            value={draft}
            placeholder={t('例如：毛利率的变化趋势如何？（⌘/Ctrl + Enter 发送）')}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void ask(draft)
              }
            }}
          />
          <Button className="sm:self-end" onClick={() => void ask(draft)} disabled={disabled || !draft.trim()} aria-busy={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {t('追问')}
          </Button>
        </div>

        {items.length === 0 && (
          <div className="flex flex-wrap gap-2">
            {QA_SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="rounded-full border border-border bg-muted/30 px-3 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                onClick={() => void ask(suggestion)}
                disabled={disabled}
              >
                {t(suggestion)}
              </button>
            ))}
          </div>
        )}

        {!config.aiConfig.enabled && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {t('AI 功能尚未启用，请先到设置中配置模型。')}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}

        {items.length > 0 && (
          <div className="space-y-3">
            {items.map((item, index) => (
              <div key={`${item.question}-${index}`} className="rounded-lg border border-border bg-muted/10 p-4">
                <div className="flex items-start gap-2 text-sm font-medium text-foreground">
                  <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{item.question}</span>
                </div>
                <div className="mt-3 text-sm text-foreground">
                  <MarkdownMessage content={item.answer || t('（模型未返回内容）')} />
                </div>
                {item.sources.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                    <span className="text-xs text-muted-foreground">{t('引用 {matched} 段 · 来源', { matched: item.matched })}</span>
                    {item.sources.map((source, sourceIndex) => (
                      <span key={`${source.title ?? 'src'}-${sourceIndex}`} className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                        {source.title ?? t('财报片段')}{source.publisher ? ` · ${source.publisher}` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

function ResultList({ title, items, emptyText }: { title: string; items: string[]; emptyText: string }) {
  return (
    <Card className="border-border bg-card">
      <div className="p-5">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {items.length ? (
          <ul className="mt-3 space-y-2 text-sm text-foreground">
            {items.map((item) => <li key={item}>- {item}</li>)}
          </ul>
        ) : (
          <div className="mt-3 text-sm text-muted-foreground">{emptyText}</div>
        )}
      </div>
    </Card>
  )
}

function formatMetricValue(value: unknown, kind?: 'money') {
  if (value === null || value === undefined || value === '') return '--'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '--'
    if (kind === 'money') return formatHundredMillion(value)
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
  }
  return String(value)
}

function formatHundredMillion(value: number) {
  const yi = value / 100_000_000
  if (Math.abs(yi) >= 0.01) {
    return `${yi.toLocaleString(undefined, { maximumFractionDigits: 2 })} 亿`
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatPercent(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : null
}
