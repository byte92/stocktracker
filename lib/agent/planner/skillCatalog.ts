import { getBuiltinSkills } from '@/lib/agent/skills/registry'
import type { AgentSkill } from '@/lib/agent/types'

const PLANNER_EXCLUDED_SKILL_PATTERNS = [
  /\.getAnalysisContext$/,
]
const PLANNER_NORMALIZED_SKILLS = new Set([
  'security.resolve',
  'market.resolveCandidate',
  'stock.match',
  'stock.getHolding',
  'stock.getRecentTrades',
  'stock.getQuote',
  'stock.getExternalQuote',
  'stock.getTechnicalSnapshot',
  'stock.getFinancials',
  'stock.getAshareSignals',
  'stock.getGlobalSignals',
  'finance.calculate',
  'trade.prepareRecord',
  'trade.commitRecord',
])

function isPlannerVisibleSkill(skill: AgentSkill) {
  const actionName = skill.actionName ?? skill.name
  return !PLANNER_EXCLUDED_SKILL_PATTERNS.some((pattern) => pattern.test(actionName))
}

function formatInputSchema(inputSchema: Record<string, unknown>) {
  const properties = inputSchema.properties && typeof inputSchema.properties === 'object' && !Array.isArray(inputSchema.properties)
    ? inputSchema.properties as Record<string, unknown>
    : null
  if (properties) {
    const required = Array.isArray(inputSchema.required) ? new Set(inputSchema.required.map(String)) : new Set<string>()
    const compact = Object.entries(properties)
      .map(([key, value]) => {
        const optional = required.has(key) ? '' : '?'
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const type = typeof (value as Record<string, unknown>).type === 'string' ? (value as Record<string, unknown>).type : 'unknown'
          return `${key}${optional}: ${type}`
        }
        return `${key}${optional}: unknown`
      })
      .join(', ')
    return compact ? `{ ${compact} }` : '{}'
  }

  const entries = Object.entries(inputSchema)
  if (!entries.length) return '{}'

  const compact = entries
    .map(([key, value]) => {
      if (typeof value === 'string') return `${key}: ${value}`
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const record = value as Record<string, unknown>
        const type = typeof record.type === 'string' ? record.type : 'unknown'
        const description = typeof record.description === 'string' ? ` (${record.description})` : ''
        return `${key}: ${type}${description}`
      }
      return `${key}: ${String(value)}`
    })
    .join(', ')

  return `{ ${compact} }`
}

function formatPlannerGuidance(documentation: string | undefined) {
  const text = documentation
    ?.replace(/^---[\s\S]*?---\s*/g, '')
    .replace(/#+\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text ? ` guidance ${text.slice(0, 420)}` : ''
}

export function getPlannerVisibleSkills() {
  return getBuiltinSkills().filter(isPlannerVisibleSkill)
}

export function buildPlannerSkillCatalogText() {
  return getPlannerVisibleSkills()
    .map((skill) => {
      const publicName = skill.id ?? skill.name
      const actionName = skill.actionName && skill.actionName !== publicName ? ` (action: ${skill.actionName})` : ''
      return `- ${publicName}${actionName}: ${skill.description} args ${formatInputSchema(skill.inputSchema)}${formatPlannerGuidance(skill.documentation)}`
    })
    .join('\n')
}

export function isWebSkillName(name: string) {
  return name.startsWith('web.')
}

export function isPlannerNormalizedSkillName(name: string) {
  return PLANNER_NORMALIZED_SKILLS.has(name) || name.startsWith('web.')
}

export function resolvePlannerSkillActionName(name: string) {
  const skill = getBuiltinSkills().find((item) => item.name === name || item.id === name || item.actionName === name)
  return skill?.actionName ?? skill?.name ?? name
}
