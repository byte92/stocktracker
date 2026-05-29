'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { BriefcaseBusiness, Bug, ChartNoAxesCombined, ChevronDown, ChevronLeft, ChevronRight, LayoutDashboard, Menu, Moon, Settings, Sparkles, Sun, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import FloatingAiChat from '@/components/ai/FloatingAiChat'
import LanguageSwitcher from '@/components/i18n/LanguageSwitcher'
import TitleBar from '@/components/layout/TitleBar'
import { useTheme } from '@/hooks/useTheme'
import { useAiDebugMode } from '@/hooks/useAiDebugMode'
import { useI18n } from '@/lib/i18n'
import { useStockStore } from '@/store/useStockStore'

const NAV_ITEMS = [
  { href: '/', labelKey: '总览', icon: LayoutDashboard, match: (pathname: string) => pathname === '/' },
  { href: '/portfolio', labelKey: '持仓', icon: BriefcaseBusiness, match: (pathname: string) => pathname === '/portfolio' || pathname.startsWith('/stock/') },
  { href: '/markets', labelKey: '大盘指标', icon: ChartNoAxesCombined, match: (pathname: string) => pathname === '/markets' },
] as const

const AI_SUB_ITEMS = [
  { href: '/ai/chat', labelKey: 'AI 对话', match: (pathname: string) => pathname.startsWith('/ai/chat') },
  { href: '/ai', labelKey: '分析中心', match: (pathname: string) => pathname === '/ai' },
  { href: '/ai/financials', labelKey: '财报分析', match: (pathname: string) => pathname.startsWith('/ai/financials') },
] as const

const SIDEBAR_COLLAPSED_KEY = 'stock-tracker-sidebar-collapsed'
const AI_NAV_EXPANDED_KEY = 'stock-tracker-ai-nav-expanded'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { theme, toggleTheme, mounted } = useTheme()
  const { debugEnabled } = useAiDebugMode()
  const { t } = useI18n()
  const { init } = useStockStore()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [aiNavExpanded, setAiNavExpanded] = useState(true)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
    setSidebarCollapsed(stored === 'true')
    const aiStored = localStorage.getItem(AI_NAV_EXPANDED_KEY)
    setAiNavExpanded(aiStored === null ? true : aiStored === 'true')
  }, [])

  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  useEffect(() => {
    if (pathname.startsWith('/ai')) {
      setAiNavExpanded(true)
    }
  }, [pathname])

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((current) => {
      const next = !current
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
      return next
    })
  }

  const toggleAiNavExpanded = () => {
    setAiNavExpanded((current) => {
      const next = !current
      localStorage.setItem(AI_NAV_EXPANDED_KEY, String(next))
      return next
    })
  }

  return (
    <div className="min-h-screen bg-background">
      <TitleBar />
      <div className="min-h-screen">
        <aside
          className={`hidden lg:flex fixed inset-y-0 left-0 z-30 shrink-0 flex-col border-r border-border bg-card/70 backdrop-blur-md transition-[width] duration-200 ${
            sidebarCollapsed ? 'w-20' : 'w-64'
          }`}
        >
          <SidebarContent
            pathname={pathname}
            theme={theme}
            toggleTheme={toggleTheme}
            mounted={mounted}
            collapsed={sidebarCollapsed}
            aiNavExpanded={aiNavExpanded}
            debugEnabled={debugEnabled}
            onToggleAiNavExpanded={toggleAiNavExpanded}
            onToggleCollapsed={toggleSidebarCollapsed}
          />
        </aside>

        <div className={`flex min-w-0 min-h-screen flex-1 flex-col transition-[padding-left] duration-200 ${sidebarCollapsed ? 'lg:pl-20' : 'lg:pl-64'}`}>
          <div className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-card/80 px-4 backdrop-blur-md lg:hidden">
            <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-4 w-4" />
            </Button>
            <div className="text-sm font-semibold">StockTracker</div>
            <div className="ml-auto text-xs text-muted-foreground">{t('本地优先')}</div>
          </div>

          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>

      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <div className="relative h-full w-72 max-w-[85vw] border-r border-border bg-card shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <div className="text-sm font-semibold">StockTracker</div>
              <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <SidebarContent
              pathname={pathname}
              theme={theme}
              toggleTheme={toggleTheme}
              mounted={mounted}
              collapsed={false}
              aiNavExpanded={aiNavExpanded}
              debugEnabled={debugEnabled}
              onToggleAiNavExpanded={toggleAiNavExpanded}
            />
          </div>
        </div>
      )}
      {!pathname.startsWith('/ai/chat') && <FloatingAiChat />}
    </div>
  )
}

