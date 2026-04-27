import { randomUUID } from "node:crypto"
import { CONTRACT_SCHEMA_VERSION, type JsonObject, type JsonValue } from "../contracts/index.js"
import {
  getAgentConfig,
  getTeamConfig,
  insertLearningEvent,
  insertProfileHistoryVersion,
  insertProfileRestoreEvent,
  listLearningEventsByApprovalState,
  listLearningEvents,
  listProfileHistoryVersions,
  listProfileRestoreEvents,
  updateLearningEventApprovalState,
  upsertAgentConfig,
  upsertTeamConfig,
  type DbLearningEvent,
  type DbProfileHistoryVersion,
  type DbProfileRestoreEvent,
} from "../db/index.js"
import { storeOwnerScopedMemory } from "../memory/isolation.js"
import type {
  AgentConfig,
  AgentEntityType,
  HistoryVersion,
  LearningApprovalState,
  LearningEvent,
  OwnerScope,
  RestoreEvent,
  RuntimeIdentity,
  TeamConfig,
} from "../contracts/sub-agent-orchestration.js"
import { recordOrchestrationEvent } from "../orchestration/event-ledger.js"

export type LearningRiskLevel = "low" | "medium" | "high"
export type LearningPolicyReasonCode =
  | "auto_apply_self_memory_high_confidence"
  | "pending_missing_evidence"
  | "pending_medium_confidence"
  | "pending_non_memory_target"
  | "pending_locked_setting_conflict"
  | "pending_permission_or_capability_expansion"
  | "rejected_low_confidence"
  | "rejected_cross_agent_write"

export interface LearningPolicyInput {
  actorOwner: OwnerScope
  targetOwner: OwnerScope
  learningTarget: LearningEvent["learningTarget"]
  before: JsonObject
  after: JsonObject
  confidence: number
  evidenceRefs?: string[]
  risk?: LearningRiskLevel
  lockedFields?: string[]
}

export interface LearningPolicyDecision {
  approvalState: LearningApprovalState
  reasonCode: LearningPolicyReasonCode
  autoApply: boolean
  requiresReview: boolean
  blocked: boolean
  confidence: number
  risk: LearningRiskLevel
  issues: string[]
}

export interface LearningEventServiceInput extends LearningPolicyInput {
  agentId: string
  agentType: AgentEntityType
  beforeSummary: string
  afterSummary: string
  evidenceRefs: string[]
  sourceRunId?: string
  sourceSessionId?: string
  sourceSubSessionId?: string
  parentRunId?: string
  parentSessionId?: string
  parentSubSessionId?: string
  parentRequestId?: string
  auditCorrelationId?: string
  learningEventId?: string
  idempotencyKey?: string
  now?: () => number
}

export interface LearningEventServiceResult {
  event: LearningEvent
  policy: LearningPolicyDecision
  inserted: boolean
  history?: HistoryVersion
  memoryDocumentId?: string
}

export interface LearningReviewQueueQuery {
  agentId?: string
  limit?: number
}

export interface HistoryVersionInput {
  targetEntityType: HistoryVersion["targetEntityType"]
  targetEntityId: string
  before: JsonObject
  after: JsonObject
  reasonCode: string
  owner: OwnerScope
  historyVersionId?: string
  idempotencyKey?: string
  auditCorrelationId?: string
  parentRunId?: string
  parentSessionId?: string
  parentSubSessionId?: string
  parentRequestId?: string
  now?: () => number
}

export interface RestoreDryRunResult {
  ok: boolean
  targetEntityType: RestoreEvent["targetEntityType"]
  targetEntityId: string
  restoredHistoryVersionId: string
  restorePayload: JsonObject
  currentPayload?: JsonObject
  effectSummary: string[]
  conflictCodes: string[]
}

export interface RestoreHistoryVersionInput {
  targetEntityType: RestoreEvent["targetEntityType"]
  targetEntityId: string
  restoredHistoryVersionId: string
  owner: OwnerScope
  dryRun: boolean
  restoreEventId?: string
  idempotencyKey?: string
  auditCorrelationId?: string
  parentRunId?: string
  parentSessionId?: string
  parentSubSessionId?: string
  parentRequestId?: string
  apply?: boolean
  now?: () => number
}

