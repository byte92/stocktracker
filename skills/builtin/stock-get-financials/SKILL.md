---
name: stock-get-financials
description: 获取并分析股票最近财报，返回营收、利润、EPS、估值、亮点、风险、来源、缺失项和置信度。
metadata:
  stocktracker:
    kind: executable
    action: stock.getFinancials
    version: 1
    handler: ./handler.ts#stockGetFinancialsSkill
    scopes:
      - quote.read
      - network.fetch
    inputSchema:
      type: object
      properties:
        symbol:
          type: string
        market:
          type: string
        researchQuery:
          type: string
        sourceHints:
          type: array
          items:
            type: string
        documents:
          type: array
          items:
            type: object
      required:
        - symbol
        - market
      additionalProperties: false
    dependencies:
      - lib/agent/skills/stock.ts
      - lib/agent/chains/financialAnalysis.ts
      - lib/agent/financials/schema.ts
      - lib/agent/skills/web.ts
---

# 使用场景

当用户询问持仓或未持仓股票的财报、年报、季报、中报、业绩、营收、利润、EPS、现金流、负债、估值是否匹配业绩时使用。

如果用户手动上传财报文件，优先使用上传文件内容。没有上传文件时，A 股优先读取结构化财务数据源；结构化数据不足时会通过受控公开搜索补充资料。OpenAI-compatible 配置下优先使用 LangChain 财报分析子链生成结构化 `analysis`；其他模型配置回退到现有 JSON 补全能力。

# 不适用场景

- 不负责自动交易或写入交易记录。
- 不适用于基金、ETF、加密资产等没有公司财报的产品；这类问题应转向持仓表现、跟踪指数、净值、费率或组合风险分析。
- 不输出确定性买卖指令、收益承诺或评级。
- 不替代完整审计和专业财务顾问服务。
- 不读取与当前标的无关的完整交易明细。
- 不长期保存上传文件原文；上传内容仅用于本次分析请求。

# 输出要求

返回兼容旧字段的财报关键数据，并新增：

- `analysis.metrics`：营收、净利润、EPS、PE、PB 等可追溯指标。
- `analysis.highlights`：财报亮点。
- `analysis.risks`：经营、利润率、现金流、负债或估值风险。
- `analysis.trendSummary`：趋势摘要。
- `analysis.portfolioImplications`：仅当标的在当前持仓中时返回。
- `analysis.sources`：结构化数据或公开网页来源。
- `analysis.missingData`：缺失字段和资料限制。
- `analysis.confidence`：low / medium / high。
- `chain`：子链使用的 provider、是否降级和错误信息。

如果公开来源不足，必须降低置信度并显式写入 `missingData`，不得编造财报数字或来源。
