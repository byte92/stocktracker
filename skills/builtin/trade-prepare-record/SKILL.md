---
name: trade-prepare-record
description: 从用户自然语言中整理买入、卖出或分红记录草稿；只返回待确认数据，不写入数据库。
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

当用户要求在对话中录入买入、卖出、加仓、减仓、分红、派息或股息时使用。

# 安全边界

- 该 Skill 只整理草稿，不写入数据库。
- 输出必须提示用户核对：标的、市场、日期、方向、数量、价格、手续费、税费、净额。
- 只有用户明确确认后，才能调用 `trade.commitRecord`。

# 不适用场景

- 用户只是复盘或询问已有交易，不要用它写入新记录。
- 用户缺少关键字段时，应返回缺失项并继续追问。
