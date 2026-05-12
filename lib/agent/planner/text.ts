import type { AgentSkillCall } from '@/lib/agent/types'

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function dedupeSkillCalls(calls: AgentSkillCall[]) {
  const seen = new Set<string>()
  const result: AgentSkillCall[] = []
  for (const call of calls) {
    const key = `${call.name}:${stableStringify(call.args)}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(call)
  }
  return result
}

export function textArg(args: Record<string, unknown> | undefined, keys: string[]) {
  if (!args) return ''
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

export function stringArrayArg(args: Record<string, unknown> | undefined, key: string) {
  const value = args?.[key]
  if (!Array.isArray(value)) return []
  return Array.from(new Set(
    value
      .map((item) => (typeof item === 'string' ? item.replace(/\s+/g, ' ').trim() : ''))
      .filter(Boolean),
  ))
}

export function extractUrls(content: string) {
  const matches = content.match(/https?:\/\/[^\s，。！？、]+/g) ?? []
  return Array.from(new Set(matches.map((item) => item.replace(/[)\]}）】]+$/, ''))))
}

export function stripUrls(content: string) {
  return content.replace(/https?:\/\/[^\s，。！？、]+/g, '').replace(/\s+/g, ' ').trim()
}
