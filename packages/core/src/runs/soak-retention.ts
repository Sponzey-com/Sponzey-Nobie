import { readdirSync } from "node:fs"
import { sanitizeUserFacingError, type SanitizedErrorKind } from "./error-sanitizer.js"

export type SoakProfileId = "short" | "one_hour" | "eight_hour" | "twenty_four_hour"
export type SoakOperationKind =
  | "model_call"
  | "safe_tool"
  | "approval_tool"
  | "artifact_tool"
  | "memory_write"
  | "memory_read"
  | "schedule_tick"
  | "yeonjang_status"

export interface SoakOperationWeight {
  kind: SoakOperationKind
  weight: number
}

export interface SoakProfile {
  id: SoakProfileId
  title: string
  durationMs: number
  sampleIntervalMs: number
  operationIntervalMs: number
  operationMix: SoakOperationWeight[]
}

export interface SoakChannelHealth {
  name: "webui" | "telegram" | "slack" | "mqtt" | "yeonjang" | string
  healthy: boolean
  connected?: boolean
  queueLength?: number
  lastEventAt?: number
  reason?: string
}

export interface SoakResourceMetrics {
  collectedAt: number
  cpuUserMicros: number
  cpuSystemMicros: number
  rssBytes: number
  heapUsedBytes: number
  heapTotalBytes: number
  externalBytes: number
  arrayBuffersBytes: number
  queueLength: number
  activeRunCount: number
  channelHealth: SoakChannelHealth[]
  openFileDescriptorCount?: number
  mqttConnected?: boolean
}

export interface SoakLatencyStats {
  count: number
  minMs: number
  maxMs: number
  averageMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
}

export type SoakHealthStatus = "healthy" | "degraded"

export interface SoakHealthThresholds {
  runLatencyP95Ms: number
  memoryRetrievalP95Ms: number
  dbQueryP95Ms: number
  eventLoopLagP95Ms: number
  rssBytes: number
  artifactCount: number
  auditRowCount: number
}

export interface SoakHealthInput {
  runLatencyMs?: number[]
  memoryRetrievalLatencyMs?: number[]
  dbQueryLatencyMs?: number[]
  eventLoopLagMs?: number[]
  rssBytes?: number
  artifactCount?: number
  auditRowCount?: number
  thresholds?: Partial<SoakHealthThresholds>
}

export interface SoakHealthSummary {
  status: SoakHealthStatus
  degradedReasons: string[]
  runLatency: SoakLatencyStats
  memoryRetrievalLatency: SoakLatencyStats
  dbQueryLatency: SoakLatencyStats
  eventLoopLag: SoakLatencyStats
  rssBytes?: number
  artifactCount?: number
  auditRowCount?: number
}

export interface SoakReportPayload {
  profileId: SoakProfileId
  startedAt: number
  finishedAt: number
  totalOperations: number
  succeededOperations: number
  failedOperations: number
  metricSampleCount: number
  auditSummary: string
  health: SoakHealthSummary
}

export interface SoakOperationContext {
  profile: SoakProfile
  operation: SoakOperationKind
  iteration: number
  startedAt: number
}

export interface SoakOperationResult {
  ok: boolean
  summary?: string
  errorMessage?: string
}

export interface SoakOperationExecution {
  operation: SoakOperationKind
  iteration: number
  startedAt: number
  completedAt: number
  ok: boolean
  summary?: string
  errorKind?: SanitizedErrorKind
  userMessage?: string
}

export interface SoakRunSummary {
  profile: SoakProfile
  startedAt: number
  finishedAt: number
  requestedStop: boolean
  totalOperations: number
  succeededOperations: number
  failedOperations: number
  operations: SoakOperationExecution[]
  metrics: SoakResourceMetrics[]
  auditSummary: string
  lastSuccess?: SoakOperationExecution
  lastFailure?: SoakOperationExecution
}

export interface SoakRunnerOptions {
  profile: SoakProfileId | SoakProfile
  maxOperations?: number
  waitBetweenOperations?: boolean
  stopOnFailure?: boolean
  now?: () => number
  wait?: (durationMs: number) => Promise<void>
  collectMetrics?: () => SoakResourceMetrics
  shouldStop?: () => boolean
  executeOperation: (operation: SoakOperationKind, context: SoakOperationContext) => Promise<SoakOperationResult>
}

