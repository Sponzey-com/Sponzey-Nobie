import { createHash, randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PATHS } from "../config/index.js"
import { CONTRACT_SCHEMA_VERSION } from "../contracts/index.js"
import type {
  CapabilityRiskLevel,
  MemoryPolicy,
  PermissionProfile,
  SkillMcpAllowlist,
  SubAgentConfig,
  SubSessionContract,
  TeamConfig,
  TeamMembership,
} from "../contracts/sub-agent-orchestration.js"
import {
  validateAgentConfig,
  validateTeamConfig,
} from "../contracts/sub-agent-orchestration.js"
import { getDb, getRunSubSession, listRunSubSessionsForParentRun } from "../db/index.js"
import { redactUiValue } from "../ui/redaction.js"
import type { OrchestrationPlannerIntent } from "./planner.js"
import {
  type AgentRegistryEntry,
  type OrchestrationRegistrySnapshot,
  type TeamRegistryEntry,
  createAgentRegistryService,
  createTeamRegistryService,
} from "./registry.js"
import {
  type SubSessionControlAction,
  controlSubSession,
  getSubSessionInfo,
  listSubSessionLogs,
  sanitizeSubSessionControlText,
  spawnSubSessionAck,
} from "./sub-session-control.js"

export type CommandPaletteResultKind =
  | "agent"
  | "team"
  | "sub_session"
  | "command"
  | "agent_template"
  | "team_template"

export type FocusTargetKind = "agent" | "team" | "sub_session"

export interface FocusTarget {
  kind: FocusTargetKind
  id: string
  label?: string
}

export interface FocusBinding {
  schemaVersion: 1
  threadId: string
  parentAgentId: string
  target: FocusTarget
  source: "api" | "command_palette" | "webui"
  reasonCode: "focus_bound_explicit_planner_target"
  finalAnswerOwner: "unchanged_parent"
  memoryIsolation: "unchanged"
  createdAt: number
  updatedAt: number
}

export interface FocusResolveSuccess {
  ok: true
  binding: FocusBinding
  plannerIntent: OrchestrationPlannerIntent
  plannerTarget: {
    kind: "explicit_agent" | "explicit_team"
    id: string
    sourceTarget: FocusTarget
  }
  enforcement: {
    directChildVisibility: "checked"
    permissionVisibility: "checked"
    finalAnswerOwnerUnchanged: true
    memoryIsolationUnchanged: true
    reasonCodes: string[]
  }
}

export interface FocusResolveFailure {
  ok: false
  reasonCode: string
  statusCode: 400 | 404 | 409
  binding?: FocusBinding
  details?: Record<string, unknown>
}

export type FocusResolveResult = FocusResolveSuccess | FocusResolveFailure

export interface CommandPaletteSearchResult {
  id: string
  kind: CommandPaletteResultKind
  title: string
  subtitle?: string
  status?: string
  target?: FocusTarget
  command?: string
  route?: string
  reasonCodes: string[]
}

export interface CommandPaletteSearchResponse {
  query: string
  generatedAt: number
  results: CommandPaletteSearchResult[]
}

export interface AgentTemplateDefinition {
  templateId: string
  displayName: string
  role: string
  description: string
  specialtyTags: string[]
  riskCeiling: CapabilityRiskLevel
  enabledSkillIds: string[]
  enabledToolNames: string[]
}

export interface TeamTemplateDefinition {
  templateId: string
  displayName: string
  purpose: string
  roleHints: string[]
  requiredTeamRoles: string[]
  requiredCapabilityTags: string[]
}

export interface AgentDescriptionLintWarning {
  code:
    | "description_too_short"
    | "description_too_broad"
    | "missing_domain_or_specialty"
    | "missing_boundaries"
  severity: "warning"
  message: string
  matched?: string
}

type FocusBindingsFile = {
  schemaVersion: 1
  bindings: Record<string, FocusBinding>
}

type SubSessionRow = {
  sub_session_id: string
  parent_run_id: string
  parent_session_id: string
  agent_id: string
  agent_display_name: string
  agent_nickname: string | null
  status: string
  contract_json: string
  created_at: number
  updated_at: number
}

const DEFAULT_PARENT_AGENT_ID = "agent:nobie"
const FOCUS_BINDINGS_FILE = "focus-bindings.json"
const COMMAND_LIMIT = 80

const COMMANDS: CommandPaletteSearchResult[] = [
  {
    id: "command:/agents",
    kind: "command",
    title: "/agents",
    subtitle: "List or search agents.",
    command: "/agents",
    reasonCodes: ["agent_search_command"],
  },
  {
    id: "command:/teams",
    kind: "command",
    title: "/teams",
    subtitle: "List or search teams.",
    command: "/teams",
    reasonCodes: ["team_search_command"],
  },
  {
    id: "command:/subsessions",
    kind: "command",
    title: "/subsessions list/info/log/kill/send/steer/spawn",
    subtitle: "Control delegated sub-sessions through existing API aliases.",
    command: "/subsessions list",
    reasonCodes: ["subsession_alias_command"],
  },
  {
    id: "command:/focus",
    kind: "command",
    title: "/focus",
    subtitle: "Bind this thread to an explicit planner target.",
    command: "/focus agent:<id>",
    reasonCodes: ["focus_command"],
  },
  {
    id: "command:/unfocus",
    kind: "command",
    title: "/unfocus",
    subtitle: "Clear the thread focus binding.",
    command: "/unfocus",
    reasonCodes: ["focus_clear_command"],
  },
]

