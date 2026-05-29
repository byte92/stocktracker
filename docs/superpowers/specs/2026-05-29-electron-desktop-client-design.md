# StockTracker Electron 桌面客户端设计

> 日期：2026-05-29
> 状态：已批准

## 背景与目标

StockTracker 当前是一个 Next.js Web 应用，需要 Node.js + pnpm 环境才能运行。对普通用户来说门槛较高。

**目标**：将 StockTracker 打包为 macOS / Windows 桌面客户端，用户下载安装后双击即用，不需要命令行、Docker 或任何技术背景。

**约束**：
- 现有 Docker 部署方式和 Web 访问方式保持不变
- Next.js 核心代码零改动
- 支持 macOS (.dmg) 和 Windows (.exe)

## 架构设计

### 整体架构

```
StockTracker.app / StockTracker.exe
├── Electron Main Process
│   ├── 启动 Next.js standalone server（子进程）
│   ├── 管理应用生命周期
│   └── 自动更新
├── BrowserWindow
│   └── 加载 http://localhost:{port}
└── 用户数据目录
    ├── finance.sqlite
    └── .env.local（AI 配置）
```

核心思路：Electron 只做"壳 + 启动器"，不修改现有 Next.js 代码。Next.js standalone server 作为子进程在后台运行，BrowserWindow 通过 localhost 访问。

### 与 Docker 部署的关系

两种部署方式共享同一份 Next.js 代码，只是启动器不同：

| | Docker（Web 服务） | Electron（桌面客户端） |
|---|---|---|
| 代码 | 同一份 Next.js | 同一份 Next.js |
| 构建 | `pnpm build` → standalone | `pnpm build` → standalone → 打包进 Electron |
| 运行 | Docker 容器内 `node server.js` | Electron 子进程 `node server.js` |
| 数据目录 | Docker volume `/app/data/` | 用户系统目录 |
| 访问方式 | 浏览器 `localhost:3218` | Electron 内嵌窗口 |
| AI 配置 | `.env.local` 手动配置 | 首次引导 + `.env.local` |

两者互不干扰，现有 Docker、开发流程、测试全部不受影响。

## 目录结构

在项目根目录新增 `electron/` 目录：

```
finance_sys/
├── electron/                      # 新增：Electron 主进程
│   ├── main.ts                    # 主进程入口
│   ├── preload.ts                 # 预加载脚本
│   ├── server.ts                  # Next.js 服务管理
│   ├── updater.ts                 # 自动更新
│   └── onboarding/
│       └── index.html             # 首次引导页面
├── scripts/
│   └── electron-build.cjs         # 打包脚本
├── electron-builder.yml           # electron-builder 配置
├── package.json                   # 新增 electron 相关依赖和脚本
├── docker/                        # 不变
├── app/                           # 不变
├── lib/                           # 不变
└── components/                    # 不变
```

## 模块设计

### 1. Next.js Server 管理 (`electron/server.ts`)

负责启动和管理 Next.js standalone server 子进程。

**职责**：
- 用 `child_process.spawn` 运行 `node server.js`（standalone 产物）
- 复用现有的端口查找逻辑，默认 3218
- 自动注入环境变量：
  - `FINANCE_SQLITE_PATH` → 用户数据目录下的 `finance.sqlite`
  - `HOSTNAME=127.0.0.1`
  - `NODE_ENV=production`
- 轮询 `http://localhost:{port}` 健康检查，就绪后再加载 BrowserWindow
- 主进程退出时 kill 子进程

**接口**：
```typescript
interface ServerManager {
  start(): Promise<{ port: number }>
  stop(): Promise<void>
  isReady(): boolean
}
```

### 2. 主进程 (`electron/main.ts`)

Electron 应用入口。

**职责**：
- 创建 BrowserWindow（1280x800 默认尺寸）
- 检测是否首次运行，决定展示引导页还是主界面
- 调用 ServerManager 启动 Next.js
- 服务就绪后加载 `http://localhost:{port}`
- 处理应用生命周期（窗口关闭、全部退出等）
- 注册应用菜单（macOS 菜单栏、Windows 菜单）

