'use client'

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronRight, Loader2, Upload, Download, Trash2, Sparkles, SlidersHorizontal, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useStockStore } from '@/store/useStockStore'
import { useCurrency } from '@/hooks/useCurrency'
import { SUPPORTED_MARKETS } from '@/config/defaults'
import { nextApiUrls } from '@/lib/api/endpoints'
import { THIRD_PARTY_API_EXAMPLES } from '@/lib/external/thirdPartyApis'
import { useI18n } from '@/lib/i18n'
import type { AiAnalysisLanguage, AiProvider, ExportData, Market, TradeMatchMode } from '@/types'

type FeeField = 'commissionRate' | 'minCommission' | 'stampDutyRate' | 'transferFeeRate' | 'settlementFeeRate'
type SectionId = 'basic' | 'ai' | 'preferences'
const SETTINGS_SECTIONS_STORAGE_KEY = 'stock-tracker-settings-sections'

type AiEnvStatus = {
  configured: boolean
  provider?: AiProvider
  baseUrl?: string
  baseUrlConfigured: boolean
  model?: string
  apiKeyConfigured: boolean
  apiKeyPreview?: string
}

export default function SettingsContent({
  onSaved,
  onCancel,
  compact = false,
}: {
  onSaved?: () => void
  onCancel?: () => void
  compact?: boolean
}) {
  const { config, updateConfig, exportData, importData, clearAll } = useStockStore()
  const { displayCurrency, setDisplayCurrency } = useCurrency()
  const { t, getMarketLabel } = useI18n()
  const [defaultMarket, setDefaultMarket] = useState<Market>(config.defaultMarket)
  const [tradeMatchMode, setTradeMatchMode] = useState<TradeMatchMode>(config.tradeMatchMode)
  const [feeConfigs, setFeeConfigs] = useState(config.feeConfigs)
  const [aiConfig, setAiConfig] = useState(config.aiConfig)
  const [draftDisplayCurrency, setDraftDisplayCurrency] = useState(displayCurrency)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [testingModel, setTestingModel] = useState(false)
  const [testMessage, setTestMessage] = useState('')
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [aiEnvStatus, setAiEnvStatus] = useState<AiEnvStatus | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const aiSectionRef = useRef<HTMLDivElement | null>(null)
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    basic: true,
    ai: true,
    preferences: false,
  })

  useEffect(() => {
    setDefaultMarket(config.defaultMarket)
    setTradeMatchMode(config.tradeMatchMode)
    setFeeConfigs(config.feeConfigs)
    setAiConfig(config.aiConfig)
    setDraftDisplayCurrency(displayCurrency)
    setError('')
    setSuccessMessage('')
    setTestMessage('')
  }, [config, displayCurrency])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_SECTIONS_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Partial<Record<SectionId, boolean>>
      setOpenSections((current) => ({
        ...current,
        ...parsed,
      }))
    } catch {
      // ignore malformed local preference
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(SETTINGS_SECTIONS_STORAGE_KEY, JSON.stringify(openSections))
  }, [openSections])

  useEffect(() => {
    if (window.location.hash !== '#ai-settings') return
    setOpenSections((current) => ({ ...current, ai: true }))
    window.setTimeout(() => {
      aiSectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }, 80)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadAiEnvStatus() {
      try {
        const res = await fetch(nextApiUrls.ai.configStatus(), { cache: 'no-store' })
        const data = await res.json()
        if (!cancelled && res.ok) {
          setAiEnvStatus(data.env ?? null)
        }
      } catch {
        if (!cancelled) setAiEnvStatus(null)
      }
    }
    void loadAiEnvStatus()
    return () => {
      cancelled = true
    }
  }, [])

  const basicDirty = useMemo(() => {
    return JSON.stringify({
      defaultMarket,
      feeConfigs,
    }) !== JSON.stringify({
      defaultMarket: config.defaultMarket,
      feeConfigs: config.feeConfigs,
    })
  }, [config.defaultMarket, config.feeConfigs, defaultMarket, feeConfigs])

  const aiDirty = useMemo(() => {
    return JSON.stringify({
      enabled: aiConfig.enabled,
      provider: aiConfig.provider,
      baseUrl: aiConfig.baseUrl,
      model: aiConfig.model,
      apiKey: aiConfig.apiKey,
      temperature: aiConfig.temperature,
      maxContextTokens: aiConfig.maxContextTokens,
      newsEnabled: aiConfig.newsEnabled,
      analysisLanguage: aiConfig.analysisLanguage,
    }) !== JSON.stringify({
      enabled: config.aiConfig.enabled,
      provider: config.aiConfig.provider,
      baseUrl: config.aiConfig.baseUrl,
      model: config.aiConfig.model,
      apiKey: config.aiConfig.apiKey,
      temperature: config.aiConfig.temperature,
      maxContextTokens: config.aiConfig.maxContextTokens,
      newsEnabled: config.aiConfig.newsEnabled,
      analysisLanguage: config.aiConfig.analysisLanguage,
    })
  }, [aiConfig, config.aiConfig])

  const preferencesDirty = draftDisplayCurrency !== displayCurrency
    || tradeMatchMode !== config.tradeMatchMode
  const envAiConfigured = aiEnvStatus?.configured === true
  const displayedAiEnabled = envAiConfigured ? true : aiConfig.enabled
  const displayedAiProvider = envAiConfigured && aiEnvStatus?.provider ? aiEnvStatus.provider : aiConfig.provider
  const displayedAiBaseUrl = envAiConfigured && aiEnvStatus?.baseUrl ? aiEnvStatus.baseUrl : aiConfig.baseUrl
  const displayedAiModel = envAiConfigured && aiEnvStatus?.model ? aiEnvStatus.model : aiConfig.model
  const displayedAiApiKey = envAiConfigured ? (aiEnvStatus?.apiKeyPreview ?? '') : aiConfig.apiKey

  const isDirty = useMemo(() => {
    return basicDirty || aiDirty || preferencesDirty
  }, [aiDirty, basicDirty, preferencesDirty])

  const updateFeeField = (market: Market, field: FeeField, value: string) => {
    const numericValue = Number(value)
    setFeeConfigs((current) => ({
      ...current,
      [market]: {
        ...current[market],
        [field]: Number.isFinite(numericValue) ? numericValue : 0,
      },
    }))
  }

  const handleSave = async () => {
    if (!isDirty) return
    setSaving(true)
    setError('')
    try {
      await updateConfig({
        defaultMarket,
        tradeMatchMode,
        feeConfigs,
        aiConfig,
      })
      if (draftDisplayCurrency !== displayCurrency) {
        setDisplayCurrency(draftDisplayCurrency)
      }
      setSuccessMessage(t('保存成功'))
      setTimeout(() => setSuccessMessage(''), 2500)
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('保存配置失败'))
    } finally {
      setSaving(false)
    }
  }

  const handleExport = () => {
    const data = exportData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    link.href = url
    link.download = `stock-tracker-backup-${stamp}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const data = JSON.parse(text) as Partial<ExportData>
      if (!Array.isArray(data.stocks) || !data.config) {
        throw new Error(t('备份文件格式不正确'))
      }
      importData(data as ExportData)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('导入失败，请检查文件内容'))
    } finally {
      event.target.value = ''
    }
  }

  const handleClearAll = () => {
    clearAll()
    setClearConfirmOpen(false)
    onSaved?.()
  }

  const handleTestModel = async () => {
    setTestingModel(true)
    setError('')
    setTestMessage('')
    try {
      const res = await fetch(nextApiUrls.ai.test(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiConfig }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(t(data?.error ?? '模型连通测试失败'))
      setTestMessage(t('连接成功：{provider} / {model}', {
        provider: data?.result?.provider ?? aiConfig.provider,
        model: data?.result?.model ?? aiConfig.model,
      }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('模型连通测试失败'))
    } finally {
      setTestingModel(false)
    }
  }

  const toggleSection = (section: SectionId) => {
    setOpenSections((current) => ({
      ...current,
      [section]: !current[section],
    }))
  }

  const renderSection = ({
    id,
    icon,
    title,
    description,
    content,
    dirty = false,
    sectionRef,
  }: {
    id: SectionId
    icon: ReactNode
    title: string
    description: string
    content: ReactNode
    dirty?: boolean
    sectionRef?: React.RefObject<HTMLDivElement | null>
  }) => (
    <Card ref={sectionRef} className="scroll-mt-24 border-border">
      <button
        type="button"
        onClick={() => toggleSection(id)}
        className="flex w-full items-start gap-3 rounded-lg p-5 text-left transition-colors hover:bg-muted/30"
      >
        <div className="mt-0.5 text-primary">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium text-foreground">{title}</div>
            {dirty && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                {t('未保存')}
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{description}</div>
        </div>
        <div className="pt-0.5 text-muted-foreground">
          {openSections[id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </button>
      {openSections[id] && (
        <CardContent className="border-t border-border pt-5">
          {content}
        </CardContent>
      )}
    </Card>
  )

  return (
    <div className="space-y-6">
      {renderSection({
        id: 'basic',
        icon: <Settings2 className="h-4 w-4" />,
        title: t('基础设置'),
        description: t('管理默认市场和各市场手续费规则。'),
        dirty: basicDirty,
        content: (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-1.5 max-w-48">
                <Label htmlFor="default-market">{t('默认市场')}</Label>
                <Select
                  id="default-market"
                  value={defaultMarket}
                  onChange={(e) => setDefaultMarket(e.target.value as Market)}
                >
                  {SUPPORTED_MARKETS.map((market) => (
                    <option key={market} value={market}>
                      {getMarketLabel(market)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div>
              <div className="text-sm font-medium text-foreground">{t('手续费配置')}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t('自动计算会优先按市场与代码套用规则。例如普通 A 股卖出会收印花税，ETF 默认免印花税；费率字段使用小数形式，例如万一填写 `0.0001`')}
              </div>
            </div>

            <div className="space-y-4">
              {SUPPORTED_MARKETS.map((market) => {
                const fee = feeConfigs[market]
                return (
                  <div key={market} className="rounded-lg border border-border p-4 space-y-3">
                    <div className="text-sm font-medium text-foreground">{getMarketLabel(market)}</div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div className="space-y-1.5">
                        <Label>{t('佣金率')}</Label>
                        <Input
                          type="number"
                          step="0.00001"
                          min="0"
                          value={fee.commissionRate}
                          onChange={(e) => updateFeeField(market, 'commissionRate', e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{t('最低佣金')}</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={fee.minCommission}
                          onChange={(e) => updateFeeField(market, 'minCommission', e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{t('印花税率')}</Label>
                        <Input
                          type="number"
                          step="0.00001"
                          min="0"
                          value={fee.stampDutyRate}
                          onChange={(e) => updateFeeField(market, 'stampDutyRate', e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{t('过户费率')}</Label>
                        <Input
                          type="number"
                          step="0.00001"
                          min="0"
                          value={fee.transferFeeRate}
                          onChange={(e) => updateFeeField(market, 'transferFeeRate', e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>{t('结算费率')}</Label>
                        <Input
                          type="number"
                          step="0.00001"
                          min="0"
                          value={fee.settlementFeeRate ?? 0}
                          onChange={(e) => updateFeeField(market, 'settlementFeeRate', e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ),
      })}

      {renderSection({
        id: 'ai',
        icon: <Sparkles className="h-4 w-4" />,
        title: t('AI 设置'),
        description: t('管理 provider、模型、密钥和默认运行参数。'),
        dirty: aiDirty,
        sectionRef: aiSectionRef,
        content: (
          <div className="rounded-lg border border-border p-4 space-y-4">
          {aiEnvStatus?.configured && (
            <div className="rounded-md border border-primary/25 bg-primary/10 p-3 text-xs text-primary">
              {t('当前检测到服务端 .env AI 配置，将优先使用环境变量中的 Provider / Base URL / Model / API Key。下方连接配置仅作为本地兜底；Temperature、Max Context Tokens、新闻增强和分析语言仍使用设置页配置。')}
              {aiEnvStatus.model && <span className="ml-1">{t('当前环境模型：{model}', { model: aiEnvStatus.model })}</span>}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ai-enabled">{t('启用 AI')}</Label>
              <Select
                id="ai-enabled"
                value={displayedAiEnabled ? 'true' : 'false'}
                disabled={envAiConfigured}
                onChange={(e) => setAiConfig((current) => ({ ...current, enabled: e.target.value === 'true' }))}
              >
                <option value="true">{t('启用')}</option>
                <option value="false">{t('停用')}</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-provider">Provider</Label>
              <Select
                id="ai-provider"
                value={displayedAiProvider}
                disabled={envAiConfigured}
                onChange={(e) => setAiConfig((current) => ({ ...current, provider: e.target.value as AiProvider }))}
              >
                <option value="openai-compatible">OpenAI Compatible</option>
                <option value="anthropic-compatible">Anthropic Compatible</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-model">{t('模型')}</Label>
              <div className="flex gap-2">
                <Input
                  id="ai-model"
                  placeholder="gpt-4.1-mini / claude / gemini ..."
                  value={displayedAiModel}
                  disabled={envAiConfigured}
                  onChange={(e) => setAiConfig((current) => ({ ...current, model: e.target.value }))}
                />
                <Button type="button" variant="outline" onClick={handleTestModel} disabled={testingModel}>
                  {testingModel ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}
                </Button>
              </div>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="ai-base-url">Base URL</Label>
              <Input
                id="ai-base-url"
                placeholder={THIRD_PARTY_API_EXAMPLES.openAiCompatibleBaseUrl}
                value={displayedAiBaseUrl}
                disabled={envAiConfigured}
                onChange={(e) => setAiConfig((current) => ({ ...current, baseUrl: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5 md:col-span-2 xl:col-span-1">
              <Label htmlFor="ai-key">API Key</Label>
              <Input
                id="ai-key"
                type={envAiConfigured ? 'text' : 'password'}
                placeholder="sk-..."
                value={displayedAiApiKey}
                disabled={envAiConfigured}
                onChange={(e) => setAiConfig((current) => ({ ...current, apiKey: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-temp">Temperature</Label>
              <Input
                id="ai-temp"
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={aiConfig.temperature}
                onChange={(e) => setAiConfig((current) => ({ ...current, temperature: Number(e.target.value) || 0 }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-max-context-tokens">Max Context Tokens</Label>
              <Input
                id="ai-max-context-tokens"
                type="number"
                min="4096"
                step="1024"
                value={aiConfig.maxContextTokens}
                onChange={(e) => setAiConfig((current) => ({ ...current, maxContextTokens: Number(e.target.value) || 128000 }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-news-enabled">{t('新闻增强')}</Label>
              <Select
                id="ai-news-enabled"
                value={aiConfig.newsEnabled ? 'true' : 'false'}
                onChange={(e) => setAiConfig((current) => ({ ...current, newsEnabled: e.target.value === 'true' }))}
              >
                <option value="true">{t('开启')}</option>
                <option value="false">{t('停用')}</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-language">{t('分析语言')}</Label>
              <Select
                id="ai-language"
                value={aiConfig.analysisLanguage}
                onChange={(e) => setAiConfig((current) => ({ ...current, analysisLanguage: e.target.value as AiAnalysisLanguage }))}
              >
                <option value="zh-CN">{t('中文')}</option>
                <option value="en-US">English</option>
              </Select>
            </div>
          </div>

          <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
            {t('推荐把 AI_PROVIDER、AI_BASE_URL、AI_MODEL、AI_API_KEY 放在 .env.local 中。若未配置环境变量，系统会继续使用这里保存的本地兜底配置；JSON 导出会自动移除 API Key。分析提示词由 Skill 固定维护，不再从设置页编辑。')}
          </div>

          {testMessage && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
              {testMessage}
            </div>
          )}
          </div>
        ),
      })}

      {renderSection({
        id: 'preferences',
        icon: <SlidersHorizontal className="h-4 w-4" />,
        title: t('偏好设置'),
        description: t('管理显示货币等页面展示偏好。'),
        dirty: preferencesDirty,
        content: (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-1.5 max-w-48">
              <Label htmlFor="display-currency">{t('显示货币')}</Label>
              <Select
                id="display-currency"
                value={draftDisplayCurrency}
                onChange={(e) => setDraftDisplayCurrency(e.target.value as 'CNY' | 'HKD' | 'USD' | 'USDT')}
              >
                <option value="CNY">CNY</option>
                <option value="HKD">HKD</option>
                <option value="USD">USD</option>
                <option value="USDT">USDT</option>
              </Select>
              <div className="text-xs text-muted-foreground">
                {t('主题模式已迁回侧边栏底部，方便随时切换。')}
              </div>
            </div>
            <div className="space-y-1.5 max-w-80">
              <Label htmlFor="trade-match-mode">{t('卖出成本匹配口径')}</Label>
              <Select
                id="trade-match-mode"
                value={tradeMatchMode}
                onChange={(e) => setTradeMatchMode(e.target.value as TradeMatchMode)}
              >
                <option value="FIFO">{t('FIFO（先进先出）')}</option>
                <option value="RECENT_LOTS">{t('最近批次（做 T 复盘口径）')}</option>
              </Select>
              <div className="text-xs text-muted-foreground">
                {t('影响卖出已实现盈亏明细；当前持仓成本价按券商摊薄口径计算。')}
              </div>
            </div>
          </div>
        ),
      })}

      <section className="space-y-3">
        <div>
          <div className="text-sm font-medium text-foreground">{t('数据管理')}</div>
          <div className="text-xs text-muted-foreground mt-1">{t('支持本地 JSON 备份、导入恢复和一键清空')}</div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1" />
            {t('导出备份')}
          </Button>
          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1" />
            {t('导入备份')}
          </Button>
          <Button type="button" variant="outline" className="text-destructive" onClick={() => setClearConfirmOpen(true)}>
            <Trash2 className="h-4 w-4 mr-1" />
            {t('清空数据')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
      </section>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className={`flex ${compact ? 'justify-end border-t border-border pt-5' : 'justify-end'} gap-2`}>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>{t('取消')}</Button>
        )}
        <div className="relative">
          <Button type="button" onClick={handleSave} disabled={saving || !isDirty}>
            {saving ? t('保存中...') : t('保存设置')}
          </Button>
          {successMessage && (
            <div className="absolute right-0 top-full mt-2 w-max max-w-xs rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 shadow-lg">
              <Check className="mr-1 inline h-3.5 w-3.5" />
              {successMessage}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={clearConfirmOpen}
        title={t('确认清空数据')}
        description={t('确定清空所有持仓、交易和配置吗？该操作不可恢复。')}
        confirmText={t('清空')}
        onOpenChange={setClearConfirmOpen}
        onConfirm={handleClearAll}
      />
    </div>
  )
}
