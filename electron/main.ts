import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { createServerManager } from './server'
import { setupAutoUpdater } from './updater'

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let serverManager: ReturnType<typeof createServerManager> | null = null

function getUserDataPath(): string {
  return app.getPath('userData')
}

function getConfigPath(): string {
  return path.join(getUserDataPath(), '.env.local')
}

function getOnboardingDonePath(): string {
  return path.join(getUserDataPath(), '.onboarding-done')
}

function needsOnboarding(): boolean {
  // Already completed or skipped onboarding before
  if (fs.existsSync(getOnboardingDonePath())) return false
  // Already have .env.local
  if (fs.existsSync(getConfigPath())) return false
  return true
}

function markOnboardingDone(): void {
  fs.writeFileSync(getOnboardingDonePath(), new Date().toISOString(), 'utf-8')
}

function writeEnvLocal(config: {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
}): void {
  const lines = [
    `AI_PROVIDER=${config.provider}`,
    config.baseUrl ? `AI_BASE_URL=${config.baseUrl}` : '',
    `AI_API_KEY=${config.apiKey}`,
    config.model ? `AI_MODEL=${config.model}` : '',
  ].filter(Boolean)
  fs.writeFileSync(getConfigPath(), lines.join('\n') + '\n', 'utf-8')
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    title: 'StockTracker',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  win.on('maximize', () => {
    win.webContents.send('window-maximized-changed', true)
  })
  win.on('unmaximize', () => {
    win.webContents.send('window-maximized-changed', false)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  return win
}

function showOnboarding(parent: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      parent,
      width: 560,
      height: 500,
      resizable: false,
      modal: true,
      titleBarStyle: 'hiddenInset',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    const onboardingPath = path.join(__dirname, 'onboarding', 'index.html')
    win.loadFile(onboardingPath)

    ipcMain.handle('save-config', (_event, config) => {
      writeEnvLocal(config)
    })

    ipcMain.handle('finish-onboarding', () => {
      markOnboardingDone()
      win.close()
      resolve()
    })

    win.on('closed', () => {
      markOnboardingDone()
      resolve()
    })
  })
}

async function main(): Promise<void> {
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && mainWindow) {
      mainWindow.show()
    }
  })

  app.on('before-quit', async () => {
    if (serverManager) {
      await serverManager.stop()
    }
  })

  await app.whenReady()

  // IPC handlers
  ipcMain.handle('get-app-version', () => app.getVersion())
  ipcMain.handle('get-user-data-path', () => getUserDataPath())
  ipcMain.handle('restart-app', () => {
    app.relaunch()
    app.exit(0)
  })

  ipcMain.handle('window-minimize', () => {
    BrowserWindow.getFocusedWindow()?.minimize()
  })
  ipcMain.handle('window-maximize', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })
  ipcMain.handle('window-close', () => {
    BrowserWindow.getFocusedWindow()?.close()
  })
  ipcMain.handle('window-is-maximized', () => {
    return BrowserWindow.getFocusedWindow()?.isMaximized() ?? false
  })

  // Start server immediately (don't wait for onboarding)
  serverManager = createServerManager({
    userDataPath: getUserDataPath(),
  })

  mainWindow = createMainWindow()

  try {
    const { port } = await serverManager.start()
    await mainWindow.loadURL(`http://127.0.0.1:${port}`)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await mainWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`
        <!DOCTYPE html>
        <html><head><meta charset="utf-8"></head>
        <body style="font-family:-apple-system,sans-serif;padding:40px;text-align:center;background:#0f172a;color:#e2e8f0">
          <h1>启动失败</h1><p>StockTracker 服务未能启动。</p>
          <pre style="background:#1e293b;padding:16px;border-radius:8px;text-align:left;color:#f87171;white-space:pre-wrap">${errorMessage}</pre>
        </body></html>
      `)}`
    )
  }

  mainWindow.show()
  mainWindow.focus()

  // Show onboarding as modal overlay if needed (after main window is ready)
  if (needsOnboarding()) {
    await showOnboarding(mainWindow)
  }

  if (!isDev) {
    setupAutoUpdater(mainWindow)
  }
}

main().catch((error) => {
  console.error('[electron] fatal:', error)
  app.quit()
})
