---
name: trade-commit-record
description: 在用户明确确认后，将已确认的买入、卖出或分红草稿写入本地数据库。
metadata:
  stocktracker:
    kind: executable
    action: trade.commitRecord
    version: 1
    handler: ./handler.ts#tradeCommitRecordSkill
    scopes:
      - trade.write
      - stock.read
    inputSchema:
      type: object
      properties:
        draft:
          type: object
          description: 已经由用户确认的交易或分红草稿
      required:
        - draft
      additionalProperties: false
---

# 使用场景

仅当用户已经明确确认待录入数据无误时使用。

# 安全边界

- 不要自行调用该 Skill 完成首次录入。
- 如果用户还在更正、犹豫或提出疑问，应继续整理草稿，不得写入数据库。
- 写入后返回实际写入的标的与交易记录摘要。

# 确认判定策略

`trade.commitRecord` 只能在用户对上一轮 `trade.prepareRecord` 返回的待确认草稿作出明确肯定后执行。

Agent 必须把用户回复归类为以下四种之一：

- `confirm`：用户明确表示草稿无误、同意录入、保存、提交或写入数据库。
- `cancel`：用户明确表示取消、作废、不录入、暂不保存或放弃本次录入。
- `revise`：用户正在修改或补充草稿字段，例如标的、市场、日期、方向、数量、价格、分红金额、手续费、税费、净额或备注。
- `unknown`：用户只是提问、犹豫、闲聊，或不能可靠判断是否确认、取消或更正。

只有 `confirm` 可以触发写入。`cancel` 必须清除待确认草稿且不写入。`revise` 必须重新整理草稿并再次请用户确认。`unknown` 必须继续追问，不得写入。

确认判定必须由 LLM 根据本 Skill 的规则完成。模型判断失败、置信度不足或 AI 配置不可用时，应向用户报错或要求更明确回复，不得使用本地关键词兜底写入。
