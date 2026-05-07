---
name: market-get-analysis-context
description: 为固定大盘 AI 分析读取 A 股、港股、美股指数、技术指标和新闻上下文。
metadata:
  stocktracker:
    kind: executable
    action: market.getAnalysisContext
    version: 1
    handler: ./handler.ts#marketGetAnalysisContextSkill
    scopes:
      - market.read
      - quote.read
    inputSchema: {}
    dependencies:
      - lib/marketOverview.ts
      - lib/technicalIndicators.ts
    prompt: lib/agent/prompts/analysis.ts#MARKET_ANALYSIS_PROMPT
---

# 使用场景

当系统执行固定模板的大盘分析，或用户询问 A 股、港股、美股整体节奏、强弱分化、风险偏好时使用。

# 不适用场景

- 用户明确询问单只股票时，应使用个股类 Skill。
- 用户询问当前持仓组合风险时，应使用组合类 Skill。

# 输出要求

返回三地代表指数、技术指标摘要、强弱排序和新闻摘要，不返回无关个股数据。

# 提示词边界

大盘分析提示词由本 Skill 绑定的固定模板维护。设置页不再支持覆盖该提示词；如需定制，应新增或替换 Skill。
