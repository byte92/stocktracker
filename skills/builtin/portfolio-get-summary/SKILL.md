---
name: portfolio-get-summary
description: 读取当前组合的轻量摘要，包括持仓数量、盈亏结构和交易概览。
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

当用户询问组合整体状态、收益结构、风险概览、持仓数量或账户整体表现时使用。

# 不适用场景

- 用户明确询问单只股票时，不应只使用本 Skill。
- 用户需要查看某只股票交易细节时，应配合 `stock.getRecentTrades`。

# 输出要求

返回轻量组合摘要，不返回全量股票列表和完整交易记录。
