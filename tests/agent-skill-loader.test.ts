import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getSkillByName } from '@/lib/agent/skills/registry'
import { loadBuiltinSkillManifests, loadConfiguredSkillManifests } from '@/lib/agent/skills/loader'
import { buildPlannerSystemPrompt } from '@/lib/agent/planner/prompt'

test('agent skill loader reads builtin markdown manifests', () => {
  const manifests = loadBuiltinSkillManifests()
  const names = manifests.map((manifest) => manifest.name).sort()

  assert.deepEqual(names, [
    'finance.calculate',
    'market.getAnalysisContext',
    'market.resolveCandidate',
    'portfolio.getAnalysisContext',
    'portfolio.getSummary',
    'portfolio.getTopPositions',
    'security.resolve',
    'stock.getAnalysisContext',
    'stock.getExternalQuote',
    'stock.getFinancials',
    'stock.getHolding',
    'stock.getQuote',
    'stock.getRecentTrades',
    'stock.getTechnicalSnapshot',
    'stock.match',
    'web.browse',
    'web.fetch',
    'web.search',
  ].sort())

  const holding = manifests.find((manifest) => manifest.name === 'stock.getHolding')
  assert.ok(holding)
  assert.equal(holding.inputs.stockId, 'string')
  assert.deepEqual(holding.scopes, ['stock.read', 'quote.read'])
  assert.ok(holding.documentation.includes('使用场景'))

  const resolver = manifests.find((manifest) => manifest.name === 'security.resolve')
  assert.ok(resolver)
  assert.equal(resolver.inputs.query, 'string')
  assert.deepEqual(resolver.scopes, ['stock.read', 'quote.read'])
})

test('agent skill registry binds markdown metadata to internal executors', () => {
  const skill = getSkillByName('stock.getHolding')

  assert.ok(skill)
  assert.equal(skill.version, 1)
  assert.equal(skill.inputSchema.stockId, 'string')
  assert.deepEqual(skill.requiredScopes, ['stock.read', 'quote.read'])
  assert.ok(skill.sourcePath?.endsWith('skills/builtin/stock-get-holding/SKILL.md'))
  assert.equal(typeof skill.execute, 'function')
})

test('agent skill registry exposes fixed analysis task skills', () => {
  const portfolioSkill = getSkillByName('portfolio.getAnalysisContext')
  const stockSkill = getSkillByName('stock.getAnalysisContext')

  assert.ok(portfolioSkill)
  assert.deepEqual(portfolioSkill.requiredScopes, ['portfolio.read', 'quote.read'])
  assert.equal(portfolioSkill.prompt, 'lib/agent/prompts/analysis.ts#PORTFOLIO_ANALYSIS_PROMPT')
  assert.ok(portfolioSkill.sourcePath?.endsWith('skills/builtin/portfolio-get-analysis-context/SKILL.md'))

  assert.ok(stockSkill)
  assert.deepEqual(stockSkill.requiredScopes, ['stock.read', 'trade.read', 'quote.read'])
  assert.equal(stockSkill.prompt, 'lib/agent/prompts/analysis.ts#STOCK_ANALYSIS_PROMPT')
  assert.ok(stockSkill.sourcePath?.endsWith('skills/builtin/stock-get-analysis-context/SKILL.md'))

  const marketSkill = getSkillByName('market.getAnalysisContext')
  assert.ok(marketSkill)
  assert.deepEqual(marketSkill.requiredScopes, ['market.read', 'quote.read'])
  assert.equal(marketSkill.prompt, 'lib/agent/prompts/analysis.ts#MARKET_ANALYSIS_PROMPT')
  assert.ok(marketSkill.sourcePath?.endsWith('skills/builtin/market-get-analysis-context/SKILL.md'))
})

test('agent planner prompt builds its skill catalog from registered manifests', () => {
  const prompt = buildPlannerSystemPrompt()

  assert.ok(prompt.includes('可用的 Skill（由注册表生成'))
  assert.ok(prompt.includes('web.browse: 使用独立 Playwright 浏览器打开用户给定的公开网页'))
  assert.ok(prompt.includes('stock.getHolding: 读取单只股票的本地持仓、成本、盈亏和备注'))
  assert.ok(!prompt.includes('stock.getAnalysisContext:'))
  assert.ok(!prompt.includes('portfolio.getAnalysisContext:'))
})

