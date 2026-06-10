# LangChain 财报分析 · RAG 扩展设计（Phase 5）

## 1. 文档目的

本文档约束财报分析能力的 **RAG（检索增强生成）扩展**实现，对应需求文档中规划但未落地的 [Phase 5：RAG 扩展](./LANGCHAIN_FINANCIAL_ANALYSIS_REQUIREMENTS.md)。

配套文档：

- [LangChain 财报分析能力需求文档](./LANGCHAIN_FINANCIAL_ANALYSIS_REQUIREMENTS.md)（Phase 5 触发条件：长期研究库 / 年报归档 / 本地研报问答）
- [LangChain 财报分析技术架构设计](./LANGCHAIN_FINANCIAL_ANALYSIS_TECH_DESIGN.md)（首版明确"不引入 RAG 和向量库"）

核心原则延续既有结论：**不把 RAG 扩展成第二套 Agent Runtime**。RAG 只嵌入 `stock.getFinancials` 的财报子链内部，作为"财报正文 → 精选片段"的检索环节，对上下游透明。

## 2. 现状诊断：为什么需要 RAG

当前财报分析链路：

```text
前端上传页 app/(main)/ai/financials/page.tsx
  -> API  app/api/ai/financial-analysis/route.ts
    -> parseFinancialUploads()           解析 PDF/TXT，单篇截断到 80,000 字
    -> stockGetFinancialsSkill.execute()  lib/agent/skills/stock.ts
       汇总 documents（手动上传 / A股抓取 / 全球抓取 / web 搜索）
    -> runFinancialAnalysisChain()        lib/agent/chains/financialAnalysis.ts
       -> compactInput()  ← 信息瓶颈
```

瓶颈在 `lib/agent/chains/financialAnalysis.ts` 的 `compactInput`：

```ts
documents: input.documents.slice(0, 5).map((doc) => ({
  ...doc,
  excerpt: doc.excerpt.length > 2500 ? `${doc.excerpt.slice(0, 2500)}\n[内容已截断]` : doc.excerpt,
}))
```

它"取前 5 篇、每篇砍到 2500 字"。一份财报 PDF 经 pdf-parse 提取后常达数万字，2500 字大约只覆盖到管理层讨论开头——营收明细、风险提示、现金流量表等关键段落几乎必然被截掉。模型不是分析能力不足，而是没看到关键内容。

**RAG 的目标单一**：把"截断前 2500 字"替换为"按问题语义检索最相关的 N 段"。接入点唯一、清晰，不触碰其它模块。

## 3. 选型与权衡

需求文档 Phase 5 与早期复习材料建议过 FAISS / Chroma / sqlite-vec。结合本项目"本地优先 + Next.js + better-sqlite3 + Electron 打包"的实际约束，做如下修正：

| 环节 | 早期建议 | 本设计采用 | 理由 |
|---|---|---|---|
| 切分 | 通用 splitter | `@langchain/textsplitters` 的 `RecursiveCharacterTextSplitter` | LangChain 官方、纯 JS、轻量 |
| Embedding | OpenAI Embeddings | `OpenAIEmbeddings`（已装 `@langchain/openai`），复用 `AiConfig` 的 baseUrl/apiKey | 不引新密钥、不起新服务 |
| 向量库（一阶段） | FAISS / Chroma | **内存检索**：`embedDocuments` + 自写余弦 topK | 一次性分析请求，向量用完即弃，零新增依赖、零 native 编译 |
| 向量库（二阶段） | sqlite-vec | **普通 sqlite 表存向量 JSON + JS 余弦检索** | 见下方说明 |

### 3.1 为什么不用 FAISS / Chroma

- 一阶段财报分析是**一次性请求**（上传 → 分析 → 存结果），向量无需常驻。LangChain 的 `MemoryVectorStore` 需要引入 `langchain` 主包（当前仅有 `@langchain/core` 与 `@langchain/openai`），不划算；自写余弦检索可同时服务一阶段内存版与二阶段持久化版，逻辑统一。
- Chroma 需起独立服务，违背 local-first。
- FAISS 的 node 绑定是 native 模块，在 Electron 打包（当前产物已 220MB）里易踩交叉编译坑。

### 3.2 为什么二阶段不用 sqlite-vec 而用"普通表 + JS 余弦"

- sqlite-vec 是 native 扩展，需随 better-sqlite3 一并加载，在 Electron 多平台打包里增加编译与体积风险。
- 财报 chunk 量级在数百，JS 内做余弦相似度是数百次点积，毫秒级，暴力检索完全够用。
- 用普通表存 `embedding JSON` 即可获得"持久化 + 多轮问答"的全部价值，零 native 风险。若未来 chunk 量级上万再迁移 sqlite-vec，检索接口不变。

### 3.3 必须处理的真实约束

`AiConfig.provider` 含 `'anthropic-compatible'`（`types/index.ts`），但 **Anthropic 不提供 embeddings API**。因此：

- 新增可选配置 `embeddingModel` / `embeddingBaseUrl`，embedding 调用走 openai-compatible 端点。
- 当 provider 为 anthropic 且未单独配置 embedding 端点时，**直接降级**回 `compactInput` 截断逻辑，绝不让财报分析因此报错。

## 4. 一阶段设计：内存版检索

### 4.1 新增文件 `lib/agent/financials/retrieval.ts`

职责单一：documents 进、检索后的精选片段出，返回结构与输入完全一致（对 `compactInput` 透明）。

