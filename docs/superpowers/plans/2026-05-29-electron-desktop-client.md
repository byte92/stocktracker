# Electron 桌面客户端实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 StockTracker 打包为 macOS / Windows 桌面客户端，用户下载安装后双击即用。

**Architecture:** Electron 主进程内嵌 Next.js standalone server 作为子进程，BrowserWindow 通过 localhost 加载。首次运行展示引导配置页。现有代码零改动，所有新增内容在 `electron/` 目录。

**Tech Stack:** Electron, electron-builder, electron-updater, Next.js standalone output, HTML/CSS/JS (onboarding)

---

## 文件结构总览

| 文件 | 操作 | 职责 |
|---|---|---|
| `package.json` | 修改 | 新增依赖和 scripts |
| `electron/main.ts` | 创建 | Electron 主进程入口 |
| `electron/preload.ts` | 创建 | 预加载脚本，暴露 IPC 桥接 |
| `electron/server.ts` | 创建 | Next.js standalone server 管理 |
| `electron/updater.ts` | 创建 | 自动更新逻辑 |
| `electron/onboarding/index.html` | 创建 | 首次引导页面 |
| `electron-builder.yml` | 创建 | 打包配置 |
| `build/icon.icns` | 创建 | macOS 应用图标 |
| `build/icon.ico` | 创建 | Windows 应用图标 |
| `build/icon.png` | 创建 | 通用图标（256x256） |
| `scripts/generate-icons.sh` | 创建 | 从 SVG 生成多格式图标 |

---

### Task 1: 安装 Electron 依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装依赖**

```bash
cd /Users/anything/Code/finance_sys
pnpm add -D electron electron-builder
pnpm add electron-updater
```

- [ ] **Step 2: 验证安装**

```bash
pnpm list electron electron-builder electron-updater
```

Expected: 三个包都有版本号输出。

- [ ] **Step 3: 提交**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add Electron dependencies"
```

---

### Task 2: 创建 Server Manager

**Files:**
- Create: `electron/server.ts`

管理 Next.js standalone server 子进程的启动、健康检查和停止。

- [ ] **Step 1: 创建 `electron/server.ts`**

```typescript
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'
import fs from 'node:fs'
import http from 'node:http'

const DEFAULT_PORT = 3218
const MAX_PORT_ATTEMPTS = 20
const HEALTH_CHECK_INTERVAL_MS = 500
const HEALTH_CHECK_TIMEOUT_MS = 30_000

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset++) {
    const port = startPort + offset
    if (port > 65535) break
    if (await isPortAvailable(port)) return port
  }
  throw new Error(`No available port found from ${startPort}`)
}

function waitForReady(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    const check = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Server not ready within ${timeoutMs}ms`))
        return
      }
      const req = http.get(`http://127.0.0.1:${port}`, (res) => {
        res.resume()
        if (res.statusCode && res.statusCode < 500) {
          resolve()
        } else {
          setTimeout(check, HEALTH_CHECK_INTERVAL_MS)
        }
      })
      req.on('error', () => setTimeout(check, HEALTH_CHECK_INTERVAL_MS))
      req.setTimeout(2000, () => { req.destroy(); setTimeout(check, HEALTH_CHECK_INTERVAL_MS) })
    }
    check()
  })
}

export interface ServerManagerOptions {
  port?: number
  userDataPath: string
}

export interface ServerManager {
  start(): Promise<{ port: number }>
  stop(): Promise<void>
  isReady(): boolean
  getPort(): number | null
}

