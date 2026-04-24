import type {
  CapabilityPolicy,
  CapabilityRiskLevel,
  ModelProfile,
  PermissionProfile,
  SkillMcpAllowlist,
  SubAgentConfig,
} from "../contracts/sub-agent-orchestration.js"
import {
  type DbAgentCapabilityBinding,
  type DbAgentCapabilityKind,
  type DbCapabilityCatalogStatus,
  type DbMcpServerCatalogEntry,
  type DbSkillCatalogEntry,
  listAgentCapabilityBindings,
  listMcpServerCatalogEntries,
  listSkillCatalogEntries,
} from "../db/index.js"
import {
  CAPABILITY_RISK_ORDER,
  normalizeSkillMcpAllowlist,
} from "../security/capability-isolation.js"
import type { ModelAvailabilityDoctorSnapshot } from "./model-execution-policy.js"

export type CapabilityModelDiagnosticSeverity = "info" | "warning" | "invalid"
export type CapabilityModelAvailabilityStatus = "available" | "degraded" | "unavailable"
export type AgentCapabilityCatalogStatus = DbCapabilityCatalogStatus | "unknown"
export type AgentCapabilityBindingStatus = DbAgentCapabilityBinding["status"] | "implicit"

export interface CapabilityModelDiagnostic {
  reasonCode: string
  severity: CapabilityModelDiagnosticSeverity
  message: string
  agentId: string
  bindingId?: string
  catalogKind?: DbAgentCapabilityKind
  catalogId?: string
}

export interface AgentSecretScopeSummary {
  configured: boolean
  scopeId?: string
}

export interface AgentCapabilityBindingSummary {
  bindingId: string
  agentId: string
  catalogKind: DbAgentCapabilityKind
  catalogId: string
  catalogDisplayName?: string
  catalogStatus: AgentCapabilityCatalogStatus
  bindingStatus: AgentCapabilityBindingStatus
  available: boolean
  availability: CapabilityModelAvailabilityStatus
  reasonCodes: string[]
  enabledToolNames: string[]
  disabledToolNames: string[]
  secretScope: AgentSecretScopeSummary
  risk: CapabilityRiskLevel
  riskCeiling: CapabilityRiskLevel
  approvalRequiredFrom: CapabilityRiskLevel
  rateLimit: CapabilityPolicy["rateLimit"]
}

export interface AgentCapabilitySummary {
  agentId: string
  available: boolean
  availability: CapabilityModelAvailabilityStatus
  enabledSkillIds: string[]
  disabledSkillIds: string[]
  enabledMcpServerIds: string[]
  disabledMcpServerIds: string[]
  enabledToolNames: string[]
  disabledToolNames: string[]
  secretScopes: AgentSecretScopeSummary[]
  skillBindings: AgentCapabilityBindingSummary[]
  mcpServerBindings: AgentCapabilityBindingSummary[]
  diagnostics: CapabilityModelDiagnostic[]
  diagnosticReasonCodes: string[]
}

export interface AgentSkillMcpSummaryResolved {
  enabledSkillIds: string[]
  enabledMcpServerIds: string[]
  enabledToolNames: string[]
  disabledToolNames: string[]
  secretScopeId?: string
}

export interface AgentModelSummary {
  agentId: string
  configured: boolean
  available: boolean
  availability: CapabilityModelAvailabilityStatus
  providerId?: string
  modelId?: string
  timeoutMs?: number
  retryCount?: number
  costBudget?: number
  fallbackModelId?: string
  diagnostics: CapabilityModelDiagnostic[]
  diagnosticReasonCodes: string[]
}

export interface AgentModelSummaryOptions {
  doctor?: ModelAvailabilityDoctorSnapshot | ModelAvailabilityDoctorSnapshot[]
}

export interface AgentCapabilityModelSummary {
  agentId: string
  capabilitySummary: AgentCapabilitySummary
  modelSummary: AgentModelSummary
  skillMcpSummary: AgentSkillMcpSummaryResolved
  degradedReasonCodes: string[]
}

interface CatalogRef {
  catalogKind: DbAgentCapabilityKind
  catalogId: string
  displayName?: string
  status: AgentCapabilityCatalogStatus
  risk: CapabilityRiskLevel
  toolNames: string[]
}

const DEFAULT_RATE_LIMIT: CapabilityPolicy["rateLimit"] = {
  maxConcurrentCalls: 1,
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : []
  } catch {
    return []
  }
}

function parseJsonRecord(value: string | null): Record<string, unknown> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function parsePermissionProfile(value: string | null): PermissionProfile | undefined {
  const record = parseJsonRecord(value)
  if (!record) return undefined
  return record as unknown as PermissionProfile
}

