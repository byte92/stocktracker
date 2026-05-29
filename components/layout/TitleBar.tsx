'use client'

import { useEffect, useState } from 'react'
import { Minus, Square, X, ChartNoAxesCombined } from 'lucide-react'

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean
      platform: string
      minimizeWindow: () => void
      maximizeWindow: () => void
      closeWindow: () => void
      isWindowMaximized: () => Promise<boolean>
      onWindowMaximized: (callback: (maximized: boolean) => void) => () => void
    }
  }
}

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false)
  const [platform, setPlatform] = useState<string>('darwin')

  const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron

  useEffect(() => {
    if (!isElectron || !window.electronAPI) return

    setPlatform(window.electronAPI.platform)

    window.electronAPI.isWindowMaximized().then(setMaximized)

    const cleanup = window.electronAPI.onWindowMaximized(setMaximized)
    return cleanup

    function setMaximized(v: boolean) { setIsMaximized(v) }
  }, [isElectron])

  if (!isElectron) return null

  const isMac = platform === 'darwin'

  return (
    <div className="electron-titlebar flex h-9 shrink-0 items-center border-b border-border/50 bg-card/95 backdrop-blur-md select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* macOS: 留出红绿灯空间 */}
      {isMac && <div className="w-[78px] shrink-0" />}

      {/* 左侧：Logo + 应用名 */}
      <div className="flex items-center gap-2 pl-3">
        <ChartNoAxesCombined className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold tracking-wide text-foreground/80">StockTracker</span>
      </div>

      {/* 中间拖拽区域 */}
      <div className="flex-1" />

      {/* Windows: 窗口控制按钮 */}
      {!isMac && (
        <div className="flex h-full" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            type="button"
            onClick={() => window.electronAPI?.minimizeWindow()}
            className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            title="最小化"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => window.electronAPI?.maximizeWindow()}
            className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            title={isMaximized ? '还原' : '最大化'}
          >
            {isMaximized ? (
              <svg className="h-3 w-3" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
                <rect x="2" y="0" width="8" height="8" rx="1" />
                <rect x="0" y="2" width="8" height="8" rx="1" fill="var(--color-card)" />
                <rect x="0" y="2" width="8" height="8" rx="1" />
              </svg>
            ) : (
              <Square className="h-3 w-3" />
            )}
          </button>
          <button
            type="button"
            onClick={() => window.electronAPI?.closeWindow()}
            className="flex h-full w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
            title="关闭"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
