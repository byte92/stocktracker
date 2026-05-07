# StockTracker

[![中文](https://img.shields.io/badge/README-%E4%B8%AD%E6%96%87-blue)](./README.md)
[![English](https://img.shields.io/badge/README-English-lightgrey)](./README_en.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
![Node.js](https://img.shields.io/badge/node-18%2B-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220?logo=pnpm&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)

StockTracker 是一个本地优先的个人投资记录、组合核算和 AI 投研工作台。

它帮助你记录交易、核算真实持仓成本、跟踪行情和收益，并让 AI Agent 基于你的真实持仓、交易记录和公开市场数据做克制的投研分析。数据默认保存在本机 SQLite，不需要账号，不默认上传到云端。

[快速开始](#快速开始) · [Docker 运行](#docker-运行) · [核心能力](#核心能力) · [AI Agent](#ai-agent) · [文档](#文档) · [免责声明](#免责声明)

## 截图与演示

> 以下截图使用脱敏 demo 数据生成，不包含真实持仓或交易记录。

| 组合总览 | 持仓列表 |
| --- | --- |
| ![组合总览](./docs/assets/screenshots/readme-overview.png) | ![持仓列表](./docs/assets/screenshots/readme-portfolio.png) |

| 个股详情 | AI 对话 |
| --- | --- |
| ![个股详情](./docs/assets/screenshots/readme-stock-detail.png) | ![AI 对话](./docs/assets/screenshots/readme-ai-chat.png) |

| AI 分析历史 |
| --- |
| ![AI 分析历史](./docs/assets/screenshots/readme-ai-history.png) |

## 为什么做它 💡

很多投资工具擅长展示价格，却不擅长回答这些真正贴近个人决策的问题：

- 我这只股票真实成本是多少？
- 分红、手续费、卖出批次之后，收益到底怎么算？
- 今天是休市日时，今日盈亏是否还应该变化？
- 当前组合最大的风险来自哪里？
- 哪些持仓正在拖累收益，哪些持仓值得继续观察？
- 我能不能让 AI 基于自己的真实交易记录，而不是泛泛而谈地分析？

StockTracker 的目标是把交易记录、收益计算、行情数据和 AI 分析收在一个可解释、可审计、可自部署的本地工作台里。

## 适合与不适合 🎯

StockTracker 适合：

- 想自己记录股票、ETF、基金或加密资产交易的个人投资者。
- 关心 FIFO、手续费、分红和真实成本核算的人。
- 希望数据默认留在本机，并能自行备份和迁移的人。
- 想把 AI 用在自己的持仓和交易复盘上，而不是泛泛聊天的人。
- 愿意 self-host，并接受第三方行情接口偶尔波动的人。

StockTracker 不适合：

- 高频交易、自动下单或券商账户同步。
- 多用户云端协作、跨设备实时同步或团队后台。
- 对行情实时性和准确性有严格合规要求的生产交易终端。
- 想获得确定性投资建议、收益承诺或自动买卖指令的场景。

## 核心能力 ✨

### 组合与收益核算 📊

- 本地 SQLite 持久化，默认不依赖云端账号。
- 支持 A 股（含 ETF）、港股、美股、基金、加密资产的统一记录模型。
- 支持买入、卖出、分红和加密资产收益记录。
- 基于 FIFO 计算卖出盈亏明细，并按券商摊薄口径计算当前持仓成本、浮动盈亏和总盈亏。
- 按市场自动计算手续费，支持用户配置费率。
- 今日盈亏只统计有效交易日行情，休市或旧行情不会被误算成今日变化。

### 行情、估值与图表 📈

- 聚合腾讯财经、Nasdaq、Yahoo Finance、Stooq、Alpha Vantage 等股票行情源。
- 加密资产报价和 K 线优先使用 Binance，失败回退 Coinbase。
- 支持 K 线、技术指标、估值字段、新闻和大盘概览。
- 内置汇率服务，支持多币种持仓统一折算。
- 多数据源自动降级，最终兜底到 Manual 手动输入模式。

### AI 投研工作流 🤖

- 内置 AI 对话、组合分析、个股分析、大盘分析和分析历史。
- AI Agent Runtime 按需调用 Skill，不把全部持仓粗暴塞进上下文。
- 支持未持仓标的查询，自动解析名称、代码和市场并抓取外部行情。
- 支持公开网页搜索和受控网页抓取，用于新闻、公告、财报和大盘事件补充。
- 提供受控的 AI Agent Trace 调试视图，方便排查意图识别和 Skill 调用链路。

### 自部署与工程化 🧰

- 使用 pnpm，项目会阻止 npm/yarn 安装以保持 lockfile 一致。
- 支持 Docker / Docker Compose 本地运行。
- 支持中文 / 英文 UI 切换，语言偏好保存在浏览器本地。
- 支持 OpenAI-compatible 和 Anthropic-compatible 模型服务。
- 提供服务端结构化日志和外部接口 smoke test，便于排查上游接口变化。

## 快速开始 🚀

环境要求：

- Node.js 18+
- pnpm
- macOS / Linux / Windows

```bash
git clone https://github.com/byte92/finance_sys.git
cd finance_sys
pnpm install
pnpm dev
```

启动后访问：

- [http://localhost:3218](http://localhost:3218)

`pnpm dev` 默认使用 `3218`，如果端口被占用会自动向后查找可用端口，并在终端输出实际地址。建议启动后先完成 AI 模型配置，以启用对话、组合分析、标的分析和大盘分析等核心体验。

更多开发、环境变量、数据库和测试说明见 [开发指南](./docs/DEVELOPMENT.md)。

## AI 模型配置 🔑

StockTracker 的核心体验依赖 AI 对话和分析能力，建议把模型连接信息放在 `.env.local`：

```bash
cp .env.example .env.local
```

常用变量：

```bash
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4.1-mini
AI_API_KEY=sk-...
```

如果 `.env.local` 中的 AI 配置完整，服务端会优先使用环境变量；设置页中的连接配置会作为本地兜底。Temperature、Max Context Tokens、新闻增强和 AI 分析语言仍由设置页控制。

## Docker 运行 🐳

如果你只想把它作为本地服务跑起来，可以直接使用 Docker Compose：

```bash
git clone https://github.com/byte92/finance_sys.git
cd finance_sys/docker
docker compose up -d --build
```

启动后访问：

- [http://localhost:3218](http://localhost:3218)

如需修改宿主机端口，可把 `docker/.env.example` 复制为 `docker/.env` 并修改 `HOST_PORT`。AI 模型配置仍放在根目录 `.env.local`；Docker Compose 会读取 `.env.local` 并注入容器。没有 `docker/.env` 时端口默认使用 `3218`。

容器默认把 SQLite 数据保存在 `docker/data/finance.sqlite` 中，重启不会丢失。更多说明见 [Docker 部署指南](./docker/README.md)。

## 本地优先与隐私边界 🔒

StockTracker 默认把交易、配置、AI 历史和 Agent Trace 保存在本机 SQLite 文件中：

```text
data/finance.sqlite
```

项目当前不提供云端账号体系，不默认上传你的交易记录。AI API Key 推荐放在 `.env.local`，服务端读取，不写入 JSON 备份。

需要注意：

- 如果你更换机器，数据不会自动同步。
- 如果你删除本地数据库，项目无法从云端恢复。
- 建议定期使用 JSON 导出功能进行备份。
- AI 分析会把必要的持仓上下文发送给你配置的模型服务商。

## AI Agent 🤖

StockTracker 的 AI 不是通用聊天机器人，而是围绕个人持仓和股票数据工作的投研 Agent。

```text
用户问题
  -> Planner 识别意图、市场和需要的数据
  -> security.resolve 解析名称、代码和候选标的
  -> Skill Registry 选择本地持仓、行情、技术指标、网页搜索等能力
  -> Executor 按需读取数据
  -> Context Composer 组装最小必要上下文
  -> LLM 流式生成回复
```

当用户询问个股新闻、公告、利好利空，或 A 股大盘今日政策、盘面新闻时，Agent 会按需调用公开网页搜索。搜索结果会作为带标题、链接、摘要和搜索时间的候选来源进入回答上下文。

应用 UI 语言可在侧边栏底部切换；AI 分析输出语言仍由设置页中的“分析语言”控制，两者相互独立。

## 技术栈 🧱

- Next.js App Router + React + TypeScript
- Zustand
- SQLite + better-sqlite3
- Tailwind CSS
- lightweight-charts / Recharts
- Playwright
- pnpm
- Docker / Docker Compose

## 整体架构 🧭

```mermaid
flowchart TB
  User["用户 / 浏览器"] --> App["Next.js App Router"]
  App --> Store["Zustand 状态层"]
  App --> Api["API Routes"]

  Store --> Api
  Api --> SQLite["SQLite 本地数据库"]
  Api --> Finance["收益 / 手续费 / FIFO 计算"]
  Api --> DataSources["行情、K 线、新闻、汇率数据源"]

  App --> AgentUI["AI 对话与分析界面"]
  AgentUI --> Agent["AI Agent Runtime"]
  Agent --> Planner["Planner 意图识别"]
  Agent --> Skills["Skill Registry"]
  Skills --> SQLite
  Skills --> DataSources
  Agent --> LLM["OpenAI / Anthropic 兼容模型服务"]

  Docker["Docker / Docker Compose"] --> App
  Docker --> SQLite
```

## 项目结构

```text
app/          Next.js App Router 页面和 API Route
components/   React 组件和业务 UI
config/       默认配置
docs/         架构、接口和维护文档
hooks/        React hooks
lib/          领域逻辑、数据源、AI/Agent、SQLite、i18n、日志
skills/       Agent Skill Markdown 描述
store/        Zustand 状态管理
tests/        单元测试和外部接口 smoke test
types/        共享类型
docker/       Dockerfile、Compose 和部署说明
```

详细边界见 [项目目录结构说明](./docs/PROJECT_STRUCTURE.md)。

## 文档 📚

- [开发指南](./docs/DEVELOPMENT.md)
- [Docker 部署指南](./docker/README.md)
- [项目目录结构](./docs/PROJECT_STRUCTURE.md)
- [国际化说明](./docs/I18N.md)
- [数据接口清单](./docs/DATA_API_INVENTORY.md)
- [Agent 架构设计](./docs/AGENT_ARCHITECTURE.md)
- [Skill 标准](./docs/SKILL_STANDARD.md)
- [AI 对话需求](./docs/AI_CHAT_REQUIREMENTS.md)
- [行情获取说明](./docs/PRICE_FETCHING.md)
- [开源发布检查清单](./docs/OPEN_SOURCE_CHECKLIST.md)

## 参与贡献 🤝

欢迎提交 Issue、改进文档、补充测试、优化 UI、修复行情源、扩展 Skill 或完善 Agent Runtime。

在提交 PR 前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

常用验证命令：

```bash
pnpm test
pnpm build
```

真实外部接口检查：

```bash
pnpm test:external
```

## 路线方向 🗺️

- 更清晰的 Agent Skill 插件化加载机制。
- 更强的组合风险归因和交易复盘能力。
- 更完整的行情源健康检查与数据源治理。
- 更稳健的 AI Trace、上下文管理和诊断导出。
- Docker Hub 镜像发布与更顺滑的一键部署体验。
- 更完善的开源协作规范、截图、演示和示例数据。

## 免责声明 ⚠️

StockTracker 提供的是交易记录、数据整理和辅助分析工具，不构成任何投资建议。行情、估值、新闻和 AI 输出可能存在延迟、遗漏或错误。请独立判断风险，并对自己的投资决策负责。

## License

[MIT](./LICENSE)
