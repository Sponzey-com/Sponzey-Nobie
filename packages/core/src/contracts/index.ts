import crypto from "node:crypto"

export const CONTRACT_SCHEMA_VERSION = 1 as const

export type ContractSchemaVersion = typeof CONTRACT_SCHEMA_VERSION
export type ContractLocaleHint = "ko" | "en" | "mixed" | "unknown"
export type ContractSource = "webui" | "telegram" | "slack" | "cli" | "scheduler" | "system"

export type IntentType =
  | "schedule_request"
  | "execute_now"
  | "cancel"
  | "update"
  | "question"
  | "impossible"
  | "clarification"

export type ActionType =
  | "create_schedule"
  | "update_schedule"
  | "cancel_schedule"
  | "run_tool"
  | "send_message"
  | "answer"
  | "ask_user"
  | "none"

export type ToolTargetKind =
  | "schedule"
  | "run"
  | "artifact"
  | "extension"
  | "display"
  | "camera"
  | "file"
  | "unknown"

export type DeliveryMode = "reply" | "direct_artifact" | "channel_message" | "none"
export type DeliveryChannel = "current_session" | "telegram" | "slack" | "webui" | "local" | "agent" | "none"
export type ScheduleKind = "one_time" | "recurring"
export type ScheduleMissedPolicy = "skip" | "catch_up_once" | "next_only"
export type SchedulePayloadKind = "literal_message" | "agent_task" | "tool_task" | "artifact_delivery"

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue | undefined }
export type JsonObject = { [key: string]: JsonValue | undefined }

export interface ContractAttachment {
  id?: string
  fileName?: string
  mimeType?: string
  artifactId?: string
}

export interface IngressEnvelope {
  schemaVersion: ContractSchemaVersion
  ingressId: string
  source: ContractSource
  channelEventId: string
  sessionId: string
  threadId?: string | null
  userId?: string | null
  receivedAt: number
  rawText?: string
  attachments?: ContractAttachment[]
  localeHint?: ContractLocaleHint
}

export interface ToolTargetContract {
  schemaVersion: ContractSchemaVersion
  kind: ToolTargetKind
  id?: string | null
  selector?: JsonObject | null
  displayName?: string
  rawText?: string
}

export interface DeliveryContract {
  schemaVersion: ContractSchemaVersion
  mode: DeliveryMode
  channel: DeliveryChannel
  sessionId?: string | null
  threadId?: string | null
  artifactId?: string | null
  explicitResend?: boolean
  displayName?: string
  rawText?: string
}

export interface IntentContract {
  schemaVersion: ContractSchemaVersion
  intentType: IntentType
  actionType: ActionType
  target: ToolTargetContract
  delivery: DeliveryContract
  constraints: string[]
  requiresApproval: boolean
  impossibility?: {
    reasonCode: string
    message: string
  } | null
  displayName?: string
  rawText?: string
  summary?: string
}

export interface ScheduleTimeContract {
  runAt?: string | null
  cron?: string | null
  timezone: string
  missedPolicy: ScheduleMissedPolicy
}

export interface SchedulePayloadContract {
  kind: SchedulePayloadKind
  literalText?: string | null
  toolName?: string | null
  toolParams?: JsonObject | null
  taskContract?: IntentContract | null
  artifactId?: string | null
}

export interface ScheduleContract {
  schemaVersion: ContractSchemaVersion
  kind: ScheduleKind
  time: ScheduleTimeContract
  payload: SchedulePayloadContract
  delivery: DeliveryContract
  source?: {
    originRunId?: string
    originRequestGroupId?: string
    createdBy?: string
  }
  displayName?: string
  rawText?: string
  summary?: string
}

export type ContractValidationErrorCode =
  | "contract_validation_failed"
  | "unsupported_contract_version"
  | "unknown_contract_action"

export interface ContractValidationIssue {
  path: string
  code: ContractValidationErrorCode
  message: string
}

export type ContractValidationResult<T> =
  | { ok: true; value: T; issues: [] }
  | { ok: false; issues: ContractValidationIssue[] }

export const CANONICAL_JSON_POLICY = {
  keyOrder: "Object keys are sorted lexicographically at every depth.",
  arrayOrder: "Array order is preserved because order can be semantically meaningful.",
  undefinedPolicy: "undefined values are omitted.",
  nullPolicy: "null values are omitted in identity/hash projections.",
  emptyStringPolicy: "empty strings are omitted in identity/hash projections.",
  emptyArrayPolicy: "empty arrays are omitted in identity/hash projections.",
} as const