function parseRateLimit(value: string | null): CapabilityPolicy["rateLimit"] | undefined {
  const record = parseJsonRecord(value)
  if (!record || typeof record.maxConcurrentCalls !== "number") return undefined
  return {
    maxConcurrentCalls: Math.max(1, record.maxConcurrentCalls),
    ...(typeof record.maxCallsPerMinute === "number"
      ? { maxCallsPerMinute: Math.max(1, record.maxCallsPerMinute) }
      : {}),
  }
}

function cloneRateLimit(
  value: CapabilityPolicy["rateLimit"] | undefined,
): CapabilityPolicy["rateLimit"] {
  return {
    maxConcurrentCalls: Math.max(
      1,
      value?.maxConcurrentCalls ?? DEFAULT_RATE_LIMIT.maxConcurrentCalls,
    ),
    ...(value?.maxCallsPerMinute !== undefined
      ? { maxCallsPerMinute: Math.max(1, value.maxCallsPerMinute) }
      : {}),
  }
}

function catalogSkillRef(row: DbSkillCatalogEntry): CatalogRef {
  return {
    catalogKind: "skill",
    catalogId: row.skill_id,
    displayName: row.display_name,
    status: row.status,
    risk: row.risk,
    toolNames: parseJsonArray(row.tool_names_json),
  }
}

function catalogMcpRef(row: DbMcpServerCatalogEntry): CatalogRef {
  return {
    catalogKind: "mcp_server",
    catalogId: row.mcp_server_id,
    displayName: row.display_name,
    status: row.status,
    risk: row.risk,
    toolNames: parseJsonArray(row.tool_names_json),
  }
}

function implicitBindingId(
  agentId: string,
  catalogKind: DbAgentCapabilityKind,
  catalogId: string,
): string {
  return `${agentId}:implicit:${catalogKind}:${catalogId}`
}

function catalogDisabledReason(catalog: CatalogRef): string | undefined {
  if (catalog.status === "enabled" || catalog.status === "unknown") return undefined
  return catalog.catalogKind === "skill" ? "skill_catalog_disabled" : "mcp_server_catalog_disabled"
}

function bindingDisabledReason(status: AgentCapabilityBindingStatus): string | undefined {
  if (status === "enabled" || status === "implicit") return undefined
  return status === "archived" ? "capability_binding_archived" : "capability_binding_disabled"
}

function availabilityFromReasons(reasonCodes: string[]): CapabilityModelAvailabilityStatus {
  if (
    reasonCodes.some((reason) =>
      [
        "capability_binding_disabled",
        "capability_binding_archived",
        "skill_catalog_disabled",
        "mcp_server_catalog_disabled",
        "mcp_secret_scope_missing",
      ].includes(reason),
    )
  ) {
    return "unavailable"
  }
  return reasonCodes.length > 0 ? "degraded" : "available"
}

function diagnosticSeverityFor(reasonCode: string): CapabilityModelDiagnosticSeverity {
  return [
    "model_profile_missing",
    "model_provider_unknown",
    "model_id_unknown",
    "model_doctor_unavailable",
    "capability_binding_disabled",
    "capability_binding_archived",
    "skill_catalog_disabled",
    "mcp_server_catalog_disabled",
    "mcp_secret_scope_missing",
  ].includes(reasonCode)
    ? "warning"
    : "info"
}

function diagnosticMessage(reasonCode: string, catalogId?: string): string {
  switch (reasonCode) {
    case "capability_binding_disabled":
      return `${catalogId ?? "capability"} binding is disabled for this agent.`
    case "capability_binding_archived":
      return `${catalogId ?? "capability"} binding is archived for this agent.`
    case "skill_catalog_disabled":
      return `Skill catalog item ${catalogId ?? "unknown"} is disabled or archived.`
    case "mcp_server_catalog_disabled":
      return `MCP server catalog item ${catalogId ?? "unknown"} is disabled or archived.`
    case "mcp_secret_scope_missing":
      return `MCP server ${catalogId ?? "unknown"} has no configured secret scope.`
    case "model_profile_missing":
      return "Agent model profile is missing."
    case "model_provider_unknown":
      return "Agent model provider is unknown."
    case "model_id_unknown":
      return "Agent model id is unknown."
    case "model_fallback_cost_budget_missing":
      return "Agent fallback model is configured without a cost budget."
    case "model_timeout_missing":
      return "Agent model timeout is not configured."
    case "model_doctor_unavailable":
      return "Model availability doctor reports this model as unavailable."
    case "model_doctor_degraded":
      return "Model availability doctor reports this model as degraded."
    default:
      return `${catalogId ?? "agent"} has diagnostic ${reasonCode}.`
  }
}