export function createServerManager(options: ServerManagerOptions): ServerManager {
  let child: ChildProcess | null = null
  let port: number | null = null
  let ready = false

  function getServerScript(): string {
    // In packaged app: resources/app/.next/standalone/server.js
    // In development: .next/standalone/server.js
    const appPath = typeof process.resourcesPath === 'string'
      ? process.resourcesPath
      : process.cwd()
    return path.join(appPath, '.next', 'standalone', 'server.js')
  }

  async function start(): Promise<{ port: number }> {
    const serverScript = getServerScript()

    if (!fs.existsSync(serverScript)) {
      throw new Error(`Next.js standalone server not found at: ${serverScript}`)
    }

    port = await findAvailablePort(options.port ?? DEFAULT_PORT)

    const env: Record<string, string> = {
      ...process.env,
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
      NODE_ENV: 'production',
      FINANCE_SQLITE_PATH: path.join(options.userDataPath, 'finance.sqlite'),
    } as Record<string, string>

    child = spawn(process.execPath, [serverScript], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: path.dirname(serverScript),
    })

    child.stdout?.on('data', (data: Buffer) => {
      console.log(`[server] ${data.toString().trim()}`)
    })
    child.stderr?.on('data', (data: Buffer) => {
      console.error(`[server] ${data.toString().trim()}`)
    })

    child.on('exit', (code, signal) => {
      console.log(`[server] exited with code=${code} signal=${signal}`)
      ready = false
    })

    await waitForReady(port, HEALTH_CHECK_TIMEOUT_MS)
    ready = true
    console.log(`[server] ready on http://127.0.0.1:${port}`)

    return { port }
  }

  async function stop(): Promise<void> {
    if (child) {
      child.kill('SIGTERM')
      // Give it 3s to gracefully exit, then force kill
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          child?.kill('SIGKILL')
          resolve()
        }, 3000)
        child!.on('exit', () => {
          clearTimeout(timeout)
          resolve()
        })
      })
      child = null
    }
    ready = false
    port = null
  }

  return {
    start,
    stop,
    isReady: () => ready,
    getPort: () => port,
  }
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd /Users/anything/Code/finance_sys
npx tsc --noEmit electron/server.ts --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck
```

Expected: 无错误输出。

- [ ] **Step 3: 提交**

```bash
git add electron/server.ts
git commit -m "feat(electron): add Next.js server manager"
```

---

### Task 3: 创建 Preload 脚本

**Files:**
- Create: `electron/preload.ts`

- [ ] **Step 1: 创建 `electron/preload.ts`**

```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getUserDataPath: () => ipcRenderer.invoke('get-user-data-path'),
  restartApp: () => ipcRenderer.invoke('restart-app'),
})
```

- [ ] **Step 2: 提交**

```bash
git add electron/preload.ts
git commit -m "feat(electron): add preload script"
```

---

### Task 4: 创建首次引导页面

**Files:**
- Create: `electron/onboarding/index.html`

- [ ] **Step 1: 创建引导页面**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>StockTracker 初始设置</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      width: 520px;
      background: #1e293b;
      border-radius: 16px;
      border: 1px solid #334155;
      padding: 40px;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
    }
    .step { display: none; }
    .step.active { display: block; }
    h1 {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 8px;
      color: #f8fafc;
    }
    .subtitle {
      font-size: 14px;
      color: #94a3b8;
      margin-bottom: 32px;
      line-height: 1.6;
    }
    .logo {
      font-size: 48px;
      margin-bottom: 16px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #cbd5e1;
      margin-bottom: 6px;
    }
    input, select {
      width: 100%;
      padding: 10px 14px;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      color: #f8fafc;
      font-size: 14px;
      margin-bottom: 16px;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus, select:focus {
      border-color: #3b82f6;
    }
    input::placeholder { color: #475569; }
    .hint {
      font-size: 12px;
      color: #64748b;
      margin-top: -12px;
      margin-bottom: 16px;
    }
    .btn-row {
      display: flex;
      gap: 12px;
      margin-top: 24px;
    }
    .btn {
      flex: 1;
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-primary {
      background: #3b82f6;
      color: white;
    }
    .btn-primary:hover { background: #2563eb; }
    .btn-secondary {
      background: transparent;
      color: #94a3b8;
      border: 1px solid #334155;
    }
    .btn-secondary:hover {
      background: #334155;
      color: #e2e8f0;
    }
    .btn-skip {
      background: transparent;
      color: #64748b;
      border: none;
      font-size: 13px;
      text-decoration: underline;
      cursor: pointer;
      padding: 8px;
    }
    .progress {
      display: flex;
      gap: 8px;
      margin-bottom: 32px;
    }
    .progress-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #334155;
      transition: background 0.3s;
    }
    .progress-dot.active { background: #3b82f6; }
    .progress-dot.done { background: #22c55e; }
    .success-icon {
      font-size: 64px;
      text-align: center;
      margin-bottom: 16px;
    }
    .field-group { margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Step 0: Welcome -->
    <div class="step active" id="step-0">
      <div class="logo">📊</div>
      <h1>欢迎使用 StockTracker</h1>
      <p class="subtitle">
        本地优先的个人投资记录与 AI 投研工作台。<br>
        数据保存在本机，不需要账号，不上传云端。
      </p>
      <p class="subtitle" style="color: #64748b; font-size: 13px;">
        接下来我们会帮你配置 AI 服务，这一步可以跳过。<br>
        跳过后你仍然可以使用行情和交易记录功能。
      </p>
      <div class="btn-row">
        <button class="btn btn-primary" onclick="goToStep(1)">开始设置</button>
      </div>
      <div style="text-align: center; margin-top: 12px;">
        <button class="btn-skip" onclick="finish()">跳过，直接进入</button>
      </div>
    </div>

    <!-- Step 1: AI Provider -->
    <div class="step" id="step-1">
      <div class="progress">
        <div class="progress-dot active"></div>
        <div class="progress-dot"></div>
      </div>
      <h1>AI 服务配置</h1>
      <p class="subtitle">选择你的 AI 服务商，填入连接信息。</p>
      <div class="field-group">
        <label for="provider">服务商类型</label>
        <select id="provider" onchange="onProviderChange()">
          <option value="openai-compatible">OpenAI Compatible</option>
          <option value="anthropic-compatible">Anthropic Compatible</option>
        </select>
      </div>
      <div class="field-group">
        <label for="baseUrl">Base URL</label>
        <input type="text" id="baseUrl" placeholder="https://api.openai.com/v1">
        <p class="hint" id="baseUrlHint">OpenAI API 地址，或第三方兼容服务的地址</p>
      </div>
      <div class="field-group">
        <label for="apiKey">API Key</label>
        <input type="password" id="apiKey" placeholder="sk-...">
      </div>
      <div class="field-group">
        <label for="model">模型名称</label>
        <input type="text" id="model" placeholder="gpt-4o-mini">
      </div>
      <div class="btn-row">
        <button class="btn btn-secondary" onclick="goToStep(0)">返回</button>
        <button class="btn btn-primary" onclick="goToStep(2)">下一步</button>
      </div>
      <div style="text-align: center; margin-top: 12px;">
        <button class="btn-skip" onclick="finish()">跳过 AI 配置</button>
      </div>
    </div>

    <!-- Step 2: Done -->
    <div class="step" id="step-2">
      <div class="progress">
        <div class="progress-dot done"></div>
        <div class="progress-dot done"></div>
      </div>
      <div class="success-icon">✅</div>
      <h1>设置完成</h1>
      <p class="subtitle">
        配置已保存。StockTracker 正在启动，稍等片刻即可使用。
      </p>
      <div class="btn-row">
        <button class="btn btn-primary" onclick="finish()" style="flex: 1;">进入 StockTracker</button>
      </div>
    </div>
  </div>

  <script>
    let currentStep = 0;

    function goToStep(n) {
      document.getElementById('step-' + currentStep).classList.remove('active');
      document.getElementById('step-' + n).classList.add('active');
      currentStep = n;
    }

    function onProviderChange() {
      const provider = document.getElementById('provider').value;
      const hint = document.getElementById('baseUrlHint');
      const baseUrl = document.getElementById('baseUrl');
      if (provider === 'anthropic-compatible') {
        hint.textContent = 'Anthropic API 地址，或第三方兼容服务的地址';
        baseUrl.placeholder = 'https://api.anthropic.com';
      } else {
        hint.textContent = 'OpenAI API 地址，或第三方兼容服务的地址';
        baseUrl.placeholder = 'https://api.openai.com/v1';
      }
    }

    async function finish() {
      const provider = document.getElementById('provider')?.value || '';
      const baseUrl = document.getElementById('baseUrl')?.value?.trim() || '';
      const apiKey = document.getElementById('apiKey')?.value?.trim() || '';
      const model = document.getElementById('model')?.value?.trim() || '';

      if (provider && apiKey) {
        // Write config via IPC
        if (window.electronAPI) {
          await window.electronAPI.saveConfig({ provider, baseUrl, apiKey, model });
        }
      }

      if (window.electronAPI) {
        await window.electronAPI.finishOnboarding();
      }
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: 更新 preload 暴露 onboarding 相关 API**

更新 `electron/prelate.ts`，添加：

```typescript
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
```

- [ ] **Step 3: 提交**

```bash
git add electron/onboarding/ electron/preload.ts
git commit -m "feat(electron): add onboarding page and preload API"
```

---

### Task 5: 创建自动更新模块

**Files:**
- Create: `electron/updater.ts`

- [ ] **Step 1: 创建 `electron/updater.ts`**

```typescript
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
```

- [ ] **Step 2: 提交**

```bash
git add electron/updater.ts
git commit -m "feat(electron): add auto-updater"
```

---

### Task 6: 创建主进程

**Files:**
- Create: `electron/main.ts`

- [ ] **Step 1: 创建 `electron/main.ts`**

```typescript
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

