# StockTracker Agent V2 技术规划

> 状态说明：本文是历史技术规划文档，其中多项能力已经在后续 PR 中落地，包括模型驱动 Planner、`security.resolve`、`web.search`、`web.fetch`、`stock.getFinancials`、多轮候选澄清和 Trace 持久化。当前实现口径以 [Agent 架构设计](./AGENT_ARCHITECTURE.md) 和 `skills/builtin/*/SKILL.md` 为准；本文保留作为设计脉络和后续版本参考。

## 1. 背景

V1 已实现极简 Agent：单轮 `plan → execute → answer`，多项内置 Skill，Agent Trace 持久化。V1 验证了按需取数、最小上下文和领域 Agent 的基础架构可行性。

V2 的核心命题是**让 Agent 从"一步问答"升级为"多步执行"**，并在数据获取能力上补齐网络请求和财报等关键缺口。

## 2. 总体目标

- Executor 支持最多 10 轮链式 Skill 调用，Skill 结果可以触发后续 Skill
- Planner 在规则无法覆盖时，使用 LLM 兜底生成结构化 AgentPlan
- 新增 `market.resolveCandidate`、`web.fetch`、`stock.getFinancials` 三个 Skill
- 完善多轮澄清机制，用户澄清后自动推进

## 3. V2 功能点详细设计

### 3.1 链式 Skill 执行

**当前问题**：Executor 一次性执行 `plan.requiredSkills` 中的所有 Skill，无法根据中间结果动态调整。

**V2 方案**：

```text
Executor 执行流程

1. 按序执行 requiredSkills
2. 每个 Skill 执行后，检查返回的 needsFollowUp 字段
3. 如果 needsFollowUp === true：
   - 将 suggestedSkills 加入待执行队列
   - 最大执行轮次上限为 10 轮（防止无限循环，财经领域调用深度有限，10 次足够覆盖所有合理场景）
4. 如果没有 followUp，继续执行下一个 Skill
```

**典型链路示例**：

```text
用户: "分析一下 AAPL 今天刚出的财报"

Planner 识别股票代码 → 匹配到 AAPL（美股）
  → stock.match 成功，但发现没有持仓
  → stock.getExternalQuote 获取行情（成功）
  → stock.getFinancials 获取财报（暂不支持，触发 needsFollowUp）
  → web.fetch 兜底抓取公开财报摘要

最终回答聚合：行情 + 财报关键数据 + 市场反应
```

**类型设计扩展**：

```ts
type AgentSkillResult<TResult = unknown> = {
  skillName: string
  ok: boolean
  data?: TResult
  error?: string
  tokenEstimate?: number
  // V2 新增
  needsFollowUp?: boolean
  suggestedSkills?: AgentSkillCall[]
}
```

**Executor 改动范围**：`lib/agent/executor.ts`

### 3.2 LLM Planner 兜底

**当前问题**：Planner 是纯规则引擎（关键词 + 代码匹配），复杂或模糊问题无法处理。

**V2 方案**：

规则优先不变（确定性高、零延迟、可审计），但在以下场景降级到 LLM Planner：

| 触发条件 | 示例 |
|---|---|
| 规则无法识别任何意图（`intent: 'unknown'` 且无明确关键词） | "帮我看看最近表现" |
| 用户输入包含多个意图且规则无法确定主次 | "成都银行和腾讯哪个更适合加仓" |
| 用户输入包含时间/条件限定词 | "最近一周跌得最多的持仓" |

**LLM Planner 协议**：

```text
System: 你是 StockTracker Agent Planner。根据用户问题输出 JSON 计划。
Context: 用户持仓列表摘要（仅股票代码+名称，不含完整交易记录）

User: "最近一周跌得最多的持仓是哪个"
LLM Output:
{
  "intent": "stock_analysis",
  "entities": [{ "type": "portfolio", "raw": "最近一周跌幅最大", "confidence": 0.78 }],
  "requiredSkills": [
    { "name": "portfolio.getTopPositions", "args": { "limit": 8 }, "reason": "先获取所有持仓的行情，再比较涨跌幅" },
    { "name": "stock.getQuote", "args": { "stockId": "all" }, "reason": "需要每只持仓的近期涨跌幅" }
  ],
  "responseMode": "answer"
}
```

**关键约束**：
- LLM Planner 仅用于意图和 Skill 规划，不生成最终用户回复
- 不注入完整交易记录到 Planner 上下文（节约 token）
- 输出必须是严格 JSON，解析失败回退到规则结果
- 单次 Planner LLM 调用 token 上限控制在 ~2000

**改动范围**：`lib/agent/planner.ts` 新增 `planViaLLM()` 函数

### 3.3 `market.resolveCandidate` Skill

**当前问题**：候选标的选择在 UI 层处理（`pendingCandidate`），不在 Agent 执行链中。这意味着 Agent 无法在对话中主动澄清标的。

**Skill 定义**：

```yaml
name: market.resolveCandidate
description: 根据用户输入的名称或代码，搜索候选标的列表
scopes: [quote.read]
inputs:
  query: string
outputs:
  candidates: Array<{ code: string; name: string; market: Market; confidence: number }>
```

