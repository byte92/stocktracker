---
name: portfolio-get-summary
description: 读取当前组合的轻量摘要，包括持仓数量、活跃持仓列表、盈亏结构和交易概览。
metadata:
  stocktracker:
    kind: executable
    action: portfolio.getSummary
    version: 1
    handler: ./handler.ts#portfolioGetSummarySkill
    scopes:
      - portfolio.read
    inputSchema: {}
    dependencies:
      - lib/finance.ts
---

# 使用场景

当用户询问组合整体状态、收益结构、风险概览、持仓数量、账户整体表现，或询问当前持仓中是否包含某类标的/某个主题/某个市场时使用。

例如：

- “我的持仓里还有银行吗？”
- “我现在有哪些港股？”
- “持仓里有没有 ETF？”
- “当前组合里还有哪些标的？”

# 不适用场景

- 用户明确询问单只股票时，不应只使用本 Skill。
- 用户需要查看某只股票交易细节时，应配合 `stock.getRecentTrades`。

# 输出要求

返回轻量组合摘要和当前仍有数量的活跃持仓列表，不返回完整原始交易记录。

`holdings` 字段只提供名称、代码、市场、备注、当前数量、成本和最近交易等精简信息。回答行业、主题、类型归属问题时，由 LLM 基于这些字段做语义判断；如果名称、代码、备注不足以判断，应明确说明信息不足，不要编造未提供的行业字段。