export const AGENT_TEMPLATES: AgentTemplateDefinition[] = [
  {
    templateId: "explorer",
    displayName: "Explorer",
    role: "Codebase explorer",
    description: "Finds concrete files, flows, and constraints before implementation.",
    specialtyTags: ["exploration", "codebase", "analysis"],
    riskCeiling: "safe",
    enabledSkillIds: [],
    enabledToolNames: [],
  },
  {
    templateId: "planner",
    displayName: "Planner",
    role: "Task planner",
    description: "Breaks work into scoped, dependency-aware plans.",
    specialtyTags: ["planning", "scope", "coordination"],
    riskCeiling: "safe",
    enabledSkillIds: [],
    enabledToolNames: [],
  },
  {
    templateId: "researcher",
    displayName: "Researcher",
    role: "Research specialist",
    description: "Collects source-grounded findings and separates evidence from inference.",
    specialtyTags: ["research", "evidence", "sources"],
    riskCeiling: "moderate",
    enabledSkillIds: ["research"],
    enabledToolNames: ["web_search"],
  },
  {
    templateId: "writer",
    displayName: "Writer",
    role: "Writing specialist",
    description: "Drafts clear user-facing prose from approved context.",
    specialtyTags: ["writing", "editing", "communication"],
    riskCeiling: "safe",
    enabledSkillIds: [],
    enabledToolNames: [],
  },
  {
    templateId: "reviewer",
    displayName: "Reviewer",
    role: "Review specialist",
    description: "Reviews outputs for correctness, regressions, and missing evidence.",
    specialtyTags: ["review", "quality", "risk"],
    riskCeiling: "safe",
    enabledSkillIds: [],
    enabledToolNames: [],
  },
  {
    templateId: "verifier",
    displayName: "Verifier",
    role: "Verification specialist",
    description: "Runs validation checks and reports residual risk.",
    specialtyTags: ["verification", "testing", "acceptance"],
    riskCeiling: "moderate",
    enabledSkillIds: [],
    enabledToolNames: [],
  },
  {
    templateId: "scheduler",
    displayName: "Scheduler",
    role: "Scheduling specialist",
    description: "Plans recurring work with explicit timing and ownership.",
    specialtyTags: ["schedule", "recurrence", "operations"],
    riskCeiling: "safe",
    enabledSkillIds: [],
    enabledToolNames: [],
  },
  {
    templateId: "monitor",
    displayName: "Monitor",
    role: "Monitoring specialist",
    description: "Watches runtime state and raises concise status changes.",
    specialtyTags: ["monitoring", "operations", "alerts"],
    riskCeiling: "safe",
    enabledSkillIds: [],
    enabledToolNames: [],
  },
  {
    templateId: "coding",
    displayName: "Coding",
    role: "Coding specialist",
    description: "Implements scoped code changes with verification.",
    specialtyTags: ["coding", "implementation", "tests"],
    riskCeiling: "moderate",
    enabledSkillIds: ["coding"],
    enabledToolNames: [],
  },
]

export const TEAM_TEMPLATES: TeamTemplateDefinition[] = [
  {
    templateId: "research",
    displayName: "Research Team",
    purpose: "Coordinate source gathering, evidence review, and synthesis.",
    roleHints: ["researcher", "reviewer"],
    requiredTeamRoles: ["researcher", "reviewer"],
    requiredCapabilityTags: ["research", "review"],
  },
  {
    templateId: "writing",
    displayName: "Writing Team",
    purpose: "Draft, edit, and review user-facing writing.",
    roleHints: ["writer", "reviewer"],
    requiredTeamRoles: ["writer", "reviewer"],
    requiredCapabilityTags: ["writing", "review"],
  },
  {
    templateId: "coding",
    displayName: "Coding Team",
    purpose: "Explore, implement, review, and verify code changes.",
    roleHints: ["explorer", "coding", "reviewer", "verifier"],
    requiredTeamRoles: ["explorer", "coding", "reviewer", "verifier"],
    requiredCapabilityTags: ["codebase", "coding", "review", "verification"],
  },
  {
    templateId: "schedule",
    displayName: "Schedule Team",
    purpose: "Plan recurring work and monitor schedule health.",
    roleHints: ["scheduler", "monitor"],
    requiredTeamRoles: ["scheduler", "monitor"],
    requiredCapabilityTags: ["schedule", "monitoring"],
  },
  {
    templateId: "monitoring",
    displayName: "Monitoring Team",
    purpose: "Watch runtime health and escalate actionable changes.",
    roleHints: ["monitor", "reviewer"],
    requiredTeamRoles: ["monitor", "reviewer"],
    requiredCapabilityTags: ["monitoring", "review"],
  },
  {
    templateId: "review",
    displayName: "Review Team",
    purpose: "Review work products and verify acceptance criteria.",
    roleHints: ["reviewer", "verifier"],
    requiredTeamRoles: ["reviewer", "verifier"],
    requiredCapabilityTags: ["review", "verification"],
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
  return strings.length > 0 ? [...new Set(strings)] : undefined
}

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return normalized || "draft"
}

function hashShort(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 10)
}

function nowMs(): number {
  return Date.now()
}

function focusFilePath(): string {
  return join(PATHS.stateDir, FOCUS_BINDINGS_FILE)
}

function readFocusBindings(): FocusBindingsFile {
  const filePath = focusFilePath()
  if (!existsSync(filePath)) return { schemaVersion: 1, bindings: {} }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as FocusBindingsFile
    if (parsed?.schemaVersion === 1 && isRecord(parsed.bindings)) return parsed
  } catch {
    // Fall through to an empty state. A malformed focus file must not affect routing.
  }
  return { schemaVersion: 1, bindings: {} }
}

function writeFocusBindings(file: FocusBindingsFile): void {
  mkdirSync(PATHS.stateDir, { recursive: true })
  writeFileSync(focusFilePath(), JSON.stringify(file, null, 2), "utf-8")
}

function normalizedThreadId(threadId: string | undefined): string {
  return threadId?.trim() || "default"
}

function defaultParentAgentId(parentAgentId: string | undefined): string {
  return parentAgentId?.trim() || DEFAULT_PARENT_AGENT_ID
}