**实现逻辑**：
1. 按代码规则匹配（如纯数字 = A 股，5 位数字后 .HK = 港股）
2. 按名称在本地持仓中模糊搜索
3. 如果本地无匹配，尝试用腾讯财经/AKShare 接口做外部搜索
4. 返回候选列表，附带市场、置信度

**典型用法**：

```text
Planner → market.resolveCandidate({ query: "平安" })
  → candidates: [
    { code: "601318", name: "中国平安", market: "A", confidence: 0.85 },
    { code: "000001", name: "平安银行", market: "A", confidence: 0.70 },
  ]
  → responseMode: "clarify"
```

**改动范围**：新增 `skills/builtin/market-resolve-candidate/SKILL.md` + `lib/agent/skills/market.ts`

### 3.4 多轮澄清机制

**当前问题**：澄清是单次的——返回一条消息就结束。用户澄清后需要重新发消息、重新 plan。

**V2 方案**：

```text
Round 1:
  User: "帮我看看平安"
  Agent Plan: clarify → "你问的是中国平安还是平安银行？"
  Session 状态记录: { pendingClarify: true, candidates: [...] }

Round 2:
  User: "中国平安"
  Route 层检测到 session 有 pendingClarify 状态
  → 跳过 Planner，直接按候选选择执行 stock.getExternalQuote
  → answer
```

**实现方式**：

- `ai_chat_sessions` 表新增 `context_json` 字段（TEXT/JSON），存储当前澄清状态
- `/api/ai/chat` route 在处理消息前先检查 session 是否有未完成的澄清
- 如果有，优先消费澄清状态，而非重新 plan

**改动范围**：`lib/sqlite/db.ts`（schema 扩展）、`app/api/ai/chat/route.ts`、`lib/agent/runtime.ts`

### 3.5 `web.fetch` Skill（网络请求兜底）

**当前问题**：Agent 只能回答内置 Skill 覆盖的数据。当用户问财报、新闻、公告或其他未内置的数据时，Agent 无能为力。

**设计方案**：

```yaml
name: web.fetch
description: 发起受控网络请求，获取外部金融数据
scopes: [network.fetch]
version: 1
inputs:
  url: string           # 目标 URL
  method: "GET" | "POST" # 请求方法
  headers?: Record<string, string>
  body?: string         # POST 请求体（JSON 字符串）
  extractPrompt?: string # 提取提示词，指导模型从抓取内容中提炼关键信息
outputs:
  status: number        # HTTP 状态码
  body: string          # 响应正文（可能被 AI 摘要）
  summary?: string      # AI 提取的摘要（当 extractPrompt 提供时）
```

**安全约束（必须）**：

| 规则 | 说明 |
|---|---|
| URL 白名单 | 只允许 `finance.yahoo.com`、`qt.gtimg.cn`、`api.nasdaq.com`、`alphavantage.co`、`eastmoney.com`、`cninfo.com.cn` 等已知金融数据源 |
| 禁止内网请求 | 拒绝 `localhost`、`127.0.0.1`、`192.168.*`、`10.*`、`172.16-31.*` |
| 超时限制 | 单次请求最长 15 秒 |
| 响应大小限制 | 最大 512KB 正文 |
| 禁止凭据传递 | 不附加 Cookie 或 Authorization（除非 Skill 内部使用配置的 API Key） |
| 审计日志 | 每次请求记录 URL、状态码、耗时到 Agent Trace |

**典型用法**：

```text
用户: "AAPL 今天发财报了，业绩怎么样？"

Agent Plan:
  → stock.match → 匹配到 AAPL (US)
  → stock.getExternalQuote → 获取行情（成功）
  → stock.getFinancials → 暂无内置支持，返回空
  → web.fetch({
      url: "https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL&fields=earningsQuarterlyGrowth,revenueGrowth,earningsDate",
      extractPrompt: "提取财报关键数据：EPS、营收、同比增长、下季度指引"
    })
  → 回答: "AAPL 当前报 $187.50，涨幅 2.3%。根据最新财报..."
```

**改动范围**：新增 `skills/builtin/web-fetch/SKILL.md` + `lib/agent/skills/web.ts`，新增 `network.fetch` scope

### 3.6 `stock.getFinancials` Skill（财报数据）

**可行性分析**：

| 数据源 | 覆盖面 | 获取方式 | 可行性 |
|---|---|---|---|
| Yahoo Finance | 美股 | API（免费） | ✅ 直接 |
| 东方财富 | A 股 | 网页抓取 | ⚠️ 需解析 |
| 巨潮资讯 (cninfo) | A 股 | 官方披露 | ⚠️ 需要 PDF 解析 |
| HKEX | 港股 | 官方公告 | ⚠️ 格式复杂 |
| Alpha Vantage | 美股 | API（需 Key） | ✅ 已有接入 |

**首版方案**：优先实现美股财报（Yahoo Finance API），A 股/港股财报通过 `web.fetch` 兜底。后续迭代再封装专用 Skill。