function isFirstRun(): boolean {
  return !fs.existsSync(getConfigPath())
}

function writeEnvLocal(config: { provider: string; baseUrl: string; apiKey: string; model: string }): void {
  const lines = [
    `AI_PROVIDER=${config.provider}`,
    `AI_BASE_URL=${config.baseUrl}`,
    `AI_API_KEY=${config.apiKey}`,
    `AI_MODEL=${config.model}`,
  ]
  fs.writeFileSync(getConfigPath(), lines.join('\n') + '\n', 'utf-8')
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    title: 'StockTracker',
    titleBarStyle: 'hiddenInset', // macOS native feel
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false, // Don't show until ready
  })

  // Handle external links
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  return win
}

function showOnboarding(): Promise<void> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 600,
      height: 520,
      resizable: false,
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
      win.close()
      resolve()
    })

    win.on('closed', () => {
      resolve()
    })
  })
}

async function main(): Promise<void> {
  // macOS: keep app running when all windows closed
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

  // Graceful shutdown
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

  // Show onboarding if first run
  if (isFirstRun()) {
    await showOnboarding()
  }

  // Start Next.js server
  serverManager = createServerManager({
    userDataPath: getUserDataPath(),
  })

  mainWindow = createMainWindow()

  try {
    const { port } = await serverManager.start()
    await mainWindow.loadURL(`http://127.0.0.1:${port}`)
  } catch (error) {
    // Show error page if server fails to start
    const errorMessage = error instanceof Error ? error.message : String(error)
    await mainWindow.loadURL(`data:text/html,
      <html>
        <body style="font-family: -apple-system, sans-serif; padding: 40px; text-align: center; background: #0f172a; color: #e2e8f0;">
          <h1>启动失败</h1>
          <p>StockTracker 服务未能启动。</p>
          <pre style="background: #1e293b; padding: 16px; border-radius: 8px; text-align: left; color: #f87171;">${errorMessage}</pre>
          <p style="margin-top: 20px;">请尝试重启应用，或联系支持。</p>
        </body>
      </html>
    `)
  }

  mainWindow.show()
  mainWindow.focus()

  // Setup auto-updater (production only)
  if (!isDev) {
    setupAutoUpdater(mainWindow)
  }
}

