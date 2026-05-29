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
})
