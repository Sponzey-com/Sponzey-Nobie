import type { CapabilityRiskLevel, SubAgentConfig, TeamConfig } from "../contracts/sub-agent-orchestration"
import { createSubAgentConfig, createTeamConfig } from "./orchestration-ui"
import { slugifyOrchestrationSegment } from "./orchestration-id"

export type AgentRolePresetId = "researcher" | "operator" | "reviewer"
export type AgentRiskPresetId = "safe_read" | "workspace_write" | "screen_control"
export type AgentCapabilityPresetId = "browser_research" | "workspace_tools" | "review_only"
export type TeamPurposePresetId = "research_pod" | "build_pod" | "ops_pod"

export interface AgentRolePreset {
  id: AgentRolePresetId
  label: string
  role: string
  personality: string
  specialtyTags: string[]
  avoidTasks: string[]
}

export interface AgentRiskPreset {
  id: AgentRiskPresetId
  label: string
  riskCeiling: CapabilityRiskLevel
  allowExternalNetwork: boolean
  allowFilesystemWrite: boolean
  allowShellExecution: boolean
  allowScreenControl: boolean
}

export interface AgentCapabilityPreset {
  id: AgentCapabilityPresetId
  label: string
  enabledSkillIds: string[]
  enabledMcpServerIds: string[]
  enabledToolNames: string[]
  allowedPaths: string[]
  allowExternalNetwork: boolean
  allowFilesystemWrite: boolean
  allowShellExecution: boolean
  allowScreenControl: boolean
}

export interface TeamPurposePreset {
  id: TeamPurposePresetId
  label: string
  purpose: string
  primaryRoleHint: string
  memberRoleHint: string
}

export interface BuildPresetSubAgentConfigInput {
  agentId: string
  displayName: string
  nickname?: string
  rolePresetId?: AgentRolePresetId
  riskPresetId?: AgentRiskPresetId
  capabilityPresetId?: AgentCapabilityPresetId
  teamIds?: string[]
  existing?: SubAgentConfig
  now?: number
}

export interface BuildPresetTeamConfigInput {
  teamId: string
  displayName: string
  nickname?: string
  purposePresetId?: TeamPurposePresetId
  memberAgentIds?: string[]
  existing?: TeamConfig
  now?: number
}

export const DEFAULT_AGENT_ROLE_PRESET: AgentRolePresetId = "researcher"
export const DEFAULT_AGENT_RISK_PRESET: AgentRiskPresetId = "safe_read"
export const DEFAULT_AGENT_CAPABILITY_PRESET: AgentCapabilityPresetId = "browser_research"
export const DEFAULT_TEAM_PURPOSE_PRESET: TeamPurposePresetId = "research_pod"

export const AGENT_ROLE_PRESETS: Record<AgentRolePresetId, AgentRolePreset> = {
  researcher: {
    id: "researcher",
    label: "Researcher",
    role: "Evidence researcher",
    personality: "Concise, evidence-first, and careful with uncertain claims.",
    specialtyTags: ["research", "evidence", "summary"],
    avoidTasks: ["unapproved shell", "destructive changes"],
  },
  operator: {
    id: "operator",
    label: "Operator",
    role: "Workspace operator",
    personality: "Systematic, execution-focused, and explicit about risk boundaries.",
    specialtyTags: ["workspace", "automation", "operations"],
    avoidTasks: ["policy bypass", "unguarded production changes"],
  },
  reviewer: {
    id: "reviewer",
    label: "Reviewer",
    role: "Quality reviewer",
    personality: "Skeptical, detail-oriented, and focused on regressions and missing evidence.",
    specialtyTags: ["review", "validation", "qa"],
    avoidTasks: ["blind approval", "speculation without evidence"],
  },
}

