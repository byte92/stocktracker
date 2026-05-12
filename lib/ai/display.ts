import type { AiProbabilityScenario } from '@/types'

export function formatProbabilityScenario(item: AiProbabilityScenario) {
  const record = item as AiProbabilityScenario & {
    reason?: string
    description?: string
    explanation?: string
    impact?: string
  }
  const rationale = record.rationale || record.reason || record.description || record.explanation || record.impact || '暂无说明'
  return `${item.label} ${item.probability}%：${rationale}`
}
