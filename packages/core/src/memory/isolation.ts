import { createHash, randomUUID } from "node:crypto"
import { CONTRACT_SCHEMA_VERSION, type JsonObject, type JsonValue } from "../contracts/index.js"
import type {
  DataExchangePackage,
  DataExchangeRetentionPolicy,
  MemoryPolicy,
  OwnerScope,
  RuntimeIdentity,
} from "../contracts/sub-agent-orchestration.js"
import { normalizeNicknameSnapshot } from "../contracts/sub-agent-orchestration.js"
import { recordControlEvent } from "../control-plane/timeline.js"
import {
  type DbAgentDataExchange,
  type MemoryScope,
  getAgentDataExchange,
  insertAgentDataExchange,
  listAgentDataExchangesForRecipient,
  listAgentDataExchangesForSource,
  recordMemoryAccessLog,
} from "../db/index.js"
import type { PromptBundleContextMemoryRef } from "../runs/context-preflight.js"
import {
  type DetailedMemorySearchResult,
  type StoreMemoryDocumentParams,
  searchMemoryDetailed,
  storeMemoryDocument,
} from "./store.js"
import {
  type MemoryWritebackCandidate,
  type PreparedMemoryWritebackCandidate,
  prepareMemoryWritebackQueueInput,
} from "./writeback.js"

export type MemoryVisibility = MemoryPolicy["visibility"]
export type MemoryAccessMode = "owner_direct" | "recipient_via_exchange"
export type MemoryOwnerScopeKind = "nobie" | "agent" | "run" | "system" | "team_projection"
export type ParentMemoryWritebackPolicy = "allow" | "review" | "deny"

export interface RunMemoryOwnerScope {
  ownerType: "run"
  ownerId: string
}

export type MemoryOwnerScope = OwnerScope | RunMemoryOwnerScope

export interface MemoryOwnerScopePolicy {
  owner: MemoryOwnerScope
  ownerScopeKey: string
  storageOwnerId: string
  kind: MemoryOwnerScopeKind
  directReadAllowed: boolean
  writeAllowed: boolean
  reasonCode?: "team_projection_read_only" | "memory_owner_scope_missing"
}

export type DataExchangeValidationIssueCode =
  | "source_owner_missing"
  | "recipient_owner_missing"
  | "source_nickname_missing"
  | "recipient_nickname_missing"
  | "purpose_missing"
  | "allowed_use_missing"
  | "retention_policy_missing"
  | "redaction_state_missing"
  | "provenance_refs_missing"
  | "provenance_refs_unrecognized"
  | "payload_missing"
  | "data_exchange_expired"
  | "data_exchange_blocked"
  | "data_exchange_wrong_recipient"
  | "data_exchange_wrong_source"
  | "data_exchange_use_not_allowed"

export interface DataExchangeValidationIssue {
  code: DataExchangeValidationIssueCode
  path: string
  message: string
}

export interface DataExchangeValidationResult {
  ok: boolean
  issues: DataExchangeValidationIssue[]
}

export type DataExchangeRedactionCategory =
  | "secret_token_key_password_env"
  | "raw_html_script_style"
  | "stack_trace_log_dump"
  | "contact_identity_payment_pii"
  | "private_memory_excerpt"
  | "external_artifact_preview"

export type DataExchangeProvenanceKind =
  | "source_result"
  | "memory"
  | "artifact"
  | "tool_call"
  | "data_exchange"
  | "run"
  | "opaque"
  | "unknown"

export interface DataExchangeRedactionInspection {
  redacted: boolean
  categories: DataExchangeRedactionCategory[]
}

export interface DataExchangeSanitizedView {
  exchangeId: string
  sourceOwner: OwnerScope
  recipientOwner: OwnerScope
  sourceNicknameSnapshot: string
  recipientNicknameSnapshot: string
  purpose: string
  allowedUse: DataExchangePackage["allowedUse"]
  retentionPolicy: DataExchangeRetentionPolicy
  redactionState: DataExchangePackage["redactionState"]
  provenanceRefs: string[]
  provenanceKinds: DataExchangeProvenanceKind[]
  payloadSummary: string
  redactionCategories: DataExchangeRedactionCategory[]
  expiresAt?: number | null
  createdAt: number
  isExpired: boolean
}

export interface DataExchangeAdminRawView {
  ok: boolean
  reasonCode?: "admin_raw_access_denied" | "admin_raw_access_reason_required"
  exchange?: DataExchangePackage
  redactionCategories: DataExchangeRedactionCategory[]
  auditEventId?: string | null
}

export interface StoreOwnerScopedMemoryParams
  extends Omit<StoreMemoryDocumentParams, "scope" | "ownerId" | "metadata"> {
  owner: OwnerScope
  visibility: MemoryVisibility
  retentionPolicy: MemoryPolicy["retentionPolicy"]
  historyVersion?: number
  scope?: MemoryScope
  metadata?: Record<string, unknown>
}

export interface CreateDataExchangePackageInput {
  sourceOwner: OwnerScope
  recipientOwner: OwnerScope
  sourceNicknameSnapshot?: string
  recipientNicknameSnapshot?: string
  purpose: string
  allowedUse: DataExchangePackage["allowedUse"]
  retentionPolicy: DataExchangeRetentionPolicy
  redactionState: DataExchangePackage["redactionState"]
  provenanceRefs: string[]
  payload: JsonObject
  parentRunId?: string
  parentSessionId?: string
  parentSubSessionId?: string
  parentRequestId?: string
  auditCorrelationId?: string
  exchangeId?: string
  idempotencyKey?: string
  expiresAt?: number | null
  now?: () => number
}

export interface OwnerScopedMemorySearchResult {
  accessMode: MemoryAccessMode
  memoryResults: DetailedMemorySearchResult[]
  exchangeRefs: PromptBundleContextMemoryRef[]
}

