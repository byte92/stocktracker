# LangChain 财报分析能力需求文档

## 1. 背景与目标

StockTracker 当前已经具备本地持仓核算、行情读取、AI 对话、Agent Runtime、Skill Registry、公开网页搜索和受控网页抓取能力。现有 `stock.getFinancials` Skill 可以读取少量财报关键字段，并在结构化数据不足时建议后续搜索，但还不能稳定完成“读取财报材料、提取指标、解释趋势、提示风险、给出来源”的完整财报分析工作流。

本功能目标是在现有 Agent Runtime 内局部接入 LangChain，新增一套受控的“财报分析子链”，让用户可以围绕已持仓或未持仓标的提问：

- “帮我分析一下腾讯最新财报。”
- “贵州茅台这次季报有什么风险？”
- “英伟达最近一季收入增长主要来自哪里？”
- “这只股票财报和我的持仓风险有什么关系？”

LangChain 只作为财报分析链路的编排和结构化输出工具，不替换现有 Agent Runtime、Planner、Executor、Skill 权限控制、SQLite 持久化和金融计算逻辑。

## 2. 用户价值

- 用户可以在 AI 对话中直接获得某只股票的财报摘要、核心指标、同比/环比趋势、风险点和数据缺口。
- 对已持仓标的，系统可以把财报变化与用户持仓成本、仓位、盈亏和交易记录放在同一上下文中解释。
- 对未持仓标的，系统可以明确区分“外部公开财报资料”和“本地持仓事实”，避免误把外部标的当成本地资产。
- 财报分析结果带有来源、缺失字段和置信度，便于用户自行复核。
- 后续可以在同一链路上扩展年报、季报、公告、电话会纪要和本地研究笔记。

## 3. 功能定位

### 3.1 是什么

本功能是 StockTracker AI Agent 的一个领域能力，面向“财报、业绩、经营质量、盈利能力、现金流、负债、估值解释和风险提示”场景。

它以现有 Skill 形式暴露，优先升级 `stock.getFinancials`，必要时新增更细粒度 Skill，例如：

- `stock.getFinancials`
- `stock.analyzeFinancialReport`
- `research.financialReport`

首版建议优先升级 `stock.getFinancials`，避免 Planner 入口变多。

### 3.2 不是什么

本功能不是：

- 自动交易或买卖建议系统。
- 预测股价涨跌的确定性模型。
- 替代审计、财务顾问或投顾服务的专业结论。
- 任意网页自由浏览 Agent。
- 全量 LangChain Agent Runtime 替换方案。

AI 输出必须保留投资风险边界，不得给出收益承诺、内幕信息、确定性买卖指令或规避风险提示的表达。

## 4. 总体方案

推荐架构：

```text
用户问题
  -> Planner 判断是否需要财报/业绩数据
  -> security.resolve 解析标的
  -> stock.getFinancials 执行
    -> 读取结构化财报数据
    -> 必要时触发 web.search / web.fetch 获取公开资料
    -> LangChain 财报分析子链做结构化提取和分析
    -> 返回 FinancialAnalysis SkillResult
  -> Context Composer 组装最小上下文
  -> 现有 LLM 流式生成最终回答
```

LangChain 只运行在 `stock.getFinancials` 或其内部 helper 中，输出结构化 JSON。最终回答仍由现有 `streamChatCompletion` 和 Agent 上下文完成。

## 5. 设计原则

- **局部接入**：LangChain 只服务财报分析子链，不接管整个 Agent。
- **权限继承**：网络访问仍通过现有 `network.fetch` scope 和受控 Skill，不允许 LangChain 自行调用任意工具。
- **确定性优先**：FIFO、手续费、持仓成本、盈亏等计算继续由 `lib/finance.ts` 等确定性代码负责。
- **来源优先**：财报分析必须返回来源列表；缺少来源时应降低置信度。
- **缺失显式化**：缺失营收、净利润、现金流、负债、分部收入等关键字段时，必须进入 `missingData`。
- **结构化输出**：LangChain 输出必须符合固定 schema，避免把不可解析自然语言直接塞进 SkillResult。
- **Node 20.9+ 兼容**：仓库目标是 Node.js 20.9+，依赖版本必须满足该运行时约束。
- **可降级**：LangChain 子链失败时，Skill 应保留现有搜索兜底或返回明确错误，不影响整个对话服务。

## 6. 数据来源

