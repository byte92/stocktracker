# 数据接口清单与拆分边界

本文档记录 StockTracker 当前使用的数据接口，以及代码中的统一入口。

## 外部数据接口

| 类型 | 服务 | URL / 域名 | 当前统一入口 | 用途 |
| --- | --- | --- | --- | --- |
| 实时报价 | 腾讯财经 | `https://qt.gtimg.cn` | `lib/dataSources/TencentFinanceSource.ts` | A 股、港股、基金、美股兜底报价、估值字段。 |
| 实时报价 | Nasdaq | `https://api.nasdaq.com/api/quote` | `lib/dataSources/NasdaqSource.ts` | 美股报价。 |
| 实时报价 | Yahoo Finance | `https://query1.finance.yahoo.com` / `https://query2.finance.yahoo.com` | `lib/dataSources/YahooFinanceSource.ts` | 美股报价兜底。 |
| 实时报价 | Stooq | `https://stooq.com/q/l/` | `lib/dataSources/StooqSource.ts` | 美股报价兜底。 |
| 实时报价 | Alpha Vantage | `https://www.alphavantage.co/query` | `lib/dataSources/AlphaVantageSource.ts` | 报价兜底，需要 `ALPHA_VANTAGE_API_KEY`。 |
| 实时报价 | Binance / Coinbase | `https://api.binance.com` / `https://api.coinbase.com` | `lib/dataSources/CryptoSource.ts` | 加密资产现货报价，优先 USDT，失败回退 USD。 |
| K 线 | 腾讯财经 | `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get` | `lib/external/kline.ts` | A 股、港股、基金日 K。 |
| 分钟 K 线 | 腾讯财经 | `https://ifzq.gtimg.cn/appstock/app/kline/mkline` | `lib/external/kline.ts` | A 股、港股、基金分钟 K。 |
| K 线 | Nasdaq | `https://api.nasdaq.com/api/quote/{symbol}/historical` | `lib/external/kline.ts` | 美股日 K。 |
| K 线 | Stooq | `https://stooq.com/q/d/l/` | `lib/external/kline.ts` | 美股日 K 兜底。 |
| K 线 | Alpha Vantage | `https://www.alphavantage.co/query` | `lib/external/kline.ts` | K 线兜底，需要 `ALPHA_VANTAGE_API_KEY`。 |
| K 线 | Binance / Coinbase | `https://api.binance.com` / `https://api.coinbase.com` | `lib/external/kline.ts` | 加密资产 K 线，优先 Binance，失败回退 Coinbase。 |
| 大盘指数 | 腾讯财经 | `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get` | `lib/external/marketIndices.ts` | A 股、港股、美股代表指数快照和技术指标。 |
| 新闻 | Google News RSS | `https://news.google.com/rss/search` | `lib/external/news.ts` | 个股、大盘相关新闻摘要。 |
| 汇率 | ExchangeRate API | `https://api.exchangerate-api.com/v4/latest/USD` | `lib/ExchangeRateService.ts` | 组合多币种折算。 |
| LLM | OpenAI Compatible | `{AI_BASE_URL}/chat/completions` | `lib/external/llmProvider.ts` | AI 对话流式回复、结构化分析。 |
| LLM | Anthropic Compatible | `{AI_BASE_URL}/messages` | `lib/external/llmProvider.ts` | AI 对话流式回复、结构化分析。 |

## 外部接口有效性测试

项目提供了 `tests/external-apis.test.ts`，用于真实请求外部数据接口并校验响应结构。为了避免普通单测被网络、上游限流或地区访问策略影响，默认 `pnpm test` 会跳过这组测试。

需要验证接口是否可用时，执行：

```bash
pnpm test:external
```

这组测试会覆盖腾讯财经报价、Nasdaq 报价、Yahoo Finance 报价、Stooq 报价、腾讯 K 线、美股 K 线、腾讯指数、Google News RSS 和汇率接口。Alpha Vantage 报价测试需要配置 `ALPHA_VANTAGE_API_KEY` 或 `NEXT_PUBLIC_ALPHA_VANTAGE_API_KEY`。

## 内部 API Route

| Route | 调用方 | 说明 |
| --- | --- | --- |
| `GET /api/stock/quote` | 添加股票、持仓列表、组合概览 | 统一通过 `StockPriceService` 获取当前报价。 |
| `GET /api/stock/kline` | K 线图组件 | 统一通过 `lib/external/kline.ts` 获取 K 线。 |
| `GET /api/market/overview` | 大盘页面 | 通过 `lib/marketOverview.ts` 聚合指数快照和新闻。 |
| `POST /api/ai/chat` | AI 对话面板 | 通过 Agent Runtime + `lib/external/llmProvider.ts` 生成流式回复。 |
| `GET/POST/PATCH/DELETE /api/ai/chat/sessions` | AI 对话面板 | AI 会话持久化。 |
| `GET/DELETE /api/ai/chat/messages` | AI 对话面板 | AI 消息读取和清理。 |
| `GET /api/ai/chat/runs` | AI Debug | Agent run 调试记录。 |
| `GET /api/ai/chat/debug` | AI Trace | 通过对话 ID、消息 ID 或 Run ID 查询完整调用链路。 |
| `POST /api/ai/portfolio-analysis` | AI Tab / 组合卡片 | 固定组合分析 Task。 |
| `POST /api/ai/stock-analysis` | 个股页分析卡片 | 固定个股分析 Task。 |
| `POST /api/ai/market-analysis` | 大盘分析卡片 | 固定大盘分析 Task。 |
| `GET/DELETE /api/ai/history` | AI 分析卡片 | 读取和清理持久化分析结果，用于恢复最近一次组合、个股和大盘分析。 |
| `GET /api/ai/config/status` | 设置页、AI 对话 | 检查 `.env.local` AI 配置状态。 |
| `POST /api/ai/test` | 设置页 | 测试 AI 连接。 |
| `GET/PUT /api/storage` | Zustand store | 本地 SQLite 数据读写。 |

## 本次拆分后的边界

- `lib/dataSources/*`：只负责“当前报价”数据源适配。
- `lib/external/*`：只负责外部接口调用和原始响应归一化，例如 K 线、新闻、指数、LLM。
- `lib/observability/fetch.ts`：为第三方 API 调用提供统一日志埋点；外部 fetch 新增时应优先使用该封装。
- `lib/marketOverview.ts`：只负责大盘业务聚合、分析上下文和结果兜底，不再直接拼外部接口 URL。
- `lib/agent/skills/*`：只负责编排领域数据，不直接请求外部 URL。
- `app/api/*`：只做参数校验、调用领域服务、返回 HTTP 响应。
- `components/*`：仍有对内部 API route 的调用。后续如果继续收敛，可新增 `lib/clientApi/*`，把浏览器侧 fetch 也封装成 typed client。

## 仍可继续优化的耦合点

- 浏览器组件中仍直接调用内部 API route，例如 AI 分析卡片、设置页测试连接。它们不是外部 API 耦合，但可以进一步收敛到 `lib/clientApi`。
- `ExchangeRateService` 目前是单独服务类，未放入 `lib/external`。它已经是独立边界，如果后续希望所有外部请求都在一个目录下，可迁移为 `lib/external/exchangeRates.ts`。
- `StockPriceService` 同时负责数据源选择、fallback 和缓存。当前边界尚可，后续可以拆成 `QuoteSourceRegistry`、`QuoteCache`、`QuoteService`。