function diagnostic(input: {
  reasonCode: string
  agentId: string
  bindingId?: string
  catalogKind?: DbAgentCapabilityKind
  catalogId?: string
}): CapabilityModelDiagnostic {
  return {
    reasonCode: input.reasonCode,
    severity: diagnosticSeverityFor(input.reasonCode),
    message: diagnosticMessage(input.reasonCode, input.catalogId),
    agentId: input.agentId,
    ...(input.bindingId ? { bindingId: input.bindingId } : {}),
    ...(input.catalogKind ? { catalogKind: input.catalogKind } : {}),
    ...(input.catalogId ? { catalogId: input.catalogId } : {}),
  }
}

function broaderThan(left: CapabilityRiskLevel, right: CapabilityRiskLevel): CapabilityRiskLevel {
  return CAPABILITY_RISK_ORDER[left] > CAPABILITY_RISK_ORDER[right] ? left : right
}

function bindingSummary(input: {
  agentId: string
  catalog: CatalogRef
  binding: DbAgentCapabilityBinding | undefined
  allowlist: SkillMcpAllowlist
  permissionProfile: PermissionProfile
  rateLimit: CapabilityPolicy["rateLimit"]
}): AgentCapabilityBindingSummary {
  const permissionProfile =
    parsePermissionProfile(input.binding?.permission_profile_json ?? null) ??
    input.permissionProfile
  const rateLimit = cloneRateLimit(
    parseRateLimit(input.binding?.rate_limit_json ?? null) ?? input.rateLimit,
  )
  const bindingStatus: AgentCapabilityBindingStatus = input.binding?.status ?? "implicit"
  const secretScopeId = input.binding?.secret_scope_id ?? input.allowlist.secretScopeId
  const enabledToolNames = uniqueStrings([
    ...input.catalog.toolNames,
    ...parseJsonArray(input.binding?.enabled_tool_names_json ?? null),
  ])
  const disabledToolNames = uniqueStrings(
    parseJsonArray(input.binding?.disabled_tool_names_json ?? null),
  )
  const reasonCodes = uniqueStrings(
    [
      bindingDisabledReason(bindingStatus),
      catalogDisabledReason(input.catalog),
      input.catalog.catalogKind === "mcp_server" && !secretScopeId
        ? "mcp_secret_scope_missing"
        : undefined,
    ].filter((reason): reason is string => Boolean(reason)),
  )
  const availability = availabilityFromReasons(reasonCodes)
  return {
    bindingId:
      input.binding?.binding_id ??
      implicitBindingId(input.agentId, input.catalog.catalogKind, input.catalog.catalogId),
    agentId: input.agentId,
    catalogKind: input.catalog.catalogKind,
    catalogId: input.catalog.catalogId,
    ...(input.catalog.displayName ? { catalogDisplayName: input.catalog.displayName } : {}),
    catalogStatus: input.catalog.status,
    bindingStatus,
    available: availability !== "unavailable",
    availability,
    reasonCodes,
    enabledToolNames,
    disabledToolNames,
    secretScope: {
      configured: Boolean(secretScopeId),
      ...(secretScopeId ? { scopeId: secretScopeId } : {}),
    },
    risk:
      input.catalog.status === "unknown"
        ? permissionProfile.riskCeiling
        : broaderThan(input.catalog.risk, "safe"),
    riskCeiling: permissionProfile.riskCeiling,
    approvalRequiredFrom:
      input.binding?.approval_required_from ?? permissionProfile.approvalRequiredFrom,
    rateLimit,
  }
}

function refsFor(
  catalogKind: DbAgentCapabilityKind,
  ids: string[],
  catalog: Map<string, CatalogRef>,
): CatalogRef[] {
  return uniqueStrings(ids).map((catalogId) => {
    const existing = catalog.get(catalogId)
    return {
      catalogKind,
      catalogId,
      status: existing?.status ?? "unknown",
      risk: existing?.risk ?? "safe",
      toolNames: existing?.toolNames ?? [],
      ...(existing?.displayName ? { displayName: existing.displayName } : {}),
    }
  })
}

function mergedAvailability(
  diagnostics: CapabilityModelDiagnostic[],
  hasUnavailable: boolean,
): CapabilityModelAvailabilityStatus {
  if (hasUnavailable) return "degraded"
  return diagnostics.some((item) => item.severity !== "info") ? "degraded" : "available"
}

