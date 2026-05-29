import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { AgentDataScope, AgentSkill } from '@/lib/agent/types'

export type StockTrackerSkillMetadata = {
  kind?: 'instruction' | 'executable'
  action?: string
  handler?: string
  scopes?: AgentDataScope[]
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  prompt?: string
  dependencies?: string[]
  version?: number
}

export type AgentSkillManifest = {
  /** Agent Skills spec-compliant id, for example stock-get-holding. */
  name: string
  /** Internal StockTracker action alias, for example stock.getHolding. */
  actionName?: string
  description: string
  version?: number
  license?: string
  compatibility?: string
  allowedTools?: string
  kind: 'instruction' | 'executable'
  scopes: AgentDataScope[]
  /** Legacy alias kept for current builtin manifests. Prefer inputSchema. */
  inputs: Record<string, unknown>
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  dependencies: string[]
  runtime?: string
  handler?: string
  /** Legacy alias for handler. */
  script?: string
  prompt?: string
  metadata: Record<string, unknown>
  stocktracker?: StockTrackerSkillMetadata
  documentation: string
  sourcePath: string
}

const SKILL_FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/
const AGENT_SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const LEGACY_ACTION_NAME_PATTERN = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/

type ParseSkillOptions = {
  allowLegacyName?: boolean
  requireDirectoryNameMatch?: boolean
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : []
}

function asAgentScopes(value: unknown) {
  return asStringArray(value) as AgentDataScope[]
}

function pickSchema(...values: unknown[]) {
  for (const value of values) {
    const record = asRecord(value)
    if (Object.keys(record).length) return record
  }
  return {}
}

function parseFrontmatter(raw: string) {
  return asRecord(parseYaml(raw))
}

function resolveSkillReference(filePath: string, reference: string | undefined) {
  if (!reference) return undefined
  if (!reference.startsWith('.')) return reference

  const [targetPath, exportName] = reference.split('#')
  const resolvedPath = path.relative(
    /*turbopackIgnore: true*/ process.cwd(),
    path.resolve(path.dirname(filePath), targetPath),
  )
  return [resolvedPath, exportName].filter(Boolean).join('#')
}

function resolveSkillReferences(filePath: string, references: string[]) {
  return references.map((reference) => resolveSkillReference(filePath, reference) ?? reference)
}

function getStockTrackerMetadata(metadata: Record<string, unknown>): StockTrackerSkillMetadata | undefined {
  const raw = asRecord(metadata.stocktracker)
  if (!Object.keys(raw).length) return undefined

  const kind = raw.kind === 'executable' || raw.kind === 'instruction' ? raw.kind : undefined
  const inputSchema = pickSchema(raw.inputSchema, raw.input_schema)
  const outputSchema = pickSchema(raw.outputSchema, raw.output_schema)

  return {
    kind,
    action: typeof raw.action === 'string' ? raw.action : undefined,
    handler: typeof raw.handler === 'string' ? raw.handler : undefined,
    scopes: Array.isArray(raw.scopes) ? asAgentScopes(raw.scopes) : undefined,
    inputSchema: Object.keys(inputSchema).length ? inputSchema : undefined,
    outputSchema: Object.keys(outputSchema).length ? outputSchema : undefined,
    prompt: typeof raw.prompt === 'string' ? raw.prompt : undefined,
    dependencies: Array.isArray(raw.dependencies) ? asStringArray(raw.dependencies) : undefined,
    version: typeof raw.version === 'number' ? raw.version : undefined,
  }
}

function validateSkillFrontmatter({
  filePath,
  name,
  description,
  metadata,
  compatibility,
  allowLegacyName,
  requireDirectoryNameMatch,
}: {
  filePath: string
  name: string
  description: string
  metadata: Record<string, unknown>
  compatibility?: string
  allowLegacyName: boolean
  requireDirectoryNameMatch: boolean
}) {
  if (!name || !description) {
    throw new Error(`Skill frontmatter 必须包含 name 和 description：${filePath}`)
  }
  if (name.length > 64) {
    throw new Error(`Skill name 不能超过 64 个字符：${filePath}`)
  }
  const isSpecName = AGENT_SKILL_NAME_PATTERN.test(name)
  const isLegacyName = allowLegacyName && LEGACY_ACTION_NAME_PATTERN.test(name)
  if (!isSpecName && !isLegacyName) {
    throw new Error(`Skill name 必须使用 agentskills.io 规范的 kebab-case：${filePath}`)
  }
  if (requireDirectoryNameMatch && isSpecName && path.basename(path.dirname(filePath)) !== name) {
    throw new Error(`Skill name 必须与父目录名一致：${filePath}`)
  }
  if (description.length > 1024) {
    throw new Error(`Skill description 不能超过 1024 个字符：${filePath}`)
  }
  if (compatibility !== undefined && (compatibility.length === 0 || compatibility.length > 500)) {
    throw new Error(`Skill compatibility 必须为 1-500 个字符：${filePath}`)
  }
  if (metadata && typeof metadata !== 'object') {
    throw new Error(`Skill metadata 必须是对象：${filePath}`)
  }
}

