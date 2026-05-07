---
name: web-fetch
description: 发起受控网络请求，抓取外部金融数据。仅限白名单域名。
compatibility: Requires public internet access.
metadata:
  stocktracker:
    kind: executable
    action: web.fetch
    version: 1
    handler: lib/agent/skills/web.ts#webFetchSkill
    scopes:
      - network.fetch
    inputSchema:
      type: object
      properties:
        url:
          type: string
        method:
          type: string
        headers:
          type: object
        body:
          type: string
        extractPrompt:
          type: string
      required:
        - url
      additionalProperties: false
    dependencies:
      - lib/agent/skills/web.ts
---

# 使用场景

当内置 Skill 无法覆盖用户需要的数据时使用（如财报、公告、新闻等）。
仅在白名单域名范围内发起请求。

# 安全约束

- 仅允许白名单内金融数据源
- 禁止内网地址（localhost、192.168.x、10.x 等）
- 单次请求最长 15 秒
- 响应正文最大 512KB
- 不传递用户凭据

# 输出要求

返回 HTTP 状态码、响应正文，如果提供了 extractPrompt 则附带 AI 提取摘要。