const INTENT_TYPES = new Set<IntentType>([
  "schedule_request",
  "execute_now",
  "cancel",
  "update",
  "question",
  "impossible",
  "clarification",
])
const ACTION_TYPES = new Set<ActionType>([
  "create_schedule",
  "update_schedule",
  "cancel_schedule",
  "run_tool",
  "send_message",
  "answer",
  "ask_user",
  "none",
])
const TARGET_KINDS = new Set<ToolTargetKind>(["schedule", "run", "artifact", "extension", "display", "camera", "file", "unknown"])
const DELIVERY_MODES = new Set<DeliveryMode>(["reply", "direct_artifact", "channel_message", "none"])
const DELIVERY_CHANNELS = new Set<DeliveryChannel>(["current_session", "telegram", "slack", "webui", "local", "agent", "none"])
const SCHEDULE_KINDS = new Set<ScheduleKind>(["one_time", "recurring"])
const MISSED_POLICIES = new Set<ScheduleMissedPolicy>(["skip", "catch_up_once", "next_only"])
const PAYLOAD_KINDS = new Set<SchedulePayloadKind>(["literal_message", "agent_task", "tool_task", "artifact_delivery"])
const HASH_PREFIX = "nobie-contract-v1"

interface CanonicalizeOptions {
  omitKeys?: ReadonlySet<string>
  dropNulls?: boolean
  dropEmptyStrings?: boolean
  dropEmptyArrays?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function addIssue(
  issues: ContractValidationIssue[],
  path: string,
  code: ContractValidationErrorCode,
  message: string,
): void {
  issues.push({ path, code, message })
}

function validateSchemaVersion(record: Record<string, unknown>, path: string, issues: ContractValidationIssue[]): void {
  if (record.schemaVersion !== CONTRACT_SCHEMA_VERSION) {
    addIssue(issues, `${path}.schemaVersion`, "unsupported_contract_version", "Unsupported contract schema version.")
  }
}

function validateStringEnum<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  path: string,
  issues: ContractValidationIssue[],
  code: ContractValidationErrorCode = "contract_validation_failed",
): value is T {
  if (typeof value === "string" && allowed.has(value as T)) return true
  addIssue(issues, path, code, `Unsupported enum value at ${path}.`)
  return false
}

function validateOptionalString(value: unknown, path: string, issues: ContractValidationIssue[]): void {
  if (value == null || typeof value === "string") return
  addIssue(issues, path, "contract_validation_failed", `Expected optional string at ${path}.`)
}

function validateOptionalJsonObject(value: unknown, path: string, issues: ContractValidationIssue[]): void {
  if (value == null || isJsonObject(value)) return
  addIssue(issues, path, "contract_validation_failed", `Expected optional JSON object at ${path}.`)
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  return isJsonObject(value)
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && Object.values(value).every((item) => item === undefined || isJsonValue(item))
}

export function validateToolTargetContract(value: unknown): ContractValidationResult<ToolTargetContract> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "$", code: "contract_validation_failed", message: "Tool target contract must be an object." }] }
  }
  validateSchemaVersion(value, "$", issues)
  validateStringEnum(value.kind, TARGET_KINDS, "$.kind", issues)
  validateOptionalString(value.id, "$.id", issues)
  validateOptionalJsonObject(value.selector, "$.selector", issues)
  validateOptionalString(value.displayName, "$.displayName", issues)
  validateOptionalString(value.rawText, "$.rawText", issues)
  return issues.length === 0 ? { ok: true, value: value as unknown as ToolTargetContract, issues: [] } : { ok: false, issues }
}

export function validateDeliveryContract(value: unknown): ContractValidationResult<DeliveryContract> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "$", code: "contract_validation_failed", message: "Delivery contract must be an object." }] }
  }
  validateSchemaVersion(value, "$", issues)
  validateStringEnum(value.mode, DELIVERY_MODES, "$.mode", issues)
  validateStringEnum(value.channel, DELIVERY_CHANNELS, "$.channel", issues)
  validateOptionalString(value.sessionId, "$.sessionId", issues)
  validateOptionalString(value.threadId, "$.threadId", issues)
  validateOptionalString(value.artifactId, "$.artifactId", issues)
  if (value.explicitResend !== undefined && typeof value.explicitResend !== "boolean") {
    addIssue(issues, "$.explicitResend", "contract_validation_failed", "explicitResend must be a boolean.")
  }
  validateOptionalString(value.displayName, "$.displayName", issues)
  validateOptionalString(value.rawText, "$.rawText", issues)
  return issues.length === 0 ? { ok: true, value: value as unknown as DeliveryContract, issues: [] } : { ok: false, issues }
}

