---
name: stock-get-financials
description: 获取股票最近财报关键数据（EPS、营收增长、盈利增长等）；结构化数据不可用时返回后续公开检索建议。
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
      required:
        - symbol
        - market
      additionalProperties: false
    dependencies:
      - lib/agent/skills/stock.ts
      - lib/agent/skills/web.ts
---

# 使用场景

当用户询问持仓或未持仓股票的财报数据时使用。
A 股优先读取结构化财务数据源，失败时按 Planner/模型提供的 `researchQuery` 和 `sourceHints` 建议追加公开搜索。

# 不适用场景

- 不负责生成投资分析或评级。
- 不包含完整三大报表，只返回最近财报关键指标。

# 输出要求

返回 EPS（实际/预期/超预期值）、营收同比增速、盈利同比增速、财报发布日期和数据源。
如果结构化数据不可用，返回后续搜索建议，由 Agent 用 Planner/模型提取的公开检索上下文继续补数据。