export interface OwnerScopedMemorySearchParams {
  requester: OwnerScope
  owner: OwnerScope
  query: string
  limit?: number
  exchanges?: DataExchangePackage[]
  now?: number
  filters?: {
    sessionId?: string
    runId?: string
    requestGroupId?: string
    scheduleId?: string
    includeSchedule?: boolean
    includeArtifact?: boolean
    includeDiagnostic?: boolean
    includeFlashFeedback?: boolean
  }
}

export interface PreparePolicyControlledMemoryWritebackInput {
  candidate: MemoryWritebackCandidate
  memoryPolicy: MemoryPolicy
  actorOwner?: OwnerScope
  targetOwner?: OwnerScope
  parentOwner?: OwnerScope
  parentMemoryWritebackPolicy?: ParentMemoryWritebackPolicy
}

export class MemoryIsolationError extends Error {
  readonly reasonCode: string

  constructor(reasonCode: string, message: string) {
    super(message)
    this.name = "MemoryIsolationError"
    this.reasonCode = reasonCode
  }
}

const DEFAULT_EXCHANGE_TTL_MS: Record<
  Exclude<DataExchangeRetentionPolicy, "long_term_candidate">,
  number
> = {
  session_only: 24 * 60 * 60 * 1_000,
  short_term: 7 * 24 * 60 * 60 * 1_000,
  discard_after_review: 24 * 60 * 60 * 1_000,
}
const DATA_EXCHANGE_ALLOWED_USES = new Set<DataExchangePackage["allowedUse"]>([
  "temporary_context",
  "memory_candidate",
  "verification_only",
])
const DATA_EXCHANGE_RETENTION_POLICIES = new Set<DataExchangeRetentionPolicy>([
  "session_only",
  "short_term",
  "long_term_candidate",
  "discard_after_review",
])
const DATA_EXCHANGE_REDACTION_STATES = new Set<DataExchangePackage["redactionState"]>([
  "redacted",
  "not_sensitive",
  "blocked",
])

function isSameOwner(a: OwnerScope, b: OwnerScope): boolean {
  return a.ownerType === b.ownerType && a.ownerId === b.ownerId
}

function ownerMissing(owner: OwnerScope | undefined): boolean {
  return !owner?.ownerType || !owner.ownerId?.trim()
}

export function memoryOwnerScopeKey(owner: MemoryOwnerScope): string {
  return `${owner.ownerType}:${owner.ownerId.trim()}`
}

export function resolveMemoryOwnerScopePolicy(owner: MemoryOwnerScope): MemoryOwnerScopePolicy {
  const ownerId = owner.ownerId.trim()
  if (!ownerId) {
    return {
      owner,
      ownerScopeKey: memoryOwnerScopeKey(owner),
      storageOwnerId: "",
      kind: "system",
      directReadAllowed: false,
      writeAllowed: false,
      reasonCode: "memory_owner_scope_missing",
    }
  }
  if (owner.ownerType === "team") {
    return {
      owner,
      ownerScopeKey: memoryOwnerScopeKey(owner),
      storageOwnerId: ownerId,
      kind: "team_projection",
      directReadAllowed: false,
      writeAllowed: false,
      reasonCode: "team_projection_read_only",
    }
  }
  if (owner.ownerType === "nobie") {
    return {
      owner,
      ownerScopeKey: memoryOwnerScopeKey(owner),
      storageOwnerId: ownerId,
      kind: "nobie",
      directReadAllowed: true,
      writeAllowed: true,
    }
  }
  if (owner.ownerType === "sub_agent") {
    return {
      owner,
      ownerScopeKey: memoryOwnerScopeKey(owner),
      storageOwnerId: ownerId,
      kind: "agent",
      directReadAllowed: true,
      writeAllowed: true,
    }
  }
  if (owner.ownerType === "run") {
    return {
      owner,
      ownerScopeKey: memoryOwnerScopeKey(owner),
      storageOwnerId: ownerId,
      kind: "run",
      directReadAllowed: true,
      writeAllowed: true,
    }
  }
  return {
    owner,
    ownerScopeKey: memoryOwnerScopeKey(owner),
    storageOwnerId: ownerId,
    kind: "system",
    directReadAllowed: true,
    writeAllowed: true,
  }
}

function assertWritableMemoryOwner(owner: OwnerScope): MemoryOwnerScopePolicy {
  const policy = resolveMemoryOwnerScopePolicy(owner)
  if (!policy.writeAllowed) {
    throw new MemoryIsolationError(
      policy.reasonCode ?? "memory_owner_scope_not_writable",
      "Memory owner scope is not writable.",
    )
  }
  return policy
}

function retentionToScope(retentionPolicy: MemoryPolicy["retentionPolicy"]): MemoryScope {
  if (retentionPolicy === "long_term") return "long-term"
  if (retentionPolicy === "short_term") return "short-term"
  return "session"
}

function hashOpaqueRef(parts: string[]): string {
  return `opaque:${createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 24)}`
}

function resolveExchangeExpiresAt(input: {
  retentionPolicy: DataExchangeRetentionPolicy
  createdAt: number
  expiresAt?: number | null
}): number | null {
  if (Object.prototype.hasOwnProperty.call(input, "expiresAt")) return input.expiresAt ?? null
  if (input.retentionPolicy === "long_term_candidate") return null
  return input.createdAt + DEFAULT_EXCHANGE_TTL_MS[input.retentionPolicy]
}

