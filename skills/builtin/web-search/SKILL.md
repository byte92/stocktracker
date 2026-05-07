---
name: web-search
description: 通过 Playwright 模拟浏览器搜索最新财报、公告、新闻等公开信息，并抓取二级页面内容。
compatibility: Requires Playwright browser runtime and public internet access.
allowed-tools: Bash(pnpm:*) Bash(npx:*)
metadata:
  stocktracker:
    kind: executable
    action: web.search
    version: 1
    handler: ./handler.ts#webSearchSkill
    scopes:
      - network.fetch
    inputSchema:
      type: object
      properties:
        query:
          type: string
        queries:
          type: array
          items:
            type: string
        sourceHints:
          type: array
          items:
            type: string
        limit:
          type: number
        searchLimit:
          type: number
      required:
        - query
      additionalProperties: false
    dependencies:
      - playwright
---

# 使用场景

当内置 Skill 无法覆盖用户需要的最新数据时使用（如财报、公告、新闻等）。
通过 Playwright 驱动搜索引擎获取候选结果，再打开二级页面抓取正文并做相关性筛选。

`web.search` 不负责理解金融语义，也不会按场景硬编码改写 query。
Planner/模型需要提前把用户问题提取成可独立搜索的 `query`，必要时提供：

- `queries`: 模型生成的候选搜索句。
- `sourceHints`: 模型判断应优先参考的来源、域名或机构名。

# 不适用场景

- 不负责生成投资分析或评级。
- 搜索结果可能包含付费广告或不可靠来源。

# 输出要求

返回搜索结果列表，每项包含标题、摘要、URL、搜索源和二级页面正文摘要。
回答生成时应把结果作为“公开网页候选来源”引用，标明搜索时间、标题、链接和摘要/要点，不应表述为实时数据库事实。