### 6.1 本地数据

对已持仓标的，可读取：

- 股票代码、名称、市场、备注。
- 当前持仓、成本、盈亏、分红和手续费摘要。
- 最近交易记录。
- 当前行情、估值字段和技术指标快照。

这些数据用于解释“财报变化和我的持仓有什么关系”，但不能与财报披露事实混淆。

### 6.2 结构化外部数据

首版优先复用现有能力：

- A 股：现有新浪财报抓取逻辑，提取营业收入、归母净利润、基本 EPS、报告期等字段。
- 行情源：现有 quote service 返回的 PE、PB、EPS、市值等估值字段。
- 后续可扩展：交易所公告、巨潮资讯、SEC Companyfacts、港交所披露等。

### 6.3 公开网页资料

结构化数据不足时，使用现有 `web.search` / `web.fetch` 作为兜底。

推荐来源优先级：

- 公司投资者关系官网。
- 交易所或监管机构披露页面。
- 年报、季报、业绩公告、earnings release、10-Q、10-K、中期业绩、年度业绩。
- 主流财经媒体的财报摘要。

不建议首版直接依赖社交媒体、论坛或无法追溯来源的二手摘要。

### 6.4 手动上传资料

财报分析页面支持用户手动上传财报文件，上传内容只用于本次分析请求，不作为长期文件库保存。

首版支持：

- PDF。
- TXT / Markdown。
- HTML。
- CSV / JSON。

限制：

- 最多 3 个文件。
- 单个文件不超过 12MB。
- 解析后的文本会截断到受控长度，避免单次上下文过大。
- 不支持图片扫描版 PDF 的 OCR。
- 不支持 Word / Excel 原生格式。

当用户上传文件时，系统优先使用上传文件内容；没有上传文件时，再使用结构化数据源和公开网页资料。

## 7. LangChain 子链职责

LangChain 财报分析子链负责：

- 将结构化指标和公开资料摘要转为统一输入。
- 按固定 prompt 提取财报关键事实。
- 生成结构化财报分析 JSON。
- 标注缺失字段、数据不一致和置信度。
- 输出供 Agent Context 使用的简明分析结果。

LangChain 子链不负责：

- 自行决定访问哪些本地数据。
- 自行写入数据库。
- 自行调用交易写入 Skill。
- 自行发起无限制网络请求。
- 生成最终给用户的完整聊天回复。

## 8. 输出结构

首版建议新增或扩展以下数据结构：

```ts
export type FinancialAnalysis = {
  symbol: string
  market: Market
  companyName?: string
  reportPeriod?: string
  reportType?: 'annual' | 'quarterly' | 'interim' | 'unknown'
  currency?: string
  metrics: {
    revenue?: number | null
    revenueGrowth?: number | null
    netProfit?: number | null
    netProfitGrowth?: number | null
    grossMargin?: number | null
    operatingMargin?: number | null
    operatingCashFlow?: number | null
    freeCashFlow?: number | null
    eps?: number | null
    debtRatio?: number | null
    peTtm?: number | null
    pb?: number | null
  }
  highlights: string[]
  risks: string[]
  trendSummary: string
  valuationNotes: string[]
  portfolioImplications?: string[]
  missingData: string[]
  sources: Array<{
    title: string
    url?: string
    publisher?: string
    date?: string
  }>
  confidence: 'low' | 'medium' | 'high'
}
```

字段说明：

- `metrics` 只放可追溯的数字，不确定时填 `null`，不要让模型编造。
- `highlights` 放财报中的正面或改善项。
- `risks` 放经营、利润率、现金流、负债、估值或披露质量风险。
- `portfolioImplications` 仅在本地持仓上下文存在时生成。
- `missingData` 用于提示本次分析缺少哪些关键资料。
- `sources` 至少包含一个有效来源，否则 `confidence` 不得为 `high`。

## 9. 交互与触发

### 9.1 触发问题

Planner 应在以下用户意图中规划财报能力：

- 财报、年报、季报、中报、业绩公告。
- 营收、利润、净利润、EPS、毛利率、现金流、负债率。
- 业绩增长、业绩下滑、超预期、低于预期。
- 公司经营质量、盈利能力、估值是否匹配业绩。

### 9.2 回答要求

最终回复应包含：

- 结论摘要。
- 核心指标变化。
- 主要亮点。
- 主要风险。
- 和用户持仓相关的影响，若该标的不在持仓中需明确说明。
- 数据来源和缺失项。
- 投资风险提示。