function validateJsonObject(value: JsonObject | undefined): boolean {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function addCategory(
  categories: Set<DataExchangeRedactionCategory>,
  category: DataExchangeRedactionCategory,
): void {
  categories.add(category)
}

function redactWithCategory(
  value: string,
  pattern: RegExp,
  replacement: string | ((match: string) => string),
  category: DataExchangeRedactionCategory,
  categories: Set<DataExchangeRedactionCategory>,
): string {
  return value.replace(pattern, (match) => {
    addCategory(categories, category)
    return typeof replacement === "function" ? replacement(match) : replacement
  })
}

function looksLikePaymentNumber(value: string): boolean {
  const digits = value.replace(/\D/gu, "")
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  let doubleDigit = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index])
    if (!Number.isFinite(digit)) return false
    if (doubleDigit) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    doubleDigit = !doubleDigit
  }
  return sum % 10 === 0
}

function redactPaymentCandidates(
  value: string,
  categories: Set<DataExchangeRedactionCategory>,
): string {
  return value.replace(/\b(?:\d[ -]?){13,19}\b/gu, (match) => {
    if (!looksLikePaymentNumber(match)) return match
    addCategory(categories, "contact_identity_payment_pii")
    return "[redacted-payment]"
  })
}

function redactSensitiveString(value: string): {
  value: string
  redacted: boolean
  categories: DataExchangeRedactionCategory[]
} {
  let redacted = false
  const categories = new Set<DataExchangeRedactionCategory>()
  let next = value

  if (
    /\[redacted-(?:api-key|jwt)\]|\b(?:Bearer|OPENAI_API_KEY|token|secret|password)(?:[:=]\s*)?\[redacted\]/iu.test(
      next,
    )
  ) {
    addCategory(categories, "secret_token_key_password_env")
  }
  if (/\[redacted-raw-html\]/iu.test(next)) addCategory(categories, "raw_html_script_style")
  if (/\[redacted-(?:stack-trace|log-dump)\]/iu.test(next)) {
    addCategory(categories, "stack_trace_log_dump")
  }
  if (/\[redacted-(?:email|phone|payment|identity)\]/iu.test(next)) {
    addCategory(categories, "contact_identity_payment_pii")
  }
  if (/\[redacted-private-memory\]/iu.test(next)) {
    addCategory(categories, "private_memory_excerpt")
  }
  if (/\[redacted-(?:artifact-preview|artifact-uri)\]/iu.test(next)) {
    addCategory(categories, "external_artifact_preview")
  }

  if (/(<!doctype\s+html|<html\b|<head\b|<body\b|<script\b|<style\b|<iframe\b)/iu.test(next)) {
    redacted = true
    addCategory(categories, "raw_html_script_style")
    next = "[redacted-raw-html]"
  }

  if (
    /(?:^|\n)\s*at\s+[^\n]+\([^\n]+:\d+:\d+\)|(?:^|\n)Traceback \(most recent call last\):/u.test(
      next,
    )
  ) {
    redacted = true
    addCategory(categories, "stack_trace_log_dump")
    next = "[redacted-stack-trace]"
  }

  const logLineMatches =
    next.match(/(?:^|\n).*\b(?:ERROR|WARN|INFO|DEBUG|TRACE)\b.*(?=\n|$)/gu) ?? []
  if (logLineMatches.length >= 4) {
    redacted = true
    addCategory(categories, "stack_trace_log_dump")
    next = "[redacted-log-dump]"
  }

  next = redactWithCategory(
    next,
    /\bsk-[A-Za-z0-9_-]{16,}\b/gu,
    "[redacted-api-key]",
    "secret_token_key_password_env",
    categories,
  )
  next = redactWithCategory(
    next,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/giu,
    "Bearer [redacted]",
    "secret_token_key_password_env",
    categories,
  )
  next = redactWithCategory(
    next,
    /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{10,}\b/gu,
    "[redacted-jwt]",
    "secret_token_key_password_env",
    categories,
  )
  next = redactWithCategory(
    next,
    /\b(?:api[_-]?key|token|secret|authorization|password|passwd|pwd|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/=:@%-]{8,}["']?/giu,
    (match) => {
      const key = match.split(/[:=]/u)[0]?.trim() || "secret"
      return `${key}: [redacted]`
    },
    "secret_token_key_password_env",
    categories,
  )
  next = redactWithCategory(
    next,
    /\b[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|DATABASE_URL|AUTHORIZATION)\s*=\s*["']?[^"'\s]{8,}["']?/gu,
    (match) => {
      const key = match.split("=")[0]?.trim() || "ENV_VALUE"
      return `${key}=[redacted]`
    },
    "secret_token_key_password_env",
    categories,
  )
  next = redactWithCategory(
    next,
    /\b[A-Z]:\\Users\\[^\\\s)]+\\[^\s)]+/gu,
    "C:\\Users\\<user>\\...",
    "external_artifact_preview",
    categories,
  )
  next = redactWithCategory(
    next,
    /\/Users\/[^/\s)]+\/[^\s)]+/gu,
    "/Users/<user>/...",
    "external_artifact_preview",
    categories,
  )
  next = redactWithCategory(
    next,
    /\b(?:file|s3|gs):\/\/[^\s)]+/giu,
    "[redacted-artifact-uri]",
    "external_artifact_preview",
    categories,
  )
  next = redactWithCategory(
    next,
    /\bdata:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{32,}/giu,
    "[redacted-artifact-preview]",
    "external_artifact_preview",
    categories,
  )
  next = redactWithCategory(
    next,
    /\b(?:external\s+)?artifact\s+preview\s*[:=]\s*[\s\S]{12,}/giu,
    "artifact preview: [redacted]",
    "external_artifact_preview",
    categories,
  )
  next = redactWithCategory(
    next,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu,
    "[redacted-email]",
    "contact_identity_payment_pii",
    categories,
  )
  next = redactWithCategory(
    next,
    /\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/gu,
    "[redacted-phone]",
    "contact_identity_payment_pii",
    categories,
  )
  next = redactWithCategory(
    next,
    /\b\d{3}-\d{2}-\d{4}\b/gu,
    "[redacted-identity]",
    "contact_identity_payment_pii",
    categories,
  )
  next = redactPaymentCandidates(next, categories)
  next = redactWithCategory(
    next,
    /\b(?:private\s+raw\s+memory|private\s+memory|memory\s+excerpt|owner-scoped\s+memory|coordinator-only\s+evidence)\b/giu,
    "[redacted-private-memory]",
    "private_memory_excerpt",
    categories,
  )

  redacted = redacted || categories.size > 0
  return { value: next, redacted, categories: [...categories].sort() }
}