function directChildIdsFor(
  registry: OrchestrationRegistrySnapshot,
  parentAgentId: string,
): {
  visible: Set<string>
  eligible: Set<string>
  hasExplicitVisibility: boolean
} {
  const hierarchyChildren = registry.hierarchy?.directChildrenByParent[parentAgentId] ?? []
  const capabilityChildren = registry.capabilityIndex?.directChildAgentIdsByParent[parentAgentId] ?? []
  return {
    visible: new Set(hierarchyChildren),
    eligible: new Set(capabilityChildren.length ? capabilityChildren : hierarchyChildren),
    hasExplicitVisibility: hierarchyChildren.length > 0 || capabilityChildren.length > 0,
  }
}

function agentBlockedReasonCodes(
  registry: OrchestrationRegistrySnapshot,
  parentAgentId: string,
  agentId: string,
): string[] {
  return (
    registry.capabilityIndex?.excludedCandidatesByParent[parentAgentId]?.find(
      (candidate) => candidate.agentId === agentId,
    )?.reasonCodes ?? []
  )
}

function agentResult(agent: AgentRegistryEntry): CommandPaletteSearchResult {
  return {
    id: agent.agentId,
    kind: "agent",
    title: agent.nickname ? `${agent.displayName} (@${agent.nickname})` : agent.displayName,
    subtitle: agent.role,
    status: agent.status,
    target: { kind: "agent", id: agent.agentId, ...(agent.nickname ? { label: agent.nickname } : {}) },
    command: `/focus agent:${agent.agentId}`,
    route: `/advanced/topology?agent=${encodeURIComponent(agent.agentId)}`,
    reasonCodes: ["agent_registry_result"],
  }
}

function teamResult(team: TeamRegistryEntry): CommandPaletteSearchResult {
  return {
    id: team.teamId,
    kind: "team",
    title: team.nickname ? `${team.displayName} (@${team.nickname})` : team.displayName,
    subtitle: team.purpose,
    status: team.status,
    target: { kind: "team", id: team.teamId, ...(team.nickname ? { label: team.nickname } : {}) },
    command: `/focus team:${team.teamId}`,
    route: `/advanced/topology?team=${encodeURIComponent(team.teamId)}`,
    reasonCodes: ["team_registry_result"],
  }
}

function parseSubSessionContract(row: Pick<SubSessionRow, "contract_json">): SubSessionContract | undefined {
  try {
    const parsed = JSON.parse(row.contract_json)
    return isRecord(parsed) ? (parsed as unknown as SubSessionContract) : undefined
  } catch {
    return undefined
  }
}

function subSessionResult(row: SubSessionRow): CommandPaletteSearchResult {
  const contract = parseSubSessionContract(row)
  const label = contract?.agentNickname ?? row.agent_nickname ?? row.agent_display_name
  return {
    id: row.sub_session_id,
    kind: "sub_session",
    title: `${row.sub_session_id} -> ${label}`,
    subtitle: `${row.parent_run_id} / ${row.agent_id}`,
    status: row.status,
    target: { kind: "sub_session", id: row.sub_session_id, label },
    command: `/subsessions info ${row.sub_session_id}`,
    route: `/advanced/runs?run=${encodeURIComponent(row.parent_run_id)}`,
    reasonCodes: ["subsession_result"],
  }
}

function recentSubSessionRows(limit = COMMAND_LIMIT): SubSessionRow[] {
  return getDb()
    .prepare<[], SubSessionRow>(
      `SELECT sub_session_id, parent_run_id, parent_session_id, agent_id, agent_display_name,
              agent_nickname, status, contract_json, created_at, updated_at
       FROM run_subsessions
       ORDER BY updated_at DESC, sub_session_id ASC
       LIMIT ${Math.max(1, Math.min(200, Math.floor(limit)))}`,
    )
    .all()
}

function matchesQuery(result: CommandPaletteSearchResult, query: string): boolean {
  if (!query) return true
  const haystack = [
    result.id,
    result.kind,
    result.title,
    result.subtitle,
    result.status,
    result.command,
    result.route,
    ...(result.reasonCodes ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  return haystack.includes(query.toLowerCase())
}

export function searchCommandPalette(input: {
  query?: string
  scope?: CommandPaletteResultKind | "all"
  limit?: number
} = {}): CommandPaletteSearchResponse {
  const query = input.query?.trim() ?? ""
  const scope = input.scope ?? "all"
  const registry = createAgentRegistryService().snapshot()
  const agentResults = registry.agents.map(agentResult)
  const teamResults = registry.teams.map(teamResult)
  const subSessionResults = recentSubSessionRows(input.limit).map(subSessionResult)
  const templateResults: CommandPaletteSearchResult[] = [
    ...AGENT_TEMPLATES.map((template) => ({
      id: `agent-template:${template.templateId}`,
      kind: "agent_template" as const,
      title: template.displayName,
      subtitle: template.description,
      command: `/agents template ${template.templateId}`,
      reasonCodes: ["agent_template_result"],
    })),
    ...TEAM_TEMPLATES.map((template) => ({
      id: `team-template:${template.templateId}`,
      kind: "team_template" as const,
      title: template.displayName,
      subtitle: template.purpose,
      command: `/teams template ${template.templateId}`,
      reasonCodes: ["team_template_result"],
    })),
  ]
  const allResults = [
    ...COMMANDS,
    ...agentResults,
    ...teamResults,
    ...subSessionResults,
    ...templateResults,
  ]
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit ?? COMMAND_LIMIT)))
  const results = allResults
    .filter((result) => scope === "all" || result.kind === scope)
    .filter((result) => matchesQuery(result, query))
    .slice(0, limit)
  return { query, generatedAt: nowMs(), results }
}

