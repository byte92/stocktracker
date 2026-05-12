---
name: stock-get-technical-snapshot
description: 读取单只股票的最新技术指标摘要和最近 20 个交易日的指标序列。
metadata:
  stocktracker:
    kind: executable
    action: stock.getTechnicalSnapshot
    version: 1
    handler: ./handler.ts#stockGetTechnicalSnapshotSkill
    scopes:
      - quote.read
    inputSchema:
      type: object
      properties:
        stockId:
          type: string
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
      - lib/technicalIndicators.ts
      - lib/StockPriceService.ts
---

# 使用场景

当用户询问走势是否健康、趋势、支撑阻力、均线、MACD、RSI、波动或技术面风险时使用。

# 不适用场景

- 基金或加密资产没有可用 K 线时，允许返回空技术指标。
- 不单独作为买卖结论，应与持仓、成本和行情一起使用。

# 输出要求

返回最新技术指标快照、最近 20 个交易日的收盘价/涨跌幅/均线/MACD/RSI/趋势序列、近期变化摘要和样本数量；数据不足时明确返回空值。