function redactJsonValue(value: JsonValue | undefined): {
  value: JsonValue | undefined
  redacted: boolean
  categories: Set<DataExchangeRedactionCategory>
} {
  const categories = new Set<DataExchangeRedactionCategory>()
  if (typeof value === "string") {
    const redacted = redactSensitiveString(value)
    for (const category of redacted.categories) categories.add(category)
    return { value: redacted.value, redacted: redacted.redacted, categories }
  }
  if (Array.isArray(value)) {
    let changed = false
    const items = value.map((item) => {
      const redacted = redactJsonValue(item)
      changed = changed || redacted.redacted
      for (const category of redacted.categories) categories.add(category)
      return redacted.value ?? null
    })
    return { value: items, redacted: changed, categories }
  }
  if (value && typeof value === "object") {
    let changed = false
    const out: JsonObject = {}
    for (const [key, item] of Object.entries(value)) {
      const redacted = redactJsonValue(item)
      changed = changed || redacted.redacted
      for (const category of redacted.categories) categories.add(category)
      if (redacted.value !== undefined) out[key] = redacted.value
    }
    return { value: out, redacted: changed, categories }
  }
  return { value, redacted: false, categories }
}

function redactJsonObject(value: JsonObject): {
  payload: JsonObject
  redacted: boolean
  categories: DataExchangeRedactionCategory[]
} {
  const redacted = redactJsonValue(value)
  return {
    payload: validateJsonObject(redacted.value as JsonObject) ? (redacted.value as JsonObject) : {},
    redacted: redacted.redacted,
    categories: [...redacted.categories].sort(),
  }
}

export function inspectDataExchangePayloadRisk(
  payload: JsonObject,
): DataExchangeRedactionInspection {
  const redacted = redactJsonObject(payload)
  return {
    redacted: redacted.redacted,
    categories: redacted.categories,
  }
}

function jsonParseObject(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : {}
  } catch {
    return {}
  }
}

function jsonParseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : []
  } catch {
    return []
  }
}

function buildIdentity(
  input: CreateDataExchangePackageInput,
  exchangeId: string,
  createdAt: number,
): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType: "data_exchange",
    entityId: exchangeId,
    owner: input.sourceOwner,
    idempotencyKey: input.idempotencyKey ?? `data-exchange:${exchangeId}`,
    ...(input.auditCorrelationId ? { auditCorrelationId: input.auditCorrelationId } : {}),
    parent: {
      ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
      ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
      ...(input.parentSubSessionId ? { parentSubSessionId: input.parentSubSessionId } : {}),
      ...(input.parentRequestId ? { parentRequestId: input.parentRequestId } : {}),
    },
  }
}

function fallbackNicknameSnapshot(owner: OwnerScope): string {
  return normalizeNicknameSnapshot(owner.ownerId)
}

function classifyDataExchangeProvenanceRef(ref: string): DataExchangeProvenanceKind {
  const normalized = ref.trim().toLowerCase()
  if (normalized.startsWith("result:") || normalized.startsWith("source_result:"))
    return "source_result"
  if (normalized.startsWith("memory:")) return "memory"
  if (normalized.startsWith("artifact:")) return "artifact"
  if (normalized.startsWith("tool:") || normalized.startsWith("tool_call:")) return "tool_call"
  if (normalized.startsWith("exchange:")) return "data_exchange"
  if (
    normalized.startsWith("run:") ||
    normalized.startsWith("session:") ||
    normalized.startsWith("sub_session:")
  )
    return "run"
  if (normalized.startsWith("opaque:")) return "opaque"
  return "unknown"
}

function uniqueProvenanceKinds(refs: string[]): DataExchangeProvenanceKind[] {
  return [...new Set(refs.map(classifyDataExchangeProvenanceRef))].sort()
}

function isExpired(expiresAt: number | null | undefined, now: number): boolean {
  return expiresAt !== undefined && expiresAt !== null && expiresAt <= now
}

function summarizeDataExchangePayload(payload: JsonObject): {
  summary: string
  categories: DataExchangeRedactionCategory[]
} {
  const redacted = redactJsonObject(payload)
  const rawSummary =
    typeof redacted.payload.summary === "string"
      ? redacted.payload.summary
      : JSON.stringify(redacted.payload)
  const sanitizedSummary = redactSensitiveString(rawSummary)
  return {
    summary:
      sanitizedSummary.value.length > 1_200
        ? `${sanitizedSummary.value.slice(0, 1_190)}...`
        : sanitizedSummary.value,
    categories: [...new Set([...redacted.categories, ...sanitizedSummary.categories])].sort(),
  }
}