export const AGENT_RISK_PRESETS: Record<AgentRiskPresetId, AgentRiskPreset> = {
  safe_read: {
    id: "safe_read",
    label: "Safe read",
    riskCeiling: "safe",
    allowExternalNetwork: false,
    allowFilesystemWrite: false,
    allowShellExecution: false,
    allowScreenControl: false,
  },
  workspace_write: {
    id: "workspace_write",
    label: "Workspace write",
    riskCeiling: "sensitive",
    allowExternalNetwork: false,
    allowFilesystemWrite: true,
    allowShellExecution: true,
    allowScreenControl: false,
  },
  screen_control: {
    id: "screen_control",
    label: "Screen control",
    riskCeiling: "dangerous",
    allowExternalNetwork: false,
    allowFilesystemWrite: true,
    allowShellExecution: true,
    allowScreenControl: true,
  },
}

export const AGENT_CAPABILITY_PRESETS: Record<AgentCapabilityPresetId, AgentCapabilityPreset> = {
  browser_research: {
    id: "browser_research",
    label: "Browser research",
    enabledSkillIds: ["web-search", "summarizer"],
    enabledMcpServerIds: ["browser"],
    enabledToolNames: ["web_search"],
    allowedPaths: [],
    allowExternalNetwork: true,
    allowFilesystemWrite: false,
    allowShellExecution: false,
    allowScreenControl: false,
  },
  workspace_tools: {
    id: "workspace_tools",
    label: "Workspace tools",
    enabledSkillIds: ["filesystem", "automation"],
    enabledMcpServerIds: ["local-tools"],
    enabledToolNames: ["shell_exec", "file_write"],
    allowedPaths: ["./workspace"],
    allowExternalNetwork: false,
    allowFilesystemWrite: true,
    allowShellExecution: true,
    allowScreenControl: false,
  },
  review_only: {
    id: "review_only",
    label: "Review only",
    enabledSkillIds: ["checklist", "evidence-review"],
    enabledMcpServerIds: [],
    enabledToolNames: [],
    allowedPaths: [],
    allowExternalNetwork: false,
    allowFilesystemWrite: false,
    allowShellExecution: false,
    allowScreenControl: false,
  },
}

export const TEAM_PURPOSE_PRESETS: Record<TeamPurposePresetId, TeamPurposePreset> = {
  research_pod: {
    id: "research_pod",
    label: "Research pod",
    purpose: "Collect external evidence, summarize findings, and route results for review.",
    primaryRoleHint: "research lead",
    memberRoleHint: "research member",
  },
  build_pod: {
    id: "build_pod",
    label: "Build pod",
    purpose: "Make workspace changes while keeping review and rollback boundaries explicit.",
    primaryRoleHint: "build lead",
    memberRoleHint: "build member",
  },
  ops_pod: {
    id: "ops_pod",
    label: "Ops pod",
    purpose: "Coordinate runtime operations, channels, and environment checks with clear approvals.",
    primaryRoleHint: "ops lead",
    memberRoleHint: "ops member",
  },
}

export function buildPresetSubAgentConfig(input: BuildPresetSubAgentConfigInput): SubAgentConfig {
  const rolePreset = AGENT_ROLE_PRESETS[input.rolePresetId ?? DEFAULT_AGENT_ROLE_PRESET]
  const riskPreset = AGENT_RISK_PRESETS[input.riskPresetId ?? DEFAULT_AGENT_RISK_PRESET]
  const capabilityPreset = AGENT_CAPABILITY_PRESETS[input.capabilityPresetId ?? DEFAULT_AGENT_CAPABILITY_PRESET]

  return createSubAgentConfig({
    agentId: input.agentId,
    displayName: input.displayName,
    nickname: input.nickname?.trim() || defaultNickname(input.displayName, input.agentId, "agent"),
    role: rolePreset.role,
    personality: rolePreset.personality,
    specialtyTags: uniqueValues(rolePreset.specialtyTags),
    avoidTasks: uniqueValues(rolePreset.avoidTasks),
    teamIds: uniqueValues(input.teamIds ?? []),
    riskCeiling: riskPreset.riskCeiling,
    enabledSkillIds: uniqueValues(capabilityPreset.enabledSkillIds),
    enabledMcpServerIds: uniqueValues(capabilityPreset.enabledMcpServerIds),
    enabledToolNames: uniqueValues(capabilityPreset.enabledToolNames),
    allowExternalNetwork: riskPreset.allowExternalNetwork || capabilityPreset.allowExternalNetwork,
    allowFilesystemWrite: riskPreset.allowFilesystemWrite || capabilityPreset.allowFilesystemWrite,
    allowShellExecution: riskPreset.allowShellExecution || capabilityPreset.allowShellExecution,
    allowScreenControl: riskPreset.allowScreenControl || capabilityPreset.allowScreenControl,
    allowedPaths: uniqueValues(capabilityPreset.allowedPaths),
    existing: input.existing,
    now: input.now,
  })
}