export const DEFAULT_SOAK_PROFILES: Record<SoakProfileId, SoakProfile> = {
  short: {
    id: "short",
    title: "Short development stability check",
    durationMs: 5 * 60 * 1000,
    sampleIntervalMs: 30 * 1000,
    operationIntervalMs: 30 * 1000,
    operationMix: [
      { kind: "safe_tool", weight: 3 },
      { kind: "memory_write", weight: 1 },
      { kind: "memory_read", weight: 1 },
      { kind: "schedule_tick", weight: 1 },
      { kind: "yeonjang_status", weight: 1 },
    ],
  },
  one_hour: {
    id: "one_hour",
    title: "One-hour operational stability check",
    durationMs: 60 * 60 * 1000,
    sampleIntervalMs: 60 * 1000,
    operationIntervalMs: 30 * 1000,
    operationMix: [
      { kind: "model_call", weight: 4 },
      { kind: "safe_tool", weight: 3 },
      { kind: "approval_tool", weight: 1 },
      { kind: "artifact_tool", weight: 1 },
      { kind: "memory_write", weight: 2 },
      { kind: "memory_read", weight: 2 },
      { kind: "schedule_tick", weight: 1 },
      { kind: "yeonjang_status", weight: 1 },
    ],
  },
  eight_hour: {
    id: "eight_hour",
    title: "Eight-hour operational stability check",
    durationMs: 8 * 60 * 60 * 1000,
    sampleIntervalMs: 5 * 60 * 1000,
    operationIntervalMs: 60 * 1000,
    operationMix: [
      { kind: "model_call", weight: 5 },
      { kind: "safe_tool", weight: 4 },
      { kind: "approval_tool", weight: 1 },
      { kind: "artifact_tool", weight: 2 },
      { kind: "memory_write", weight: 3 },
      { kind: "memory_read", weight: 3 },
      { kind: "schedule_tick", weight: 2 },
      { kind: "yeonjang_status", weight: 2 },
    ],
  },
  twenty_four_hour: {
    id: "twenty_four_hour",
    title: "Twenty-four-hour operational stability check",
    durationMs: 24 * 60 * 60 * 1000,
    sampleIntervalMs: 10 * 60 * 1000,
    operationIntervalMs: 2 * 60 * 1000,
    operationMix: [
      { kind: "model_call", weight: 5 },
      { kind: "safe_tool", weight: 4 },
      { kind: "approval_tool", weight: 1 },
      { kind: "artifact_tool", weight: 2 },
      { kind: "memory_write", weight: 3 },
      { kind: "memory_read", weight: 3 },
      { kind: "schedule_tick", weight: 3 },
      { kind: "yeonjang_status", weight: 3 },
    ],
  },
}

export type RetentionDataKind = "audit_log" | "artifact" | "temp_file" | "short_term_memory" | "schedule_history"
export type RetentionCleanupReason = "max_age" | "max_count" | "max_bytes"

export interface RetentionKindPolicy {
  maxAgeMs?: number
  maxCount?: number
  maxBytes?: number
}

export type RetentionPolicy = Record<RetentionDataKind, RetentionKindPolicy>

export interface RetentionItem {
  id: string
  kind: RetentionDataKind
  createdAt: number
  sizeBytes: number
  path?: string
  runId?: string
  active?: boolean
}

export interface RetentionCleanupCandidate extends RetentionItem {
  reasons: RetentionCleanupReason[]
}

export interface RetentionCleanupKindSummary {
  candidateCount: number
  skippedActiveCount: number
  estimatedBytes: number
}

export interface RetentionCleanupPlan {
  dryRun: boolean
  now: number
  candidates: RetentionCleanupCandidate[]
  skippedActive: RetentionItem[]
  estimatedBytes: number
  byKind: Record<RetentionDataKind, RetentionCleanupKindSummary>
  auditSummary: string
}

export interface RetentionCleanupFailure {
  candidate: RetentionCleanupCandidate
  errorKind: SanitizedErrorKind
  userMessage: string
}

export interface RetentionCleanupResult {
  plan: RetentionCleanupPlan
  deleted: RetentionCleanupCandidate[]
  failures: RetentionCleanupFailure[]
  auditRecorded: boolean
}