function validateAgentFocus(
  registry: OrchestrationRegistrySnapshot,
  parentAgentId: string,
  target: FocusTarget,
): FocusResolveResult {
  const agent = registry.agents.find((candidate) => candidate.agentId === target.id)
  if (!agent) {
    return {
      ok: false,
      reasonCode: "focus_agent_not_found",
      statusCode: 404,
      details: { agentId: target.id },
    }
  }
  const directChildren = directChildIdsFor(registry, parentAgentId)
  if (directChildren.hasExplicitVisibility && !directChildren.visible.has(agent.agentId)) {
    return {
      ok: false,
      reasonCode: "focus_target_not_direct_child",
      statusCode: 409,
      details: { parentAgentId, agentId: agent.agentId },
    }
  }
  if (!directChildren.eligible.has(agent.agentId)) {
    const reasonCodes = agentBlockedReasonCodes(registry, parentAgentId, agent.agentId)
    return {
      ok: false,
      reasonCode: "focus_agent_not_visible",
      statusCode: 409,
      details: { parentAgentId, agentId: agent.agentId, reasonCodes },
    }
  }
  return {
    ok: true,
    binding: undefined as never,
    plannerIntent: { explicitAgentId: agent.agentId },
    plannerTarget: {
      kind: "explicit_agent",
      id: agent.agentId,
      sourceTarget: target,
    },
    enforcement: {
      directChildVisibility: "checked",
      permissionVisibility: "checked",
      finalAnswerOwnerUnchanged: true,
      memoryIsolationUnchanged: true,
      reasonCodes: ["focus_agent_explicit_target_validated"],
    },
  }
}

function validateTeamFocus(
  registry: OrchestrationRegistrySnapshot,
  parentAgentId: string,
  target: FocusTarget,
): FocusResolveResult {
  const team = registry.teams.find((candidate) => candidate.teamId === target.id)
  if (!team) {
    return {
      ok: false,
      reasonCode: "focus_team_not_found",
      statusCode: 404,
      details: { teamId: target.id },
    }
  }
  const ownerAgentId = team.coverage?.ownerAgentId ?? team.config.ownerAgentId ?? DEFAULT_PARENT_AGENT_ID
  if (ownerAgentId !== parentAgentId) {
    return {
      ok: false,
      reasonCode: "focus_team_not_owned_by_parent",
      statusCode: 409,
      details: { parentAgentId, ownerAgentId, teamId: team.teamId },
    }
  }
  const activeMemberAgentIds = team.coverage?.activeMemberAgentIds.length
    ? team.coverage.activeMemberAgentIds
    : team.activeMemberAgentIds
  if (team.status !== "enabled" || team.health?.status === "invalid" || activeMemberAgentIds.length === 0) {
    return {
      ok: false,
      reasonCode: "focus_team_not_visible",
      statusCode: 409,
      details: {
        teamId: team.teamId,
        status: team.status,
        health: team.health?.status ?? "unknown",
        activeMemberAgentIds,
      },
    }
  }
  return {
    ok: true,
    binding: undefined as never,
    plannerIntent: { explicitTeamId: team.teamId },
    plannerTarget: {
      kind: "explicit_team",
      id: team.teamId,
      sourceTarget: target,
    },
    enforcement: {
      directChildVisibility: "checked",
      permissionVisibility: "checked",
      finalAnswerOwnerUnchanged: true,
      memoryIsolationUnchanged: true,
      reasonCodes: ["focus_team_explicit_target_validated"],
    },
  }
}

function validateSubSessionFocus(
  registry: OrchestrationRegistrySnapshot,
  parentAgentId: string,
  target: FocusTarget,
): FocusResolveResult {
  const row = getRunSubSession(target.id)
  if (!row) {
    return {
      ok: false,
      reasonCode: "focus_sub_session_not_found",
      statusCode: 404,
      details: { subSessionId: target.id },
    }
  }
  const contract = parseSubSessionContract({
    contract_json: row.contract_json,
  })
  const agentId = contract?.agentId ?? row.agent_id
  const agentValidation = validateAgentFocus(registry, parentAgentId, {
    kind: "agent",
    id: agentId,
    label: contract?.agentNickname ?? row.agent_nickname ?? row.agent_display_name,
  })
  if (!agentValidation.ok) {
    return {
      ...agentValidation,
      reasonCode:
        agentValidation.reasonCode === "focus_target_not_direct_child"
          ? "focus_sub_session_agent_not_direct_child"
          : agentValidation.reasonCode,
      details: {
        ...(agentValidation.details ?? {}),
        subSessionId: target.id,
        resolvedAgentId: agentId,
      },
    }
  }
  return {
    ...agentValidation,
    plannerTarget: {
      kind: "explicit_agent",
      id: agentId,
      sourceTarget: target,
    },
    enforcement: {
      ...agentValidation.enforcement,
      reasonCodes: [
        ...agentValidation.enforcement.reasonCodes,
        "focus_sub_session_resolved_to_agent_target",
      ],
    },
  }
}

function validateFocusTarget(input: {
  target: FocusTarget
  parentAgentId?: string
}): FocusResolveResult {
  const parentAgentId = defaultParentAgentId(input.parentAgentId)
  const registry = createAgentRegistryService().snapshot()
  if (input.target.kind === "agent") {
    return validateAgentFocus(registry, parentAgentId, input.target)
  }
  if (input.target.kind === "team") {
    return validateTeamFocus(registry, parentAgentId, input.target)
  }
  return validateSubSessionFocus(registry, parentAgentId, input.target)
}

function bindValidationResult(
  validation: FocusResolveResult,
  binding: FocusBinding,
): FocusResolveResult {
  if (!validation.ok) return { ...validation, binding }
  return { ...validation, binding }
}