export function validateDataExchangePackage(
  input: DataExchangePackage,
  options: { now?: number } = {},
): DataExchangeValidationResult {
  const issues: DataExchangeValidationIssue[] = []
  const add = (code: DataExchangeValidationIssueCode, path: string, message: string): void => {
    issues.push({ code, path, message })
  }

  if (ownerMissing(input.sourceOwner))
    add("source_owner_missing", "sourceOwner", "Data exchange source owner is required.")
  if (ownerMissing(input.recipientOwner))
    add("recipient_owner_missing", "recipientOwner", "Data exchange recipient owner is required.")
  if (!input.sourceNicknameSnapshot?.trim()) {
    add(
      "source_nickname_missing",
      "sourceNicknameSnapshot",
      "Data exchange source nickname snapshot is required.",
    )
  }
  if (!input.recipientNicknameSnapshot?.trim()) {
    add(
      "recipient_nickname_missing",
      "recipientNicknameSnapshot",
      "Data exchange recipient nickname snapshot is required.",
    )
  }
  if (!input.purpose?.trim())
    add("purpose_missing", "purpose", "Data exchange purpose is required.")
  if (!input.allowedUse)
    add("allowed_use_missing", "allowedUse", "Data exchange allowed use is required.")
  else if (!DATA_EXCHANGE_ALLOWED_USES.has(input.allowedUse)) {
    add(
      "data_exchange_use_not_allowed",
      "allowedUse",
      "Data exchange allowed use is not supported.",
    )
  }
  if (!input.retentionPolicy) {
    add(
      "retention_policy_missing",
      "retentionPolicy",
      "Data exchange retention policy is required.",
    )
  } else if (!DATA_EXCHANGE_RETENTION_POLICIES.has(input.retentionPolicy)) {
    add(
      "retention_policy_missing",
      "retentionPolicy",
      "Data exchange retention policy is not supported.",
    )
  }
  if (!input.redactionState)
    add("redaction_state_missing", "redactionState", "Data exchange redaction state is required.")
  else if (!DATA_EXCHANGE_REDACTION_STATES.has(input.redactionState)) {
    add(
      "redaction_state_missing",
      "redactionState",
      "Data exchange redaction state is not supported.",
    )
  }
  if (!input.provenanceRefs?.length)
    add("provenance_refs_missing", "provenanceRefs", "Data exchange provenance refs are required.")
  if (
    input.provenanceRefs?.length &&
    !uniqueProvenanceKinds(input.provenanceRefs).some((kind) => kind !== "unknown")
  ) {
    add(
      "provenance_refs_unrecognized",
      "provenanceRefs",
      "Data exchange provenance refs must identify a result, memory, artifact, tool call, exchange, run, or opaque reference.",
    )
  }
  if (!validateJsonObject(input.payload))
    add("payload_missing", "payload", "Data exchange payload must be a JSON object.")
  if (isExpired(input.expiresAt, options.now ?? Date.now())) {
    add("data_exchange_expired", "expiresAt", "Data exchange package is expired.")
  }
  return { ok: issues.length === 0, issues }
}

function sanitizeDataExchangePackage(input: DataExchangePackage): DataExchangePackage {
  const redacted = redactJsonObject(input.payload)
  const redactionState =
    redacted.redacted && input.redactionState === "not_sensitive"
      ? "redacted"
      : input.redactionState
  return {
    ...input,
    redactionState,
    payload: redacted.payload,
  }
}

export function createDataExchangePackage(
  input: CreateDataExchangePackageInput,
): DataExchangePackage {
  const createdAt = input.now?.() ?? Date.now()
  const exchangeId = input.exchangeId ?? `exchange:${randomUUID()}`
  const redacted = redactJsonObject(input.payload)
  const redactionState =
    redacted.redacted && input.redactionState === "not_sensitive"
      ? "redacted"
      : input.redactionState
  const sourceNicknameSnapshot = input.sourceNicknameSnapshot
    ? normalizeNicknameSnapshot(input.sourceNicknameSnapshot)
    : fallbackNicknameSnapshot(input.sourceOwner)
  const recipientNicknameSnapshot = input.recipientNicknameSnapshot
    ? normalizeNicknameSnapshot(input.recipientNicknameSnapshot)
    : fallbackNicknameSnapshot(input.recipientOwner)
  return {
    identity: buildIdentity(input, exchangeId, createdAt),
    exchangeId,
    sourceOwner: input.sourceOwner,
    recipientOwner: input.recipientOwner,
    sourceNicknameSnapshot,
    recipientNicknameSnapshot,
    purpose: input.purpose.trim(),
    allowedUse: input.allowedUse,
    retentionPolicy: input.retentionPolicy,
    redactionState,
    provenanceRefs: input.provenanceRefs.filter((ref) => ref.trim().length > 0),
    payload: redacted.payload,
    expiresAt: resolveExchangeExpiresAt({
      retentionPolicy: input.retentionPolicy,
      createdAt,
      ...(Object.prototype.hasOwnProperty.call(input, "expiresAt")
        ? { expiresAt: input.expiresAt ?? null }
        : {}),
    }),
    createdAt,
  }
}