export interface RestoreHistoryVersionResult extends RestoreDryRunResult {
  event: RestoreEvent
  inserted: boolean
  applied: boolean
}

export interface ApproveLearningEventInput {
  agentId: string
  learningEventId: string
  owner: OwnerScope
  auditCorrelationId?: string
  now?: () => number
}

export interface ApproveLearningEventResult {
  ok: boolean
  reasonCode:
    | "approved"
    | "learning_event_not_found"
    | "learning_event_not_pending"
    | "learning_event_missing_diff"
  event?: LearningEvent
  history?: HistoryVersion
  historyInserted: boolean
  memoryDocumentId?: string
}

function sameOwner(a: OwnerScope, b: OwnerScope): boolean {
  return a.ownerType === b.ownerType && a.ownerId === b.ownerId
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function hasOwn(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function normalizedKeys(value: JsonObject): Set<string> {
  const result = new Set<string>()
  const visit = (item: JsonValue | undefined): void => {
    if (!item || typeof item !== "object") return
    if (Array.isArray(item)) {
      for (const child of item) visit(child)
      return
    }
    for (const [key, child] of Object.entries(item)) {
      result.add(key.trim().toLowerCase())
      visit(child)
    }
  }
  visit(value)
  return result
}

function containsPermissionOrCapabilityExpansion(input: {
  before: JsonObject
  after: JsonObject
}): boolean {
  const sensitiveKeys = new Set([
    "capabilitypolicy",
    "capabilitybinding",
    "agentcapabilitybinding",
    "capabilitycatalog",
    "permissionprofile",
    "skillmcpallowlist",
    "catalogid",
    "bindingid",
    "skillbinding",
    "mcpserverbinding",
    "enabledskillids",
    "enabledmcpserverids",
    "enabledtoolnames",
    "secretscopeid",
    "secretscopes",
    "secretaccess",
    "allowexternalnetwork",
    "allowfilesystemwrite",
    "allowshellexecution",
    "allowscreencontrol",
    "allowedpaths",
    "riskceiling",
    "approvalrequiredfrom",
  ])
  const afterKeys = normalizedKeys(input.after)
  if ([...afterKeys].some((key) => sensitiveKeys.has(key))) return true

  const beforeRisk =
    typeof input.before["riskCeiling"] === "string" ? input.before["riskCeiling"] : undefined
  const afterRisk =
    typeof input.after["riskCeiling"] === "string" ? input.after["riskCeiling"] : undefined
  if (beforeRisk && afterRisk && beforeRisk !== afterRisk) return true

  return false
}

function lockedFieldConflict(input: { after: JsonObject; lockedFields?: string[] }): boolean {
  const locked = new Set((input.lockedFields ?? []).map((item) => item.trim()).filter(Boolean))
  if (locked.size === 0) return false
  const afterKeys = normalizedKeys(input.after)
  return [...locked].some(
    (field) => afterKeys.has(field.toLowerCase()) || hasOwn(input.after, field),
  )
}

function hasEvidenceRefs(evidenceRefs: string[] | undefined): boolean {
  return (evidenceRefs ?? []).some((ref) => ref.trim().length > 0)
}

function redactString(value: string): { value: string; changed: boolean } {
  let changed = false
  const next = value
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, () => {
      changed = true
      return "[redacted-api-key]"
    })
    .replace(
      /\b(?:api[_-]?key|token|secret|authorization)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}["']?/giu,
      (match) => {
        changed = true
        const key = match.split(/[:=]/u)[0]?.trim() || "secret"
        return `${key}: [redacted]`
      },
    )
    .replace(/\/Users\/[^/\s)]+\/[^\s)]+/g, () => {
      changed = true
      return "/Users/<user>/..."
    })
  return { value: next, changed }
}

function sanitizeJsonValue(value: JsonValue | undefined): JsonValue | undefined {
  if (typeof value === "string") return redactString(value).value
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonValue(item) ?? null)
  if (value && typeof value === "object") {
    const out: JsonObject = {}
    for (const [key, item] of Object.entries(value)) {
      if (/^(secret|token|apiKey|authorization)$/iu.test(key)) {
        out[key] = "[redacted]"
        continue
      }
      const next = sanitizeJsonValue(item)
      if (next !== undefined) out[key] = next
    }
    return out
  }
  return value
}

