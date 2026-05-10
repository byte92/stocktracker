'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Bot, Clock, Eraser, GitBranch, Info, Maximize2, Pencil, Plus, Send, Square, Trash2, X } from 'lucide-react'
import ConfirmDialog from '@/components/ConfirmDialog'
import MarkdownMessage from '@/components/ai/MarkdownMessage'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAiDebugMode } from '@/hooks/useAiDebugMode'
import { nextApiUrls } from '@/lib/api/endpoints'
import { useI18n } from '@/lib/i18n'
import { buildAiChatSuggestions } from '@/lib/ai/chatSuggestions'
import { useStockStore } from '@/store/useStockStore'
import type { AiChatContextStats, AiChatMessage, AiChatSession } from '@/types'

type AiChatPanelProps = {
  mode: 'floating' | 'full'
  onClose?: () => void
}

const CHAT_TITLE_MAX_LENGTH = 24

type AiEnvStatus = {
  configured: boolean
  model?: string
}

export default function AiChatPanel({ mode, onClose }: AiChatPanelProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { userId, stocks, config, sync } = useStockStore()
  const { t, formatDateTime } = useI18n()
  const [sessions, setSessions] = useState<AiChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<AiChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [contextStats, setContextStats] = useState<AiChatContextStats | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [aiEnvStatus, setAiEnvStatus] = useState<AiEnvStatus | null>(null)
  const [streamStatus, setStreamStatus] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [showTraceLink, setShowTraceLink] = useState(false)
  const messagesRef = useRef<HTMLDivElement | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const composingRef = useRef(false)

  const activeSession = sessions.find((session) => session.id === activeSessionId)
  const aiReady = Boolean(aiEnvStatus?.configured) || (config.aiConfig.enabled && config.aiConfig.baseUrl.trim() && config.aiConfig.model.trim() && config.aiConfig.apiKey.trim())
  const currentModelName = aiEnvStatus?.configured ? aiEnvStatus.model : config.aiConfig.model
  const currentTitle = activeSession?.title ?? (activeSessionId ? t('AI 对话') : t('新对话'))
  const { debugEnabled, setDebugEnabled } = useAiDebugMode()
  const suggestions = buildAiChatSuggestions({
    stocks,
    pathname,
    activeSessionId,
    messageCount: messages.length,
  })

  useEffect(() => {
    if (mode !== 'full') return
    const sessionId = new URLSearchParams(window.location.search).get('sessionId')
    if (sessionId) setActiveSessionId(sessionId)
  }, [mode])

  useEffect(() => {
    let cancelled = false
    async function loadAiEnvStatus() {
      try {
        const res = await fetch(nextApiUrls.ai.configStatus(), { cache: 'no-store' })
        const data = await res.json()
        if (!cancelled && res.ok) setAiEnvStatus(data.env ?? null)
      } catch {
        if (!cancelled) setAiEnvStatus(null)
      }
    }
    void loadAiEnvStatus()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
    }
  }, [])

  const refreshSessions = useCallback(async (options: { autoSelect?: boolean } = {}) => {
    if (!userId) return
    const res = await fetch(nextApiUrls.ai.chatSessions({ userId }), { cache: 'no-store' })
    const data = await res.json()
    if (!res.ok) throw new Error(t(data?.error ?? '获取 AI 对话失败'))
    const nextSessions = (data.sessions ?? []) as AiChatSession[]
    setSessions(nextSessions)
    if (options.autoSelect && !activeSessionId && nextSessions[0]) {
      setActiveSessionId(nextSessions[0].id)
    }
  }, [activeSessionId, t, userId])

  const refreshMessages = useCallback(async (sessionId: string | null) => {
    if (!userId || !sessionId) {
      setMessages([])
      return
    }
    const res = await fetch(nextApiUrls.ai.chatMessages({ userId, sessionId }), { cache: 'no-store' })
    const data = await res.json()
    if (!res.ok) throw new Error(t(data?.error ?? '获取 AI 消息失败'))
    setMessages((data.messages ?? []) as AiChatMessage[])
  }, [t, userId])

  useEffect(() => {
    if (mode !== 'full') return
    void refreshSessions({ autoSelect: true }).catch((err) => setError(err instanceof Error ? err.message : t('获取 AI 对话失败')))
  }, [mode, refreshSessions, t])

  useEffect(() => {
    if (mode !== 'full') return
    void refreshMessages(activeSessionId).catch((err) => setError(err instanceof Error ? err.message : t('获取 AI 消息失败')))
  }, [activeSessionId, mode, refreshMessages, t])

  useEffect(() => {
    const el = messagesRef.current
    if (!el) return
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight
    })
  }, [messages, loading])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setShowTraceLink(true)
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') setShowTraceLink(false)
    }
    const handleBlur = () => setShowTraceLink(false)

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  const createSession = async () => {
    if (!userId) return
    const res = await fetch(nextApiUrls.ai.chatSessions(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(t(data?.error ?? '创建 AI 对话失败'))
    const session = data.session as AiChatSession
    await refreshSessions()
    setActiveSessionId(session.id)
    setMessages([])
  }

  const startSend = async (content: string) => {
    if (!content.trim() || !userId || loading) return
    if (!aiReady) {
      setError(t('请先在 .env.local 或设置页配置 AI Provider、Base URL、模型和 API Key。'))
      return
    }

    setError('')
    setInput('')
    setLoading(true)
    setStreamStatus('')
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    const optimisticUser: AiChatMessage = {
      id: `local-user-${Date.now()}`,
      sessionId: activeSessionId ?? 'pending',
      userId,
      role: 'user',
      content,
      tokenEstimate: 0,
      createdAt: new Date().toISOString(),
    }
    const optimisticAssistant: AiChatMessage = {
      id: `local-assistant-${Date.now()}`,
      sessionId: activeSessionId ?? 'pending',
      userId,
      role: 'assistant',
      content: '',
      tokenEstimate: 0,
      createdAt: new Date().toISOString(),
    }
    setMessages((current) => [...current, optimisticUser, optimisticAssistant])
    let assistantText = ''

    try {
      const res = await fetch(nextApiUrls.ai.chat(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          sessionId: activeSessionId,
          message: content,
          stocks,
          aiConfig: config.aiConfig,
        }),
        signal: abortController.signal,
      })

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null)
        throw new Error(t(data?.error ?? 'AI 对话失败'))
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let nextSessionId = activeSessionId
      let shouldSyncPortfolio = false

      const handleEvent = (raw: string) => {
        const event = raw.match(/^event:\s*(.+)$/m)?.[1]?.trim()
        const dataText = raw.match(/^data:\s*(.+)$/m)?.[1]
        if (!event || !dataText) return
        const data = JSON.parse(dataText)
        if (event === 'meta') {
          nextSessionId = data.sessionId
          setActiveSessionId(data.sessionId)
          if (data.stats) setContextStats(data.stats)
        } else if (event === 'status') {
          setStreamStatus(data.phase === 'external-data' ? t('正在获取行情数据') : '')
        } else if (event === 'token') {
          assistantText += data.token ?? ''
          setStreamStatus('')
          setMessages((current) => current.map((message) => (
            message.id === optimisticAssistant.id ? { ...message, content: assistantText } : message
          )))
        } else if (event === 'error') {
          throw new Error(data.error ?? t('AI 对话失败'))
        } else if (event === 'done') {
          shouldSyncPortfolio = Boolean(data.dataChanged)
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''
        for (const chunk of chunks) handleEvent(chunk)
      }

      if (mode === 'full') {
        await refreshSessions()
        await refreshMessages(nextSessionId)
      } else if (nextSessionId) {
        const resolvedSessionId = nextSessionId
        setSessions((current) => {
          if (current.some((session) => session.id === resolvedSessionId)) return current
          return [{
            id: resolvedSessionId,
            userId,
            title: content.trim().slice(0, CHAT_TITLE_MAX_LENGTH) || t('新对话'),
            scope: 'portfolio',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messageCount: messages.length + 2,
            latestMessageAt: new Date().toISOString(),
          }, ...current]
        })
        await refreshMessages(nextSessionId)
      }
      if (shouldSyncPortfolio) {
        await sync()
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setMessages((current) => current.map((message) => (
          message.id === optimisticAssistant.id
            ? { ...message, content: assistantText || t('已停止生成。') }
            : message
        )))
        return
      }
      setError(err instanceof Error ? err.message : t('AI 对话失败'))
      setMessages((current) => current.filter((message) => message.id !== optimisticAssistant.id))
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null
      }
      setLoading(false)
      setStreamStatus('')
    }
  }

  const handleSend = async () => {
    await startSend(input)
  }

  const stopGeneration = () => {
    if (!loading) return
    setStreamStatus(t('正在停止'))
    abortControllerRef.current?.abort()
  }

  const clearMessages = async () => {
    if (!userId || !activeSessionId) return
    const res = await fetch(nextApiUrls.ai.chatMessages(), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, sessionId: activeSessionId }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(t(data?.error ?? '清空 AI 对话失败'))
      return
    }
    setClearOpen(false)
    setMessages([])
    if (mode === 'full') await refreshSessions({ autoSelect: true })
  }

  const deleteSession = async () => {
    if (!userId || !activeSessionId) return
    const res = await fetch(nextApiUrls.ai.chatSessions(), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, sessionId: activeSessionId }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(t(data?.error ?? '删除 AI 对话失败'))
      return
    }
    setDeleteOpen(false)
    setMessages([])
    setActiveSessionId(null)
    if (mode === 'full') await refreshSessions({ autoSelect: true })
  }

  const startEditTitle = () => {
    setTitleDraft(currentTitle)
    setEditingTitle(true)
  }

  const saveTitle = async () => {
    if (!userId || !activeSessionId) {
      setEditingTitle(false)
      return
    }
    const nextTitle = titleDraft.trim().slice(0, CHAT_TITLE_MAX_LENGTH) || t('新对话')
    setEditingTitle(false)
    if (nextTitle === activeSession?.title) return

    const res = await fetch(nextApiUrls.ai.chatSessions(), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, sessionId: activeSessionId, title: nextTitle }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      setError(t(data?.error ?? '更新对话名称失败'))
      return
    }
    if (mode === 'full') await refreshSessions()
  }

  const goFull = () => {
    const suffix = activeSessionId ? `?sessionId=${encodeURIComponent(activeSessionId)}` : ''
    router.push(`/ai/chat${suffix}`)
    onClose?.()
  }

  const goTrace = () => {
    if (!debugEnabled) setDebugEnabled(true)
    router.push(`/ai/debug${activeSessionId ? `?id=${encodeURIComponent(activeSessionId)}` : ''}`)
  }

  return (
    <div className={mode === 'full' ? 'grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,14rem)_minmax(0,1fr)] gap-4 lg:grid-cols-[280px_1fr] lg:grid-rows-1' : 'flex h-full min-h-0 flex-col'}>
      {mode === 'full' && (
        <aside className="flex h-full min-h-0 flex-col rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border p-4">
            <div>
              <div className="text-sm font-semibold">{t('对话历史')}</div>
              <div className="text-xs text-muted-foreground">{t('本地保存')}</div>
            </div>
            <Button type="button" size="icon" variant="ghost" onClick={() => void createSession()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent" style={{ scrollbarWidth: 'thin', scrollbarColor: 'hsl(var(--border)) transparent' } as React.CSSProperties}>
            <TooltipProvider delayDuration={300}>
              {sessions.map((session) => (
                <Tooltip key={session.id}>
                  <TooltipTrigger asChild>
                    <div
                      className={`relative w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                        session.id === activeSessionId ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveSessionId(session.id)}
                        aria-label={t('打开对话：{title}', { title: session.title })}
                        className="block w-full text-left"
                      >
                        <div className="truncate">{session.title}</div>
                        <div className="mt-1 flex items-center gap-1 text-[11px] opacity-75">
                          <Clock className="h-3 w-3" />
                          {formatDateTime(session.updatedAt)}
                        </div>
                      </button>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="start">{session.title}</TooltipContent>
                </Tooltip>
              ))}
            </TooltipProvider>
            {!sessions.length && <div className="px-3 py-8 text-sm text-muted-foreground">{t('暂无对话')}</div>}
          </div>
        </aside>
      )}

      <section className={`flex min-h-0 flex-col overflow-hidden ${mode === 'floating' ? 'h-full flex-1' : 'h-full rounded-lg border border-border bg-card'}`}>
        <header className="shrink-0 flex items-center gap-3 border-b border-border p-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/12 text-primary">
            <Bot className="h-4 w-4" />
          </div>
          <div className="relative min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5">
              {editingTitle ? (
                <Input
                  value={titleDraft}
                  maxLength={CHAT_TITLE_MAX_LENGTH}
                  autoFocus
                  onChange={(event) => setTitleDraft(event.target.value.slice(0, CHAT_TITLE_MAX_LENGTH))}
                  onBlur={() => void saveTitle()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      event.currentTarget.blur()
                    }
                    if (event.key === 'Escape') {
                      setEditingTitle(false)
                      setTitleDraft(currentTitle)
                    }
                  }}
                  className="h-7 max-w-[260px] px-2 text-sm font-semibold"
                />
              ) : (
                <>
                  <div className="truncate text-sm font-semibold" title={currentTitle}>{currentTitle}</div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground"
                    onClick={startEditTitle}
                    disabled={!activeSessionId}
                    title={t('修改对话名称')}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
            <Link
              href="/settings#ai-settings"
              onClick={onClose}
              className="inline-block max-w-full truncate text-xs text-muted-foreground transition-colors hover:text-primary hover:underline"
              title={currentModelName || t('前往 AI 设置')}
            >
              {currentModelName || t('配置 AI 模型')}
            </Link>
          </div>
          {mode === 'floating' && (
            <Button type="button" variant="ghost" size="icon" onClick={goFull} title={t('放大')}>
              <Maximize2 className="h-4 w-4" />
            </Button>
          )}
          {mode === 'full' && (debugEnabled || showTraceLink) && (
            <Button type="button" variant="ghost" size="sm" title={debugEnabled ? t('打开 Trace') : t('启用 Debug 并打开 Trace')} className="gap-2" onClick={goTrace}>
              <GitBranch className="h-4 w-4" />
              Trace
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon" onClick={() => setClearOpen(true)} disabled={!activeSessionId || !messages.length} title={t('清空对话')}>
            <Eraser className="h-4 w-4" />
          </Button>
          {mode === 'full' && (
            <Button type="button" variant="ghost" size="icon" onClick={() => setDeleteOpen(true)} disabled={!activeSessionId} title={t('删除会话')}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          {mode === 'floating' && (
            <Button type="button" variant="ghost" size="icon" onClick={onClose} title={t('关闭')}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </header>

        {!aiReady && (
          <div className="shrink-0 border-b border-border bg-secondary/50 p-4 text-sm text-muted-foreground">
            {t('请先在 .env.local 或 AI 设置中完成模型连接配置后再开始对话。')}
            <Link href="/settings" className="ml-2 text-primary hover:underline" onClick={onClose}>{t('去设置')}</Link>
          </div>
        )}

        <div
          ref={messagesRef}
          className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent"
          style={{ scrollbarWidth: 'thin', scrollbarColor: 'hsl(var(--border)) transparent' } as React.CSSProperties}
        >
          {!messages.length && (
            <div className="space-y-3">
              <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-200">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{t('AI 分析基于你的持仓和交易数据生成，仅供参考，不构成任何投资建议。市场有风险，交易需谨慎。')}</span>
              </div>
              <div className="text-sm text-muted-foreground">{t('可以直接问我与你的持仓、交易复盘、估值或风险管理相关的问题。')}</div>
              <div className="grid gap-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={!aiReady || loading}
                    onClick={() => void startSend(suggestion)}
                    className="rounded-md border border-border px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-4">
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`relative min-w-0 max-w-[82%] ${message.role === 'assistant' ? 'space-y-2' : ''}`}>
                  <div className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-6 ${
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border bg-secondary/60 text-foreground'
                  }`}>
                    {message.content ? (
                      message.role === 'assistant'
                        ? <div className="markdown-message"><MarkdownMessage content={message.content} /></div>
                        : message.content
                    ) : (message.role === 'assistant' && loading ? (
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        {streamStatus && <span>{streamStatus}</span>}
                        <span className="inline-flex items-center gap-1" aria-label={streamStatus || t('AI 正在生成')}>
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
                        </span>
                      </span>
                    ) : '')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && <div className="border-t border-border px-4 py-2 text-xs text-destructive">{error}</div>}

        <footer className="mt-auto shrink-0 border-t border-border p-3">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/40 px-3 py-2 transition-colors focus-within:border-primary/40 focus-within:bg-secondary/60">
            <textarea
              value={input}
              disabled={!aiReady || loading}
              rows={mode === 'full' ? 2 : 1}
              placeholder={aiReady ? t('输入与标的、持仓或交易相关的问题...') : t('请先配置 AI')}
              onChange={(event) => setInput(event.target.value)}
              onCompositionStart={() => {
                composingRef.current = true
              }}
              onCompositionEnd={() => {
                composingRef.current = false
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || composingRef.current) return
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void handleSend()
                }
              }}
              className="min-h-0 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
            <button
              type="button"
              disabled={loading ? false : (!aiReady || !input.trim())}
              onClick={() => {
                if (loading) {
                  stopGeneration()
                  return
                }
                void handleSend()
              }}
              className={`shrink-0 rounded-lg p-1.5 transition-colors disabled:opacity-30 ${
                loading ? 'text-destructive hover:bg-destructive/10 hover:text-destructive' : 'text-muted-foreground hover:text-primary'
              }`}
              title={loading ? t('停止生成') : t('发送')}
              aria-label={loading ? t('停止生成') : t('发送消息')}
            >
              {loading ? <Square className="h-4 w-4 fill-current" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </footer>
      </section>

      <ConfirmDialog
        open={clearOpen}
        title={t('确认清空对话')}
        description={t('确定清空当前会话的所有消息吗？该操作不可恢复。')}
        confirmText={t('清空')}
        onOpenChange={setClearOpen}
        onConfirm={clearMessages}
      />
      <ConfirmDialog
        open={deleteOpen}
        title={t('确认删除会话')}
        description={t('确定删除当前 AI 对话会话吗？该操作不可恢复。')}
        confirmText={t('删除')}
        onOpenChange={setDeleteOpen}
        onConfirm={deleteSession}
      />
    </div>
  )
}