function SidebarContent({
  pathname,
  theme,
  toggleTheme,
  mounted,
  collapsed,
  aiNavExpanded,
  debugEnabled,
  onToggleAiNavExpanded,
  onToggleCollapsed,
}: {
  pathname: string
  theme: 'dark' | 'light'
  toggleTheme: () => void
  mounted: boolean
  collapsed: boolean
  aiNavExpanded: boolean
  debugEnabled: boolean
  onToggleAiNavExpanded?: () => void
  onToggleCollapsed?: () => void
}) {
  const aiSectionActive = pathname.startsWith('/ai')
  const { t } = useI18n()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav className={`flex-1 min-h-0 overflow-y-auto space-y-1 py-4 ${collapsed ? 'px-2' : 'px-3'}`}>
        {NAV_ITEMS.map((item) => {
          const active = item.match(pathname)
          const Icon = item.icon
          const label = t(item.labelKey)
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? label : undefined}
              className={`flex items-center rounded-lg py-2.5 text-sm transition-colors ${
                collapsed ? 'justify-center px-2' : 'gap-3 px-3'
              } ${
                active
                  ? 'border border-primary/20 bg-primary/12 text-primary'
                  : 'border border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {!collapsed && <span>{label}</span>}
            </Link>
          )
        })}

        <div className="space-y-1">
          <button
            type="button"
            onClick={onToggleAiNavExpanded}
            title={collapsed ? 'AI' : undefined}
            className={`flex w-full items-center rounded-lg py-2.5 text-sm transition-colors ${
              collapsed ? 'justify-center px-2' : 'gap-3 px-3'
            } ${
              aiSectionActive
                ? 'border border-primary/20 bg-primary/12 text-primary'
                : 'border border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            <Sparkles className="h-4 w-4" />
            {!collapsed && (
              <>
                <span className="flex-1 text-left">AI</span>
                <ChevronDown className={`h-4 w-4 transition-transform ${aiNavExpanded ? 'rotate-0' : '-rotate-90'}`} />
              </>
            )}
          </button>

          {!collapsed && aiNavExpanded && (
            <div className="ml-3 space-y-1 border-l border-border/70 pl-3">
              {AI_SUB_ITEMS
                .map((item) => {
                  const active = item.match(pathname)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors ${
                        active
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                      }`}
                    >
                      {t(item.labelKey)}
                    </Link>
                  )
                })}
            </div>
          )}
        </div>
      </nav>

      <div className={`border-t border-border py-4 space-y-3 ${collapsed ? 'px-2' : 'px-4'}`}>
        <div className={`flex gap-2 ${collapsed ? 'flex-col items-center justify-center' : 'items-center justify-start'}`}>
          {mounted && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-lg border border-border/70 text-muted-foreground hover:text-foreground"
              onClick={toggleTheme}
              title={theme === 'dark' ? t('切换到亮色模式') : t('切换到暗色模式')}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          )}

          <LanguageSwitcher compact={collapsed} />

          <Link href="/settings" title={t('设置')}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={`h-9 w-9 rounded-lg border border-border/70 ${
                pathname.startsWith('/settings')
                  ? 'border-primary/20 bg-primary/12 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </Link>

          {debugEnabled && (
            <Link href="/ai/debug" title="Debug">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={`h-9 w-9 rounded-lg border border-border/70 ${
                  pathname.startsWith('/ai/debug')
                    ? 'border-primary/20 bg-primary/12 text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Bug className="h-4 w-4" />
              </Button>
            </Link>
          )}
        </div>

        {onToggleCollapsed && (
          <Button
            variant="ghost"
            className={`w-full border border-border/70 ${collapsed ? 'justify-center px-2' : 'justify-between'}`}
            onClick={onToggleCollapsed}
            title={collapsed ? t('展开侧边栏') : t('收起侧边栏')}
          >
            {collapsed ? (
              <>
                <ChevronRight className="h-4 w-4" />
              </>
            ) : (
              <>
                <span className="text-xs text-muted-foreground">{t('收起侧边栏')}</span>
                <ChevronLeft className="h-4 w-4" />
              </>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}
