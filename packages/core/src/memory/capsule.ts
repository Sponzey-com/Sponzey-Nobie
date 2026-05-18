const MEMORY_CAPSULE_FORBIDDEN_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  {
    code: "plaintext_secret",
    pattern: /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token)\b\s*[:=]|\bBearer\s+[A-Za-z0-9._-]{8,}|\bsk-[A-Za-z0-9]{8,}\b/i,
  },
  {
    code: "raw_screenshot_binary",
    pattern: /\bdata:image\/[a-zA-Z0-9.+-]+;base64,/i,
  },
  {
    code: "raw_stack_trace",
    pattern: /(?:Traceback \(most recent call last\):|\bstack\s*trace\b|^\s*at .+\(.+:\d+:\d+\)$)/im,
  },
  {
    code: "raw_tool_dump",
    pattern: /(?:"tool_(?:input|output)"\s*:|\btool\s+(?:input|output)\b\s*:)/i,
  },
]

export const MEMORY_COMPACTION_LAYERS = [
  "active_raw_window",
  "pinned_working_set",
  "compacted_capsule",
  "searchable_archive",
  "durable_long_term_review_queue",
  "capsule_chain_rollup",
] as const

export const MEMORY_DETERMINISTIC_CAPSULE_FIELDS = [
  "constraints",
  "pendingItems",
  "artifactRefs",
  "confirmedFacts",
  "activeObjectives",
  "decisions",
] as const

export const MEMORY_MODEL_GENERATED_CAPSULE_FIELDS = [
  "summary",
  "recoveryHints",
] as const

export const MEMORY_APPEND_ONLY_HISTORY_SOURCES = [
  "messages",
  "run_events",
  "result_reports",
  "exchange_packages",
  "delivery_receipts",
] as const

export const MEMORY_ACTIVE_READ_MODEL_COMPONENTS = [
  "prompt_injection_window",
  "latest_capsule_projection",
  "pinned_working_set_projection",
  "task_continuity_projection",
] as const

export type MemoryCapsuleOwnerType = "main_agent" | "sub_agent" | "session" | "task"

export type MemoryCapsuleKind =
  | "session_compaction"
  | "task_compaction"
  | "lineage_compaction"
  | "handoff_compaction"

export interface MemoryCapsuleOwnerScope {
  ownerType: MemoryCapsuleOwnerType
  ownerId: string
  sessionId?: string
  requestGroupId?: string
  lineageId?: string
  channelKey?: string
  threadKey?: string
}

export interface MemoryCapsuleArtifactRef {
  artifactId?: string
  path?: string
  receiptId?: string
  note: string
}

export interface MemoryCapsule {
  capsuleId: string
  capsuleVersion: number
  parentCapsuleId?: string
  ownerScope: MemoryCapsuleOwnerScope
  nicknameSnapshot?: string
  capsuleKind: MemoryCapsuleKind
  summary: string
  activeObjectives: string[]
  confirmedFacts: string[]
  decisions: string[]
  constraints: string[]
  pendingItems: string[]
  artifactRefs: MemoryCapsuleArtifactRef[]
  recoveryHints: string[]
  sourceRefs: string[]
  compactedMessageIds: string[]
  sourceTokenEstimate: number
  resultTokenEstimate: number
  createdAt: number
}

export interface MemoryCapsuleDeterministicState {
  activeObjectives?: string[]
  confirmedFacts?: string[]
  decisions?: string[]
  constraints?: string[]
  pendingItems?: string[]
  artifactRefs?: MemoryCapsuleArtifactRef[]
}

export interface MemoryCapsuleValidationOptions {
  expectedOwnerScope?: Partial<MemoryCapsuleOwnerScope>
  requireSourceRefs?: boolean
}

export interface MemoryCapsuleValidationResult {
  ok: boolean
  reasonCodes: string[]
}

export interface CapsuleSessionSnapshotProjection {
  sessionId: string
  summary: string
  preservedFacts: string[]
  activeTaskIds: string[]
}

export interface CapsuleTaskContinuityProjection {
  lineageRootRunId: string
  parentRunId?: string
  handoffSummary: string
  lastGoodState: string
  pendingApprovals: string[]
  pendingDelivery: string[]
  status: string
}

function hasOwn<T extends object, K extends PropertyKey>(
  value: T,
  key: K,
): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function normalizeString(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeStringArray(values: string[] = []): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const value of values) {
    const trimmed = normalizeString(value)
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    normalized.push(trimmed)
  }
  return normalized
}

