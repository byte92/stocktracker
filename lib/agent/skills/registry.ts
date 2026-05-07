import type { AgentSkill } from '@/lib/agent/types'
import { applySkillManifest, loadBuiltinSkillManifests, loadConfiguredSkillManifests } from '@/lib/agent/skills/loader'
import { portfolioGetAnalysisContextSkill, stockGetAnalysisContextSkill } from '@/lib/agent/skills/analysis'
import { marketGetAnalysisContextSkill, marketResolveCandidateSkill } from '@/lib/agent/skills/market'
import { securityResolveSkill } from '@/lib/agent/skills/security'
import { financeCalculateSkill } from '@/lib/agent/skills/finance'
import { webBrowseSkill } from '@/lib/agent/skills/browser'
import { webSearchSkill } from '@/lib/agent/skills/search'
import { webFetchSkill } from '@/lib/agent/skills/web'
import { portfolioGetSummarySkill, portfolioGetTopPositionsSkill } from '@/lib/agent/skills/portfolio'
import {
  stockGetExternalQuoteSkill,
  stockGetHoldingSkill,
  stockGetQuoteSkill,
  stockGetRecentTradesSkill,
  stockGetTechnicalSnapshotSkill,
  stockGetFinancialsSkill,
  stockMatchSkill,
} from '@/lib/agent/skills/stock'

const BUILTIN_SKILLS: AgentSkill<any, any>[] = [
  securityResolveSkill,
  financeCalculateSkill,
  marketResolveCandidateSkill,
  marketGetAnalysisContextSkill,
  webBrowseSkill,
  webFetchSkill,
  webSearchSkill,
  portfolioGetAnalysisContextSkill,
  portfolioGetSummarySkill,
  portfolioGetTopPositionsSkill,
  stockGetAnalysisContextSkill,
  stockMatchSkill,
  stockGetHoldingSkill,
  stockGetRecentTradesSkill,
  stockGetQuoteSkill,
  stockGetExternalQuoteSkill,
  stockGetTechnicalSnapshotSkill,
  stockGetFinancialsSkill,
]

const MANIFESTS = [
  ...loadBuiltinSkillManifests(),
  ...loadConfiguredSkillManifests(),
]
const MANIFEST_BY_ACTION = new Map(MANIFESTS.map((manifest) => [manifest.actionName ?? manifest.name, manifest]))
const MANIFEST_BY_NAME = new Map(MANIFESTS.map((manifest) => [manifest.name, manifest]))
const REGISTERED_SKILLS = BUILTIN_SKILLS.map((skill) => applySkillManifest(skill, MANIFEST_BY_ACTION.get(skill.name) ?? MANIFEST_BY_NAME.get(skill.name) ?? null))

export function getBuiltinSkills() {
  return REGISTERED_SKILLS
}

export function getRegisteredSkillManifests() {
  return MANIFESTS
}

export function getSkillByName(name: string) {
  return REGISTERED_SKILLS.find((skill) => skill.name === name || skill.id === name || skill.actionName === name) ?? null
}