function sanitizeJsonObject(value: JsonObject): JsonObject {
  const sanitized = sanitizeJsonValue(value)
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? (sanitized as JsonObject)
    : {}
}

function sanitizeSummary(value: string): string {
  return redactString(value).value.trim()
}

function parseJsonObject(value: string | null | undefined): JsonObject {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : {}
  } catch {
    return {}
  }
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : []
  } catch {
    return []
  }
}

function buildIdentity(input: {
  entityType: RuntimeIdentity["entityType"]
  entityId: string
  owner: OwnerScope
  idempotencyKey: string
  auditCorrelationId?: string
  parentRunId?: string
  parentSessionId?: string
  parentSubSessionId?: string
  parentRequestId?: string
}): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType: input.entityType,
    entityId: input.entityId,
    owner: input.owner,
    idempotencyKey: input.idempotencyKey,
    ...(input.auditCorrelationId ? { auditCorrelationId: input.auditCorrelationId } : {}),
    parent: {
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
      ...(input.parentSubSessionId ? { parentSubSessionId: input.parentSubSessionId } : {}),
      ...(input.parentRequestId ? { parentRequestId: input.parentRequestId } : {}),
    },
  }
}

function nextHistoryVersion(
  targetEntityType: HistoryVersion["targetEntityType"],
  targetEntityId: string,
): number {
  const versions = listProfileHistoryVersions(targetEntityType, targetEntityId)
  return versions.reduce((max, row) => Math.max(max, row.version), 0) + 1
}

function learningRisk(input: LearningPolicyInput): LearningRiskLevel {
  if (input.risk) return input.risk
  if (containsPermissionOrCapabilityExpansion(input)) return "high"
  if (input.learningTarget === "memory") return "low"
  return "medium"
}

export function evaluateLearningPolicy(input: LearningPolicyInput): LearningPolicyDecision {
  const confidence = clampConfidence(input.confidence)
  const risk = learningRisk(input)
  const issues: string[] = []
  const crossAgent = !sameOwner(input.actorOwner, input.targetOwner)
  const permissionExpansion = containsPermissionOrCapabilityExpansion(input)
  const lockedConflict = lockedFieldConflict(input)

  if (crossAgent) {
    return {
      approvalState: "rejected",
      reasonCode: "rejected_cross_agent_write",
      autoApply: false,
      requiresReview: false,
      blocked: true,
      confidence,
      risk,
      issues: ["cross_agent_learning_write_blocked"],
    }
  }

  if (confidence < 0.6) {
    return {
      approvalState: "rejected",
      reasonCode: "rejected_low_confidence",
      autoApply: false,
      requiresReview: false,
      blocked: true,
      confidence,
      risk,
      issues: ["confidence_below_0_60"],
    }
  }

  if (permissionExpansion) {
    return {
      approvalState: "pending_review",
      reasonCode: "pending_permission_or_capability_expansion",
      autoApply: false,
      requiresReview: true,
      blocked: false,
      confidence,
      risk: "high",
      issues: ["permission_or_capability_expansion_requires_review"],
    }
  }

  if (lockedConflict) {
    return {
      approvalState: "pending_review",
      reasonCode: "pending_locked_setting_conflict",
      autoApply: false,
      requiresReview: true,
      blocked: false,
      confidence,
      risk,
      issues: ["locked_setting_conflict"],
    }
  }

  if (!hasEvidenceRefs(input.evidenceRefs)) {
    return {
      approvalState: "pending_review",
      reasonCode: "pending_missing_evidence",
      autoApply: false,
      requiresReview: true,
      blocked: false,
      confidence,
      risk,
      issues: ["evidence_refs_required_for_auto_apply"],
    }
  }

  if (confidence < 0.85) {
    return {
      approvalState: "pending_review",
      reasonCode: "pending_medium_confidence",
      autoApply: false,
      requiresReview: true,
      blocked: false,
      confidence,
      risk,
      issues: ["confidence_between_0_60_and_0_85"],
    }
  }

  if (input.learningTarget !== "memory" || risk !== "low") {
    return {
      approvalState: "pending_review",
      reasonCode: "pending_non_memory_target",
      autoApply: false,
      requiresReview: true,
      blocked: false,
      confidence,
      risk,
      issues: ["only_low_risk_self_memory_can_auto_apply"],
    }
  }

  return {
    approvalState: "auto_applied",
    reasonCode: "auto_apply_self_memory_high_confidence",
    autoApply: true,
    requiresReview: false,
    blocked: false,
    confidence,
    risk,
    issues,
  }
}