main().catch((error) => {
  console.error('[electron] fatal:', error)
  app.quit()
})
```

- [ ] **Step 2: 验证 TypeScript 编译**

```bash
cd /Users/anything/Code/finance_sys
npx tsc --noEmit electron/main.ts --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck
```

Expected: 无错误（或仅有 electron 类型相关的 minor warnings）。

- [ ] **Step 3: 提交**

```bash
git add electron/main.ts
git commit -m "feat(electron): add main process"
```

---

### Task 7: 配置 electron-builder 和构建脚本

**Files:**
- Create: `electron-builder.yml`
- Modify: `package.json`

- [ ] **Step 1: 创建 `electron-builder.yml`**

```yaml
appId: com.stocktracker.app
productName: StockTracker
directories:
  output: dist-electron

files:
  - electron/**/*
  - .next/standalone/**/*
  - .next/static/**/*
  - app/icon.svg
  - skills/**/*
  - "!node_modules/**/{test,tests,__tests__}/**"
  - "!node_modules/**/*.{md,ts,map}"
  - "!**/*.{ts,map}"

extraResources:
  - from: ".env.example"
    to: ".env.example"

asar: true

mac:
  category: public.app-category.finance
  icon: build/icon.icns
  target:
    - target: dmg
      arch:
        - x64
        - arm64
  hardenedRuntime: false
  gatekeeperAssess: false

