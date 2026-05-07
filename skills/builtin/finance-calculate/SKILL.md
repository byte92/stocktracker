---
name: finance-calculate
description: 执行受控的投资业务域计算，例如基于当前持仓和分红口径估算可分金额。
metadata:
  stocktracker:
    kind: executable
    action: finance.calculate
    version: 1
    handler: ./handler.ts#financeCalculateSkill
    scopes:
      - stock.read
      - trade.read
    inputSchema:
      type: object
      properties:
        type:
          type: string
          enum:
            - dividend.estimate
        stockId:
          type: string
        code:
          type: string
        symbol:
          type: string
        market:
          type: string
        quantity:
          type: number
        cashPerShare:
          type: number
        dividendPer10Shares:
          type: number
      required:
        - type
      additionalProperties: false
    dependencies:
      - lib/finance.ts
      - lib/money.ts
---

# 使用场景

当用户提出仍属于 StockTracker 业务域的确定性计算时使用，例如：

- 根据当前持仓数量和每股分红/派息金额，估算本次可分现金。
- 根据本地最近一次现金收益记录，按相同口径估算下一次分红现金。

# 不适用场景

- 不回答通识类、百科类、娱乐类或与投资业务无关的问题。
- 不执行任意数学题或任意代码计算。
- 不凭空猜测每股分红金额；缺少金额时应通过 `web.search` 补充公开信息，或让用户提供口径。

# 输出要求

返回计算类型、标的、数量、每股金额、估算金额、公式、来源口径和假设。回答时必须说明是税前口径还是实际到账口径。