**窗口配置**：
- 默认尺寸：1280x800
- 最小尺寸：1024x768
- 标题：StockTracker
- 图标：使用现有 `app/icon.svg` 转换的 `.icns` / `.ico`

### 3. 首次引导 (`electron/onboarding/`)

用户首次打开应用时展示配置向导。

**触发条件**：用户数据目录下不存在 `.env.local`

**引导内容**：
1. 欢迎页 — 简介 StockTracker
2. AI 服务配置 — 选择服务商、填入 URL 和 Key、选择模型
3. 可选配置 — Alpha Vantage API Key（行情增强）
4. 完成 — 写入 `.env.local`，启动服务

**跳过**：每一步都可以跳过，跳过后进入主界面（AI 功能不可用，但行情和交易记录正常）

**技术实现**：
- 纯 HTML + CSS + JS，不依赖 Next.js（因为服务还没启动）
- 写入 `.env.local` 到用户数据目录

### 4. 用户数据目录

| 平台 | 路径 |
|---|---|
| macOS | `~/Library/Application Support/StockTracker/` |
| Windows | `%APPDATA%/StockTracker/` |

使用 Electron 的 `app.getPath('userData')` 获取，自动适配平台。

存放内容：
- `finance.sqlite` — 数据库
- `.env.local` — AI 配置
- `skills/custom/` — 自定义技能（预留）

### 5. 自动更新 (`electron/updater.ts`)

使用 `electron-updater` 集成 GitHub Releases 自动更新。

**行为**：
- 应用启动后后台检查更新
- 发现新版本时通知用户
- 用户确认后下载并安装
- 支持静默更新（可选）

## 打包与分发

### 构建流程

1. `pnpm build` — 构建 Next.js standalone 产物（`.next/standalone/`）
2. `electron-builder` — 打包 Electron 应用

### 打包配置 (`electron-builder.yml`)

```yaml
appId: com.stocktracker.app
productName: StockTracker
directories:
  output: dist-electron
files:
  - electron/
  - .next/standalone/
  - .next/static/
  - app/icon.svg
  - skills/
  - node_modules/
extraResources:
  - from: .env.example
    to: .env.example
mac:
  category: Finance
  icon: build/icon.icns
  target: dmg
win:
  icon: build/icon.ico
  target: nsis
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```

### 发布格式

| 平台 | 格式 | 说明 |
|---|---|---|
| macOS | `.dmg` | 拖拽安装到 Applications |
| Windows | `.exe` (NSIS) | 安装向导，可选安装目录 |

### 构建脚本 (`scripts/electron-build.cjs`)

在 `package.json` 中新增脚本：
```json
{
  "scripts": {
    "electron:dev": "electron .",
    "electron:build": "pnpm build && electron-builder",
    "electron:build:mac": "pnpm build && electron-builder --mac",
    "electron:build:win": "pnpm build && electron-builder --win"
  }
}
```

## 依赖

### 新增 npm 依赖

| 包 | 用途 |
|---|---|
| `electron` | 桌面应用框架 |
| `electron-builder` | 打包工具 |
| `electron-updater` | 自动更新 |
| `electron-is-dev` | 判断开发/生产环境 |

### 新增 dev 依赖

| 包 | 用途 |
|---|---|
| `@electron-forge/publisher-github` | GitHub Releases 发布 |

## 对现有代码的影响

**零改动**。所有新增内容都在 `electron/` 目录和 `package.json` 中。现有的：

- Next.js 应用代码（`app/`, `lib/`, `components/`）
- Docker 部署（`docker/`）
- 开发流程（`pnpm dev`）
- 测试（`pnpm test`）
- 构建（`pnpm build`）

全部保持不变。

## 测试策略

1. **开发模式**：`electron:dev` 启动，验证窗口加载、服务启动、引导流程
2. **打包测试**：本地构建 .dmg / .exe，安装后验证完整流程
3. **首次运行**：删除用户数据目录，验证引导页展示
4. **非首次运行**：已有 `.env.local`，直接进入主界面
5. **服务异常**：Next.js 启动失败时展示错误提示
6. **自动更新**：发布测试版本，验证更新流程