### 9.3 示例问题

- “分析一下 00700 最新财报。”
- “我持仓里的腾讯财报风险大吗？”
- “贵州茅台最近季报的收入和利润怎么样？”
- “英伟达最新 earnings 说明需求还强吗？”
- “这家公司现金流有没有恶化？”

## 10. 依赖与兼容性

仓库当前目标是 Node.js 20.9+。依赖选择必须满足：

- 不能引入高于 Node.js 20.9+ 的版本要求，除非项目整体目标再次升级。
- 必须通过 `pnpm install` 或 `pnpm install --frozen-lockfile` 管理锁文件。
- 需要在实现说明中记录 LangChain 版本选择原因。

首版只需要 OpenAI-compatible chat model 和结构化输出能力，不需要引入向量数据库、LangGraph 或 LangSmith。

## 11. 错误处理与降级

需要覆盖以下失败场景：

- AI 配置缺失或模型不可用：返回明确配置错误。
- LangChain 依赖初始化失败：Skill 返回错误，Agent 继续给出可用数据说明。
- 财报来源不足：返回 `missingData`，降低置信度。
- 抓取网页失败：保留搜索结果摘要，说明未能读取原文。
- 结构化输出解析失败：重试一次；仍失败则返回原始关键数据和明确错误。
- 模型输出疑似编造来源：丢弃无 URL 或无标题来源，并降低置信度。

## 12. 安全与边界

- 不允许 LangChain 子链写入交易记录、持仓或配置。
- 不允许将 API Key 明文放入 prompt、trace 或 SkillResult。
- 不允许把本地完整交易明细无差别发送给财报分析子链；只传与当前标的相关的摘要。
- 不允许长期保存上传的财报文件原文；首版只做单次请求内解析。
- 不允许把外部搜索内容当作确定事实；必须保留来源和置信度。
- 不允许输出确定性买卖指令，例如“必须买入”“一定卖出”。
- 不允许省略“仅供参考，不构成投资建议”的风险边界。

## 13. 分阶段计划

### Phase 1：需求与方案确认

- 新增本文档。
- 明确 LangChain 只作为财报分析子链。
- 明确输出 schema、数据来源、权限边界和兼容性要求。

### Phase 2：最小可用实现

- 增加 LangChain 依赖，选择 Node 20.9+ 兼容版本。
- 新增 `lib/agent/chains/financialAnalysis.ts`。
- 升级 `stock.getFinancials`，返回 `FinancialAnalysis`。
- 保留现有 A 股结构化抓取逻辑和搜索兜底。
- 增加基础单元测试或 smoke test。

### Phase 3：Agent 与回答质量优化

- 优化 Planner 对财报问题的 Skill 选择。
- 优化 Context Composer 对 `FinancialAnalysis` 的摘要格式。
- 在 Agent Trace 中展示来源、缺失字段和置信度。
- 补充中英文回答口径。

### Phase 4：数据源增强

- 增加更权威的 A 股公告来源。
- 增加美股 SEC 或公司 IR 来源。
- 增加港股公告来源。
- 根据需要评估 PDF 解析和本地文档上传。

### Phase 5：RAG 扩展

- 仅当用户需要长期研究库、年报归档或本地研报问答时，再引入向量索引。
- RAG 不进入首版范围。

## 14. 验收标准

功能首版完成后，应满足：

- 用户询问明确标的财报时，Planner 能规划 `stock.getFinancials`。
- 已持仓标的的财报分析能结合本地持仓摘要解释影响。
- 未持仓标的的财报分析明确标注“不在当前持仓中”。
- 输出包含核心指标、亮点、风险、来源、缺失项和置信度。
- 来源不足或抓取失败时不编造数据。
- LangChain 子链失败时不会导致整个 AI 对话崩溃。
- `pnpm test` 和 `pnpm build` 通过。
- 不破坏现有组合分析、个股分析、交易录入确认和 AI 对话流式输出。

## 15. 暂不实现内容

首版暂不实现：

- 向量数据库。
- LangGraph 多节点工作流。
- LangSmith 远程追踪。
- PDF 财报全文解析。
- 用户上传研报。
- 自动生成买卖操作。
- 财报数据入库缓存。
- 前端独立财报详情页。

这些能力可以在财报分析子链稳定后逐步评估。