export interface RetentionCleanupOptions {
  items: RetentionItem[]
  activeRunIds?: Iterable<string>
  policy?: Partial<Record<RetentionDataKind, RetentionKindPolicy>>
  now?: number
  dryRun?: boolean
}

export interface RetentionCleanupApplyOptions extends RetentionCleanupOptions {
  deleteCandidate?: (candidate: RetentionCleanupCandidate) => Promise<void> | void
  recordAudit?: (result: RetentionCleanupResult) => Promise<void> | void
}

export type RetryFailureDomain = "model" | "channel" | "yeonjang" | "tool" | "delivery" | "scheduler"

export interface RetryPolicy {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
}

export interface RetryFailureFingerprintInput {
  domain: RetryFailureDomain
  channel?: string
  provider?: string
  model?: string
  toolName?: string
  targetId?: string
  extensionId?: string
  errorMessage?: string
}

export interface RetryBackoffInput {
  domain?: RetryFailureDomain
  attempt: number
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

export interface RetryBackoffDecision {
  attempt: number
  maxAttempts: number
  shouldRetry: boolean
  exhausted: boolean
  reason: "retry_scheduled" | "retry_exhausted"
  nextDelayMs?: number
}

export interface RepeatedFailureStopDecision {
  fingerprint: string
  seenCount: number
  threshold: number
  shouldStop: boolean
}

const RETENTION_DATA_KINDS: RetentionDataKind[] = [
  "audit_log",
  "artifact",
  "temp_file",
  "short_term_memory",
  "schedule_history",
]

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  audit_log: { maxAgeMs: 90 * 24 * 60 * 60 * 1000, maxCount: 50_000, maxBytes: 256 * 1024 * 1024 },
  artifact: { maxAgeMs: 30 * 24 * 60 * 60 * 1000, maxCount: 10_000, maxBytes: 10 * 1024 * 1024 * 1024 },
  temp_file: { maxAgeMs: 24 * 60 * 60 * 1000, maxCount: 5_000, maxBytes: 1024 * 1024 * 1024 },
  short_term_memory: { maxAgeMs: 7 * 24 * 60 * 60 * 1000, maxCount: 20_000, maxBytes: 512 * 1024 * 1024 },
  schedule_history: { maxAgeMs: 90 * 24 * 60 * 60 * 1000, maxCount: 10_000, maxBytes: 256 * 1024 * 1024 },
}

export const DEFAULT_RETRY_POLICIES: Record<RetryFailureDomain, RetryPolicy> = {
  model: { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 30_000 },
  channel: { maxAttempts: 3, baseDelayMs: 2_000, maxDelayMs: 60_000 },
  yeonjang: { maxAttempts: 6, baseDelayMs: 5_000, maxDelayMs: 60_000 },
  tool: { maxAttempts: 2, baseDelayMs: 1_000, maxDelayMs: 15_000 },
  delivery: { maxAttempts: 3, baseDelayMs: 2_000, maxDelayMs: 60_000 },
  scheduler: { maxAttempts: 3, baseDelayMs: 5_000, maxDelayMs: 120_000 },
}

export const DEFAULT_SOAK_HEALTH_THRESHOLDS: SoakHealthThresholds = {
  runLatencyP95Ms: 15_000,
  memoryRetrievalP95Ms: 2_000,
  dbQueryP95Ms: 500,
  eventLoopLagP95Ms: 250,
  rssBytes: 1536 * 1024 * 1024,
  artifactCount: 10_000,
  auditRowCount: 100_000,
}

export function getSoakProfile(profile: SoakProfileId | SoakProfile): SoakProfile {
  if (typeof profile !== "string") return profile
  return DEFAULT_SOAK_PROFILES[profile]
}

export function expandSoakOperationMix(profile: SoakProfile): SoakOperationKind[] {
  const operations: SoakOperationKind[] = []
  for (const entry of profile.operationMix) {
    const weight = Math.max(0, Math.trunc(entry.weight))
    for (let index = 0; index < weight; index += 1) operations.push(entry.kind)
  }
  return operations.length > 0 ? operations : ["safe_tool"]
}