export function buildPresetTeamConfig(input: BuildPresetTeamConfigInput): TeamConfig {
  const preset = TEAM_PURPOSE_PRESETS[input.purposePresetId ?? DEFAULT_TEAM_PURPOSE_PRESET]
  const memberAgentIds = uniqueValues(input.memberAgentIds ?? [])

  return createTeamConfig({
    teamId: input.teamId,
    displayName: input.displayName,
    nickname: input.nickname?.trim() || defaultNickname(input.displayName, input.teamId, "team"),
    purpose: preset.purpose,
    memberAgentIds,
    roleHints: buildRoleHints(memberAgentIds, preset),
    existing: input.existing,
    now: input.now,
  })
}

export function inferAgentRolePresetId(config: Pick<SubAgentConfig, "role" | "specialtyTags">): AgentRolePresetId {
  const haystack = `${config.role} ${config.specialtyTags.join(" ")}`.toLowerCase()
  if (haystack.includes("review") || haystack.includes("qa")) return "reviewer"
  if (haystack.includes("operate") || haystack.includes("workspace") || haystack.includes("automation")) return "operator"
  return "researcher"
}

export function inferAgentRiskPresetId(config: Pick<SubAgentConfig, "capabilityPolicy">): AgentRiskPresetId {
  const profile = config.capabilityPolicy.permissionProfile
  if (profile.allowScreenControl || profile.riskCeiling === "dangerous") return "screen_control"
  if (profile.allowFilesystemWrite || profile.allowShellExecution || profile.riskCeiling === "sensitive") return "workspace_write"
  return "safe_read"
}

export function inferAgentCapabilityPresetId(config: Pick<SubAgentConfig, "capabilityPolicy">): AgentCapabilityPresetId {
  const allowlist = config.capabilityPolicy.skillMcpAllowlist
  const enabled = `${allowlist.enabledSkillIds.join(" ")} ${allowlist.enabledMcpServerIds.join(" ")} ${allowlist.enabledToolNames.join(" ")}`.toLowerCase()
  if (enabled.includes("shell") || enabled.includes("filesystem") || enabled.includes("local-tools")) return "workspace_tools"
  if (enabled.includes("review") || enabled.includes("checklist")) return "review_only"
  return "browser_research"
}

export function inferTeamPurposePresetId(config: Pick<TeamConfig, "displayName" | "purpose" | "roleHints">): TeamPurposePresetId {
  const haystack = `${config.displayName} ${config.purpose} ${config.roleHints.join(" ")}`.toLowerCase()
  if (haystack.includes("ops") || haystack.includes("runtime") || haystack.includes("channel")) return "ops_pod"
  if (haystack.includes("build") || haystack.includes("code") || haystack.includes("workspace")) return "build_pod"
  return "research_pod"
}

function buildRoleHints(memberAgentIds: string[], preset: TeamPurposePreset): string[] {
  if (memberAgentIds.length === 0) return [preset.primaryRoleHint]
  return memberAgentIds.map((_, index) => index === 0 ? preset.primaryRoleHint : preset.memberRoleHint)
}

function defaultNickname(displayName: string, fallbackId: string, fallbackSlug: "agent" | "team"): string {
  return slugifyOrchestrationSegment(displayName || fallbackId, fallbackSlug).slice(0, 24)
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)))
}