export function setFocusBinding(input: {
  threadId?: string
  parentAgentId?: string
  target: FocusTarget
  source?: FocusBinding["source"]
}): FocusResolveResult {
  const targetId = input.target.id.trim()
  if (!targetId) {
    return { ok: false, reasonCode: "focus_target_required", statusCode: 400 }
  }
  const threadId = normalizedThreadId(input.threadId)
  const parentAgentId = defaultParentAgentId(input.parentAgentId)
  const now = nowMs()
  const binding: FocusBinding = {
    schemaVersion: 1,
    threadId,
    parentAgentId,
    target: {
      kind: input.target.kind,
      id: targetId,
      ...(input.target.label ? { label: input.target.label } : {}),
    },
    source: input.source ?? "api",
    reasonCode: "focus_bound_explicit_planner_target",
    finalAnswerOwner: "unchanged_parent",
    memoryIsolation: "unchanged",
    createdAt: now,
    updatedAt: now,
  }
  const validation = validateFocusTarget({ target: binding.target, parentAgentId })
  if (!validation.ok) return bindValidationResult(validation, binding)
  const file = readFocusBindings()
  const previous = file.bindings[threadId]
  file.bindings[threadId] = {
    ...binding,
    createdAt: previous?.createdAt ?? binding.createdAt,
  }
  writeFocusBindings(file)
  return bindValidationResult(validation, file.bindings[threadId])
}

export function getFocusBinding(threadId?: string): FocusBinding | undefined {
  return readFocusBindings().bindings[normalizedThreadId(threadId)]
}

export function clearFocusBinding(threadId?: string): {
  ok: true
  threadId: string
  cleared: boolean
  reasonCode: "focus_binding_cleared"
} {
  const normalized = normalizedThreadId(threadId)
  const file = readFocusBindings()
  const cleared = Boolean(file.bindings[normalized])
  delete file.bindings[normalized]
  writeFocusBindings(file)
  return { ok: true, threadId: normalized, cleared, reasonCode: "focus_binding_cleared" }
}

export function resolveFocusBinding(input: {
  threadId?: string
  parentAgentId?: string
}): FocusResolveResult {
  const binding = getFocusBinding(input.threadId)
  if (!binding) {
    return {
      ok: false,
      reasonCode: "focus_binding_not_found",
      statusCode: 404,
      details: { threadId: normalizedThreadId(input.threadId) },
    }
  }
  const validation = validateFocusTarget({
    target: binding.target,
    parentAgentId: input.parentAgentId ?? binding.parentAgentId,
  })
  return bindValidationResult(validation, binding)
}

function safePermissionProfile(profileId: string, riskCeiling: CapabilityRiskLevel): PermissionProfile {
  return {
    profileId,
    riskCeiling,
    approvalRequiredFrom: "moderate",
    allowExternalNetwork: riskCeiling !== "safe",
    allowFilesystemWrite: false,
    allowShellExecution: false,
    allowScreenControl: false,
    allowedPaths: [],
  }
}

function safeAllowlist(input: {
  enabledSkillIds?: string[]
  enabledToolNames?: string[]
  secretScopeId: string
}): SkillMcpAllowlist {
  return {
    enabledSkillIds: input.enabledSkillIds ?? [],
    enabledMcpServerIds: [],
    enabledToolNames: input.enabledToolNames ?? [],
    disabledToolNames: ["shell_exec", "screen_control", "filesystem_write"],
    secretScopeId: input.secretScopeId,
  }
}

function memoryPolicyFor(agentId: string): MemoryPolicy {
  return {
    owner: { ownerType: "sub_agent", ownerId: agentId },
    visibility: "private",
    readScopes: [{ ownerType: "sub_agent", ownerId: agentId }],
    writeScope: { ownerType: "sub_agent", ownerId: agentId },
    retentionPolicy: "short_term",
    writebackReviewRequired: true,
  }
}

function templateAgentConfig(
  template: AgentTemplateDefinition,
  overrides: Record<string, unknown>,
): SubAgentConfig {
  const now = nowMs()
  const displayName = asString(overrides.displayName) ?? template.displayName
  const templateAgentId =
    asString(overrides.agentId) ?? `agent:template:${slug(template.templateId)}`
  const teamIds = asStringArray(overrides.teamIds) ?? [`team:template:${slug(template.templateId)}`]
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    agentType: "sub_agent",
    agentId: templateAgentId,
    displayName,
    nickname: asString(overrides.nickname) ?? displayName,
    status: "disabled",
    role: asString(overrides.role) ?? template.role,
    personality:
      asString(overrides.personality) ??
      `${template.description} Draft profile is disabled until reviewed.`,
    specialtyTags: asStringArray(overrides.specialtyTags) ?? template.specialtyTags,
    avoidTasks: asStringArray(overrides.avoidTasks) ?? ["Unreviewed or unsafe execution."],
    memoryPolicy: memoryPolicyFor(templateAgentId),
    capabilityPolicy: {
      permissionProfile: safePermissionProfile(
        `profile:${slug(template.templateId)}:draft`,
        template.riskCeiling,
      ),
      skillMcpAllowlist: safeAllowlist({
        enabledSkillIds: template.enabledSkillIds,
        enabledToolNames: template.enabledToolNames,
        secretScopeId: templateAgentId,
      }),
      rateLimit: { maxConcurrentCalls: 1 },
    },
    delegationPolicy: {
      enabled: false,
      maxParallelSessions: 1,
      retryBudget: 0,
    },
    teamIds,
    delegation: {
      enabled: false,
      maxParallelSessions: 1,
      retryBudget: 0,
    },
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
  }
}