export function buildHistoryVersion(input: HistoryVersionInput): HistoryVersion {
  const createdAt = input.now?.() ?? Date.now()
  const historyVersionId = input.historyVersionId ?? `history:${randomUUID()}`
  return {
    identity: buildIdentity({
      entityType: "data_exchange",
      entityId: historyVersionId,
      owner: input.owner,
      idempotencyKey: input.idempotencyKey ?? `history:${historyVersionId}`,
      ...(input.auditCorrelationId ? { auditCorrelationId: input.auditCorrelationId } : {}),
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
      ...(input.parentSubSessionId ? { parentSubSessionId: input.parentSubSessionId } : {}),
      ...(input.parentRequestId ? { parentRequestId: input.parentRequestId } : {}),
    }),
    historyVersionId,
    targetEntityType: input.targetEntityType,
    targetEntityId: input.targetEntityId,
    version: nextHistoryVersion(input.targetEntityType, input.targetEntityId),
    before: sanitizeJsonObject(input.before),
    after: sanitizeJsonObject(input.after),
    reasonCode: input.reasonCode,
    createdAt,
  }
}

export function recordHistoryVersion(
  input: HistoryVersion,
  options: { auditId?: string | null } = {},
): boolean {
  return insertProfileHistoryVersion(input, options)
}

function emitLearningRecorded(input: {
  event: LearningEvent
  policy: LearningPolicyDecision
  history?: HistoryVersion
  inserted: boolean
  createdAt: number
}): void {
  if (!input.inserted) return
  recordOrchestrationEvent({
    eventKind: "learning_recorded",
    runId: input.event.sourceRunId ?? input.event.identity.parent?.parentRunId ?? null,
    requestGroupId: input.event.identity.parent?.parentRequestId ?? null,
    subSessionId:
      input.event.sourceSubSessionId ?? input.event.identity.parent?.parentSubSessionId ?? null,
    agentId: input.event.agentId,
    correlationId: input.event.identity.auditCorrelationId ?? input.event.learningEventId,
    dedupeKey: `learning_recorded:${input.event.learningEventId}:${input.event.approvalState}`,
    source: "learning-event-service",
    severity: input.policy.blocked ? "warning" : "info",
    summary: `Learning recorded for ${input.event.agentId}: ${input.event.learningTarget}`,
    payload: {
      learningEventId: input.event.learningEventId,
      agentId: input.event.agentId,
      agentType: input.event.agentType,
      learningTarget: input.event.learningTarget,
      evidenceRefs: input.event.evidenceRefs,
      confidence: input.event.confidence,
      approvalState: input.event.approvalState,
      policyReasonCode: input.event.policyReasonCode,
      autoApply: input.policy.autoApply,
      requiresReview: input.policy.requiresReview,
      blocked: input.policy.blocked,
      ...(input.history
        ? {
            historyVersionId: input.history.historyVersionId,
            historyVersion: input.history.version,
            targetEntityType: input.history.targetEntityType,
            targetEntityId: input.history.targetEntityId,
          }
        : {}),
    },
    producerTask: "task028",
    createdAt: input.createdAt,
    emittedAt: input.createdAt,
  })
}

function emitHistoryRestored(input: {
  event: RestoreEvent
  inserted: boolean
  applied: boolean
  ok: boolean
  conflictCodes: string[]
  createdAt: number
}): void {
  if (!input.inserted) return
  recordOrchestrationEvent({
    eventKind: "history_restored",
    runId: input.event.identity.parent?.parentRunId ?? null,
    requestGroupId: input.event.identity.parent?.parentRequestId ?? null,
    subSessionId: input.event.identity.parent?.parentSubSessionId ?? null,
    agentId:
      input.event.targetEntityType === "agent" || input.event.targetEntityType === "memory"
        ? input.event.targetEntityId
        : null,
    teamId: input.event.targetEntityType === "team" ? input.event.targetEntityId : null,
    correlationId: input.event.identity.auditCorrelationId ?? input.event.restoreEventId,
    dedupeKey: `history_restored:${input.event.restoreEventId}`,
    source: "learning-event-service",
    severity: input.ok ? "info" : "warning",
    summary: `History restore ${input.event.dryRun ? "dry-run" : "event"} for ${input.event.targetEntityType}:${input.event.targetEntityId}`,
    payload: {
      restoreEventId: input.event.restoreEventId,
      targetEntityType: input.event.targetEntityType,
      targetEntityId: input.event.targetEntityId,
      restoredHistoryVersionId: input.event.restoredHistoryVersionId,
      dryRun: input.event.dryRun,
      applied: input.applied,
      ok: input.ok,
      effectSummary: input.event.effectSummary,
      conflictCodes: input.conflictCodes,
    },
    producerTask: "task028",
    createdAt: input.createdAt,
    emittedAt: input.createdAt,
  })
}