test('agent skill loader supports OpenClaw-style instruction skills', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stocktracker-openclaw-skills-'))
  const skillDir = path.join(root, 'github')
  fs.mkdirSync(skillDir)
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
    '---',
    'name: github',
    'description: Use gh for GitHub issues, PR status, CI/logs, comments, reviews, releases, and API queries.',
    'metadata:',
    '  openclaw:',
    '    requires:',
    '      bins:',
    '        - gh',
    '    install:',
    '      - id: brew',
    '        kind: brew',
    '        formula: gh',
    '        bins:',
    '          - gh',
    '        label: Install GitHub CLI (brew)',
    '---',
    '',
    '# GitHub Skill',
    '',
    'Use the `gh` CLI to interact with GitHub repositories.',
  ].join('\n'))

  const manifests = loadConfiguredSkillManifests([root])
  assert.equal(manifests.length, 1)
  assert.equal(manifests[0].name, 'github')
  assert.equal(manifests[0].kind, 'instruction')
  assert.deepEqual(manifests[0].scopes, [])
  assert.deepEqual((manifests[0].metadata.openclaw as any).requires.bins, ['gh'])
  assert.ok(manifests[0].documentation.includes('GitHub Skill'))
})

test('agent skill loader supports stocktracker executable metadata extension', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stocktracker-executable-skills-'))
  const skillDir = path.join(root, 'custom-holding')
  fs.mkdirSync(skillDir)
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
    '---',
    'name: stock.getHolding',
    'description: 使用标准 metadata.stocktracker 声明可执行 Skill。',
    'version: 3',
    'metadata:',
    '  stocktracker:',
    '    kind: executable',
    '    handler: lib/agent/skills/stock.ts#stockGetHoldingSkill',
    '    scopes:',
    '      - stock.read',
    '      - quote.read',
    '    inputSchema:',
    '      type: object',
    '      properties:',
    '        stockId:',
    '          type: string',
    '          description: 本地持仓股票 ID',
    '      required:',
    '        - stockId',
    '      additionalProperties: false',
    '---',
    '',
    '# 使用场景',
    '',
    '用于测试新的 StockTracker 可执行 Skill 扩展。',
  ].join('\n'))

  const manifests = loadConfiguredSkillManifests([root])
  assert.equal(manifests.length, 1)
  assert.equal(manifests[0].kind, 'executable')
  assert.equal(manifests[0].handler, 'lib/agent/skills/stock.ts#stockGetHoldingSkill')
  assert.deepEqual(manifests[0].scopes, ['stock.read', 'quote.read'])
  assert.equal(manifests[0].inputSchema.type, 'object')
  assert.deepEqual(manifests[0].inputSchema.required, ['stockId'])
})

test('agent skill loader reads external skill manifest roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stocktracker-skills-'))
  const skillDir = path.join(root, 'custom-stock-holding')
  fs.mkdirSync(skillDir)
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
    '---',
    'name: stock.getHolding',
    'description: 自定义持仓读取说明。',
    'version: 2',
    'scopes:',
    '  - stock.read',
    'inputs:',
    '  stockId: string',
    'dependencies:',
    '  - lib/finance.ts',
    'script: lib/agent/skills/stock.ts#stockGetHoldingSkill',
    'prompt: skills/custom/stock-holding.md',
    '---',
    '',
    '# 使用场景',
    '',
    '外部 Skill manifest 可以覆盖内置 Skill 的描述和提示词绑定。',
  ].join('\n'))

  const manifests = loadConfiguredSkillManifests([root])
  assert.equal(manifests.length, 1)
  assert.equal(manifests[0].name, 'stock.getHolding')
  assert.equal(manifests[0].description, '自定义持仓读取说明。')
  assert.equal(manifests[0].version, 2)
  assert.equal(manifests[0].prompt, 'skills/custom/stock-holding.md')
})
