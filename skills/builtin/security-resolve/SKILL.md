---
name: security-resolve
description: 基础证券实体解析，将股票/ETF/基金名称、代码、简称或自然语言提问解析为标准 code、name、market 和持仓状态。
metadata:
  stocktracker:
    kind: executable
    action: security.resolve
    version: 1
    handler: lib/agent/skills/security.ts#securityResolveSkill
    scopes:
      - stock.read
      - quote.read
    inputSchema:
      type: object
      properties:
        query:
          type: string
        limit:
          type: number
      required:
        - query
      additionalProperties: false
    dependencies:
      - lib/agent/entity/securityResolver.ts
      - lib/agent/entity/externalCandidates.ts
      - lib/agent/entity/stockMatcher.ts
---

# 使用场景

所有名称/代码转换都应先使用本 Skill。
它负责把用户输入的股票名称、代码、简称、ETF 名称或自然语言问题解析为统一候选：

- code
- name
- market
- confidence
- inPortfolio
- stockId
- source

# 数据来源顺序

1. 当前本地持仓。
2. 本地常用别名和 ETF 映射。
3. 腾讯 smartbox 名称搜索。
4. 代码形态推断。

# 不适用场景

- 不负责抓取行情，行情由 `stock.getQuote` 或 `stock.getExternalQuote` 负责。
- 不负责生成投资建议。
- 不负责替代用户在多个低置信候选之间做选择。

# 输出要求

返回 candidates 数组。业务 Skill 应优先消费标准化后的 `code + market`，不要直接拿中文名称请求行情源。