export function instantiateAgentTemplate(input: {
  templateId: string
  overrides?: unknown
  persist?: boolean
}): {
  ok: true
  template: AgentTemplateDefinition
  draft: {
    agent: SubAgentConfig
    disabled: true
    reviewRequired: true
    executionCandidate: false
    reasonCodes: string[]
  }
  persisted: boolean
} | {
  ok: false
  reasonCode: string
  issues?: unknown
} {
  const template = AGENT_TEMPLATES.find((candidate) => candidate.templateId === input.templateId)
  if (!template) return { ok: false, reasonCode: "agent_template_not_found" }
  const overrides = isRecord(input.overrides) ? input.overrides : {}
  const agent = templateAgentConfig(template, overrides)
  const validation = validateAgentConfig(agent)
  if (!validation.ok) {
    return { ok: false, reasonCode: "invalid_agent_template_draft", issues: validation.issues }
  }
  if (input.persist !== false) {
    createAgentRegistryService().createOrUpdate(validation.value, {
      source: "manual",
      auditId: `agent-template:${template.templateId}`,
      idempotencyKey: `agent-template:${agent.agentId}`,
    })
  }
  return {
    ok: true,
    template,
    draft: {
      agent,
      disabled: true,
      reviewRequired: true,
      executionCandidate: false,
      reasonCodes: ["template_draft_disabled_review_required"],
    },
    persisted: input.persist !== false,
  }
}

function teamMembership(teamId: string, agentId: string, role: string, index: number): TeamMembership {
  return {
    membershipId: `${teamId}:membership:${slug(agentId)}:${index}`,
    teamId,
    agentId,
    ownerAgentIdSnapshot: DEFAULT_PARENT_AGENT_ID,
    teamRoles: [role],
    primaryRole: role,
    required: true,
    sortOrder: index,
    status: "inactive",
  }
}

function templateTeamConfig(
  template: TeamTemplateDefinition,
  overrides: Record<string, unknown>,
): TeamConfig {
  const now = nowMs()
  const displayName = asString(overrides.displayName) ?? template.displayName
  const teamId = asString(overrides.teamId) ?? `team:template:${slug(template.templateId)}`
  const memberAgentIds =
    asStringArray(overrides.memberAgentIds) ??
    template.roleHints.map((role) => `agent:template:${slug(role)}`)
  const roleHints = asStringArray(overrides.roleHints) ?? template.roleHints
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    teamId,
    displayName,
    nickname: asString(overrides.nickname) ?? displayName,
    status: "disabled",
    purpose: asString(overrides.purpose) ?? `${template.purpose} Draft team is disabled until reviewed.`,
    ownerAgentId: DEFAULT_PARENT_AGENT_ID,
    leadAgentId: memberAgentIds[0] ?? `agent:template:${slug(template.templateId)}:lead`,
    memberCountMin: 1,
    memberCountMax: Math.max(1, memberAgentIds.length),
    requiredTeamRoles: template.requiredTeamRoles,
    requiredCapabilityTags: template.requiredCapabilityTags,
    resultPolicy: "lead_synthesis",
    conflictPolicy: "lead_decides",
    memberships: memberAgentIds.map((agentId, index) =>
      teamMembership(teamId, agentId, roleHints[index] ?? "member", index),
    ),
    memberAgentIds,
    roleHints,
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
  }
}

export function instantiateTeamTemplate(input: {
  templateId: string
  overrides?: unknown
  persist?: boolean
}): {
  ok: true
  template: TeamTemplateDefinition
  draft: {
    team: TeamConfig
    disabled: true
    reviewRequired: true
    executionCandidate: false
    reasonCodes: string[]
  }
  persisted: boolean
} | {
  ok: false
  reasonCode: string
  issues?: unknown
} {
  const template = TEAM_TEMPLATES.find((candidate) => candidate.templateId === input.templateId)
  if (!template) return { ok: false, reasonCode: "team_template_not_found" }
  const overrides = isRecord(input.overrides) ? input.overrides : {}
  const team = templateTeamConfig(template, overrides)
  const validation = validateTeamConfig(team)
  if (!validation.ok) {
    return { ok: false, reasonCode: "invalid_team_template_draft", issues: validation.issues }
  }
  if (input.persist !== false) {
    createTeamRegistryService().createOrUpdate(validation.value, {
      source: "manual",
      auditId: `team-template:${template.templateId}`,
      idempotencyKey: `team-template:${team.teamId}`,
    })
  }
  return {
    ok: true,
    template,
    draft: {
      team,
      disabled: true,
      reviewRequired: true,
      executionCandidate: false,
      reasonCodes: ["template_draft_disabled_review_required"],
    },
    persisted: input.persist !== false,
  }
}

function importedName(raw: unknown): string {
  if (!isRecord(raw)) return "Imported Agent"
  return (
    asString(raw.displayName) ??
    asString(raw.name) ??
    asString(raw.agentName) ??
    asString(raw.role) ??
    "Imported Agent"
  )
}

function importedDescription(raw: unknown): string {
  if (!isRecord(raw)) return "Imported external profile."
  return (
    asString(raw.description) ??
    asString(raw.summary) ??
    asString(raw.systemPrompt) ??
    asString(raw.prompt) ??
    "Imported external profile."
  )
}

