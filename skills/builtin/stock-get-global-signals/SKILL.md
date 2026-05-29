---
name: stock-get-global-signals
description: 读取港股/美股扩展信号，包括东财资金流、Yahoo 期权/新闻、SEC Filing，以及可选全市场排名。
metadata:
  stocktracker:
    kind: executable
    action: stock.getGlobalSignals
    version: 1
    handler: ./handler.ts#stockGetGlobalSignalsSkill
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
        includeMarketRank:
          type: boolean
      additionalProperties: false
    dependencies:
      - lib/external/globalStock/index.ts
      - lib/external/globalStock/eastmoney.ts
      - lib/external/globalStock/yahoo.ts
      - lib/external/globalStock/sec.ts
---

# 使用场景

当用户询问港股或美股的扩展市场信号时使用，例如：

- 美股期权链、call/put、到期日、隐含波动率。
- SEC 10-K、10-Q、8-K Filing。
- 美股 XBRL 财务指标的来源追溯。
- 港美股日级资金流。
- 港美股新闻。
- 港美股全市场涨跌幅、成交量或成交额排名。

# 不适用场景

- 不适用于 A 股。A 股资金面和事件信号应使用 `stock.getAshareSignals`。
- 不替代财报分析。财务三表、关键指标、分析师预期和机构持仓会由 `stock.getFinancials` 读取。
- 港股期权不在 Yahoo 覆盖范围内，不能编造期权数据。

# 输出要求

返回结构化信号数据。回答时应说明来源和资料边界，例如 SEC 仅覆盖美股，Yahoo 期权仅覆盖美股，东财资金流可能返回空数组。