export function collectSoakResourceMetrics(input: {
  now?: number
  queueLength?: number
  activeRunCount?: number
  mqttConnected?: boolean
  channelHealth?: SoakChannelHealth[]
  openFileDescriptorCount?: number
} = {}): SoakResourceMetrics {
  const cpu = process.cpuUsage()
  const memory = process.memoryUsage()
  const openFileDescriptorCount = input.openFileDescriptorCount ?? countOpenFileDescriptors()
  const metrics: SoakResourceMetrics = {
    collectedAt: input.now ?? Date.now(),
    cpuUserMicros: cpu.user,
    cpuSystemMicros: cpu.system,
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
    queueLength: input.queueLength ?? 0,
    activeRunCount: input.activeRunCount ?? 0,
    channelHealth: input.channelHealth ?? [],
  }
  if (openFileDescriptorCount !== undefined) metrics.openFileDescriptorCount = openFileDescriptorCount
  if (input.mqttConnected !== undefined) metrics.mqttConnected = input.mqttConnected
  return metrics
}

export async function runSoakProfile(options: SoakRunnerOptions): Promise<SoakRunSummary> {
  const profile = getSoakProfile(options.profile)
  const operations = expandSoakOperationMix(profile)
  const now = options.now ?? Date.now
  const wait = options.wait ?? ((durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs)))
  const operationLimit = options.maxOperations ?? Math.max(1, Math.ceil(profile.durationMs / profile.operationIntervalMs))
  const startedAt = now()
  const deadline = startedAt + profile.durationMs
  const metrics: SoakResourceMetrics[] = []
  const executions: SoakOperationExecution[] = []
  let requestedStop = false
  let lastSuccess: SoakOperationExecution | undefined
  let lastFailure: SoakOperationExecution | undefined

  const collectMetrics = options.collectMetrics ?? (() => collectSoakResourceMetrics({ now: now() }))
  metrics.push(collectMetrics())

  for (let iteration = 0; iteration < operationLimit; iteration += 1) {
    if (options.shouldStop?.()) {
      requestedStop = true
      break
    }
    if (iteration > 0 && now() >= deadline) break

    const operation = operations[iteration % operations.length] ?? "safe_tool"
    const operationStartedAt = now()
    const context: SoakOperationContext = { profile, operation, iteration, startedAt: operationStartedAt }
    let execution: SoakOperationExecution
    try {
      const result = await options.executeOperation(operation, context)
      execution = buildSoakExecution(operation, iteration, operationStartedAt, now(), result)
    } catch (error) {
      execution = buildSoakExecution(operation, iteration, operationStartedAt, now(), {
        ok: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      })
    }

    executions.push(execution)
    if (execution.ok) lastSuccess = execution
    else {
      lastFailure = execution
      if (options.stopOnFailure) break
    }
    metrics.push(collectMetrics())

    if (options.waitBetweenOperations !== false && iteration + 1 < operationLimit) {
      await wait(profile.operationIntervalMs)
    }
  }

  const finishedAt = now()
  const summaryInput: Parameters<typeof buildSoakRunSummary>[0] = {
    profile,
    startedAt,
    finishedAt,
    requestedStop,
    operations: executions,
    metrics,
  }
  if (lastSuccess) summaryInput.lastSuccess = lastSuccess
  if (lastFailure) summaryInput.lastFailure = lastFailure
  const summary = buildSoakRunSummary(summaryInput)
  return summary
}

export function calculateSoakLatencyStats(samples: readonly number[]): SoakLatencyStats {
  if (samples.length === 0) {
    return { count: 0, minMs: 0, maxMs: 0, averageMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 }
  }
  const sorted = [...samples].sort((a, b) => a - b)
  const sum = sorted.reduce((total, value) => total + value, 0)
  return {
    count: sorted.length,
    minMs: sorted[0] ?? 0,
    maxMs: sorted.at(-1) ?? 0,
    averageMs: sum / sorted.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    p99Ms: percentile(sorted, 99),
  }
}

