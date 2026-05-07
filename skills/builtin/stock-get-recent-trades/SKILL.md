---
name: stock-get-recent-trades
description: 读取单只股票最近交易记录。
metadata:
  stocktracker:
    kind: executable
    action: stock.getRecentTrades
    version: 1
    handler: lib/agent/skills/stock.ts#stockGetRecentTradesSkill
    scopes:
      - trade.read
    inputSchema:
      type: object
      properties:
        stockId:
          type: string
        limit:
          type: number
      required:
        - stockId
      additionalProperties: false
    dependencies:
      - types/index.ts
---

# 使用场景

当用户询问交易复盘、买卖节奏、加仓减仓是否合理、某只股票成本变化时使用。

# 不适用场景

- 不用于组合级概览。
- 不返回超过需要数量的历史交易。

# 输出要求

返回最近 N 条交易的日期、方向、价格、数量、费用和备注。
