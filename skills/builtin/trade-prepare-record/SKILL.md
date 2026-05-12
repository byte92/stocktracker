---
name: trade-prepare-record
description: 当用户表达“要录入一笔已经发生或即将入账的交易/分红事实”时，从自然语言整理记录草稿；只返回待确认数据，不写入数据库。
metadata:
  stocktracker:
    kind: executable
    action: trade.prepareRecord
    version: 1
    handler: ./handler.ts#tradePrepareRecordSkill
    scopes:
      - stock.read
      - trade.read
    inputSchema:
      type: object
      properties:
        text:
          type: string
          description: 用户原始交易或分红录入文本
        correctionText:
          type: string
          description: 用户对上一次待确认草稿的更正
        previousDraft:
          type: object
          description: 上一次待确认草稿
      additionalProperties: false
---

# 使用场景

当用户表达的主要意图是“把一笔交易或现金收益写入 StockTracker”时使用。Planner 应根据上下文判断用户是在陈述待记录事实，还是只是在询问、复盘或征求建议。

# 安全边界

- 该 Skill 只整理草稿，不写入数据库。
- 输出必须提示用户核对：标的、市场、日期、方向、数量、价格、手续费、税费、净额。
- 只有用户明确确认后，才能调用 `trade.commitRecord`。

# 不适用场景

- 用户只是复盘、询问已有交易、讨论是否应该操作或请求投资建议时，不要用它写入新记录。
- 用户缺少关键字段时，应返回缺失项并继续追问。