export async function recordLearningEvent(
  input: LearningEventServiceInput,
): Promise<LearningEventServiceResult> {
  const policy = evaluateLearningPolicy(input)
  const createdAt = input.now?.() ?? Date.now()
  const learningEventId = input.learningEventId ?? `learning:${randomUUID()}`
  const event: LearningEvent = {
    identity: buildIdentity({
      entityType: "data_exchange",
      entityId: learningEventId,
      owner: input.targetOwner,
      idempotencyKey: input.idempotencyKey ?? `learning:${learningEventId}`,
      ...(input.auditCorrelationId ? { auditCorrelationId: input.auditCorrelationId } : {}),
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
      ...(input.parentSubSessionId ? { parentSubSessionId: input.parentSubSessionId } : {}),
      ...(input.parentRequestId ? { parentRequestId: input.parentRequestId } : {}),
    }),
    learningEventId,
    agentId: input.agentId,
    agentType: input.agentType,
    ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
    ...(input.sourceSessionId ? { sourceSessionId: input.sourceSessionId } : {}),
    ...(input.sourceSubSessionId ? { sourceSubSessionId: input.sourceSubSessionId } : {}),
    learningTarget: input.learningTarget,
    before: sanitizeJsonObject(input.before),
    after: sanitizeJsonObject(input.after),
    beforeSummary: sanitizeSummary(input.beforeSummary),
    afterSummary: sanitizeSummary(input.afterSummary),
    evidenceRefs: input.evidenceRefs.filter((ref) => ref.trim().length > 0),
    confidence: policy.confidence,
    approvalState: policy.approvalState,
    policyReasonCode: policy.reasonCode,
  }

  const inserted = insertLearningEvent(event, {
    ...(input.auditCorrelationId ? { auditId: input.auditCorrelationId } : {}),
    now: createdAt,
  })

  let history: HistoryVersion | undefined
  let memoryDocumentId: string | undefined
  if (inserted && policy.autoApply) {
    history = buildHistoryVersion({
      targetEntityType: "memory",
      targetEntityId: input.targetOwner.ownerId,
      before: input.before,
      after: input.after,
      reasonCode: policy.reasonCode,
      owner: input.targetOwner,
      historyVersionId: `history:${learningEventId}`,
      idempotencyKey: `history:${learningEventId}`,
      ...(input.auditCorrelationId ? { auditCorrelationId: input.auditCorrelationId } : {}),
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
      ...(input.parentSubSessionId ? { parentSubSessionId: input.parentSubSessionId } : {}),
      ...(input.parentRequestId ? { parentRequestId: input.parentRequestId } : {}),
      now: () => createdAt,
    })
    recordHistoryVersion(history, {
      ...(input.auditCorrelationId ? { auditId: input.auditCorrelationId } : {}),
    })
    const stored = await storeOwnerScopedMemory({
      owner: input.targetOwner,
      visibility: "private",
      retentionPolicy: "long_term",
      rawText: event.afterSummary,
      sourceType: "learning_event",
      sourceRef: event.learningEventId,
      title: `learning:${event.learningTarget}`,
      historyVersion: history.version,
      metadata: {
        learningEventId,
        confidence: policy.confidence,
        approvalState: policy.approvalState,
        reasonCode: policy.reasonCode,
        evidenceRefs: event.evidenceRefs,
      },
    })
    memoryDocumentId = stored.documentId
  }

  emitLearningRecorded({
    event,
    policy,
    inserted,
    createdAt,
    ...(history ? { history } : {}),
  })

  return {
    event,
    policy,
    inserted,
    ...(history ? { history } : {}),
    ...(memoryDocumentId ? { memoryDocumentId } : {}),
  }
}