win:
  icon: build/icon.ico
  target:
    - target: nsis
      arch:
        - x64

nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: StockTracker

publish:
  provider: github
  owner: byte92
  repo: stocktracker
```

- [ ] **Step 2: 更新 `package.json` 添加 scripts 和 main 入口**

在 `package.json` 的 `scripts` 中添加：

```json
{
  "main": "electron/main.js",
  "scripts": {
    "electron:dev": "electron .",
    "electron:build": "pnpm build && electron-builder",
    "electron:build:mac": "pnpm build && electron-builder --mac",
    "electron:build:win": "pnpm build && electron-builder --win"
  }
}
```

注意：需要在 `package.json` 顶层添加 `"main": "electron/main.js"` 字段。

- [ ] **Step 3: 提交**

```bash
git add electron-builder.yml package.json
git commit -m "feat(electron): add electron-builder config and build scripts"
```

---

### Task 8: 生成应用图标

**Files:**
- Create: `build/icon.png`
- Create: `build/icon.icns`
- Create: `build/icon.ico`
- Create: `scripts/generate-icons.sh`

- [ ] **Step 1: 安装图标转换工具**

```bash
# macOS
brew install imagemagick
npm install -g png2icons
```

- [ ] **Step 2: 从 SVG 生成 PNG 基础图标**

```bash
mkdir -p build
# 使用 ImageMagick 将 SVG 转为 1024x1024 PNG
convert -background none -density 300 -resize 1024x1024 app/icon.svg build/icon.png
```

- [ ] **Step 3: 生成各平台图标格式**

```bash
# macOS .icns
# 使用 iconutil（macOS 自带）
mkdir -p build/icon.iconset
for size in 16 32 64 128 256 512; do
  sips -z $size $size build/icon.png --out build/icon.iconset/icon_${size}x${size}.png
  double=$((size * 2))
  sips -z $double $double build/icon.png --out build/icon.iconset/icon_${size}x${size}@2x.png
done
iconutil -c icns build/icon.iconset -o build/icon.icns
rm -rf build/icon.iconset

# Windows .ico
png2icons build/icon.png build/icon.ico -ico
```

- [ ] **Step 4: 创建图标生成脚本 `scripts/generate-icons.sh`**

```bash
#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SVG_PATH="$PROJECT_ROOT/app/icon.svg"
BUILD_DIR="$PROJECT_ROOT/build"

