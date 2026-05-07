# 开发指南

本文档记录 StockTracker 的本地开发、环境变量、数据库和验证流程。面向项目维护者和贡献者。

## 环境要求

- Node.js 18+
- pnpm
- macOS / Linux / Windows

首次拉取项目后请使用 pnpm 安装依赖，确保 lockfile 与依赖树保持一致：

```bash
pnpm install
```

## 常用命令

```bash
# 启动开发环境
pnpm dev

# 运行默认测试
pnpm test

# 真实外部接口 smoke test
pnpm test:external

# 生产构建
pnpm build

# 生产启动
pnpm start
```

开发服务器启动后访问：

- [http://localhost:3218](http://localhost:3218)

`pnpm dev` 默认从 `PORT` 环境变量读取端口；未设置时使用 `3218`。如果目标端口已被占用，脚本会自动向后查找可用端口，并在终端输出实际地址。

## 本地数据库

项目默认使用本地 SQLite 存储交易记录、配置、AI 历史和 Agent 调试记录。

默认数据库文件路径：

```bash
data/finance.sqlite
```

应用第一次启动并访问存储接口时，会自动创建数据库目录、SQLite 文件和必要的数据表，不需要手动执行建表脚本。

相关代码：

- `lib/sqlite/db.ts`
- `app/api/storage/route.ts`

可以通过环境变量自定义数据库路径：

```bash
FINANCE_SQLITE_PATH=/absolute/path/to/finance.sqlite
```

例如：

```bash
FINANCE_SQLITE_PATH=./data/dev-finance.sqlite pnpm dev
```

## AI 模型配置

推荐把模型连接信息放在 `.env.local`，避免 API Key 写入 SQLite 配置或 JSON 备份。

```bash
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://api.openai.com/v1
AI_MODEL=gpt-4.1-mini
AI_API_KEY=sk-...
```

如果这些环境变量配置完整，服务端会优先使用 `.env.local` 中的 Provider、Base URL、Model 和 API Key。设置页中的连接配置会作为本地兜底；Temperature、Max Context Tokens、新闻增强和分析语言仍由设置页控制。

AI 分析提示词由 Skill 固定维护，不再从设置页编辑。

## 国际化

应用 UI 已接入轻量 i18n 层，当前支持：

- `zh-CN`
- `en-US`

相关代码：

- `lib/i18n/index.tsx`
- `lib/i18n/messages.ts`
- `components/i18n/LanguageSwitcher.tsx`

语言切换入口位于侧边栏底部。选择结果保存在浏览器 `localStorage`，并同步更新 `<html lang>`。当前翻译表使用中文源文案作为过渡 key，新增用户可见文案时请同步补充英文翻译；后续如继续扩大语言范围，建议逐步迁移到语义 key。

AI 分析输出语言由设置页中的“分析语言”控制，和 UI 语言切换相互独立。

## 环境变量说明

| 变量 | 必填 | 示例 | 说明 |
| --- | --- | --- | --- |
| `AI_PROVIDER` | 是 | `openai-compatible` | AI provider 类型。可选 `openai-compatible` 或 `anthropic-compatible`。 |
| `AI_BASE_URL` | 是 | `https://api.openai.com/v1` | AI 服务地址。OpenAI 兼容接口通常以 `/v1` 结尾；本地或第三方兼容网关也可以填写自己的地址。 |
| `AI_MODEL` | 是 | `gpt-4.1-mini` | 模型名称，由服务商决定，例如 `gpt-4.1-mini`、`deepseek-chat`、`qwen-plus`。 |
| `AI_API_KEY` | 是 | `sk-...` | AI 服务密钥。只在服务端读取，不会发送到浏览器；真实值建议只放 `.env.local`。 |
| `AGENT_SKILL_PATHS` | 否 | `/path/a:/path/b` | 额外 Agent Skill manifest 目录。系统默认读取 `skills/custom`；该变量可追加外部目录。 |
| `AGENT_PLANNER_REASONING_EFFORT` | 否 | `none` | Agent Planner 的 OpenAI 兼容 `reasoning_effort`。可选 `none`、`minimal`、`low`、`medium`、`high`；未设置时默认 `none`，用于关闭 Planner 阶段的思考开销。 |
| `ALPHA_VANTAGE_API_KEY` | 否 | `YOUR_API_KEY_HERE` | Alpha Vantage 行情备用源密钥，服务端读取。 |
| `NEXT_PUBLIC_ALPHA_VANTAGE_API_KEY` | 否 | `YOUR_API_KEY_HERE` | 兼容旧配置，不推荐。`NEXT_PUBLIC_` 变量会暴露到前端。 |
| `FINANCE_SQLITE_PATH` | 否 | `./data/dev-finance.sqlite` | 自定义 SQLite 数据库文件路径。未设置时默认使用 `data/finance.sqlite`。 |
| `APP_LOG_LEVEL` | 否 | `debug` | 服务端日志级别。可选 `debug`、`info`、`warn`、`error`、`silent`；开发默认 `debug`，生产默认 `info`。 |
| `APP_LOG_COLOR` | 否 | `auto` | 服务端日志 ANSI 颜色。可选 `auto`、`always`、`never`，也支持 `true`/`false`；默认仅在开发环境中着色。 |
| `PORT` | 否 | `3218` | Next.js 服务监听端口。本地开发未设置时默认 `3218`，占用时自动递增；Docker 容器内固定使用 `3218`。 |

建议把项目业务配置放在 `.env.local`。Docker 编排配置单独放在 `docker/.env`，例如宿主机端口 `HOST_PORT`；容器运行时会由 Compose 可选读取根目录 `.env.local` 并注入业务环境变量。

## 数据迁移与备份

如果浏览器里还有历史 `localStorage` 数据，而 SQLite 里还没有内容，应用会自动把旧数据迁移到 SQLite。

建议长期使用时：

- 定期导出 JSON 备份。
- 在升级、迁移设备或清理数据前备份 SQLite 文件。
- 不要把真实 `data/*.sqlite` 文件提交到仓库。

## 行情与估值数据

当前报价链路由 `StockPriceService` 聚合多个数据源：

- Tencent Finance
- Nasdaq
- Yahoo Finance
- Stooq
- Binance / Coinbase（加密资产）
- Alpha Vantage
- Manual fallback

外部 API 统一入口和测试说明见 [数据接口清单](./DATA_API_INVENTORY.md)。

## 服务端日志

项目提供轻量结构化日志：

- `lib/observability/logger.ts`：日志级别、序列化和输出。
- `lib/observability/api.ts`：API Route 请求耗时、状态码和异常日志。
- `lib/observability/fetch.ts`：第三方 API 调用耗时、状态码和失败日志。

开发终端中日志会按级别着色：`debug` 灰色、`info` 青色、`warn` 黄色、`error` 红色。生产环境和 `APP_LOG_COLOR=never` 会保持纯 JSON，便于 Docker 或日志采集系统解析。

开发排查外部 API、AI Provider 或 SQLite 问题时，可临时设置：

```bash
APP_LOG_LEVEL=debug pnpm dev
```

日志中不要输出 API Key、完整持仓数据或用户隐私内容。

## 手续费与收益计算

当前收益模型：

- 已实现收益：固定基于 FIFO 计算，不提供其它卖出成本匹配口径。
- 浮动盈亏：基于当前持仓与实时价格。
- 总收益：已实现收益 + 浮动盈亏。

当前手续费逻辑：

- 普通 A 股股票：佣金 + 过户费；卖出再加印花税。
- A 股 ETF：默认不收印花税，自动手续费逻辑已单独处理。
- 港股：佣金 + 印花税 + 结算费。
- 美股、基金、加密资产：使用对应市场配置；加密资产支持小数数量和交易所费率。

敏感文件：

- `config/defaults.ts`
- `lib/finance.ts`
- `tests/finance.test.ts`

如果修改财务计算逻辑，请务必补充或更新测试，并进行人工复核。

## 测试策略

默认测试不依赖真实外部网络：

```bash
pnpm test
```

外部接口 smoke test 会真实请求行情、K 线、新闻和汇率接口，适合发布前或排查数据源问题时运行：

```bash
pnpm test:external
```

Alpha Vantage 测试需要配置 `ALPHA_VANTAGE_API_KEY`，否则会跳过。

## 目录维护

目录边界和清理规则见 [项目目录结构说明](./PROJECT_STRUCTURE.md)。

原则：

- 不保留空目录。
- 不提交本地调试产物。
- 不保留一次性接口调试脚本。
- 外部 API 请求优先放入 `lib/external` 或 `lib/dataSources`。