function normalizeArtifactRefs(values: MemoryCapsuleArtifactRef[] = []): MemoryCapsuleArtifactRef[] {
  const normalized: MemoryCapsuleArtifactRef[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const note = normalizeString(value.note)
    if (!note) continue
    const next: MemoryCapsuleArtifactRef = { note }
    const artifactId = normalizeString(value.artifactId)
    const path = normalizeString(value.path)
    const receiptId = normalizeString(value.receiptId)
    if (artifactId) next.artifactId = artifactId
    if (path) next.path = path
    if (receiptId) next.receiptId = receiptId
    const dedupeKey = JSON.stringify(next)
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    normalized.push(next)
  }
  return normalized
}

function collectCapsuleStrings(capsule: MemoryCapsule): string[] {
  const values = [
    capsule.summary,
    capsule.nicknameSnapshot,
    ...capsule.activeObjectives,
    ...capsule.confirmedFacts,
    ...capsule.decisions,
    ...capsule.constraints,
    ...capsule.pendingItems,
    ...capsule.recoveryHints,
    ...capsule.sourceRefs,
    ...capsule.compactedMessageIds,
    ...capsule.artifactRefs.flatMap((item) => [item.note, item.path, item.artifactId, item.receiptId]),
  ]
  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
}

function findForbiddenReasonCodes(capsule: MemoryCapsule): string[] {
  const reasonCodes = new Set<string>()
  for (const value of collectCapsuleStrings(capsule)) {
    for (const entry of MEMORY_CAPSULE_FORBIDDEN_PATTERNS) {
      if (entry.pattern.test(value)) reasonCodes.add(`forbidden_capsule_content:${entry.code}`)
    }
  }
  return [...reasonCodes]
}

export function normalizeMemoryCapsuleOwnerScope(
  scope: MemoryCapsuleOwnerScope,
): MemoryCapsuleOwnerScope {
  const normalized: MemoryCapsuleOwnerScope = {
    ownerType: scope.ownerType,
    ownerId: normalizeString(scope.ownerId) ?? scope.ownerId,
  }
  const sessionId = normalizeString(scope.sessionId)
  const requestGroupId = normalizeString(scope.requestGroupId)
  const lineageId = normalizeString(scope.lineageId)
  const channelKey = normalizeString(scope.channelKey)
  const threadKey = normalizeString(scope.threadKey)
  if (sessionId) normalized.sessionId = sessionId
  if (requestGroupId) normalized.requestGroupId = requestGroupId
  if (lineageId) normalized.lineageId = lineageId
  if (channelKey) normalized.channelKey = channelKey
  if (threadKey) normalized.threadKey = threadKey
  return normalized
}

export function normalizeMemoryCapsule(input: MemoryCapsule): MemoryCapsule {
  const normalized: MemoryCapsule = {
    capsuleId: normalizeString(input.capsuleId) ?? input.capsuleId,
    capsuleVersion: Number.isFinite(input.capsuleVersion) ? Math.max(1, Math.floor(input.capsuleVersion)) : 1,
    ownerScope: normalizeMemoryCapsuleOwnerScope(input.ownerScope),
    capsuleKind: input.capsuleKind,
    summary: normalizeString(input.summary) ?? "",
    activeObjectives: normalizeStringArray(input.activeObjectives),
    confirmedFacts: normalizeStringArray(input.confirmedFacts),
    decisions: normalizeStringArray(input.decisions),
    constraints: normalizeStringArray(input.constraints),
    pendingItems: normalizeStringArray(input.pendingItems),
    artifactRefs: normalizeArtifactRefs(input.artifactRefs),
    recoveryHints: normalizeStringArray(input.recoveryHints),
    sourceRefs: normalizeStringArray(input.sourceRefs),
    compactedMessageIds: normalizeStringArray(input.compactedMessageIds),
    sourceTokenEstimate: Number.isFinite(input.sourceTokenEstimate)
      ? Math.max(0, Math.floor(input.sourceTokenEstimate))
      : 0,
    resultTokenEstimate: Number.isFinite(input.resultTokenEstimate)
      ? Math.max(0, Math.floor(input.resultTokenEstimate))
      : 0,
    createdAt: Number.isFinite(input.createdAt) ? Math.floor(input.createdAt) : Date.now(),
  }
  const parentCapsuleId = normalizeString(input.parentCapsuleId)
  const nicknameSnapshot = normalizeString(input.nicknameSnapshot)
  if (parentCapsuleId) normalized.parentCapsuleId = parentCapsuleId
  if (nicknameSnapshot) normalized.nicknameSnapshot = nicknameSnapshot
  return normalized
}