export function parseSkillMarkdown(filePath: string, options: ParseSkillOptions = {}): AgentSkillManifest {
  const raw = fs.readFileSync(filePath, 'utf8')
  const match = raw.match(SKILL_FRONTMATTER_PATTERN)
  if (!match) {
    throw new Error(`Skill 缺少 frontmatter：${filePath}`)
  }

  const frontmatter = parseFrontmatter(match[1])
  const name = String(frontmatter.name ?? '').trim()
  const description = String(frontmatter.description ?? '').trim()
  const metadata = asRecord(frontmatter.metadata)
  const license = typeof frontmatter.license === 'string' ? frontmatter.license.trim() : undefined
  const compatibility = typeof frontmatter.compatibility === 'string' ? frontmatter.compatibility.trim() : undefined
  const allowedTools = typeof frontmatter['allowed-tools'] === 'string' ? frontmatter['allowed-tools'].trim() : undefined
  validateSkillFrontmatter({
    filePath,
    name,
    description,
    metadata,
    compatibility,
    allowLegacyName: options.allowLegacyName ?? true,
    requireDirectoryNameMatch: options.requireDirectoryNameMatch ?? false,
  })

  const stocktracker = getStockTrackerMetadata(metadata)
  const inputs = asRecord(frontmatter.inputs)
  const inputSchema = stocktracker?.inputSchema ?? pickSchema(frontmatter.inputSchema, frontmatter.input_schema, inputs)
  const outputSchema = stocktracker?.outputSchema ?? pickSchema(frontmatter.outputSchema, frontmatter.output_schema)
  const rawHandler = stocktracker?.handler
    ?? (typeof frontmatter.handler === 'string' ? frontmatter.handler : undefined)
    ?? (typeof frontmatter.script === 'string' ? frontmatter.script : undefined)
  const handler = resolveSkillReference(filePath, rawHandler)
  const script = resolveSkillReference(filePath, typeof frontmatter.script === 'string' ? frontmatter.script : rawHandler)
  const prompt = resolveSkillReference(filePath, stocktracker?.prompt ?? (typeof frontmatter.prompt === 'string' ? frontmatter.prompt : undefined))
  const dependencies = resolveSkillReferences(filePath, stocktracker?.dependencies ?? asStringArray(frontmatter.dependencies))
  const scopes = stocktracker?.scopes ?? asAgentScopes(frontmatter.scopes)
  const explicitKind = stocktracker?.kind
    ?? (frontmatter.kind === 'executable' || frontmatter.kind === 'instruction' ? frontmatter.kind : undefined)
  const kind = explicitKind ?? (handler ? 'executable' : 'instruction')
  const version = stocktracker?.version ?? (typeof frontmatter.version === 'number' ? frontmatter.version : undefined)
  const actionName = stocktracker?.action ?? (LEGACY_ACTION_NAME_PATTERN.test(name) ? name : undefined)

  return {
    name,
    actionName,
    description,
    version,
    license,
    compatibility,
    allowedTools,
    kind,
    scopes,
    inputs,
    inputSchema,
    outputSchema: Object.keys(outputSchema).length ? outputSchema : undefined,
    dependencies,
    runtime: typeof frontmatter.runtime === 'string' ? frontmatter.runtime : undefined,
    handler,
    script,
    prompt,
    metadata,
    stocktracker,
    documentation: match[2].trim(),
    sourcePath: filePath,
  }
}

export function loadSkillManifests(rootDir: string, options: ParseSkillOptions = {}) {
  if (!fs.existsSync(rootDir)) return []
  const rootSkillPath = path.join(rootDir, 'SKILL.md')
  if (fs.existsSync(rootSkillPath)) {
    return [parseSkillMarkdown(rootSkillPath, options)]
  }
  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootDir, entry.name, 'SKILL.md'))
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => parseSkillMarkdown(filePath, options))
}

export function loadBuiltinSkillManifests(rootDir = path.join(/*turbopackIgnore: true*/ process.cwd(), 'skills', 'builtin')) {
  return loadSkillManifests(rootDir, { allowLegacyName: false, requireDirectoryNameMatch: true })
}

function getConfiguredSkillRoots() {
  const roots = [path.join(/*turbopackIgnore: true*/ process.cwd(), 'skills', 'custom')]
  const envRoots = process.env.AGENT_SKILL_PATHS
    ?.split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean) ?? []
  return [...roots, ...envRoots]
}

export function loadConfiguredSkillManifests(roots = getConfiguredSkillRoots()) {
  return roots.flatMap((root) => loadSkillManifests(path.isAbsolute(root) ? root : path.join(/*turbopackIgnore: true*/ process.cwd(), root), { allowLegacyName: true }))
}

export function applySkillManifest<TArgs, TResult>(
  skill: AgentSkill<TArgs, TResult>,
  manifest: AgentSkillManifest | null,
): AgentSkill<TArgs, TResult> {
  if (!manifest) return skill
  return {
    ...skill,
    id: manifest.name,
    actionName: manifest.actionName ?? skill.actionName ?? skill.name,
    description: manifest.description,
    version: manifest.version,
    license: manifest.license,
    compatibility: manifest.compatibility,
    allowedTools: manifest.allowedTools,
    inputSchema: manifest.inputSchema,
    requiredScopes: manifest.scopes,
    dependencies: manifest.dependencies,
    script: manifest.script,
    prompt: manifest.prompt,
    documentation: manifest.documentation,
    sourcePath: manifest.sourcePath,
  }
}
