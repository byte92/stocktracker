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
  'finance.calculate',
])

function isPlannerVisibleSkill(skill: AgentSkill) {
  return !PLANNER_EXCLUDED_SKILL_PATTERNS.some((pattern) => pattern.test(skill.name))
}

function formatInputSchema(inputSchema: Record<string, unknown>) {
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

export function getPlannerVisibleSkills() {
  return getBuiltinSkills().filter(isPlannerVisibleSkill)
}

export function buildPlannerSkillCatalogText() {
  return getPlannerVisibleSkills()
    .map((skill) => `- ${skill.name}: ${skill.description} args ${formatInputSchema(skill.inputSchema)}`)
    .join('\n')
}

export function isWebSkillName(name: string) {
  return name.startsWith('web.')
}

export function isPlannerNormalizedSkillName(name: string) {
  return PLANNER_NORMALIZED_SKILLS.has(name) || name.startsWith('web.')
}
