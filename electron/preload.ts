import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  saveConfig: (config: { provider: string; baseUrl: string; apiKey: string; model: string }) =>
    ipcRenderer.invoke('save-config', config),
  finishOnboarding: () => ipcRenderer.invoke('finish-onboarding'),
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window-minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window-maximize'),
  closeWindow: () => ipcRenderer.invoke('window-close'),
  isWindowMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onWindowMaximized: (callback: (maximized: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized)
    ipcRenderer.on('window-maximized-changed', handler)
    return () => { ipcRenderer.removeListener('window-maximized-changed', handler) }
  },
})