export function buildSoakHealthSummary(input: SoakHealthInput): SoakHealthSummary {
  const thresholds = { ...DEFAULT_SOAK_HEALTH_THRESHOLDS, ...input.thresholds }
  const runLatency = calculateSoakLatencyStats(input.runLatencyMs ?? [])
  const memoryRetrievalLatency = calculateSoakLatencyStats(input.memoryRetrievalLatencyMs ?? [])
  const dbQueryLatency = calculateSoakLatencyStats(input.dbQueryLatencyMs ?? [])
  const eventLoopLag = calculateSoakLatencyStats(input.eventLoopLagMs ?? [])
  const degradedReasons: string[] = []

  if (runLatency.p95Ms > thresholds.runLatencyP95Ms) degradedReasons.push("run_latency_p95")
  if (memoryRetrievalLatency.p95Ms > thresholds.memoryRetrievalP95Ms) degradedReasons.push("memory_retrieval_p95")
  if (dbQueryLatency.p95Ms > thresholds.dbQueryP95Ms) degradedReasons.push("db_query_p95")
  if (eventLoopLag.p95Ms > thresholds.eventLoopLagP95Ms) degradedReasons.push("event_loop_lag_p95")
  if (input.rssBytes !== undefined && input.rssBytes > thresholds.rssBytes) degradedReasons.push("rss_bytes")
  if (input.artifactCount !== undefined && input.artifactCount > thresholds.artifactCount) degradedReasons.push("artifact_count")
  if (input.auditRowCount !== undefined && input.auditRowCount > thresholds.auditRowCount) degradedReasons.push("audit_row_count")

  const summary: SoakHealthSummary = {
    status: degradedReasons.length > 0 ? "degraded" : "healthy",
    degradedReasons,
    runLatency,
    memoryRetrievalLatency,
    dbQueryLatency,
    eventLoopLag,
  }
  if (input.rssBytes !== undefined) summary.rssBytes = input.rssBytes
  if (input.artifactCount !== undefined) summary.artifactCount = input.artifactCount
  if (input.auditRowCount !== undefined) summary.auditRowCount = input.auditRowCount
  return summary
}

export function buildSoakReportPayload(summary: SoakRunSummary, health: SoakHealthSummary): SoakReportPayload {
  return {
    profileId: summary.profile.id,
    startedAt: summary.startedAt,
    finishedAt: summary.finishedAt,
    totalOperations: summary.totalOperations,
    succeededOperations: summary.succeededOperations,
    failedOperations: summary.failedOperations,
    metricSampleCount: summary.metrics.length,
    auditSummary: summary.auditSummary,
    health,
  }
}

export function buildSoakReportArtifact(summary: SoakRunSummary, health: SoakHealthSummary): string {
  return JSON.stringify(buildSoakReportPayload(summary, health), null, 2)
}

export function buildRetentionCleanupPlan(options: RetentionCleanupOptions): RetentionCleanupPlan {
  const now = options.now ?? Date.now()
  const dryRun = options.dryRun ?? true
  const activeRunIds = new Set(options.activeRunIds ?? [])
  const policy = mergeRetentionPolicy(options.policy)
  const candidateById = new Map<string, RetentionCleanupCandidate>()
  const skippedActive: RetentionItem[] = []

  for (const item of options.items) {
    if (isActiveRetentionItem(item, activeRunIds)) skippedActive.push(item)
  }

  for (const kind of RETENTION_DATA_KINDS) {
    const items = options.items.filter((item) => item.kind === kind && !isActiveRetentionItem(item, activeRunIds))
    const limits = policy[kind]

    if (limits.maxAgeMs !== undefined && limits.maxAgeMs >= 0) {
      const cutoff = now - limits.maxAgeMs
      for (const item of items) {
        if (item.createdAt <= cutoff) markRetentionCandidate(candidateById, item, "max_age")
      }
    }

    if (limits.maxCount !== undefined && limits.maxCount >= 0) {
      const byNewest = [...items].sort(compareRetentionNewestFirst)
      for (const item of byNewest.slice(limits.maxCount)) markRetentionCandidate(candidateById, item, "max_count")
    }

    if (limits.maxBytes !== undefined && limits.maxBytes >= 0) {
      const byNewest = [...items].sort(compareRetentionNewestFirst)
      let totalBytes = 0
      for (const item of byNewest) {
        totalBytes += item.sizeBytes
        if (totalBytes > limits.maxBytes) markRetentionCandidate(candidateById, item, "max_bytes")
      }
    }
  }

  const candidates = [...candidateById.values()].sort(compareRetentionOldestFirst)
  const byKind = buildRetentionKindSummary(candidates, skippedActive)
  const estimatedBytes = candidates.reduce((sum, candidate) => sum + candidate.sizeBytes, 0)
  return {
    dryRun,
    now,
    candidates,
    skippedActive,
    estimatedBytes,
    byKind,
    auditSummary: formatRetentionAuditSummary({ dryRun, candidates, skippedActive, estimatedBytes }),
  }
}

