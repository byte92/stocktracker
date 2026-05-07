---
name: market-resolve-candidate
description: 旧版兼容解析 Skill，内部转发到 security.resolve。
metadata:
  stocktracker:
    kind: executable
    action: market.resolveCandidate
    version: 1
    handler: ./handler.ts#marketResolveCandidateSkill
    scopes:
      - quote.read
    inputSchema:
      type: object
      properties:
        query:
          type: string
      required:
        - query
      additionalProperties: false
    dependencies:
      - lib/agent/entity/stockMatcher.ts
---

# 使用场景

旧版兼容入口。新计划应优先使用 `security.resolve`。
当用户输入股票名称、代码或简称，但该标的未在当前持仓中、或存在多市场歧义时，可返回候选列表。
返回候选列表供 Planner 决定是否需要澄清或直接抓取行情。

# 不适用场景

- 不负责抓取行情数据（由 stock.getExternalQuote 负责）。
- 不负责生成最终投资分析。

# 输出要求

返回 candidates 数组，每项包含 code、name、market、confidence。
如果本地持仓有匹配，优先返回持仓信息。
如果无匹配，按代码规则推断可能的市场（纯数字→A股，数字.HK→港股，字母→美股）。