export function validateMemoryCapsule(
  input: MemoryCapsule,
  options: MemoryCapsuleValidationOptions = {},
): MemoryCapsuleValidationResult {
  const capsule = normalizeMemoryCapsule(input)
  const reasonCodes: string[] = []

  if (!capsule.capsuleId.trim()) reasonCodes.push("capsule_id_missing")
  if (!capsule.ownerScope.ownerId.trim()) reasonCodes.push("owner_id_missing")
  if (!capsule.summary.trim()) reasonCodes.push("summary_missing")
  if ((options.requireSourceRefs ?? true) && capsule.sourceRefs.length === 0)
    reasonCodes.push("source_refs_missing")
  if (capsule.resultTokenEstimate > capsule.sourceTokenEstimate && capsule.sourceTokenEstimate > 0)
    reasonCodes.push("result_token_estimate_exceeds_source")

  const expectedOwnerScope = options.expectedOwnerScope
  if (expectedOwnerScope) {
    for (const key of [
      "ownerType",
      "ownerId",
      "sessionId",
      "requestGroupId",
      "lineageId",
      "channelKey",
      "threadKey",
    ] as const) {
      const expectedValue = expectedOwnerScope[key]
      if (expectedValue === undefined) continue
      if (capsule.ownerScope[key] !== expectedValue) {
        reasonCodes.push(`owner_scope_mismatch:${key}`)
      }
    }
  }

  reasonCodes.push(...findForbiddenReasonCodes(capsule))
  return { ok: reasonCodes.length === 0, reasonCodes }
}

export function applyMemoryCapsuleDeterministicState(
  input: {
    capsule: MemoryCapsule
    deterministicState: MemoryCapsuleDeterministicState
  },
): MemoryCapsule {
  const capsule = normalizeMemoryCapsule(input.capsule)
  const deterministicState = input.deterministicState
  return normalizeMemoryCapsule({
    ...capsule,
    ...(hasOwn(deterministicState, "activeObjectives")
      ? { activeObjectives: deterministicState.activeObjectives ?? [] }
      : {}),
    ...(hasOwn(deterministicState, "confirmedFacts")
      ? { confirmedFacts: deterministicState.confirmedFacts ?? [] }
      : {}),
    ...(hasOwn(deterministicState, "decisions") ? { decisions: deterministicState.decisions ?? [] } : {}),
    ...(hasOwn(deterministicState, "constraints")
      ? { constraints: deterministicState.constraints ?? [] }
      : {}),
    ...(hasOwn(deterministicState, "pendingItems")
      ? { pendingItems: deterministicState.pendingItems ?? [] }
      : {}),
    ...(hasOwn(deterministicState, "artifactRefs")
      ? { artifactRefs: deterministicState.artifactRefs ?? [] }
      : {}),
  })
}

export function buildSessionSnapshotProjectionFromMemoryCapsule(
  input: MemoryCapsule,
): CapsuleSessionSnapshotProjection | undefined {
  const capsule = normalizeMemoryCapsule(input)
  if (!capsule.ownerScope.sessionId) return undefined
  const preservedFacts = normalizeStringArray([
    ...capsule.pendingItems.map((item) => `pending_item:${item}`),
    ...capsule.constraints.map((item) => `constraint:${item}`),
    ...capsule.confirmedFacts.map((item) => `confirmed_fact:${item}`),
  ])
  const activeTaskIds = normalizeStringArray([
    capsule.ownerScope.requestGroupId ?? "",
    capsule.ownerScope.lineageId ?? "",
  ])
  return {
    sessionId: capsule.ownerScope.sessionId,
    summary: capsule.summary,
    preservedFacts,
    activeTaskIds,
  }
}

export function buildTaskContinuityProjectionFromMemoryCapsule(
  input: MemoryCapsule,
): CapsuleTaskContinuityProjection | undefined {
  const capsule = normalizeMemoryCapsule(input)
  if (!capsule.ownerScope.lineageId) return undefined
  const pendingApprovals = capsule.pendingItems
    .filter((item) => item.startsWith("pending_approval:"))
    .map((item) => item.slice("pending_approval:".length))
  const pendingDelivery = capsule.pendingItems
    .filter((item) => item.startsWith("pending_delivery:"))
    .map((item) => item.slice("pending_delivery:".length))
  return {
    lineageRootRunId: capsule.ownerScope.lineageId,
    ...(capsule.ownerScope.requestGroupId ? { parentRunId: capsule.ownerScope.requestGroupId } : {}),
    handoffSummary: capsule.summary,
    lastGoodState: capsule.summary,
    pendingApprovals,
    pendingDelivery,
    status: "capsule_projected",
  }
}