export function buildAgentCapabilitySummary(config: SubAgentConfig): AgentCapabilitySummary {
  const allowlist = normalizeSkillMcpAllowlist(config.capabilityPolicy.skillMcpAllowlist)
  const skillCatalog = new Map(
    listSkillCatalogEntries({ includeArchived: true }).map((row) => [
      row.skill_id,
      catalogSkillRef(row),
    ]),
  )
  const mcpCatalog = new Map(
    listMcpServerCatalogEntries({ includeArchived: true }).map((row) => [
      row.mcp_server_id,
      catalogMcpRef(row),
    ]),
  )
  const bindings = listAgentCapabilityBindings({ agentId: config.agentId, includeArchived: true })
  const bindingByKey = new Map(
    bindings.map((binding) => [`${binding.capability_kind}:${binding.catalog_id}`, binding]),
  )
  const skillRefs = refsFor(
    "skill",
    [
      ...allowlist.enabledSkillIds,
      ...bindings
        .filter((binding) => binding.capability_kind === "skill")
        .map((binding) => binding.catalog_id),
    ],
    skillCatalog,
  )
  const mcpRefs = refsFor(
    "mcp_server",
    [
      ...allowlist.enabledMcpServerIds,
      ...bindings
        .filter((binding) => binding.capability_kind === "mcp_server")
        .map((binding) => binding.catalog_id),
    ],
    mcpCatalog,
  )

  const skillBindings = skillRefs.map((catalog) =>
    bindingSummary({
      agentId: config.agentId,
      catalog,
      binding: bindingByKey.get(`${catalog.catalogKind}:${catalog.catalogId}`),
      allowlist,
      permissionProfile: config.capabilityPolicy.permissionProfile,
      rateLimit: config.capabilityPolicy.rateLimit,
    }),
  )
  const mcpServerBindings = mcpRefs.map((catalog) =>
    bindingSummary({
      agentId: config.agentId,
      catalog,
      binding: bindingByKey.get(`${catalog.catalogKind}:${catalog.catalogId}`),
      allowlist,
      permissionProfile: config.capabilityPolicy.permissionProfile,
      rateLimit: config.capabilityPolicy.rateLimit,
    }),
  )
  const bindingDiagnostics = [...skillBindings, ...mcpServerBindings].flatMap((binding) =>
    binding.reasonCodes.map((reasonCode) =>
      diagnostic({
        reasonCode,
        agentId: config.agentId,
        bindingId: binding.bindingId,
        catalogKind: binding.catalogKind,
        catalogId: binding.catalogId,
      }),
    ),
  )
  const availableSkillIds = skillBindings
    .filter((binding) => binding.available)
    .map((binding) => binding.catalogId)
  const disabledSkillIds = skillBindings
    .filter((binding) => !binding.available)
    .map((binding) => binding.catalogId)
  const availableMcpServerIds = mcpServerBindings
    .filter((binding) => binding.available)
    .map((binding) => binding.catalogId)
  const disabledMcpServerIds = mcpServerBindings
    .filter((binding) => !binding.available)
    .map((binding) => binding.catalogId)
  const disabledToolNames = uniqueStrings([
    ...allowlist.disabledToolNames,
    ...[...skillBindings, ...mcpServerBindings].flatMap((binding) => binding.disabledToolNames),
    ...[...skillBindings, ...mcpServerBindings]
      .filter((binding) => !binding.available)
      .flatMap((binding) => binding.enabledToolNames),
  ])
  const enabledToolNames = uniqueStrings([
    ...allowlist.enabledToolNames,
    ...[...skillBindings, ...mcpServerBindings]
      .filter((binding) => binding.available)
      .flatMap((binding) => binding.enabledToolNames),
  ]).filter((toolName) => !disabledToolNames.includes(toolName))
  const secretScopes = [...skillBindings, ...mcpServerBindings]
    .filter((binding) => binding.secretScope.configured)
    .map((binding) => binding.secretScope)
  const availability = mergedAvailability(
    bindingDiagnostics,
    [...skillBindings, ...mcpServerBindings].some((binding) => !binding.available),
  )
  return {
    agentId: config.agentId,
    available: availability !== "unavailable",
    availability,
    enabledSkillIds: availableSkillIds,
    disabledSkillIds,
    enabledMcpServerIds: availableMcpServerIds,
    disabledMcpServerIds,
    enabledToolNames,
    disabledToolNames,
    secretScopes,
    skillBindings,
    mcpServerBindings,
    diagnostics: bindingDiagnostics,
    diagnosticReasonCodes: uniqueStrings(bindingDiagnostics.map((item) => item.reasonCode)),
  }
}