export function importExternalAgentProfileDraft(input: {
  profile: unknown
  source?: string
  overrides?: unknown
  persist?: boolean
}): {
  ok: true
  draft: {
    agent: SubAgentConfig
    disabled: true
    imported: true
    reviewRequired: true
    preflightRequired: true
    executionCandidate: false
    reasonCodes: string[]
  }
  importSummary: {
    source: string
    redactedPreview: unknown
    redactionCount: number
  }
  persisted: boolean
} | {
  ok: false
  reasonCode: string
  issues?: unknown
} {
  const source = input.source?.trim() || "external"
  const overrides = isRecord(input.overrides) ? input.overrides : {}
  const displayName = asString(overrides.displayName) ?? importedName(input.profile)
  const agentId =
    asString(overrides.agentId) ?? `agent:import:${slug(displayName)}:${hashShort(input.profile)}`
  const description = importedDescription(input.profile)
  const now = nowMs()
  const agent: SubAgentConfig = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    agentType: "sub_agent",
    agentId,
    displayName,
    nickname: asString(overrides.nickname) ?? displayName,
    status: "disabled",
    role: asString(overrides.role) ?? "Imported external draft",
    personality:
      `Imported draft summary: ${sanitizeSubSessionControlText(description).slice(0, 600)} ` +
      "Raw imported instructions are inactive until review and task012 prompt preflight.",
    specialtyTags: asStringArray(overrides.specialtyTags) ?? ["imported", source],
    avoidTasks: [
      "Do not execute before profile review.",
      "Do not use imported instructions to expand permissions.",
    ],
    memoryPolicy: memoryPolicyFor(agentId),
    capabilityPolicy: {
      permissionProfile: safePermissionProfile("profile:imported:draft", "safe"),
      skillMcpAllowlist: {
        enabledSkillIds: [],
        enabledMcpServerIds: [],
        enabledToolNames: [],
        disabledToolNames: ["*"],
        secretScopeId: agentId,
      },
      rateLimit: { maxConcurrentCalls: 1 },
    },
    delegationPolicy: {
      enabled: false,
      maxParallelSessions: 1,
      retryBudget: 0,
    },
    teamIds: asStringArray(overrides.teamIds) ?? ["team:imported:drafts"],
    delegation: {
      enabled: false,
      maxParallelSessions: 1,
      retryBudget: 0,
    },
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
  }
  const validation = validateAgentConfig(agent)
  if (!validation.ok) {
    return { ok: false, reasonCode: "invalid_imported_agent_draft", issues: validation.issues }
  }
  if (input.persist !== false) {
    createAgentRegistryService().createOrUpdate(validation.value, {
      imported: true,
      source: "import",
      auditId: `import:${source}`,
      idempotencyKey: `import:${agent.agentId}`,
    })
  }
  const redacted = redactUiValue(input.profile, { audience: "advanced" })
  return {
    ok: true,
    draft: {
      agent,
      disabled: true,
      imported: true,
      reviewRequired: true,
      preflightRequired: true,
      executionCandidate: false,
      reasonCodes: [
        "imported_profile_disabled",
        "imported_profile_requires_review",
        "task012_prompt_bundle_preflight_required",
      ],
    },
    importSummary: {
      source,
      redactedPreview: redacted.value,
      redactionCount: redacted.maskedCount,
    },
    persisted: input.persist !== false,
  }
}

const BROAD_DESCRIPTION_PATTERNS = [
  /\bdo (anything|everything|all tasks)\b/i,
  /\b(anything|everything|whatever|general purpose|all[- ]?purpose)\b/i,
  /\bhandle all\b/i,
  /모든\s*(일|작업|요청)/,
  /아무거나/,
  /다\s*해/,
]

export function lintAgentDescription(description: string): {
  ok: true
  warnings: AgentDescriptionLintWarning[]
  reasonCodes: string[]
} {
  const text = description.trim()
  const warnings: AgentDescriptionLintWarning[] = []
  if (text.length < 32) {
    warnings.push({
      code: "description_too_short",
      severity: "warning",
      message: "Description is too short to route safely.",
    })
  }
  for (const pattern of BROAD_DESCRIPTION_PATTERNS) {
    const match = text.match(pattern)
    if (match?.[0]) {
      warnings.push({
        code: "description_too_broad",
        severity: "warning",
        message: "Description is broad enough to blur ownership and routing.",
        matched: match[0],
      })
    }
  }
  if (!/\b(research|write|review|verify|code|schedule|monitor|design|test|analy|plan)\w*\b/i.test(text)) {
    warnings.push({
      code: "missing_domain_or_specialty",
      severity: "warning",
      message: "Description does not name a concrete domain or specialty.",
    })
  }
  if (!/\b(do not|avoid|only|except|scope|boundary|review|approval|검토|범위|제외)\b/i.test(text)) {
    warnings.push({
      code: "missing_boundaries",
      severity: "warning",
      message: "Description does not state boundaries or review constraints.",
    })
  }
  return {
    ok: true,
    warnings,
    reasonCodes: warnings.map((warning) => warning.code),
  }
}

function commandParts(commandText: string): string[] {
  return commandText.trim().split(/\s+/).filter(Boolean)
}

function commandTail(commandText: string, consumedParts: number): string {
  const parts = commandParts(commandText)
  const prefix = parts.slice(0, consumedParts).join(" ")
  return commandText.trim().slice(prefix.length).trim()
}

function parseFocusTarget(value: string | undefined): FocusTarget | undefined {
  const raw = value?.trim()
  if (!raw) return undefined
  const [prefix, ...rest] = raw.split(":")
  const suffix = rest.join(":")
  if (prefix === "agent" && suffix) return { kind: "agent", id: suffix.startsWith("agent:") ? suffix : `agent:${suffix}` }
  if (prefix === "team" && suffix) return { kind: "team", id: suffix.startsWith("team:") ? suffix : `team:${suffix}` }
  if ((prefix === "subsession" || prefix === "sub_session") && suffix) {
    return { kind: "sub_session", id: suffix.startsWith("sub:") ? suffix : `sub:${suffix}` }
  }
  if (raw.startsWith("agent:")) return { kind: "agent", id: raw }
  if (raw.startsWith("team:")) return { kind: "team", id: raw }
  if (raw.startsWith("sub:")) return { kind: "sub_session", id: raw }
  return undefined
}

