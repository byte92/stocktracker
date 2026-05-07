---
name: stock-get-analysis-context
description: 为固定个股 AI 分析读取持仓、行情、技术指标和新闻上下文。
metadata:
  stocktracker:
    kind: executable
    action: stock.getAnalysisContext
    version: 1
    handler: lib/agent/skills/analysis.ts#stockGetAnalysisContextSkill
    scopes:
      - stock.read
      - trade.read
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
      - lib/StockPriceService.ts
      - lib/technicalIndicators.ts
    prompt: lib/agent/prompts/analysis.ts#STOCK_ANALYSIS_PROMPT
---

# 使用场景

当系统执行固定模板的 AI 个股分析时使用。

# 不适用场景

- 用户在自由对话中询问组合整体风险时，不应调用本 Skill。
- 用户只需要当前行情时，应优先使用 `stock.getQuote` 或 `stock.getExternalQuote`。

# 输出要求

返回单只股票分析需要的持仓、成本、盈亏、行情、技术指标和新闻摘要，不返回无关股票数据。

# 提示词边界

个股分析提示词由本 Skill 绑定的固定模板维护。设置页不再支持覆盖该提示词；如需定制，应新增或替换 Skill。
