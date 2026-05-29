---
name: stock-get-ashare-signals
description: 读取 A 股个股信号数据，包括龙虎榜、解禁、融资融券、大宗交易、股东户数、分红和 120 日资金流。
metadata:
  stocktracker:
    kind: executable
    action: stock.getAshareSignals
    version: 1
    handler: ./handler.ts#stockGetAShareSignalsSkill
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
        query:
          type: string
        keyword:
          type: string
        name:
          type: string
      additionalProperties: false
    dependencies:
      - lib/external/aShare/index.ts
      - lib/external/aShare/eastmoney.ts
---

# 使用场景

当用户询问 A 股个股的资金面、筹码、事件驱动或交易活跃信号时使用，例如：

- 龙虎榜、营业部席位、机构买卖。
- 未来限售解禁压力。
- 融资融券余额变化。
- 大宗交易。
- 股东户数变化、筹码集中度。
- 分红送转历史。
- 主力/大单/中单/小单资金流。

# 不适用场景

- 不适用于港股、美股、ETF、基金或加密资产。
- 不输出确定性买卖指令。
- 不替代公司财报分析；财报、公告、研报和三表应使用 `stock.getFinancials`。

# 输出要求

返回结构化信号数据。回答时应明确哪些来源有数据、哪些来源为空。空数组表示公开接口没有返回相关记录，不能据此断言“没有风险”。
