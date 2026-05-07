---
name: stock-get-holding
description: 读取单只股票的本地持仓、成本、盈亏和备注。
metadata:
  stocktracker:
    kind: executable
    action: stock.getHolding
    version: 1
    handler: lib/agent/skills/stock.ts#stockGetHoldingSkill
    scopes:
      - stock.read
      - quote.read
    inputSchema:
      type: object
      properties:
        stockId:
          type: string
      required:
        - stockId
      additionalProperties: false
    dependencies:
      - lib/finance.ts
---

# 使用场景

当用户询问某只已持仓股票的走势、成本、盈亏、仓位、是否继续持有或风险时使用。

# 不适用场景

- 用户询问未持仓股票时，应使用 `stock.getExternalQuote`。
- 用户询问组合整体风险时，应优先使用组合类 Skill。

# 输出要求

返回精简持仓摘要，不返回完整原始交易对象。