```ts
export async function retrieveRelevantExcerpts(
  documents: FinancialAnalysisInput['documents'],
  query: string,             // = input.userQuestion
  config: AiConfig,
  options?: { topK?: number },
): Promise<{
  documents: FinancialAnalysisInput['documents']  // excerpt 已替换为检索拼接结果
  retrieved: boolean                               // false = 已降级
  chunkCount?: number
}>
```

内部流程：

1. **切分**：每篇 excerpt 经 `RecursiveCharacterTextSplitter`（chunkSize ≈ 800、overlap ≈ 100）切块，保留 `{title, publisher, url, date}` 作为 metadata。
2. **向量化**：`OpenAIEmbeddings.embedDocuments(chunks)` 批量 embedding；query 用 `embedQuery`。
3. **检索**：JS 余弦相似度取 topK（默认 8）。
4. **重组**：命中片段按来源 title 归并，拼回 `{title, publisher, excerpt}` 结构。
5. **降级**：任何一步失败（embedding 端点不可用 / anthropic 无端点 / 文档过短无需检索）→ 返回 `retrieved: false`，由调用方退回 `compactInput`。

### 4.2 接入点改造

在 `lib/agent/chains/financialAnalysis.ts` 的 `chain.invoke` 之前，先调用 `retrieveRelevantExcerpts`，命中则用检索结果、否则用原 `compactInput`。`compactInput` 保留作兜底。`FinancialAnalysisChainResult` 增补检索元信息（`retrieval: { used, chunkCount }`）便于前端与可观测性展示。

## 5. 二阶段设计：持久化向量 + 多轮问答

### 5.1 向量表

在 `lib/sqlite/db.ts` 的 `initSchema` 增加（遵循现有 `CREATE TABLE IF NOT EXISTS` 风格）：

```sql
CREATE TABLE IF NOT EXISTS financial_doc_chunks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  analysis_id TEXT,            -- 关联 ai_analysis_history.id
  symbol TEXT NOT NULL,
  market TEXT,
  source_title TEXT,
  publisher TEXT,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embedding_json TEXT NOT NULL,  -- number[] 序列化
  embedding_model TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_financial_doc_chunks_user_symbol
  ON financial_doc_chunks(user_id, symbol, market);
```

### 5.2 写入时机

财报分析成功后，在 API route 以 **fire-and-forget** 方式（不 `await`、异常仅记日志）后台索引：切分文档 → embedding → 落库，关联 `analysis_id`。

设计取舍：后台索引独立于一阶段检索，会对文档**再做一次 embedding**（一阶段检索时已 embed 过一次）。之所以不复用一阶段向量，是为了让"索引"与"分析检索"解耦——索引失败不影响分析、且不必把向量穿过 chain→skill→route 多层透传。代价是一次额外 embedding 调用；因其在后台执行，不增加用户感知的分析响应延迟。若未来 embedding 成本敏感，可改为把一阶段 `chunkVectors` 透传复用。

写入采用"最新覆盖"语义：`replaceFinancialDocChunks` 先按 `(user, symbol, market)` 删除旧向量再插入，即每个标的只保留最近一次分析的财报向量（多轮问答始终针对最新财报）。如需"同标的多份财报共存"，再按 `analysis_id` 维度细分。

**模型漂移防护**：chunk 落库时记录 `embedding_model`；问答时若当前 embedding 模型与索引时不一致，向量空间不可比，直接要求重建索引（返回 `model-mismatch`），而非静默返回失真的检索结果。

### 5.3 多轮问答

- 新增 skill `stock.askFinancials`（或独立函数），输入 `{userId, symbol, market, question}`。
- 流程：question → embedQuery → 从 `financial_doc_chunks` 取该 symbol 的向量 → JS 余弦 topK → 命中片段塞入问答 prompt → LLM 回答（复用 `llmProvider`）。
- 新增 API route `app/api/ai/financial-qa/route.ts`，供前端对已分析财报追问（如"应收账款周转有没有恶化？"）。
- 检索逻辑与一阶段共用同一份余弦函数。

## 6. 数据流前后对比

```text
改造前：
  财报全文(数万字) --slice(0,2500)--> 模型（丢失绝大部分内容）

改造后（命中）：
  财报全文 --切分--> chunks --embedding--> 向量
  用户问题 --embedQuery--> 余弦topK --> 最相关8段 --> 模型
改造后（降级）：
  embedding 不可用 --> 退回 slice(0,2500)（不劣于改造前）
```

## 7. 任务清单

一阶段：

1. 安装 `@langchain/textsplitters`。
2. `types/index.ts` 的 `AiConfig` 增加可选 `embeddingModel` / `embeddingBaseUrl`。
3. 新建 `lib/agent/financials/retrieval.ts`（切分 + embedding + 余弦 topK + 降级）。
4. 改 `lib/agent/chains/financialAnalysis.ts` 接入检索，补检索元信息。

二阶段：

5. `lib/sqlite/db.ts` 新增 `financial_doc_chunks` 表与读写函数。
6. 分析成功后持久化 chunk 向量。
7. 新建 `stock.askFinancials` 检索问答能力 + `app/api/ai/financial-qa/route.ts`。

## 8. 风险与边界

- **embedding 成本与延迟**：一份长财报切几百块，单次 embedding 批量调用有耗时；用超时 + 降级保证最坏不劣于现状。
- **anthropic-only 配置**：无 embedding 端点时全程降级，功能等价于改造前。
- **向量与文本一致性**：embedding_model 写入表中，模型变更后旧向量按 model 区分或失效重建。
- **不纳入本期**：LangGraph 编排、LangSmith 可观测、跨标的全局研究库——保持 RAG 仅服务财报子链，不扩成第二套 Runtime。
