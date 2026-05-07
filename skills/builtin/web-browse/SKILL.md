---
name: web-browse
description: 使用独立 Playwright 浏览器打开用户给定的公开网页，并抽取页面标题和正文。
compatibility: Requires Playwright browser runtime and public internet access.
allowed-tools: Bash(pnpm:*) Bash(npx:*)
metadata:
  stocktracker:
    kind: executable
    action: web.browse
    version: 1
    handler: lib/agent/skills/browser.ts#webBrowseSkill
    scopes:
      - network.fetch
    inputSchema:
      type: object
      properties:
        url:
          type: string
        extractPrompt:
          type: string
      required:
        - url
      additionalProperties: false
    dependencies:
      - playwright
---

# 使用场景

当用户明确给出新闻、公告、研报、交易所页面等网页链接，并希望 Agent 解释、总结或据此回答问题时使用。

`web.browse` 会使用独立 Playwright 浏览器打开页面，等待 DOM 加载并抽取标题、meta 描述和正文文本。

# 不适用场景

- 不用于直接调用 JSON/API 接口；这类场景优先使用 `web.fetch`。
- 不访问内网地址、localhost 或私有 IP。
- 不负责生成投资结论；只提供页面内容证据。

# 输出要求

返回最终 URL、页面标题、HTTP 状态、抓取时间、正文内容，以及按 `extractPrompt` 组织的提取摘要。