function matchingDoctor(
  modelProfile: ModelProfile | undefined,
  doctor: AgentModelSummaryOptions["doctor"],
): ModelAvailabilityDoctorSnapshot | undefined {
  if (!modelProfile || !doctor) return undefined
  const rows = Array.isArray(doctor) ? doctor : [doctor]
  return rows.find(
    (row) =>
      row.providerId === modelProfile.providerId &&
      (row.modelId === modelProfile.modelId || row.modelId === modelProfile.fallbackModelId),
  )
}

function modelReasonCodes(
  modelProfile: ModelProfile | undefined,
  options: AgentModelSummaryOptions = {},
): string[] {
  const doctor = matchingDoctor(modelProfile, options.doctor)
  if (!modelProfile) return ["model_profile_missing"]
  return uniqueStrings(
    [
      modelProfile.providerId === "provider:unknown" ? "model_provider_unknown" : undefined,
      modelProfile.modelId === "model:unknown" ? "model_id_unknown" : undefined,
      modelProfile.fallbackModelId && modelProfile.costBudget === undefined
        ? "model_fallback_cost_budget_missing"
        : undefined,
      modelProfile.timeoutMs === undefined ? "model_timeout_missing" : undefined,
      doctor?.status === "unavailable" ? "model_doctor_unavailable" : undefined,
      doctor?.status === "degraded" ? "model_doctor_degraded" : undefined,
      ...(doctor?.reasonCodes ?? []),
    ].filter((reason): reason is string => Boolean(reason)),
  )
}

function modelAvailability(reasonCodes: string[]): CapabilityModelAvailabilityStatus {
  if (
    reasonCodes.includes("model_profile_missing") ||
    reasonCodes.includes("model_provider_unknown") ||
    reasonCodes.includes("model_id_unknown") ||
    reasonCodes.includes("model_doctor_unavailable")
  ) {
    return "unavailable"
  }
  return reasonCodes.length > 0 ? "degraded" : "available"
}

export function buildAgentModelSummary(
  config: SubAgentConfig,
  options: AgentModelSummaryOptions = {},
): AgentModelSummary {
  const reasonCodes = modelReasonCodes(config.modelProfile, options)
  const availability = modelAvailability(reasonCodes)
  const diagnostics = reasonCodes.map((reasonCode) =>
    diagnostic({ reasonCode, agentId: config.agentId }),
  )
  return {
    agentId: config.agentId,
    configured: config.modelProfile !== undefined,
    available: availability !== "unavailable",
    availability,
    ...(config.modelProfile?.providerId ? { providerId: config.modelProfile.providerId } : {}),
    ...(config.modelProfile?.modelId ? { modelId: config.modelProfile.modelId } : {}),
    ...(config.modelProfile?.timeoutMs !== undefined
      ? { timeoutMs: config.modelProfile.timeoutMs }
      : {}),
    ...(config.modelProfile?.retryCount !== undefined
      ? { retryCount: config.modelProfile.retryCount }
      : {}),
    ...(config.modelProfile?.costBudget !== undefined
      ? { costBudget: config.modelProfile.costBudget }
      : {}),
    ...(config.modelProfile?.fallbackModelId
      ? { fallbackModelId: config.modelProfile.fallbackModelId }
      : {}),
    diagnostics,
    diagnosticReasonCodes: reasonCodes,
  }
}

export function resolveAgentCapabilityModelSummary(
  config: SubAgentConfig,
  options: AgentModelSummaryOptions = {},
): AgentCapabilityModelSummary {
  const capabilitySummary = buildAgentCapabilitySummary(config)
  const modelSummary = buildAgentModelSummary(config, options)
  const allowlist = normalizeSkillMcpAllowlist(config.capabilityPolicy.skillMcpAllowlist)
  const skillMcpSummary: AgentSkillMcpSummaryResolved = {
    enabledSkillIds: [...capabilitySummary.enabledSkillIds],
    enabledMcpServerIds: [...capabilitySummary.enabledMcpServerIds],
    enabledToolNames: [...capabilitySummary.enabledToolNames],
    disabledToolNames: [...capabilitySummary.disabledToolNames],
    ...(allowlist.secretScopeId ? { secretScopeId: allowlist.secretScopeId } : {}),
  }
  const degradedReasonCodes = uniqueStrings([
    ...capabilitySummary.diagnosticReasonCodes,
    ...modelSummary.diagnosticReasonCodes,
  ])
  return {
    agentId: config.agentId,
    capabilitySummary,
    modelSummary,
    skillMcpSummary,
    degradedReasonCodes,
  }
}