export function dbLearningEventToContract(row: DbLearningEvent): LearningEvent {
  const parsed = parseJsonObject(row.contract_json)
  const parsedAfter = parsed["after"]
  const hasAfter = parsedAfter && typeof parsedAfter === "object" && !Array.isArray(parsedAfter)
  const parsedBefore = parsed["before"]
  return {
    identity: parsed["identity"] as unknown as RuntimeIdentity,
    learningEventId: row.learning_event_id,
    agentId: row.agent_id,
    ...(typeof parsed["agentType"] === "string"
      ? { agentType: parsed["agentType"] as AgentEntityType }
      : {}),
    ...(typeof parsed["sourceRunId"] === "string" ? { sourceRunId: parsed["sourceRunId"] } : {}),
    ...(typeof parsed["sourceSessionId"] === "string"
      ? { sourceSessionId: parsed["sourceSessionId"] }
      : {}),
    ...(typeof parsed["sourceSubSessionId"] === "string"
      ? { sourceSubSessionId: parsed["sourceSubSessionId"] }
      : {}),
    learningTarget: row.learning_target,
    ...(hasAfter
      ? {
          before:
            parsedBefore && typeof parsedBefore === "object" && !Array.isArray(parsedBefore)
              ? (parsedBefore as JsonObject)
              : {},
          after: parsedAfter as JsonObject,
        }
      : {}),
    beforeSummary: row.before_summary,
    afterSummary: row.after_summary,
    evidenceRefs: parseStringArray(row.evidence_refs_json),
    confidence: row.confidence,
    approvalState: row.approval_state,
    ...(typeof parsed["policyReasonCode"] === "string"
      ? { policyReasonCode: parsed["policyReasonCode"] }
      : {}),
  }
}

function targetEntityTypeForLearningTarget(
  target: LearningEvent["learningTarget"],
): HistoryVersion["targetEntityType"] {
  if (target === "team_profile") return "team"
  if (target === "memory") return "memory"
  return "agent"
}

export async function approveLearningEvent(
  input: ApproveLearningEventInput,
): Promise<ApproveLearningEventResult> {
  const event = listAgentLearningEvents(input.agentId).find(
    (item) => item.learningEventId === input.learningEventId,
  )
  if (!event) {
    return { ok: false, reasonCode: "learning_event_not_found", historyInserted: false }
  }
  if (event.approvalState !== "pending_review") {
    return { ok: false, reasonCode: "learning_event_not_pending", event, historyInserted: false }
  }
  if (!event.before || !event.after) {
    return { ok: false, reasonCode: "learning_event_missing_diff", event, historyInserted: false }
  }

  const createdAt = input.now?.() ?? Date.now()
  const targetEntityType = targetEntityTypeForLearningTarget(event.learningTarget)
  const targetEntityId = event.identity.owner.ownerId
  const history = buildHistoryVersion({
    targetEntityType,
    targetEntityId,
    before: event.before,
    after: event.after,
    reasonCode: event.policyReasonCode ?? "approved_learning_event",
    owner: input.owner,
    historyVersionId: `history:${event.learningEventId}:approved`,
    idempotencyKey: `history:${event.learningEventId}:approved`,
    ...(input.auditCorrelationId ? { auditCorrelationId: input.auditCorrelationId } : {}),
    now: () => createdAt,
  })
  const historyInserted = recordHistoryVersion(history, {
    ...(input.auditCorrelationId ? { auditId: input.auditCorrelationId } : {}),
  })
  updateLearningEventApprovalState(event.learningEventId, "applied_by_user", {
    ...(input.auditCorrelationId ? { auditId: input.auditCorrelationId } : {}),
    now: createdAt,
  })

  let memoryDocumentId: string | undefined
  if (historyInserted && event.learningTarget === "memory") {
    const stored = await storeOwnerScopedMemory({
      owner: event.identity.owner,
      visibility: "private",
      retentionPolicy: "long_term",
      rawText: event.afterSummary,
      sourceType: "learning_event_review",
      sourceRef: event.learningEventId,
      title: `learning:${event.learningTarget}:approved`,
      historyVersion: history.version,
      metadata: {
        learningEventId: event.learningEventId,
        confidence: event.confidence,
        approvalState: "applied_by_user",
        evidenceRefs: event.evidenceRefs,
      },
    })
    memoryDocumentId = stored.documentId
  }

  return {
    ok: true,
    reasonCode: "approved",
    event: { ...event, approvalState: "applied_by_user" },
    history,
    historyInserted,
    ...(memoryDocumentId ? { memoryDocumentId } : {}),
  }
}