export function validateIntentContract(value: unknown): ContractValidationResult<IntentContract> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "$", code: "contract_validation_failed", message: "Intent contract must be an object." }] }
  }
  validateSchemaVersion(value, "$", issues)
  validateStringEnum(value.intentType, INTENT_TYPES, "$.intentType", issues, "unknown_contract_action")
  validateStringEnum(value.actionType, ACTION_TYPES, "$.actionType", issues, "unknown_contract_action")
  const target = validateToolTargetContract(value.target)
  if (!target.ok) issues.push(...target.issues.map((issue) => ({ ...issue, path: `$.target${issue.path.slice(1)}` })))
  const delivery = validateDeliveryContract(value.delivery)
  if (!delivery.ok) issues.push(...delivery.issues.map((issue) => ({ ...issue, path: `$.delivery${issue.path.slice(1)}` })))
  if (!Array.isArray(value.constraints) || !value.constraints.every((item) => typeof item === "string")) {
    addIssue(issues, "$.constraints", "contract_validation_failed", "constraints must be a string array.")
  }
  if (typeof value.requiresApproval !== "boolean") {
    addIssue(issues, "$.requiresApproval", "contract_validation_failed", "requiresApproval must be a boolean.")
  }
  if (value.impossibility != null) {
    if (!isRecord(value.impossibility)) {
      addIssue(issues, "$.impossibility", "contract_validation_failed", "impossibility must be null or an object.")
    } else {
      validateOptionalString(value.impossibility.reasonCode, "$.impossibility.reasonCode", issues)
      validateOptionalString(value.impossibility.message, "$.impossibility.message", issues)
    }
  }
  validateOptionalString(value.displayName, "$.displayName", issues)
  validateOptionalString(value.rawText, "$.rawText", issues)
  validateOptionalString(value.summary, "$.summary", issues)
  return issues.length === 0 ? { ok: true, value: value as unknown as IntentContract, issues: [] } : { ok: false, issues }
}

export function validateScheduleContract(value: unknown): ContractValidationResult<ScheduleContract> {
  const issues: ContractValidationIssue[] = []
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "$", code: "contract_validation_failed", message: "Schedule contract must be an object." }] }
  }
  validateSchemaVersion(value, "$", issues)
  validateStringEnum(value.kind, SCHEDULE_KINDS, "$.kind", issues)
  if (!isRecord(value.time)) {
    addIssue(issues, "$.time", "contract_validation_failed", "time must be an object.")
  } else {
    validateOptionalString(value.time.runAt, "$.time.runAt", issues)
    validateOptionalString(value.time.cron, "$.time.cron", issues)
    if (typeof value.time.timezone !== "string" || !value.time.timezone.trim()) {
      addIssue(issues, "$.time.timezone", "contract_validation_failed", "timezone is required.")
    }
    validateStringEnum(value.time.missedPolicy, MISSED_POLICIES, "$.time.missedPolicy", issues)
  }
  if (!isRecord(value.payload)) {
    addIssue(issues, "$.payload", "contract_validation_failed", "payload must be an object.")
  } else {
    validateStringEnum(value.payload.kind, PAYLOAD_KINDS, "$.payload.kind", issues, "unknown_contract_action")
    validateOptionalString(value.payload.literalText, "$.payload.literalText", issues)
    validateOptionalString(value.payload.toolName, "$.payload.toolName", issues)
    validateOptionalJsonObject(value.payload.toolParams, "$.payload.toolParams", issues)
    validateOptionalString(value.payload.artifactId, "$.payload.artifactId", issues)
    if (value.payload.taskContract != null) {
      const task = validateIntentContract(value.payload.taskContract)
      if (!task.ok) issues.push(...task.issues.map((issue) => ({ ...issue, path: `$.payload.taskContract${issue.path.slice(1)}` })))
    }
  }
  const delivery = validateDeliveryContract(value.delivery)
  if (!delivery.ok) issues.push(...delivery.issues.map((issue) => ({ ...issue, path: `$.delivery${issue.path.slice(1)}` })))
  validateOptionalString(value.displayName, "$.displayName", issues)
  validateOptionalString(value.rawText, "$.rawText", issues)
  validateOptionalString(value.summary, "$.summary", issues)
  return issues.length === 0 ? { ok: true, value: value as unknown as ScheduleContract, issues: [] } : { ok: false, issues }
}

function canonicalizeValue(value: unknown, options: CanonicalizeOptions): unknown {
  if (value === undefined) return undefined
  if (value === null) return options.dropNulls ? undefined : null
  if (typeof value === "string") {
    if (options.dropEmptyStrings && value.trim() === "") return undefined
    return value
  }
  if (typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) {
    const items = value
      .map((item) => canonicalizeValue(item, options))
      .filter((item) => item !== undefined)
    if (options.dropEmptyArrays && items.length === 0) return undefined
    return items
  }
  if (isRecord(value)) {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      if (options.omitKeys?.has(key)) continue
      const next = canonicalizeValue(value[key], options)
      if (next !== undefined) result[key] = next
    }
    if (Object.keys(result).length === 0) return undefined
    return result
  }
  return String(value)
}

