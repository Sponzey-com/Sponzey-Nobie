import { createHash, randomUUID } from "node:crypto"
import { CONTRACT_SCHEMA_VERSION, type JsonObject, type JsonValue } from "../contracts/index.js"
import {
  getAgentDataExchange,
  insertAgentDataExchange,
  listAgentDataExchangesForRecipient,
  type DbAgentDataExchange,
  type MemoryScope,
} from "../db/index.js"
import type {
  DataExchangePackage,
  DataExchangeRetentionPolicy,
  MemoryPolicy,
  OwnerScope,
  RuntimeIdentity,
} from "../contracts/sub-agent-orchestration.js"
import { searchMemoryDetailed, storeMemoryDocument, type DetailedMemorySearchResult, type StoreMemoryDocumentParams } from "./store.js"
import {
  prepareMemoryWritebackQueueInput,
  type MemoryWritebackCandidate,
  type PreparedMemoryWritebackCandidate,
} from "./writeback.js"
import type { PromptBundleContextMemoryRef } from "../runs/context-preflight.js"

export type MemoryVisibility = MemoryPolicy["visibility"]
export type MemoryAccessMode = "owner_direct" | "recipient_via_exchange"

export type DataExchangeValidationIssueCode =
  | "source_owner_missing"
  | "recipient_owner_missing"
  | "purpose_missing"
  | "redaction_state_missing"
  | "provenance_refs_missing"
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

export interface StoreOwnerScopedMemoryParams extends Omit<StoreMemoryDocumentParams, "scope" | "ownerId" | "metadata"> {
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

export class MemoryIsolationError extends Error {
  readonly reasonCode: string

  constructor(reasonCode: string, message: string) {
    super(message)
    this.name = "MemoryIsolationError"
    this.reasonCode = reasonCode
  }
}

const DEFAULT_EXCHANGE_TTL_MS: Record<Exclude<DataExchangeRetentionPolicy, "long_term_candidate">, number> = {
  session_only: 24 * 60 * 60 * 1_000,
  short_term: 7 * 24 * 60 * 60 * 1_000,
  discard_after_review: 24 * 60 * 60 * 1_000,
}

function isSameOwner(a: OwnerScope, b: OwnerScope): boolean {
  return a.ownerType === b.ownerType && a.ownerId === b.ownerId
}

function ownerMissing(owner: OwnerScope | undefined): boolean {
  return !owner?.ownerType || !owner.ownerId?.trim()
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

function redactSensitiveString(value: string): { value: string; redacted: boolean } {
  let redacted = false
  let next = value
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, () => {
      redacted = true
      return "[redacted-api-key]"
    })
    .replace(/\b(?:api[_-]?key|token|secret|authorization)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}["']?/giu, (match) => {
      redacted = true
      const key = match.split(/[:=]/u)[0]?.trim() || "secret"
      return `${key}: [redacted]`
    })
    .replace(/\/Users\/[^/\s)]+\/[^\s)]+/g, () => {
      redacted = true
      return "/Users/<user>/..."
    })
    .replace(/\b[A-Z]:\\Users\\[^\\\s)]+\\[^\s)]+/g, () => {
      redacted = true
      return "C:\\Users\\<user>\\..."
    })

  if (/<!doctype\s+html|<html[\s>]|<body[\s>]|<head[\s>]/iu.test(next)) {
    redacted = true
    next = "[redacted-raw-html]"
  }
  if (/(?:^|\n)\s*at\s+[^\n]+\([^\n]+:\d+:\d+\)|(?:^|\n)Traceback \(most recent call last\):/u.test(next)) {
    redacted = true
    next = "[redacted-stack-trace]"
  }

  return { value: next, redacted }
}

function redactJsonValue(value: JsonValue | undefined): { value: JsonValue | undefined; redacted: boolean } {
  if (typeof value === "string") {
    const redacted = redactSensitiveString(value)
    return { value: redacted.value, redacted: redacted.redacted }
  }
  if (Array.isArray(value)) {
    let changed = false
    const items = value.map((item) => {
      const redacted = redactJsonValue(item)
      changed = changed || redacted.redacted
      return redacted.value ?? null
    })
    return { value: items, redacted: changed }
  }
  if (value && typeof value === "object") {
    let changed = false
    const out: JsonObject = {}
    for (const [key, item] of Object.entries(value)) {
      const redacted = redactJsonValue(item)
      changed = changed || redacted.redacted
      if (redacted.value !== undefined) out[key] = redacted.value
    }
    return { value: out, redacted: changed }
  }
  return { value, redacted: false }
}