export function dbHistoryVersionToContract(row: DbProfileHistoryVersion): HistoryVersion {
  return {
    identity: {
      schemaVersion: row.schema_version as RuntimeIdentity["schemaVersion"],
      entityType: "data_exchange",
      entityId: row.history_version_id,
      owner: { ownerType: "system", ownerId: row.target_entity_id },
      idempotencyKey: row.idempotency_key,
      ...(row.audit_id ? { auditCorrelationId: row.audit_id } : {}),
    },
    historyVersionId: row.history_version_id,
    targetEntityType: row.target_entity_type,
    targetEntityId: row.target_entity_id,
    version: row.version,
    before: parseJsonObject(row.before_json),
    after: parseJsonObject(row.after_json),
    reasonCode: row.reason_code,
    createdAt: row.created_at,
  }
}

export function dbRestoreEventToContract(row: DbProfileRestoreEvent): RestoreEvent {
  return {
    identity: {
      schemaVersion: row.schema_version as RuntimeIdentity["schemaVersion"],
      entityType: "data_exchange",
      entityId: row.restore_event_id,
      owner: { ownerType: "system", ownerId: row.target_entity_id },
      idempotencyKey: row.idempotency_key,
      ...(row.audit_id ? { auditCorrelationId: row.audit_id } : {}),
    },
    restoreEventId: row.restore_event_id,
    targetEntityType: row.target_entity_type,
    targetEntityId: row.target_entity_id,
    restoredHistoryVersionId: row.restored_history_version_id,
    dryRun: row.dry_run === 1,
    effectSummary: parseStringArray(row.effect_summary_json),
    createdAt: row.created_at,
  }
}

function currentPayloadFor(
  targetEntityType: RestoreEvent["targetEntityType"],
  targetEntityId: string,
): JsonObject | undefined {
  if (targetEntityType === "agent") {
    const row = getAgentConfig(targetEntityId)
    return row ? parseJsonObject(row.config_json) : undefined
  }
  if (targetEntityType === "team") {
    const row = getTeamConfig(targetEntityId)
    return row ? parseJsonObject(row.config_json) : undefined
  }
  return undefined
}

function findHistoryVersion(
  targetEntityType: RestoreEvent["targetEntityType"],
  targetEntityId: string,
  historyVersionId: string,
): HistoryVersion | undefined {
  return listProfileHistoryVersions(targetEntityType, targetEntityId)
    .map(dbHistoryVersionToContract)
    .find((history) => history.historyVersionId === historyVersionId)
}

function changedKeys(before: JsonObject, after: JsonObject): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys]
    .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort()
}

export function dryRunRestoreHistoryVersion(input: {
  targetEntityType: RestoreEvent["targetEntityType"]
  targetEntityId: string
  restoredHistoryVersionId: string
}): RestoreDryRunResult {
  const history = findHistoryVersion(
    input.targetEntityType,
    input.targetEntityId,
    input.restoredHistoryVersionId,
  )
  if (!history) {
    return {
      ok: false,
      targetEntityType: input.targetEntityType,
      targetEntityId: input.targetEntityId,
      restoredHistoryVersionId: input.restoredHistoryVersionId,
      restorePayload: {},
      effectSummary: ["history version not found"],
      conflictCodes: ["history_version_not_found"],
    }
  }

  const currentPayload = currentPayloadFor(input.targetEntityType, input.targetEntityId)
  const restorePayload = history.before
  const keys = changedKeys(currentPayload ?? history.after, restorePayload)
  const conflictCodes: string[] = []
  if (currentPayload && JSON.stringify(currentPayload) !== JSON.stringify(history.after)) {
    conflictCodes.push("current_state_differs_from_history_after")
  }

  return {
    ok: true,
    targetEntityType: input.targetEntityType,
    targetEntityId: input.targetEntityId,
    restoredHistoryVersionId: input.restoredHistoryVersionId,
    restorePayload,
    ...(currentPayload ? { currentPayload } : {}),
    effectSummary:
      keys.length > 0
        ? keys.map(
            (key) => `restore ${input.targetEntityType}:${input.targetEntityId} field ${key}`,
          )
        : [`restore ${input.targetEntityType}:${input.targetEntityId} has no visible field diff`],
    conflictCodes,
  }
}

