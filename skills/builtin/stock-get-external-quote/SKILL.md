---
name: stock-get-external-quote
description: 读取未持仓股票的行情和估值数据。
metadata:
  stocktracker:
    kind: executable
    action: stock.getExternalQuote
    version: 1
    handler: lib/agent/skills/stock.ts#stockGetExternalQuoteSkill
    scopes:
      - quote.read
    inputSchema:
      type: object
      properties:
        symbol:
          type: string
        market:
          type: string
        query:
          type: string
        keyword:
          type: string
        name:
          type: string
      additionalProperties: false
    dependencies:
      - lib/StockPriceService.ts
---

# 使用场景

当用户询问未在当前持仓中的股票，并且已经确定代码和市场时使用。

# 不适用场景

- 市场不明确时不应直接调用，应先要求用户选择具体市场。
- 不把未持仓股票当成用户持仓。

# 输出要求

返回 `inPortfolio: false`，并提供行情和估值字段。
