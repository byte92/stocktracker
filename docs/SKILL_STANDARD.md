# StockTracker Skill Standard

StockTracker Skill 遵循 [Agent Skills specification](https://agentskills.io/specification) 的目录结构和 frontmatter 约束：

```text
skills/<skill-name>/SKILL.md
```

每个 `SKILL.md` 必须包含 YAML frontmatter 和 Markdown 指令正文。`skill-name` 必须使用小写字母、数字和连字符，并且必须和 frontmatter 里的 `name` 一致。

标准顶层字段只使用：

- `name`
- `description`
- `license`
- `compatibility`
- `metadata`
- `allowed-tools`

StockTracker 自己的执行信息全部放在 `metadata.stocktracker` 下，不再使用自定义顶层字段。

## Instruction Skill

Instruction Skill 用来教 Agent 如何使用外部工具、CLI、流程或第三方能力。它只进入 Agent 指令上下文，不直接进入 StockTracker 的内部 `execute(args)` 调用链。

```md
---
name: github
description: Use gh for GitHub issues, PR status, CI/logs, comments, reviews, releases, and API queries.
metadata:
  openclaw:
    requires:
      bins:
        - gh
    install:
      - id: brew
        kind: brew
        formula: gh
        bins:
          - gh
        label: Install GitHub CLI (brew)
---

# GitHub Skill

## When to Use

Use this skill when the user asks about GitHub issues, pull requests, CI logs, reviews, releases, or repository API queries.

## When NOT to Use

Do not use this skill for local git operations such as commit, branch, diff, or push.
```

## Executable Skill

Executable Skill 是 StockTracker 内部可结构化调用的 Skill。标准 `name` 是外部 Skill ID；StockTracker 内部历史 action 名称放在 `metadata.stocktracker.action` 中。

它必须在 `metadata.stocktracker` 中声明 `kind: executable`、`action`、`handler`、`scopes` 和 `inputSchema`。

```md
---
name: stock-get-holding
description: 当用户询问某只已持仓股票的成本、收益、仓位、分红、手续费或操作建议时使用。
metadata:
  stocktracker:
    kind: executable
    action: stock.getHolding
    version: 2
    handler: lib/agent/skills/stock.ts#stockGetHoldingSkill
    scopes:
      - stock.read
      - quote.read
    inputSchema:
      type: object
      properties:
        stockId:
          type: string
          description: 本地持仓股票 ID
      required:
        - stockId
      additionalProperties: false
---

# 使用场景

当用户询问某只已持仓股票的成本、收益、仓位、分红、手续费或操作建议时使用。

# 不适用场景

- 用户询问组合整体表现时，优先使用组合类 Skill。
- 用户询问未持仓股票时，使用外部行情类 Skill。

# 输出解释

返回 `stock` 和 `summary`。`summary` 包含持仓数量、成本价、行情价、市值、已实现收益、未实现收益、总收益、手续费和分红。
```

## Compatibility

内置 Skill 使用严格模式加载，必须符合 agentskills.io 规范：

- `name` 必须是 kebab-case。
- `name` 必须匹配父目录名。
- `description` 必须非空且不超过 1024 字符。
- `compatibility` 如果提供，必须是 1-500 字符。
- StockTracker 执行元数据必须放在 `metadata.stocktracker`。

自定义 Skill 仍兼容旧版字段，方便已有本地扩展平滑迁移：

```yaml
name: stock.getHolding
scopes:
  - stock.read
inputs:
  stockId: string
script: lib/agent/skills/stock.ts#stockGetHoldingSkill
```

新 Skill 应优先使用标准 `name` 和 `metadata.stocktracker.inputSchema`。旧字段只用于向后兼容早期自定义 Skill。

## Dual Names

StockTracker Runtime 同时支持两个名称：

- `name`: 标准 Skill ID，例如 `stock-get-holding`。
- `metadata.stocktracker.action`: 内部执行 action，例如 `stock.getHolding`。

Planner 可以从标准 Skill ID 生成提示词；Executor 仍可以通过标准 ID 或内部 action 找到同一个执行器。这样既兼容旧计划，也让 `SKILL.md` 本身符合 agentskills.io 规范。

## Loading Policy

- `name` 和 `description` 是所有 Skill 的必填字段。
- 没有 `handler` 或 `metadata.stocktracker.kind: executable` 的 Skill 默认视为 `instruction`。
- 只有 `executable` Skill 能绑定到内部 `AgentSkill.execute`。
- 第三方 Skill 默认按 `instruction` 加载，不允许直接读取投资数据。
- `metadata.openclaw.requires` 可用于表达第三方 CLI、配置或系统依赖。
- `metadata.openclaw.install` 只作为安装建议展示，不应自动执行。

## Body Guidelines

Markdown 正文应面向 Agent 执行任务，而不是面向用户宣传：

- 写清楚 When to Use / When NOT to Use。
- 写清楚安全边界和数据边界。
- 对复杂命令给出可复制模板。
- 对长参考资料使用 `references/` 渐进加载。
- 对脆弱或确定性强的步骤优先提供脚本。