mkdir -p "$BUILD_DIR"

echo "Generating PNG from SVG..."
convert -background none -density 300 -resize 1024x1024 "$SVG_PATH" "$BUILD_DIR/icon.png"

echo "Generating macOS .icns..."
mkdir -p "$BUILD_DIR/icon.iconset"
for size in 16 32 64 128 256 512; do
  sips -z $size $size "$BUILD_DIR/icon.png" --out "$BUILD_DIR/icon.iconset/icon_${size}x${size}.png" > /dev/null
  double=$((size * 2))
  sips -z $double $double "$BUILD_DIR/icon.png" --out "$BUILD_DIR/icon.iconset/icon_${size}x${size}@2x.png" > /dev/null
done
iconutil -c icns "$BUILD_DIR/icon.iconset" -o "$BUILD_DIR/icon.icns"
rm -rf "$BUILD_DIR/icon.iconset"

echo "Generating Windows .ico..."
if command -v png2icons &> /dev/null; then
  png2icons "$BUILD_DIR/icon.png" "$BUILD_DIR/icon.ico" -ico
else
  echo "Warning: png2icons not found. Install with: npm install -g png2icons"
fi

echo "Icons generated in $BUILD_DIR/"
ls -la "$BUILD_DIR/"
```

- [ ] **Step 5: 提交**

```bash
chmod +x scripts/generate-icons.sh
git add build/ scripts/generate-icons.sh
git commit -m "feat(electron): add app icons for macOS and Windows"
```

---

### Task 9: 端到端验证

- [ ] **Step 1: 构建 Next.js standalone**

```bash
cd /Users/anything/Code/finance_sys
pnpm build
```

Expected: 构建成功，`.next/standalone/server.js` 存在。

- [ ] **Step 2: 以开发模式启动 Electron**

```bash
pnpm electron:dev
```

Expected:
1. 如果没有 `.env.local`，展示引导页
2. 填写配置后进入主界面
3. 主界面加载 StockTracker 页面

- [ ] **Step 3: 验证数据目录**

检查 `~/Library/Application Support/StockTracker/` 下是否有：
- `finance.sqlite`
- `.env.local`（如果完成了引导）

```bash
ls -la ~/Library/Application\ Support/StockTracker/
```

- [ ] **Step 4: 验证非首次启动**

关闭应用后重新打开，应直接进入主界面，不再展示引导。

```bash
pnpm electron:dev
```

- [ ] **Step 5: 验证跳过引导**

删除 `.env.local`，重新打开，点击"跳过"进入主界面。

```bash
rm ~/Library/Application\ Support/StockTracker/.env.local
pnpm electron:dev
```

- [ ] **Step 6: 构建 macOS 安装包**

```bash
pnpm electron:build:mac
```

Expected: `dist-electron/` 下生成 `.dmg` 文件。

- [ ] **Step 7: 安装并测试 .dmg**

双击 `.dmg`，拖拽到 Applications，打开应用验证完整流程。

- [ ] **Step 8: 提交最终状态**

```bash
git add -A
git commit -m "feat(electron): complete Electron desktop client setup"
```

---

## 注意事项

### 与现有代码的兼容性

- `electron/server.ts` 中使用 `process.resourcesPath` 判断打包环境，开发模式使用 `process.cwd()`
- `FINANCE_SQLITE_PATH` 环境变量指向用户数据目录，不影响现有 Docker 部署
- `next.config.ts` 不需要修改，`output: 'standalone'` 已经满足需求

### 后续扩展

- Windows 构建需要在 Windows 或 CI 环境中执行
- 代码签名（macOS 公证、Windows 签名）需要开发者账号，可后续添加
- 自动更新需要 GitHub Releases 发布新版本后才能触发
