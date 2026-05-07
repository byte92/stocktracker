---
name: stock-get-quote
description: 读取单只本地持仓股票的行情和估值数据。
metadata:
  stocktracker:
    kind: executable
    action: stock.getQuote
    version: 1
    handler: lib/agent/skills/stock.ts#stockGetQuoteSkill
    scopes:
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
      - lib/StockPriceService.ts
---

# 使用场景

当用户询问某只已持仓股票当前价格、涨跌幅、估值、PE、PB、EPS 或市值时使用。

# 不适用场景

- 不用于未持仓股票，未持仓股票应使用 `stock.getExternalQuote`。
- 不负责技术指标计算。

# 输出要求

返回行情和估值字段；如果行情源缺失估值字段，应显式返回空值。