export function persistDataExchangePackage(
  input: DataExchangePackage,
  options: { now?: number; auditId?: string | null } = {},
): boolean {
  const storable = sanitizeDataExchangePackage(input)
  const validation = validateDataExchangePackage(storable, {
    ...(options.now !== undefined ? { now: options.now } : {}),
  })
  if (!validation.ok) {
    throw new MemoryIsolationError(
      validation.issues[0]?.code ?? "data_exchange_validation_failed",
      `data exchange validation failed: ${validation.issues.map((issue) => issue.code).join(", ")}`,
    )
  }
  return insertAgentDataExchange(storable, {
    ...(options.auditId !== undefined ? { auditId: options.auditId } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    expiresAt: storable.expiresAt ?? null,
  })
}

export function dbAgentDataExchangeToPackage(row: DbAgentDataExchange): DataExchangePackage {
  const sourceOwner: OwnerScope = { ownerType: row.source_owner_type, ownerId: row.source_owner_id }
  const recipientOwner: OwnerScope = {
    ownerType: row.recipient_owner_type,
    ownerId: row.recipient_owner_id,
  }
  return {
    identity: {
      schemaVersion: row.schema_version as RuntimeIdentity["schemaVersion"],
      entityType: "data_exchange",
      entityId: row.exchange_id,
      owner: sourceOwner,
      idempotencyKey: row.idempotency_key,
      ...(row.audit_id ? { auditCorrelationId: row.audit_id } : {}),
    },
    exchangeId: row.exchange_id,
    sourceOwner,
    recipientOwner,
    sourceNicknameSnapshot: row.source_nickname_snapshot ?? "",
    recipientNicknameSnapshot: row.recipient_nickname_snapshot ?? "",
    purpose: row.purpose,
    allowedUse: row.allowed_use,
    retentionPolicy: row.retention_policy,
    redactionState: row.redaction_state,
    provenanceRefs: jsonParseStringArray(row.provenance_refs_json),
    payload: jsonParseObject(row.payload_json),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }
}

export function buildDataExchangeSanitizedView(
  input: DataExchangePackage,
  options: { now?: number } = {},
): DataExchangeSanitizedView {
  const storable = sanitizeDataExchangePackage(input)
  const payload = summarizeDataExchangePayload(storable.payload)
  const now = options.now ?? Date.now()
  return {
    exchangeId: storable.exchangeId,
    sourceOwner: storable.sourceOwner,
    recipientOwner: storable.recipientOwner,
    sourceNicknameSnapshot: storable.sourceNicknameSnapshot ?? "",
    recipientNicknameSnapshot: storable.recipientNicknameSnapshot ?? "",
    purpose: storable.purpose,
    allowedUse: storable.allowedUse,
    retentionPolicy: storable.retentionPolicy,
    redactionState: storable.redactionState,
    provenanceRefs: storable.provenanceRefs,
    provenanceKinds: uniqueProvenanceKinds(storable.provenanceRefs),
    payloadSummary: payload.summary,
    redactionCategories: payload.categories,
    createdAt: storable.createdAt,
    isExpired: isExpired(storable.expiresAt, now),
    ...(storable.expiresAt !== undefined ? { expiresAt: storable.expiresAt } : {}),
  }
}

export function buildDataExchangeAdminRawView(
  input: DataExchangePackage,
  options: {
    adminAccessGranted: boolean
    reason?: string
    requester?: string
    now?: number
    recordAudit?: boolean
  },
): DataExchangeAdminRawView {
  const storable = sanitizeDataExchangePackage(input)
  const redaction = inspectDataExchangePayloadRisk(storable.payload)
  if (!options.adminAccessGranted) {
    return {
      ok: false,
      reasonCode: "admin_raw_access_denied",
      redactionCategories: redaction.categories,
    }
  }
  const reason = options.reason?.trim()
  if (!reason) {
    return {
      ok: false,
      reasonCode: "admin_raw_access_reason_required",
      redactionCategories: redaction.categories,
    }
  }
  const auditEventId =
    options.recordAudit === false
      ? null
      : recordControlEvent({
          eventType: "data_exchange.raw_view.opened",
          component: "data_exchange",
          severity: "warning",
          summary: `admin raw data exchange view opened for ${storable.exchangeId}`,
          detail: {
            exchangeId: storable.exchangeId,
            sourceOwner: storable.sourceOwner,
            recipientOwner: storable.recipientOwner,
            requester: options.requester ?? "unknown",
            reason,
            redactionState: storable.redactionState,
            redactionCategories: redaction.categories,
          },
          createdAt: options.now ?? Date.now(),
        })
  return {
    ok: true,
    exchange: storable,
    redactionCategories: redaction.categories,
    auditEventId,
  }
}

export function listActiveDataExchangePackagesForRecipient(
  recipientOwner: OwnerScope,
  options: { now?: number; allowedUse?: DataExchangePackage["allowedUse"]; limit?: number } = {},
): DataExchangePackage[] {
  return listAgentDataExchangesForRecipient(recipientOwner, options)
    .map(dbAgentDataExchangeToPackage)
    .filter(
      (pkg) =>
        validateDataExchangePackage(pkg, {
          ...(options.now !== undefined ? { now: options.now } : {}),
        }).ok,
    )
}

export function listActiveDataExchangePackagesForSource(
  sourceOwner: OwnerScope,
  options: {
    now?: number
    recipientOwner?: OwnerScope
    includeExpired?: boolean
    limit?: number
  } = {},
): DataExchangePackage[] {
  return listAgentDataExchangesForSource(sourceOwner, options)
    .map(dbAgentDataExchangeToPackage)
    .filter(
      (pkg) =>
        validateDataExchangePackage(pkg, {
          ...(options.now !== undefined ? { now: options.now } : {}),
        }).ok,
    )
}

export function getDataExchangePackage(
  exchangeId: string,
  options: { now?: number; includeExpired?: boolean } = {},
): DataExchangePackage | undefined {
  const row = getAgentDataExchange(exchangeId)
  if (!row) return undefined
  const pkg = dbAgentDataExchangeToPackage(row)
  if (options.includeExpired) return pkg
  return validateDataExchangePackage(pkg, {
    ...(options.now !== undefined ? { now: options.now } : {}),
  }).ok
    ? pkg
    : undefined
}

export function storeOwnerScopedMemory(params: StoreOwnerScopedMemoryParams) {
  const ownerPolicy = assertWritableMemoryOwner(params.owner)
  const scope = params.scope ?? retentionToScope(params.retentionPolicy)
  return storeMemoryDocument({
    rawText: params.rawText,
    scope,
    ownerId: ownerPolicy.storageOwnerId,
    sourceType: params.sourceType,
    ...(params.sourceRef ? { sourceRef: params.sourceRef } : {}),
    ...(params.title ? { title: params.title } : {}),
    metadata: {
      ...(params.metadata ?? {}),
      ownerType: params.owner.ownerType,
      ownerId: params.owner.ownerId,
      ownerScopeKey: ownerPolicy.ownerScopeKey,
      ownerScopeKind: ownerPolicy.kind,
      visibility: params.visibility,
      retentionPolicy: params.retentionPolicy,
      historyVersion: params.historyVersion ?? 1,
      historyOwnerId: params.owner.ownerId,
      memoryIsolation: "owner_scoped",
    },
  })
}

export function isDataExchangeUsableForMemoryAccess(input: {
  exchange: DataExchangePackage
  requester: OwnerScope
  sourceOwner: OwnerScope
  allowedUses?: DataExchangePackage["allowedUse"][]
  now?: number
}): boolean {
  if (!isSameOwner(input.exchange.recipientOwner, input.requester)) return false
  if (!isSameOwner(input.exchange.sourceOwner, input.sourceOwner)) return false
  if (
    !validateDataExchangePackage(input.exchange, {
      ...(input.now !== undefined ? { now: input.now } : {}),
    }).ok
  )
    return false
  if (input.exchange.redactionState === "blocked") return false
  const allowedUses = input.allowedUses ?? ["temporary_context", "verification_only"]
  return allowedUses.includes(input.exchange.allowedUse)
}

export function assertMemoryAccessAllowed(input: {
  requester: OwnerScope
  owner: OwnerScope
  exchanges?: DataExchangePackage[]
  now?: number
}): MemoryAccessMode {
  const ownerPolicy = resolveMemoryOwnerScopePolicy(input.owner)
  if (!ownerPolicy.directReadAllowed) {
    throw new MemoryIsolationError(
      ownerPolicy.reasonCode ?? "memory_owner_scope_not_readable",
      "Memory owner scope is not directly readable.",
    )
  }
  if (isSameOwner(input.requester, input.owner)) return "owner_direct"
  const exchange = (input.exchanges ?? []).find((candidate) =>
    isDataExchangeUsableForMemoryAccess({
      exchange: candidate,
      requester: input.requester,
      sourceOwner: input.owner,
      ...(input.now !== undefined ? { now: input.now } : {}),
    }),
  )
  if (exchange) return "recipient_via_exchange"
  throw new MemoryIsolationError(
    "cross_agent_memory_requires_data_exchange",
    "Cross-agent memory access requires an explicit non-expired DataExchangePackage.",
  )
}

function recordOwnerScopedMemoryAccessAudit(input: {
  requester: OwnerScope
  owner: OwnerScope
  query: string
  resultSource: string
  reason: string
  allowed: boolean
  accessMode?: MemoryAccessMode
  filters?: OwnerScopedMemorySearchParams["filters"]
}): void {
  const ownerPolicy = resolveMemoryOwnerScopePolicy(input.owner)
  try {
    recordMemoryAccessLog({
      ...(input.filters?.runId ? { runId: input.filters.runId } : {}),
      ...(input.filters?.sessionId ? { sessionId: input.filters.sessionId } : {}),
      ...(input.filters?.requestGroupId ? { requestGroupId: input.filters.requestGroupId } : {}),
      query: input.query,
      resultSource: input.resultSource,
      scope: ownerPolicy.ownerScopeKey,
      reason: input.reason,
    })
  } catch {
    // Memory access audit must not change access decisions.
  }
  try {
    recordControlEvent({
      eventType: input.allowed ? "memory.access.allowed" : "memory.access.denied",
      component: "memory",
      severity: input.allowed ? "info" : "warning",
      summary: input.allowed
        ? `memory access allowed via ${input.accessMode ?? "unknown"}`
        : `memory access denied: ${input.reason}`,
      detail: {
        requester: input.requester,
        owner: input.owner,
        ownerScopeKey: ownerPolicy.ownerScopeKey,
        ownerScopeKind: ownerPolicy.kind,
        reason: input.reason,
        resultSource: input.resultSource,
        ...(input.accessMode ? { accessMode: input.accessMode } : {}),
      },
    })
  } catch {
    // Control timeline audit is best-effort.
  }
}

export async function searchOwnerScopedMemory(
  input: OwnerScopedMemorySearchParams,
): Promise<OwnerScopedMemorySearchResult> {
  let accessMode: MemoryAccessMode
  try {
    accessMode = assertMemoryAccessAllowed({
      requester: input.requester,
      owner: input.owner,
      ...(input.exchanges ? { exchanges: input.exchanges } : {}),
      ...(input.now !== undefined ? { now: input.now } : {}),
    })
  } catch (error) {
    if (error instanceof MemoryIsolationError) {
      recordOwnerScopedMemoryAccessAudit({
        requester: input.requester,
        owner: input.owner,
        query: input.query,
        resultSource: "owner_scope_guard",
        reason: error.reasonCode,
        allowed: false,
        filters: input.filters,
      })
    }
    throw error
  }
  if (accessMode === "recipient_via_exchange") {
    recordOwnerScopedMemoryAccessAudit({
      requester: input.requester,
      owner: input.owner,
      query: input.query,
      resultSource: "data_exchange_context",
      reason: "data_exchange_context_allowed",
      allowed: true,
      accessMode,
      filters: input.filters,
    })
    return {
      accessMode,
      memoryResults: [],
      exchangeRefs: buildDataExchangeContextMemoryRefs(input.exchanges ?? [], {
        recipient: input.requester,
        sourceOwner: input.owner,
        ...(input.now !== undefined ? { now: input.now } : {}),
      }),
    }
  }

  recordOwnerScopedMemoryAccessAudit({
    requester: input.requester,
    owner: input.owner,
    query: input.query,
    resultSource: "owner_scope_guard",
    reason: "owner_direct_allowed",
    allowed: true,
    accessMode,
    filters: input.filters,
  })
  const memoryResults = await searchMemoryDetailed(input.query, input.limit ?? 5, {
    ...(input.filters ?? {}),
    ownerScope: input.owner,
    recipientScope: input.requester,
  })
  return {
    accessMode,
    memoryResults,
    exchangeRefs: [],
  }
}

export function buildDataExchangeContextMemoryRefs(
  exchanges: DataExchangePackage[],
  options: { recipient: OwnerScope; sourceOwner?: OwnerScope; now?: number },
): PromptBundleContextMemoryRef[] {
  return exchanges
    .filter((exchange) => isSameOwner(exchange.recipientOwner, options.recipient))
    .filter(
      (exchange) => !options.sourceOwner || isSameOwner(exchange.sourceOwner, options.sourceOwner),
    )
    .filter(
      (exchange) =>
        validateDataExchangePackage(exchange, {
          ...(options.now !== undefined ? { now: options.now } : {}),
        }).ok,
    )
    .filter((exchange) => exchange.redactionState !== "blocked")
    .filter(
      (exchange) =>
        exchange.allowedUse === "temporary_context" || exchange.allowedUse === "verification_only",
    )
    .map((exchange) => {
      const summary = buildDataExchangeSanitizedView(exchange, {
        ...(options.now !== undefined ? { now: options.now } : {}),
      }).payloadSummary
      return {
        owner: exchange.sourceOwner,
        visibility: "private" as const,
        sourceRef: `exchange:${exchange.exchangeId}`,
        content: summary,
        dataExchangeId: exchange.exchangeId,
      }
    })
}

export function buildMemorySummaryDataExchange(
  input: Omit<CreateDataExchangePackageInput, "payload" | "provenanceRefs"> & {
    memoryResults: DetailedMemorySearchResult[]
    maxItems?: number
  },
): DataExchangePackage {
  const maxItems = Math.max(1, Math.min(20, Math.floor(input.maxItems ?? 5)))
  const items = input.memoryResults.slice(0, maxItems).map((result) => {
    const opaqueRef = hashOpaqueRef([
      input.sourceOwner.ownerType,
      input.sourceOwner.ownerId,
      result.chunk.document_id,
      result.chunkId,
    ])
    const excerpt = redactSensitiveString(result.chunk.content).value.slice(0, 700)
    return {
      ref: opaqueRef,
      scope: result.chunk.scope,
      sourceType: result.chunk.document_source_type,
      excerpt,
    }
  })
  const summary = items.map((item, index) => `${index + 1}. ${item.excerpt}`).join("\n")
  return createDataExchangePackage({
    ...input,
    provenanceRefs: items.map((item) => item.ref),
    payload: {
      summary,
      items,
      sourceOwner: `${input.sourceOwner.ownerType}:${input.sourceOwner.ownerId}`,
      recipientOwner: `${input.recipientOwner.ownerType}:${input.recipientOwner.ownerId}`,
    },
  })
}

export function prepareAgentMemoryWritebackQueueInput(input: {
  candidate: MemoryWritebackCandidate
  memoryPolicy: MemoryPolicy
}): PreparedMemoryWritebackCandidate {
  return preparePolicyControlledMemoryWritebackQueueInput({
    candidate: input.candidate,
    memoryPolicy: input.memoryPolicy,
  })
}

export function preparePolicyControlledMemoryWritebackQueueInput(
  input: PreparePolicyControlledMemoryWritebackInput,
): PreparedMemoryWritebackCandidate {
  const writeOwner = input.memoryPolicy.writeScope
  const actorOwner = input.actorOwner ?? input.memoryPolicy.owner
  const targetOwner = input.targetOwner ?? writeOwner
  const targetPolicy = assertWritableMemoryOwner(targetOwner)
  const requestedOwnerId = input.candidate.ownerId?.trim()
  if (requestedOwnerId && requestedOwnerId !== targetPolicy.storageOwnerId) {
    throw new MemoryIsolationError(
      "writeback_owner_scope_mismatch",
      "Memory writeback candidate owner must match the target owner scope.",
    )
  }
  const selfWrite = isSameOwner(targetOwner, writeOwner)
  const parentWrite = input.parentOwner ? isSameOwner(targetOwner, input.parentOwner) : false
  const policyMode = parentWrite ? (input.parentMemoryWritebackPolicy ?? "review") : undefined
  if (!selfWrite && !parentWrite) {
    throw new MemoryIsolationError(
      "writeback_owner_scope_mismatch",
      "Memory writeback target must be the agent write scope or an explicit parent owner scope.",
    )
  }
  if (policyMode === "deny") {
    throw new MemoryIsolationError(
      "parent_writeback_policy_denied",
      "Parent memory writeback is denied by policy.",
    )
  }

  const metadata = {
    ...(input.candidate.metadata ?? {}),
    actorOwnerType: actorOwner.ownerType,
    actorOwnerId: actorOwner.ownerId,
    targetOwnerType: targetOwner.ownerType,
    targetOwnerId: targetOwner.ownerId,
    targetOwnerScopeKey: targetPolicy.ownerScopeKey,
    targetOwnerScopeKind: targetPolicy.kind,
    ownerType: targetOwner.ownerType,
    ownerId: targetOwner.ownerId,
    visibility: input.memoryPolicy.visibility,
    retentionPolicy: input.memoryPolicy.retentionPolicy,
    writebackReviewRequired:
      parentWrite && policyMode === "review" ? true : input.memoryPolicy.writebackReviewRequired,
    memoryIsolation: "owner_scoped_writeback",
    ...(parentWrite
      ? {
          crossOwnerWriteback: true,
          parentMemoryWritebackPolicy: policyMode,
          requiresReview: policyMode === "review",
          approved: policyMode === "allow",
        }
      : {}),
  }

  const prepared = prepareMemoryWritebackQueueInput({
    ...input.candidate,
    ownerId: targetPolicy.storageOwnerId,
    metadata,
  })
  if (parentWrite && policyMode === "review" && !prepared.status) {
    return { ...prepared, status: "pending" }
  }
  return prepared
}