function subSessionListForCommand(parentRunId?: string): SubSessionRow[] {
  if (parentRunId) {
    return listRunSubSessionsForParentRun(parentRunId).map((row) => ({
      sub_session_id: row.sub_session_id,
      parent_run_id: row.parent_run_id,
      parent_session_id: row.parent_session_id,
      agent_id: row.agent_id,
      agent_display_name: row.agent_display_name,
      agent_nickname: row.agent_nickname,
      status: row.status,
      contract_json: row.contract_json,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))
  }
  return recentSubSessionRows()
}

export function executeWorkspaceCommand(input: {
  command: string
  threadId?: string
  parentAgentId?: string
  payload?: unknown
}): {
  ok: boolean
  command: string
  reasonCode: string
  result?: unknown
  statusCode?: number
} {
  const command = input.command.trim()
  const parts = commandParts(command)
  const root = parts[0]?.toLowerCase()
  if (!root?.startsWith("/")) {
    return { ok: false, command, reasonCode: "slash_command_required", statusCode: 400 }
  }

  if (root === "/agents") {
    return {
      ok: true,
      command,
      reasonCode: "agents_listed",
      result: searchCommandPalette({ query: commandTail(command, 1), scope: "agent" }),
    }
  }
  if (root === "/teams") {
    return {
      ok: true,
      command,
      reasonCode: "teams_listed",
      result: searchCommandPalette({ query: commandTail(command, 1), scope: "team" }),
    }
  }
  if (root === "/focus") {
    const target = parseFocusTarget(parts[1])
    if (!target) {
      return { ok: false, command, reasonCode: "focus_target_required", statusCode: 400 }
    }
    const threadId = input.threadId?.trim()
    const parentAgentId = input.parentAgentId?.trim()
    const result = setFocusBinding({
      ...(threadId ? { threadId } : {}),
      ...(parentAgentId ? { parentAgentId } : {}),
      target,
      source: "command_palette",
    })
    return {
      ok: result.ok,
      command,
      reasonCode: result.ok ? "focus_bound" : result.reasonCode,
      result,
      statusCode: result.ok ? 200 : result.statusCode,
    }
  }
  if (root === "/unfocus") {
    return {
      ok: true,
      command,
      reasonCode: "focus_binding_cleared",
      result: clearFocusBinding(input.threadId),
    }
  }
  if (root === "/subsessions") {
    const action = parts[1]?.toLowerCase()
    if (!action || action === "list") {
      return {
        ok: true,
        command,
        reasonCode: "subsessions_listed",
        result: { subSessions: subSessionListForCommand(parts[2]).map(subSessionResult) },
      }
    }
    if (action === "info" && parts[2]) {
      const result = getSubSessionInfo(parts[2], parts[3])
      return {
        ok: result.ok,
        command,
        reasonCode: result.ok ? "subsession_info" : result.reasonCode,
        result,
        statusCode: result.ok ? 200 : result.statusCode,
      }
    }
    if ((action === "log" || action === "logs") && parts[2]) {
      const result = listSubSessionLogs({ subSessionId: parts[2], limit: parts[3] })
      return {
        ok: result.ok,
        command,
        reasonCode: result.ok ? "subsession_logs" : result.reasonCode,
        result,
        statusCode: result.ok ? 200 : result.statusCode,
      }
    }
    if (action === "spawn") {
      const result = spawnSubSessionAck(input.payload)
      return {
        ok: result.ok,
        command,
        reasonCode: result.reasonCode,
        result,
        statusCode: result.ok ? 202 : 400,
      }
    }
    if (["kill", "send", "steer"].includes(action ?? "") && parts[2]) {
      const controlAction = action as Extract<SubSessionControlAction, "kill" | "send" | "steer">
      const message = commandTail(command, 3)
      const result = controlSubSession({
        subSessionId: parts[2],
        action: controlAction,
        body: {
          message: message || `${controlAction} requested from command palette`,
          ...(isRecord(input.payload) ? input.payload : {}),
        },
      })
      return {
        ok: result.ok,
        command,
        reasonCode: result.ok ? result.reasonCode : result.reasonCode,
        result,
        statusCode: "statusCode" in result ? result.statusCode : 202,
      }
    }
    return { ok: false, command, reasonCode: "unsupported_subsession_command", statusCode: 400 }
  }

  return { ok: false, command, reasonCode: "unsupported_command", statusCode: 400 }
}

export function createOneClickBackgroundTask(input: {
  message?: string
  sessionId?: string
  parentRunId?: string
  targetAgentId?: string
  dryRun?: boolean
}): {
  ok: boolean
  reasonCode: string
  backgroundTask?: {
    mode: "background_sub_session"
    status: "draft" | "queued"
    parentRunId: string
    sessionId?: string
    targetAgentId: string
    message: string
    command: string
    subSessionDraft: Record<string, unknown>
    finalAnswerOwnerUnchanged: true
    memoryIsolationUnchanged: true
  }
  statusCode?: number
} {
  const message = input.message?.trim()
  const parentRunId = input.parentRunId?.trim()
  const targetAgentId = input.targetAgentId?.trim()
  if (!message) return { ok: false, reasonCode: "background_task_message_required", statusCode: 400 }
  if (!parentRunId) return { ok: false, reasonCode: "background_task_parent_run_required", statusCode: 400 }
  if (!targetAgentId) return { ok: false, reasonCode: "background_task_target_agent_required", statusCode: 400 }
  const subSessionId = `sub:bg:${randomUUID()}`
  return {
    ok: true,
    reasonCode: input.dryRun === false ? "background_subsession_queued" : "background_subsession_draft",
    backgroundTask: {
      mode: "background_sub_session",
      status: input.dryRun === false ? "queued" : "draft",
      parentRunId,
      ...(input.sessionId?.trim() ? { sessionId: input.sessionId.trim() } : {}),
      targetAgentId,
      message: sanitizeSubSessionControlText(message),
      command: `/subsessions spawn ${subSessionId}`,
      subSessionDraft: {
        subSessionId,
        parentRunId,
        targetAgentId,
        promptPreview: sanitizeSubSessionControlText(message).slice(0, 500),
        reasonCode: "one_click_background_task",
        requiresPromptBundlePreflight: true,
      },
      finalAnswerOwnerUnchanged: true,
      memoryIsolationUnchanged: true,
    },
  }
}