```yaml
name: stock.getFinancials
description: 获取美股最近财报关键数据
scopes: [quote.read, network.fetch]
version: 1
inputs:
  symbol: string    # 美股代码
  market: "US"      # 首版仅支持 US
outputs:
  earningsDate: string
  epsActual: number | null
  epsEstimate: number | null
  epsSurprise: number | null        # (实际-预期)/预期 * 100
  revenueActual: number | null
  revenueEstimate: number | null
  revenueGrowth: number | null      # 同比营收增长 %
  earningsGrowth: number | null     # 同比盈利增长 %
  nextEarningsDate: string | null
```

**数据来源**：Yahoo Finance `v7/finance/quote` 接口的 `earnings` 相关字段

**改动范围**：新增 `skills/builtin/stock-get-financials/SKILL.md` + `lib/agent/skills/stock.ts`

## 4. 改动文件清单

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `lib/agent/types.ts` | 修改 | AgentSkillResult 增加 needsFollowUp / suggestedSkills |
| `lib/agent/executor.ts` | 重写 | 支持链式执行，最大 10 轮 |
| `lib/agent/planner.ts` | 扩展 | 新增 LLM 兜底 Planner |
| `lib/agent/runtime.ts` | 修改 | 整合链式执行和 LLM Planner |
| `lib/agent/context.ts` | 微调 | 适配多轮 Skill 结果上下文 |
| `lib/sqlite/db.ts` | 扩展 | sessions 表增加 context_json |
| `app/api/ai/chat/route.ts` | 修改 | 澄清状态消费 |
| `lib/agent/skills/market.ts` | 扩展 | market.resolveCandidate |
| `lib/agent/skills/stock.ts` | 扩展 | stock.getFinancials |
| `lib/agent/skills/web.ts` | 新增 | web.fetch Skill |
| `lib/agent/skills/registry.ts` | 修改 | 注册新 Skill |
| `skills/builtin/market-resolve-candidate/SKILL.md` | 新增 | |
| `skills/builtin/web-fetch/SKILL.md` | 新增 | |
| `skills/builtin/stock-get-financials/SKILL.md` | 新增 | |
| `tests/agent-*.test.ts` | 新增/扩展 | 链式执行、LLM Planner、新 Skill 单测 |

## 5. 开发顺序建议

```
Phase A ─ 基础设施
  1. market.resolveCandidate Skill
  2. 链式执行（executor 升级）

Phase B ─ 智能增强
  3. LLM Planner 兜底
  4. 多轮澄清机制

Phase C ─ 数据扩展
  5. web.fetch Skill
  6. stock.getFinancials Skill
```

Phase A 改动最小、风险最低，先做可以快速验证链式执行的架构。Phase C 依赖 `web.fetch` 作为兜底，所以 `web.fetch` 优先于 `stock.getFinancials`。

---

## 6. 后续版本概要规划

### V3：会话摘要与用户偏好

| 条目 | 说明 |
|---|---|
| 长对话自动摘要 | 对话超过 N 轮（默认 12 轮）时，自动用 LLM 生成摘要注入上下文，替代裁剪早期消息 |
| 用户投资偏好学习 | 从对话历史中提取用户风格偏好（偏股息/偏成长/偏短线/偏低波动），注入后续回答 |
| 投资纪律提醒 | 用户可设置规则（如"单只持仓超过 30% 提醒"），Agent 在每次回答时检查并提醒 |
| 上下文智能压缩 | 对 Skill 返回的大量数据做 LLM 摘要压缩，而非简单裁剪 |

### V4：开放 Skill 生态

| 条目 | 说明 |
|---|---|
| Skill manifest 规范 | 标准化 SKILL.md 格式，支持版本、权限声明、依赖声明 |
| 社区 Skill 安装 | 支持从本地目录加载第三方 Skill（`skills/custom/`） |
| 权限白名单 | 安装前自动校验 `requiredScopes`，拒绝越权 Skill |
| 安全审计工具 | 提供 `pnpm audit:skills` 检查已安装 Skill 的权限和脚本绑定 |
| Skill 市场（远期） | Web 端浏览、安装社区 Skill |

### V5：工作流 Agent

| 条目 | 说明 |
|---|---|
| 每日复盘 | 定时生成组合日报：当日涨跌、盈亏变化、关键异动 |
| 异动提醒 | 单日涨跌幅超阈值、成交量异常放大、技术破位时推送 |
| 财报日历 | 跟踪持仓股票的财报发布日期，提前提醒 |
| 分红提醒 | 除权除息日前提醒用户 |
| 自然语言定时任务 | "每天早上 9 点给我发一份组合简报" → 自动注册 Cron 任务 |

---

## 7. 未纳入本次范围（明确排除）

- 自主循环 Agent（不做 LLM 自主决策多轮循环，始终保持确定性控制流）
- 子 Agent / Agent 间通信
- 实时 WebSocket 推送（V5 工作流 Agent 时再考虑）
- 语音/图片输入
- 跨设备同步
- 附件上传