export async function runRetentionCleanup(options: RetentionCleanupApplyOptions): Promise<RetentionCleanupResult> {
  const plan = buildRetentionCleanupPlan(options)
  const deleted: RetentionCleanupCandidate[] = []
  const failures: RetentionCleanupFailure[] = []

  if (!plan.dryRun) {
    for (const candidate of plan.candidates) {
      try {
        if (!options.deleteCandidate) throw new Error("retention cleanup delete handler is not configured")
        await options.deleteCandidate(candidate)
        deleted.push(candidate)
      } catch (error) {
        const sanitized = sanitizeUserFacingError(error instanceof Error ? error.message : String(error))
        failures.push({ candidate, errorKind: sanitized.kind, userMessage: sanitized.userMessage })
      }
    }
  }

  const result: RetentionCleanupResult = { plan, deleted, failures, auditRecorded: false }
  if (options.recordAudit) {
    await options.recordAudit(result)
    result.auditRecorded = true
  }
  return result
}

export function buildRetryFailureFingerprint(input: RetryFailureFingerprintInput): string {
  const sanitized = sanitizeUserFacingError(input.errorMessage)
  const parts = [
    ["domain", input.domain],
    ["kind", sanitized.kind],
    ["channel", input.channel],
    ["provider", input.provider],
    ["model", input.model],
    ["tool", input.toolName],
    ["target", input.targetId],
    ["extension", input.extensionId],
  ] as const
  return parts
    .filter(([, value]) => value !== undefined && value.trim().length > 0)
    .map(([key, value]) => `${key}=${normalizeFingerprintComponent(value ?? "unknown")}`)
    .join("|")
}

export function evaluateRetryBackoff(input: RetryBackoffInput): RetryBackoffDecision {
  const defaultPolicy = input.domain ? DEFAULT_RETRY_POLICIES[input.domain] : DEFAULT_RETRY_POLICIES.tool
  const attempt = Math.max(1, Math.trunc(input.attempt))
  const maxAttempts = Math.max(1, Math.trunc(input.maxAttempts ?? defaultPolicy.maxAttempts))
  const baseDelayMs = Math.max(0, input.baseDelayMs ?? defaultPolicy.baseDelayMs)
  const maxDelayMs = Math.max(baseDelayMs, input.maxDelayMs ?? defaultPolicy.maxDelayMs)
  const exhausted = attempt >= maxAttempts
  const decision: RetryBackoffDecision = {
    attempt,
    maxAttempts,
    shouldRetry: !exhausted,
    exhausted,
    reason: exhausted ? "retry_exhausted" : "retry_scheduled",
  }
  if (!exhausted) decision.nextDelayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))
  return decision
}

export function shouldStopRepeatedFailure(input: {
  fingerprint: string
  seenCount: number
  threshold: number
}): RepeatedFailureStopDecision {
  const threshold = Math.max(1, Math.trunc(input.threshold))
  const seenCount = Math.max(0, Math.trunc(input.seenCount))
  return {
    fingerprint: input.fingerprint,
    seenCount,
    threshold,
    shouldStop: seenCount >= threshold,
  }
}

function buildSoakExecution(
  operation: SoakOperationKind,
  iteration: number,
  startedAt: number,
  completedAt: number,
  result: SoakOperationResult,
): SoakOperationExecution {
  const execution: SoakOperationExecution = {
    operation,
    iteration,
    startedAt,
    completedAt,
    ok: result.ok,
  }
  if (result.summary) execution.summary = result.summary
  if (!result.ok) {
    const sanitized = sanitizeUserFacingError(result.errorMessage)
    execution.errorKind = sanitized.kind
    execution.userMessage = sanitized.userMessage
    if (!execution.summary) execution.summary = sanitized.reason
  }
  return execution
}