function applyRestorePayload(
  input: RestoreHistoryVersionInput,
  payload: JsonObject,
  now: number,
): boolean {
  if (!input.apply || input.dryRun) return false
  if (input.targetEntityType === "agent") {
    const config = payload as unknown as AgentConfig
    if (
      !config ||
      typeof config !== "object" ||
      !("agentId" in config) ||
      config.agentId !== input.targetEntityId
    )
      return false
    upsertAgentConfig({ ...config, updatedAt: now } as AgentConfig, {
      source: "system",
      auditId: input.auditCorrelationId ?? null,
      idempotencyKey: `restore:${input.restoredHistoryVersionId}:${now}`,
      now,
    })
    return true
  }
  if (input.targetEntityType === "team") {
    const config = payload as unknown as TeamConfig
    if (
      !config ||
      typeof config !== "object" ||
      !("teamId" in config) ||
      config.teamId !== input.targetEntityId
    )
      return false
    upsertTeamConfig({ ...config, updatedAt: now } as TeamConfig, {
      source: "system",
      auditId: input.auditCorrelationId ?? null,
      idempotencyKey: `restore:${input.restoredHistoryVersionId}:${now}`,
      now,
    })
    return true
  }
  return false
}

export function restoreHistoryVersion(
  input: RestoreHistoryVersionInput,
): RestoreHistoryVersionResult {
  const createdAt = input.now?.() ?? Date.now()
  const dryRun = dryRunRestoreHistoryVersion(input)
  const restoreEventId = input.restoreEventId ?? `restore:${randomUUID()}`
  const event: RestoreEvent = {
    identity: buildIdentity({
      entityType: "data_exchange",
      entityId: restoreEventId,
      owner: input.owner,
      idempotencyKey: input.idempotencyKey ?? `restore:${restoreEventId}`,
      ...(input.auditCorrelationId ? { auditCorrelationId: input.auditCorrelationId } : {}),
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
      ...(input.parentSubSessionId ? { parentSubSessionId: input.parentSubSessionId } : {}),
      ...(input.parentRequestId ? { parentRequestId: input.parentRequestId } : {}),
    }),
    restoreEventId,
    targetEntityType: input.targetEntityType,
    targetEntityId: input.targetEntityId,
    restoredHistoryVersionId: input.restoredHistoryVersionId,
    dryRun: input.dryRun,
    effectSummary: dryRun.effectSummary,
    createdAt,
  }
  const inserted = insertProfileRestoreEvent(event, {
    ...(input.auditCorrelationId ? { auditId: input.auditCorrelationId } : {}),
  })
  const applied = dryRun.ok ? applyRestorePayload(input, dryRun.restorePayload, createdAt) : false
  emitHistoryRestored({
    event,
    inserted,
    applied,
    ok: dryRun.ok,
    conflictCodes: dryRun.conflictCodes,
    createdAt,
  })
  return {
    ...dryRun,
    event,
    inserted,
    applied,
  }
}

export function listAgentLearningEvents(agentId: string): LearningEvent[] {
  return listLearningEvents(agentId).map(dbLearningEventToContract)
}

export function listLearningReviewQueue(query: LearningReviewQueueQuery = {}): LearningEvent[] {
  return listLearningEventsByApprovalState("pending_review", query).map(dbLearningEventToContract)
}

export function listHistoryVersions(
  targetEntityType: HistoryVersion["targetEntityType"],
  targetEntityId: string,
): HistoryVersion[] {
  return listProfileHistoryVersions(targetEntityType, targetEntityId).map(
    dbHistoryVersionToContract,
  )
}

export function listRestoreEvents(
  targetEntityType: RestoreEvent["targetEntityType"],
  targetEntityId: string,
): RestoreEvent[] {
  return listProfileRestoreEvents(targetEntityType, targetEntityId).map(dbRestoreEventToContract)
}