function redactJsonObject(value: JsonObject): { payload: JsonObject; redacted: boolean } {
  const redacted = redactJsonValue(value)
  return {
    payload: validateJsonObject(redacted.value as JsonObject) ? redacted.value as JsonObject : {},
    redacted: redacted.redacted,
  }
}

function jsonParseObject(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as JsonObject
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

function buildIdentity(input: CreateDataExchangePackageInput, exchangeId: string, createdAt: number): RuntimeIdentity {
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

export function validateDataExchangePackage(input: DataExchangePackage, options: { now?: number } = {}): DataExchangeValidationResult {
  const issues: DataExchangeValidationIssue[] = []
  const add = (code: DataExchangeValidationIssueCode, path: string, message: string): void => {
    issues.push({ code, path, message })
  }

  if (ownerMissing(input.sourceOwner)) add("source_owner_missing", "sourceOwner", "Data exchange source owner is required.")
  if (ownerMissing(input.recipientOwner)) add("recipient_owner_missing", "recipientOwner", "Data exchange recipient owner is required.")
  if (!input.purpose?.trim()) add("purpose_missing", "purpose", "Data exchange purpose is required.")
  if (!input.redactionState) add("redaction_state_missing", "redactionState", "Data exchange redaction state is required.")
  if (!input.provenanceRefs?.length) add("provenance_refs_missing", "provenanceRefs", "Data exchange provenance refs are required.")
  if (!validateJsonObject(input.payload)) add("payload_missing", "payload", "Data exchange payload must be a JSON object.")
  if (input.expiresAt !== undefined && input.expiresAt !== null && input.expiresAt <= (options.now ?? Date.now())) {
    add("data_exchange_expired", "expiresAt", "Data exchange package is expired.")
  }
  return { ok: issues.length === 0, issues }
}

export function createDataExchangePackage(input: CreateDataExchangePackageInput): DataExchangePackage {
  const createdAt = input.now?.() ?? Date.now()
  const exchangeId = input.exchangeId ?? `exchange:${randomUUID()}`
  const redacted = redactJsonObject(input.payload)
  const redactionState = redacted.redacted && input.redactionState === "not_sensitive"
    ? "redacted"
    : input.redactionState
  return {
    identity: buildIdentity(input, exchangeId, createdAt),
    exchangeId,
    sourceOwner: input.sourceOwner,
    recipientOwner: input.recipientOwner,
    purpose: input.purpose.trim(),
    allowedUse: input.allowedUse,
    retentionPolicy: input.retentionPolicy,
    redactionState,
    provenanceRefs: input.provenanceRefs.filter((ref) => ref.trim().length > 0),
    payload: redacted.payload,
    expiresAt: resolveExchangeExpiresAt({
      retentionPolicy: input.retentionPolicy,
      createdAt,
      ...(Object.prototype.hasOwnProperty.call(input, "expiresAt") ? { expiresAt: input.expiresAt ?? null } : {}),
    }),
    createdAt,
  }
}

export function persistDataExchangePackage(input: DataExchangePackage, options: { now?: number; auditId?: string | null } = {}): boolean {
  const validation = validateDataExchangePackage(input, {
    ...(options.now !== undefined ? { now: options.now } : {}),
  })
  if (!validation.ok) {
    throw new MemoryIsolationError(
      validation.issues[0]?.code ?? "data_exchange_validation_failed",
      `data exchange validation failed: ${validation.issues.map((issue) => issue.code).join(", ")}`,
    )
  }
  return insertAgentDataExchange(input, {
    ...(options.auditId !== undefined ? { auditId: options.auditId } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    expiresAt: input.expiresAt ?? null,
  })
}

export function dbAgentDataExchangeToPackage(row: DbAgentDataExchange): DataExchangePackage {
  const sourceOwner: OwnerScope = { ownerType: row.source_owner_type, ownerId: row.source_owner_id }
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
    recipientOwner: { ownerType: row.recipient_owner_type, ownerId: row.recipient_owner_id },
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

export function listActiveDataExchangePackagesForRecipient(
  recipientOwner: OwnerScope,
  options: { now?: number; allowedUse?: DataExchangePackage["allowedUse"]; limit?: number } = {},
): DataExchangePackage[] {
  return listAgentDataExchangesForRecipient(recipientOwner, options)
    .map(dbAgentDataExchangeToPackage)
    .filter((pkg) => validateDataExchangePackage(pkg, {
      ...(options.now !== undefined ? { now: options.now } : {}),
    }).ok)
}

export function getDataExchangePackage(exchangeId: string, options: { now?: number; includeExpired?: boolean } = {}): DataExchangePackage | undefined {
  const row = getAgentDataExchange(exchangeId)
  if (!row) return undefined
  const pkg = dbAgentDataExchangeToPackage(row)
  if (options.includeExpired) return pkg
  return validateDataExchangePackage(pkg, {
    ...(options.now !== undefined ? { now: options.now } : {}),
  }).ok ? pkg : undefined
}

export function storeOwnerScopedMemory(params: StoreOwnerScopedMemoryParams) {
  const scope = params.scope ?? retentionToScope(params.retentionPolicy)
  return storeMemoryDocument({
    rawText: params.rawText,
    scope,
    ownerId: params.owner.ownerId,
    sourceType: params.sourceType,
    ...(params.sourceRef ? { sourceRef: params.sourceRef } : {}),
    ...(params.title ? { title: params.title } : {}),
    metadata: {
      ...(params.metadata ?? {}),
      ownerType: params.owner.ownerType,
      ownerId: params.owner.ownerId,
      visibility: params.visibility,
      retentionPolicy: params.retentionPolicy,
      historyVersion: params.historyVersion ?? 1,
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
  if (!validateDataExchangePackage(input.exchange, {
    ...(input.now !== undefined ? { now: input.now } : {}),
  }).ok) return false
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
  if (isSameOwner(input.requester, input.owner)) return "owner_direct"
  const exchange = (input.exchanges ?? []).find((candidate) => isDataExchangeUsableForMemoryAccess({
    exchange: candidate,
    requester: input.requester,
    sourceOwner: input.owner,
    ...(input.now !== undefined ? { now: input.now } : {}),
  }))
  if (exchange) return "recipient_via_exchange"
  throw new MemoryIsolationError(
    "cross_agent_memory_requires_data_exchange",
    "Cross-agent memory access requires an explicit non-expired DataExchangePackage.",
  )
}

export async function searchOwnerScopedMemory(input: OwnerScopedMemorySearchParams): Promise<OwnerScopedMemorySearchResult> {
  const accessMode = assertMemoryAccessAllowed({
    requester: input.requester,
    owner: input.owner,
    ...(input.exchanges ? { exchanges: input.exchanges } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
  })
  if (accessMode === "recipient_via_exchange") {
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
    .filter((exchange) => !options.sourceOwner || isSameOwner(exchange.sourceOwner, options.sourceOwner))
    .filter((exchange) => validateDataExchangePackage(exchange, {
      ...(options.now !== undefined ? { now: options.now } : {}),
    }).ok)
    .filter((exchange) => exchange.redactionState !== "blocked")
    .filter((exchange) => exchange.allowedUse === "temporary_context" || exchange.allowedUse === "verification_only")
    .map((exchange) => {
      const summary = typeof exchange.payload["summary"] === "string"
        ? exchange.payload["summary"]
        : JSON.stringify(exchange.payload)
      return {
        owner: exchange.sourceOwner,
        visibility: "private" as const,
        sourceRef: `exchange:${exchange.exchangeId}`,
        content: summary,
        dataExchangeId: exchange.exchangeId,
      }
    })
}

export function buildMemorySummaryDataExchange(input: Omit<CreateDataExchangePackageInput, "payload" | "provenanceRefs"> & {
  memoryResults: DetailedMemorySearchResult[]
  maxItems?: number
}): DataExchangePackage {
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
  const writeOwner = input.memoryPolicy.writeScope
  const ownerId = input.candidate.ownerId?.trim() || writeOwner.ownerId
  if (ownerId !== writeOwner.ownerId) {
    throw new MemoryIsolationError(
      "writeback_owner_scope_mismatch",
      "Memory writeback candidate owner must match the agent write scope.",
    )
  }
  return prepareMemoryWritebackQueueInput({
    ...input.candidate,
    ownerId,
    metadata: {
      ...(input.candidate.metadata ?? {}),
      ownerType: writeOwner.ownerType,
      ownerId: writeOwner.ownerId,
      visibility: input.memoryPolicy.visibility,
      retentionPolicy: input.memoryPolicy.retentionPolicy,
      writebackReviewRequired: input.memoryPolicy.writebackReviewRequired,
      memoryIsolation: "owner_scoped_writeback",
    },
  })
}