export function toCanonicalJson(value: unknown, options: CanonicalizeOptions = {}): string {
  const normalized = canonicalizeValue(value, {
    dropNulls: options.dropNulls ?? true,
    dropEmptyStrings: options.dropEmptyStrings ?? true,
    dropEmptyArrays: options.dropEmptyArrays ?? true,
    ...(options.omitKeys ? { omitKeys: options.omitKeys } : {}),
  })
  return JSON.stringify(normalized ?? null)
}

export function stableContractHash(value: unknown, namespace = "generic"): string {
  const canonical = toCanonicalJson(value)
  const digest = crypto.createHash("sha256").update(`${HASH_PREFIX}:${namespace}:${canonical}`).digest("hex")
  return `${namespace}:v1:${digest}`
}

export function buildSchedulePayloadProjection(payload: SchedulePayloadContract): JsonObject {
  return {
    kind: payload.kind,
    literalText: payload.literalText ?? undefined,
    toolName: payload.toolName ?? undefined,
    toolParams: payload.toolParams ?? undefined,
    taskContract: payload.taskContract
      ? {
          schemaVersion: payload.taskContract.schemaVersion,
          intentType: payload.taskContract.intentType,
          actionType: payload.taskContract.actionType,
          target: buildToolTargetProjection(payload.taskContract.target),
          delivery: buildDeliveryProjection(payload.taskContract.delivery),
          constraints: payload.taskContract.constraints,
          requiresApproval: payload.taskContract.requiresApproval,
          impossibility: payload.taskContract.impossibility ?? undefined,
        }
      : undefined,
    artifactId: payload.artifactId ?? undefined,
  }
}

export function buildToolTargetProjection(target: ToolTargetContract): JsonObject {
  return {
    schemaVersion: target.schemaVersion,
    kind: target.kind,
    id: target.id ?? undefined,
    selector: target.selector ?? undefined,
  }
}

export function buildDeliveryProjection(delivery: DeliveryContract): JsonObject {
  return {
    schemaVersion: delivery.schemaVersion,
    mode: delivery.mode,
    channel: delivery.channel,
    sessionId: delivery.sessionId ?? undefined,
    threadId: delivery.threadId ?? undefined,
    artifactId: delivery.artifactId ?? undefined,
    explicitResend: delivery.explicitResend === true ? true : undefined,
  }
}

export function buildScheduleIdentityProjection(contract: ScheduleContract): JsonObject {
  return {
    schemaVersion: contract.schemaVersion,
    kind: contract.kind,
    time: {
      runAt: contract.time.runAt ?? undefined,
      cron: contract.time.cron ?? undefined,
      timezone: contract.time.timezone,
      missedPolicy: contract.time.missedPolicy,
    },
    payload: buildSchedulePayloadProjection(contract.payload),
    delivery: {
      channel: contract.delivery.channel,
      sessionId: contract.delivery.sessionId ?? undefined,
      threadId: contract.delivery.threadId ?? undefined,
    },
  }
}

export function buildPayloadHash(payload: SchedulePayloadContract): string {
  return stableContractHash(buildSchedulePayloadProjection(payload), "payload")
}

export function buildDeliveryKey(delivery: DeliveryContract): string {
  return stableContractHash(buildDeliveryProjection(delivery), "delivery")
}

export function buildScheduleIdentityKey(contract: ScheduleContract): string {
  return stableContractHash(buildScheduleIdentityProjection(contract), "schedule")
}

export function buildDeliveryDedupeKey(params: {
  scheduleId: string
  dueAt: string | number
  delivery: DeliveryContract
  payloadHash: string
}): string {
  return stableContractHash({
    scheduleId: params.scheduleId,
    dueAt: String(params.dueAt),
    delivery: buildDeliveryProjection(params.delivery),
    payloadHash: params.payloadHash,
  }, "delivery-dedupe")
}

export function formatContractValidationFailureForUser(issues: ContractValidationIssue[]): string {
  if (issues.some((issue) => issue.code === "unsupported_contract_version")) {
    return "지원하지 않는 실행 계약 버전입니다. 최신 버전으로 다시 생성해야 합니다."
  }
  if (issues.some((issue) => issue.code === "unknown_contract_action")) {
    return "지원하지 않는 실행 계약 작업입니다. 요청을 다시 해석해야 합니다."
  }
  return "실행 계약 형식이 올바르지 않아 작업을 진행할 수 없습니다."
}
