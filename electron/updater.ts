import { autoUpdater } from 'electron-updater'
import { BrowserWindow, dialog } from 'electron'

export function setupAutoUpdater(mainWindow: BrowserWindow): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', async (info) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '发现新版本',
      message: `StockTracker ${info.version} 已可用`,
      detail: '是否现在下载更新？',
      buttons: ['下载更新', '稍后'],
      defaultId: 0,
    })

    if (result.response === 0) {
      autoUpdater.downloadUpdate()
    }
  })

  autoUpdater.on('update-downloaded', async () => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '更新已下载',
      message: '新版本已准备好，重启应用即可完成更新。',
      buttons: ['立即重启', '稍后重启'],
      defaultId: 0,
    })

    if (result.response === 0) {
      autoUpdater.quitAndInstall()
    }
  })

  autoUpdater.on('error', (error) => {
    console.error('[updater] error:', error.message)
  })

  // Check for updates after a delay (don't block startup)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] check failed:', err.message)
    })
  }, 10_000)
}