function buildSoakRunSummary(input: {
  profile: SoakProfile
  startedAt: number
  finishedAt: number
  requestedStop: boolean
  operations: SoakOperationExecution[]
  metrics: SoakResourceMetrics[]
  lastSuccess?: SoakOperationExecution
  lastFailure?: SoakOperationExecution
}): SoakRunSummary {
  const succeededOperations = input.operations.filter((operation) => operation.ok).length
  const failedOperations = input.operations.length - succeededOperations
  const summary: SoakRunSummary = {
    profile: input.profile,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    requestedStop: input.requestedStop,
    totalOperations: input.operations.length,
    succeededOperations,
    failedOperations,
    operations: input.operations,
    metrics: input.metrics,
    auditSummary: `soak:${input.profile.id} operations=${input.operations.length} success=${succeededOperations} failed=${failedOperations}`,
  }
  if (input.lastSuccess) summary.lastSuccess = input.lastSuccess
  if (input.lastFailure) summary.lastFailure = input.lastFailure
  return summary
}

function countOpenFileDescriptors(): number | undefined {
  try {
    return readdirSync("/proc/self/fd").length
  } catch {
    return undefined
  }
}

function percentile(sortedAscending: readonly number[], percentileRank: number): number {
  if (sortedAscending.length === 0) return 0
  const boundedRank = Math.min(100, Math.max(0, percentileRank))
  const index = Math.max(0, Math.ceil((boundedRank / 100) * sortedAscending.length) - 1)
  return sortedAscending[index] ?? 0
}

function mergeRetentionPolicy(policy?: Partial<Record<RetentionDataKind, RetentionKindPolicy>>): RetentionPolicy {
  return {
    audit_log: { ...DEFAULT_RETENTION_POLICY.audit_log, ...policy?.audit_log },
    artifact: { ...DEFAULT_RETENTION_POLICY.artifact, ...policy?.artifact },
    temp_file: { ...DEFAULT_RETENTION_POLICY.temp_file, ...policy?.temp_file },
    short_term_memory: { ...DEFAULT_RETENTION_POLICY.short_term_memory, ...policy?.short_term_memory },
    schedule_history: { ...DEFAULT_RETENTION_POLICY.schedule_history, ...policy?.schedule_history },
  }
}

function isActiveRetentionItem(item: RetentionItem, activeRunIds: Set<string>): boolean {
  return item.active === true || (item.runId !== undefined && activeRunIds.has(item.runId))
}

function markRetentionCandidate(
  candidateById: Map<string, RetentionCleanupCandidate>,
  item: RetentionItem,
  reason: RetentionCleanupReason,
): void {
  const existing = candidateById.get(item.id)
  if (existing) {
    if (!existing.reasons.includes(reason)) existing.reasons.push(reason)
    return
  }
  candidateById.set(item.id, { ...item, reasons: [reason] })
}

function compareRetentionNewestFirst(a: RetentionItem, b: RetentionItem): number {
  return b.createdAt - a.createdAt || a.id.localeCompare(b.id)
}

function compareRetentionOldestFirst(a: RetentionItem, b: RetentionItem): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id)
}

function buildRetentionKindSummary(
  candidates: RetentionCleanupCandidate[],
  skippedActive: RetentionItem[],
): Record<RetentionDataKind, RetentionCleanupKindSummary> {
  const summary = Object.fromEntries(
    RETENTION_DATA_KINDS.map((kind) => [kind, { candidateCount: 0, skippedActiveCount: 0, estimatedBytes: 0 }]),
  ) as Record<RetentionDataKind, RetentionCleanupKindSummary>

  for (const candidate of candidates) {
    const entry = summary[candidate.kind]
    entry.candidateCount += 1
    entry.estimatedBytes += candidate.sizeBytes
  }
  for (const item of skippedActive) summary[item.kind].skippedActiveCount += 1
  return summary
}

function formatRetentionAuditSummary(input: {
  dryRun: boolean
  candidates: RetentionCleanupCandidate[]
  skippedActive: RetentionItem[]
  estimatedBytes: number
}): string {
  return `retention:${input.dryRun ? "dry-run" : "apply"} candidates=${input.candidates.length} bytes=${input.estimatedBytes} skipped_active=${input.skippedActive.length}`
}

function normalizeFingerprintComponent(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "unknown"
}
