---
name: stock-match
description: 根据用户输入匹配本地持仓中的股票名称或代码。
metadata:
  stocktracker:
    kind: executable
    action: stock.match
    version: 1
    handler: ./handler.ts#stockMatchSkill
    scopes:
      - stock.read
    inputSchema:
      type: object
      properties:
        query:
          type: string
      required:
        - query
      additionalProperties: false
    dependencies:
      - lib/agent/entity/stockMatcher.ts
---

# 使用场景

当用户输入股票名称、代码、简称或模糊标的时使用，用于确认用户具体想分析哪只股票。

# 不适用场景

- 不负责抓取未持仓股票行情。
- 不负责生成最终投资分析。

# 输出要求

返回候选股票列表、市场、代码、置信度和匹配原因。
