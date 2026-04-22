import { randomUUID } from "node:crypto"
import { CONTRACT_SCHEMA_VERSION, type JsonValue } from "../contracts/index.js"
import type {
  AgentPromptBundle,
  CommandRequest,
  ErrorReport,
  FeedbackRequest,
  ParallelSubSessionGroup,
  ProgressEvent,
  ResourceLockContract,
  ResultReport,
  RuntimeIdentity,
  SubSessionContract,
  SubSessionStatus,
} from "../contracts/sub-agent-orchestration.js"
import {
  getRunSubSessionByIdempotencyKey,
  insertRunSubSession,
  updateRunSubSession,
} from "../db/index.js"
import { appendRunEvent, getRootRun } from "../runs/store.js"
import {
  recordMessageLedgerEvent,
  type MessageLedgerEventInput,
} from "../runs/message-ledger.js"
import {
  reviewSubAgentResult,
  type SubAgentResultReview,
  type SubAgentRetryClass,
} from "../agent/sub-agent-result-review.js"
import {
  createSubSessionProgressAggregator,
  type SubSessionProgressAggregationBatch,
  type SubSessionProgressAggregator,
} from "./sub-session-progress-aggregation.js"
import { recordLatencyMetric } from "../observability/latency.js"

export interface SubSessionRuntimeAgentSnapshot {
  agentId: string
  displayName: string
  nickname?: string
}

export interface RunSubSessionInput {
  command: CommandRequest
  agent: SubSessionRuntimeAgentSnapshot
  parentSessionId: string
  promptBundle: AgentPromptBundle
  timeoutMs?: number
  parentAbortSignal?: AbortSignal
}

export interface SubSessionExecutionControls {
  signal: AbortSignal
  emitProgress: (summary: string, status?: SubSessionStatus) => Promise<ProgressEvent>
}

export type SubSessionExecutionHandler = (
  input: RunSubSessionInput,
  controls: SubSessionExecutionControls,
) => Promise<ResultReport> | ResultReport

export interface SubSessionRunOutcome {
  subSession: SubSessionContract
  status: SubSessionStatus
  replayed: boolean
  resultReport?: ResultReport
  errorReport?: ErrorReport
  review?: SubAgentResultReview
  feedbackRequest?: FeedbackRequest
}

export interface SubSessionRuntimeDependencies {
  now?: () => number
  idProvider?: () => string
  loadSubSessionByIdempotencyKey?: (idempotencyKey: string) => Promise<SubSessionContract | undefined> | SubSessionContract | undefined
  persistSubSession?: (subSession: SubSessionContract) => Promise<boolean> | boolean
  updateSubSession?: (subSession: SubSessionContract) => Promise<void> | void
  appendParentEvent?: (parentRunId: string, label: string) => Promise<void> | void
  isParentCancelled?: (parentRunId: string) => Promise<boolean> | boolean
  deliverResultToUser?: (result: ResultReport) => Promise<void> | void
  progressAggregator?: SubSessionProgressAggregator
  recordLedgerEvent?: (input: MessageLedgerEventInput) => string | null
  reviewResultReport?: (params: {
    input: RunSubSessionInput
    resultReport: ResultReport
    subSession: SubSessionContract
  }) => Promise<SubAgentResultReview> | SubAgentResultReview
}

export interface SubSessionWorkItem {
  taskId: string
  subSessionId: string
  resourceLocks?: ResourceLockContract[]
  dependencies?: string[]
  run: () => Promise<SubSessionRunOutcome> | SubSessionRunOutcome
}

export interface SubSessionExecutionWave {
  waveIndex: number
  items: SubSessionWorkItem[]
  reasonCodes: string[]
  waitReasonCodesByTask?: Record<string, string[]>
}

export interface ParallelSubSessionGroupRunResult {
  groupId: string
  status: "completed" | "failed" | "blocked"
  waves: Array<{ waveIndex: number; taskIds: string[]; subSessionIds: string[]; reasonCodes: string[] }>
  outcomes: SubSessionRunOutcome[]
  skipped: Array<{ taskId: string; subSessionId: string; reasonCode: string }>
}

export interface ParallelSubSessionGroupRunOptions {
  now?: () => number
  runId?: string
  sessionId?: string
  requestGroupId?: string
  source?: string
  appendParentEvent?: (parentRunId: string, label: string) => Promise<void> | void
}

export interface SubSessionRecoveryDecision {
  subSessionId: string
  previousStatus: SubSessionStatus
  nextStatus: SubSessionStatus
  action: "unchanged" | "mark_failed"
  reasonCode: string
}

export interface SubSessionRecoveryResult {
  decisions: SubSessionRecoveryDecision[]
  updatedSubSessions: SubSessionContract[]
}

const ACTIVE_RECOVERY_STATUSES = new Set<SubSessionStatus>([
  "created",
  "queued",
  "running",
  "waiting_for_input",
  "awaiting_approval",
])

const REPLAY_STATUSES = new Set<SubSessionStatus>([
  "completed",
  "needs_revision",
  "failed",
  "cancelled",
])

function isReplayableStatus(status: SubSessionStatus): boolean {
  return REPLAY_STATUSES.has(status)
}

function isAbortLike(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const record = error as Record<string, unknown>
  return record["name"] === "AbortError" || record["code"] === "ABORT_ERR"
}

function asErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : "sub-session execution failed"
}

function parseStoredSubSession(value: string): SubSessionContract | undefined {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" ? parsed as SubSessionContract : undefined
  } catch {
    return undefined
  }
}

function defaultIdProvider(): string {
  return randomUUID()
}

function buildProgressEvent(input: {
  idProvider: () => string
  now: number
  command: CommandRequest
  status: SubSessionStatus
  summary: string
}): ProgressEvent {
  return {
    identity: {
      ...input.command.identity,
      entityType: "sub_session",
      entityId: input.command.subSessionId,
      idempotencyKey: `sub-session-progress:${input.command.subSessionId}:${input.idProvider()}`,
      parent: {
        ...input.command.identity.parent,
        parentRunId: input.command.parentRunId,
      },
    },
    eventId: input.idProvider(),
    parentRunId: input.command.parentRunId,
    subSessionId: input.command.subSessionId,
    status: input.status,
    summary: input.summary,
    at: input.now,
  }
}

function buildErrorReport(input: {
  idProvider: () => string
  command: CommandRequest
  reasonCode: string
  safeMessage: string
  retryable: boolean
}): ErrorReport {
  return {
    identity: {
      ...input.command.identity,
      entityType: "sub_session",
      entityId: input.command.subSessionId,
      idempotencyKey: `sub-session-error:${input.command.subSessionId}:${input.reasonCode}:${input.idProvider()}`,
      parent: {
        ...input.command.identity.parent,
        parentRunId: input.command.parentRunId,
      },
    },
    errorReportId: input.idProvider(),
    parentRunId: input.command.parentRunId,
    subSessionId: input.command.subSessionId,
    reasonCode: input.reasonCode,
    safeMessage: input.safeMessage,
    retryable: input.retryable,
  }
}

export function buildSubSessionContract(input: RunSubSessionInput): SubSessionContract {
  const identity: RuntimeIdentity = {
    ...input.command.identity,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType: "sub_session",
    entityId: input.command.subSessionId,
    owner: { ownerType: "sub_agent", ownerId: input.command.targetAgentId },
    idempotencyKey: input.command.identity.idempotencyKey || `sub-session:${input.command.parentRunId}:${input.command.subSessionId}`,
    parent: {
      ...input.command.identity.parent,
      parentRunId: input.command.parentRunId,
      parentSessionId: input.parentSessionId,
    },
  }

  return {
    identity,
    subSessionId: input.command.subSessionId,
    parentSessionId: input.parentSessionId,
    parentRunId: input.command.parentRunId,
    agentId: input.agent.agentId,
    agentDisplayName: input.agent.displayName,
    ...(input.agent.nickname ? { agentNickname: input.agent.nickname } : {}),
    commandRequestId: input.command.commandRequestId,
    status: "created",
    retryBudgetRemaining: input.command.retryBudget,
    promptBundleId: input.promptBundle.bundleId,
    promptBundleSnapshot: input.promptBundle,
  }
}

export class ResourceLockManager {
  private readonly holders = new Map<string, Array<{ holderId: string; lock: ResourceLockContract }>>()

  canAcquire(locks: ResourceLockContract[]): { ok: boolean; conflicts: ResourceLockContract[] } {
    const conflicts: ResourceLockContract[] = []
    for (const lock of locks) {
      const existing = this.holders.get(this.lockKey(lock)) ?? []
      for (const holder of existing) {
        if (holder.lock.mode === "exclusive" || lock.mode === "exclusive") {
          conflicts.push(holder.lock)
        }
      }
    }
    return { ok: conflicts.length === 0, conflicts }
  }

  acquire(holderId: string, locks: ResourceLockContract[]): { ok: boolean; conflicts: ResourceLockContract[] } {
    const check = this.canAcquire(locks)
    if (!check.ok) return check
    for (const lock of locks) {
      const key = this.lockKey(lock)
      const existing = this.holders.get(key) ?? []
      existing.push({ holderId, lock })
      this.holders.set(key, existing)
    }
    return check
  }

  release(holderId: string): void {
    for (const [key, holders] of this.holders.entries()) {
      const remaining = holders.filter((holder) => holder.holderId !== holderId)
      if (remaining.length === 0) this.holders.delete(key)
      else this.holders.set(key, remaining)
    }
  }

  private lockKey(lock: ResourceLockContract): string {
    return `${lock.kind}:${lock.target}`
  }
}

export function planSubSessionExecutionWaves(
  items: SubSessionWorkItem[],
  group?: Pick<ParallelSubSessionGroup, "dependencyEdges" | "concurrencyLimit">,
): SubSessionExecutionWave[] {
  const byTaskId = new Map(items.map((item) => [item.taskId, item]))
  const pending = new Set(items.map((item) => item.taskId))
  const completed = new Set<string>()
  const dependencyMap = new Map<string, Set<string>>()
  const deferredReasonCodesByTask = new Map<string, Set<string>>()
  const limit = Math.max(1, group?.concurrencyLimit ?? items.length)

  for (const item of items) {
    dependencyMap.set(item.taskId, new Set(item.dependencies ?? []))
  }
  for (const edge of group?.dependencyEdges ?? []) {
    const deps = dependencyMap.get(edge.toTaskId) ?? new Set<string>()
    deps.add(edge.fromTaskId)
    dependencyMap.set(edge.toTaskId, deps)
  }

  const waves: SubSessionExecutionWave[] = []
  while (pending.size > 0) {
    const waveLocks = new ResourceLockManager()
    const waveItems: SubSessionWorkItem[] = []
    const candidates = [...pending]
      .map((taskId) => byTaskId.get(taskId))
      .filter((item): item is SubSessionWorkItem => Boolean(item))
      .filter((item) => {
        const deps = dependencyMap.get(item.taskId) ?? new Set<string>()
        return [...deps].every((dep) => completed.has(dep))
      })

    for (const item of candidates) {
      if (waveItems.length >= limit) {
        rememberDeferredReason(deferredReasonCodesByTask, item.taskId, "concurrency_limit")
        continue
      }
      const locks = item.resourceLocks ?? []
      const acquired = waveLocks.acquire(item.taskId, locks)
      if (!acquired.ok) {
        rememberDeferredReason(deferredReasonCodesByTask, item.taskId, "resource_lock")
        continue
      }
      waveItems.push(item)
    }

    if (waveItems.length === 0) {
      const fallback = [...pending]
        .map((taskId) => byTaskId.get(taskId))
        .find((item): item is SubSessionWorkItem => Boolean(item))
      if (!fallback) break
      waveItems.push(fallback)
    }

    const reasonCodes = waveItems.length > 1 ? ["parallel_sub_sessions"] : ["sequential_or_blocked_sub_session"]
    const waitReasonCodesByTask: Record<string, string[]> = {}
    for (const item of waveItems) {
      const waitReasonCodes = deferredReasonCodesByTask.get(item.taskId)
      if (waitReasonCodes && waitReasonCodes.size > 0) {
        waitReasonCodesByTask[item.taskId] = [...waitReasonCodes]
      }
    }
    waves.push({
      waveIndex: waves.length,
      items: waveItems,
      reasonCodes,
      ...(Object.keys(waitReasonCodesByTask).length > 0 ? { waitReasonCodesByTask } : {}),
    })
    for (const item of waveItems) {
      pending.delete(item.taskId)
      completed.add(item.taskId)
      deferredReasonCodesByTask.delete(item.taskId)
    }
  }

  return waves
}

function rememberDeferredReason(
  map: Map<string, Set<string>>,
  taskId: string,
  reasonCode: string,
): void {
  const existing = map.get(taskId) ?? new Set<string>()
  existing.add(reasonCode)
  map.set(taskId, existing)
}

function buildDeferredWaveSummary(
  groupId: string,
  waves: SubSessionExecutionWave[],
): string | null {
  const waitingEntries: string[] = []
  for (const wave of waves) {
    for (const item of wave.items) {
      const waitReasonCodes = wave.waitReasonCodesByTask?.[item.taskId]
      if (!waitReasonCodes || waitReasonCodes.length === 0) continue
      waitingEntries.push(`${item.taskId}(${waitReasonCodes.join("+")})`)
    }
  }
  if (waitingEntries.length === 0) return null
  return `sub_session_waiting:${groupId}:${waitingEntries.join(", ")}`
}

export class SubSessionRunner {
  private readonly now: () => number
  private readonly idProvider: () => string
  private readonly dependencies: Required<Omit<SubSessionRuntimeDependencies, "deliverResultToUser" | "reviewResultReport">>
  private readonly customReviewResultReport: NonNullable<SubSessionRuntimeDependencies["reviewResultReport"]> | undefined
  private readonly progressAggregator: SubSessionProgressAggregator
  private readonly recordLedgerEvent: (input: MessageLedgerEventInput) => string | null
  private readonly activeControllers = new Map<string, { parentRunId: string; controller: AbortController }>()
  private readonly firstProgressRecorded = new Set<string>()

  constructor(dependencies: SubSessionRuntimeDependencies = {}) {
    this.now = dependencies.now ?? (() => Date.now())
    this.idProvider = dependencies.idProvider ?? defaultIdProvider
    this.dependencies = {
      now: this.now,
      idProvider: this.idProvider,
      loadSubSessionByIdempotencyKey: dependencies.loadSubSessionByIdempotencyKey ?? defaultLoadSubSessionByIdempotencyKey,
      persistSubSession: dependencies.persistSubSession ?? defaultPersistSubSession,
      updateSubSession: dependencies.updateSubSession ?? defaultUpdateSubSession,
      appendParentEvent: dependencies.appendParentEvent ?? defaultAppendParentEvent,
      isParentCancelled: dependencies.isParentCancelled ?? defaultIsParentCancelled,
      progressAggregator: dependencies.progressAggregator ?? createSubSessionProgressAggregator({ now: this.now }),
      recordLedgerEvent: dependencies.recordLedgerEvent ?? recordMessageLedgerEvent,
    }
    this.customReviewResultReport = dependencies.reviewResultReport
    this.progressAggregator = this.dependencies.progressAggregator
    this.recordLedgerEvent = this.dependencies.recordLedgerEvent
  }

  async runSubSession(input: RunSubSessionInput, handler: SubSessionExecutionHandler): Promise<SubSessionRunOutcome> {
    const queuedAt = this.now()
    const subSession = buildSubSessionContract(input)
    const existing = await this.dependencies.loadSubSessionByIdempotencyKey(subSession.identity.idempotencyKey)
    if (existing && isReplayableStatus(existing.status)) {
      await this.dependencies.appendParentEvent(existing.parentRunId, `sub_session_replay:${existing.subSessionId}:${existing.status}`)
      return { subSession: existing, status: existing.status, replayed: true }
    }

    const inserted = await this.dependencies.persistSubSession(subSession)
    if (!inserted) {
      const replayed = await this.dependencies.loadSubSessionByIdempotencyKey(subSession.identity.idempotencyKey)
      if (replayed) {
        await this.dependencies.appendParentEvent(replayed.parentRunId, `sub_session_replay:${replayed.subSessionId}:${replayed.status}`)
        return { subSession: replayed, status: replayed.status, replayed: true }
      }
    }
    await this.dependencies.appendParentEvent(subSession.parentRunId, `sub_session_created:${subSession.subSessionId}`)
    this.recordSubSessionLifecycleEvent(subSession, "sub_session_created", "started", "서브 세션을 생성했습니다.")

    if (input.parentAbortSignal?.aborted || await this.dependencies.isParentCancelled(subSession.parentRunId)) {
      return this.cancelBeforeStart(input, subSession)
    }

    const controller = new AbortController()
    const parentAbortHandler = () => controller.abort()
    input.parentAbortSignal?.addEventListener("abort", parentAbortHandler, { once: true })
    this.activeControllers.set(subSession.subSessionId, { parentRunId: subSession.parentRunId, controller })
    let timeout: NodeJS.Timeout | undefined

    try {
      recordLatencyMetric({
        name: "sub_session_queue_wait_ms",
        durationMs: Math.max(0, this.now() - queuedAt),
        runId: subSession.parentRunId,
        sessionId: subSession.parentSessionId,
        detail: {
          subSessionId: subSession.subSessionId,
          agentId: subSession.agentId,
        },
      })
      await this.changeStatus(subSession, "running")
      const result = await this.runWithTimeout(
        () => handler(input, {
          signal: controller.signal,
          emitProgress: async (summary, status = subSession.status) => {
            const progress = buildProgressEvent({
              idProvider: this.idProvider,
              now: this.now(),
              command: input.command,
              status,
              summary,
            })
            await this.dependencies.appendParentEvent(subSession.parentRunId, `sub_session_progress:${subSession.subSessionId}:${summary}`)
            await this.recordSubSessionProgress(subSession, progress)
            return progress
          },
        }),
        controller,
        input.timeoutMs,
        (timer) => {
          timeout = timer
        },
      )

      if (controller.signal.aborted) {
        const outcome = await this.markCancelled(input, subSession, "sub_session_cancelled")
        return outcome
      }

      const finalizationStartedAt = this.now()
      const review = await this.reviewResultReport(input, result, subSession)
      const terminalStatus = review.status
      if (terminalStatus === "failed") {
        subSession.retryBudgetRemaining = Math.max(0, subSession.retryBudgetRemaining - 1)
      } else if (terminalStatus === "needs_revision") {
        subSession.retryBudgetRemaining = Math.max(0, review.feedbackRequest?.retryBudgetRemaining ?? subSession.retryBudgetRemaining - 1)
      }
      await this.changeStatus(subSession, terminalStatus)
      await this.flushProgressBatch(subSession.parentRunId, "terminal_flush")
      recordLatencyMetric({
        name: "finalization_latency_ms",
        durationMs: Math.max(0, this.now() - finalizationStartedAt),
        runId: subSession.parentRunId,
        sessionId: subSession.parentSessionId,
        detail: {
          subSessionId: subSession.subSessionId,
          reviewStatus: review.status,
        },
      })
      await this.dependencies.appendParentEvent(subSession.parentRunId, `sub_session_result:${subSession.subSessionId}:${terminalStatus}`)
      this.recordSubSessionLifecycleEvent(
        subSession,
        terminalStatus === "failed" ? "sub_session_failed" : "sub_session_completed",
        terminalStatus === "failed" ? "failed" : "succeeded",
        `서브 세션 결과를 parent review로 회수했습니다: ${terminalStatus}`,
        { resultReportId: result.resultReportId, reviewStatus: review.status },
      )
      this.recordSubSessionLifecycleEvent(
        subSession,
        "sub_session_result_suppressed",
        "suppressed",
        "서브 세션 결과 직접 전달을 차단하고 parent final answer 합성 대상으로 보관했습니다.",
        { resultReportId: result.resultReportId, reviewStatus: review.status },
      )
      if (review.feedbackRequest) {
        await this.dependencies.appendParentEvent(subSession.parentRunId, `sub_session_feedback_requested:${subSession.subSessionId}:${review.normalizedFailureKey ?? "unknown"}`)
      }
      return {
        subSession,
        status: subSession.status,
        resultReport: result,
        review,
        ...(review.feedbackRequest ? { feedbackRequest: review.feedbackRequest } : {}),
        replayed: false,
      }
    } catch (error) {
      if (controller.signal.aborted || isAbortLike(error)) {
        return this.markCancelled(input, subSession, "sub_session_cancelled")
      }
      subSession.retryBudgetRemaining = Math.max(0, subSession.retryBudgetRemaining - 1)
      const errorReport = buildErrorReport({
        idProvider: this.idProvider,
        command: input.command,
        reasonCode: error instanceof SubSessionTimeoutError ? "sub_session_timeout" : "sub_session_handler_error",
        safeMessage: asErrorMessage(error),
        retryable: subSession.retryBudgetRemaining > 0,
      })
      await this.changeStatus(subSession, "failed")
      await this.flushProgressBatch(subSession.parentRunId, "terminal_flush")
      await this.dependencies.appendParentEvent(subSession.parentRunId, `sub_session_failed:${subSession.subSessionId}:${errorReport.reasonCode}`)
      this.recordSubSessionLifecycleEvent(subSession, "sub_session_failed", "failed", errorReport.safeMessage, {
        reasonCode: errorReport.reasonCode,
        retryable: errorReport.retryable,
      })
      return { subSession, status: "failed", errorReport, replayed: false }
    } finally {
      if (timeout) clearTimeout(timeout)
      input.parentAbortSignal?.removeEventListener("abort", parentAbortHandler)
      this.activeControllers.delete(subSession.subSessionId)
    }
  }

  cancelParentRun(parentRunId: string): number {
    let cancelled = 0
    for (const entry of this.activeControllers.values()) {
      if (entry.parentRunId !== parentRunId) continue
      entry.controller.abort()
      cancelled += 1
    }
    return cancelled
  }

  private async cancelBeforeStart(input: RunSubSessionInput, subSession: SubSessionContract): Promise<SubSessionRunOutcome> {
    const errorReport = buildErrorReport({
      idProvider: this.idProvider,
      command: input.command,
      reasonCode: "parent_run_cancelled",
      safeMessage: "Parent run was cancelled before the sub-session started.",
      retryable: false,
    })
    await this.changeStatus(subSession, "cancelled")
    await this.flushProgressBatch(subSession.parentRunId, "terminal_flush")
    await this.dependencies.appendParentEvent(subSession.parentRunId, `sub_session_cancelled:${subSession.subSessionId}`)
    this.recordSubSessionLifecycleEvent(subSession, "sub_session_failed", "degraded", errorReport.safeMessage, {
      reasonCode: errorReport.reasonCode,
    })
    return { subSession, status: "cancelled", errorReport, replayed: false }
  }

  private async markCancelled(
    input: RunSubSessionInput,
    subSession: SubSessionContract,
    reasonCode: string,
  ): Promise<SubSessionRunOutcome> {
    const errorReport = buildErrorReport({
      idProvider: this.idProvider,
      command: input.command,
      reasonCode,
      safeMessage: "Sub-session execution was cancelled.",
      retryable: false,
    })
    await this.changeStatus(subSession, "cancelled")
    await this.flushProgressBatch(subSession.parentRunId, "terminal_flush")
    await this.dependencies.appendParentEvent(subSession.parentRunId, `sub_session_cancelled:${subSession.subSessionId}`)
    this.recordSubSessionLifecycleEvent(subSession, "sub_session_failed", "degraded", errorReport.safeMessage, {
      reasonCode,
    })
    return { subSession, status: "cancelled", errorReport, replayed: false }
  }

  private async recordSubSessionProgress(
    subSession: SubSessionContract,
    progress: ProgressEvent,
  ): Promise<void> {
    if (!this.firstProgressRecorded.has(subSession.subSessionId)) {
      this.firstProgressRecorded.add(subSession.subSessionId)
      recordLatencyMetric({
        name: "first_progress_latency_ms",
        durationMs: Math.max(0, progress.at - (subSession.startedAt ?? progress.at)),
        runId: subSession.parentRunId,
        sessionId: subSession.parentSessionId,
        detail: {
          subSessionId: subSession.subSessionId,
          agentId: subSession.agentId,
        },
      })
    }
    const batch = this.progressAggregator.push({
      parentRunId: subSession.parentRunId,
      subSessionId: subSession.subSessionId,
      agentId: subSession.agentId,
      agentDisplayName: subSession.agentDisplayName,
      status: progress.status,
      summary: progress.summary,
      at: progress.at,
    })
    if (batch) await this.publishProgressBatch(batch)
  }

  private async flushProgressBatch(
    parentRunId: string,
    reason: SubSessionProgressAggregationBatch["reason"],
  ): Promise<void> {
    const batch = this.progressAggregator.flush(parentRunId, reason, this.now())
    if (batch) await this.publishProgressBatch(batch)
  }

  private async publishProgressBatch(batch: SubSessionProgressAggregationBatch): Promise<void> {
    await this.dependencies.appendParentEvent(batch.parentRunId, `sub_session_progress_summary:${batch.text}`)
    this.recordLedgerEvent({
      parentRunId: batch.parentRunId,
      eventKind: "sub_session_progress_summarized",
      deliveryKind: "progress",
      status: "delivered",
      summary: batch.text,
      idempotencyKey: `sub-session-progress-summary:${batch.parentRunId}:${batch.windowStartedAt}:${batch.windowClosedAt}`,
      detail: {
        reason: batch.reason,
        windowStartedAt: batch.windowStartedAt,
        windowClosedAt: batch.windowClosedAt,
        windowMs: batch.windowMs,
        items: batch.items.map((item) => ({
          subSessionId: item.subSessionId,
          agentId: item.agentId,
          agentDisplayName: item.agentDisplayName,
          status: item.status,
          summary: item.summary,
          at: item.at,
        })),
      },
    })
  }

  private recordSubSessionLifecycleEvent(
    subSession: SubSessionContract,
    eventKind: Extract<MessageLedgerEventInput["eventKind"], "sub_session_created" | "sub_session_completed" | "sub_session_failed" | "sub_session_result_suppressed">,
    status: MessageLedgerEventInput["status"],
    summary: string,
    detail: Record<string, unknown> = {},
  ): void {
    this.recordLedgerEvent({
      parentRunId: subSession.parentRunId,
      subSessionId: subSession.subSessionId,
      agentId: subSession.agentId,
      eventKind,
      deliveryKind: eventKind === "sub_session_result_suppressed" ? "final" : "diagnostic",
      status,
      summary,
      idempotencyKey: `${eventKind}:${subSession.parentRunId}:${subSession.subSessionId}:${subSession.status}`,
      detail: {
        agentDisplayName: subSession.agentDisplayName,
        agentNickname: subSession.agentNickname ?? null,
        status: subSession.status,
        retryBudgetRemaining: subSession.retryBudgetRemaining,
        ...detail,
      },
    })
  }

  private async changeStatus(subSession: SubSessionContract, status: SubSessionStatus): Promise<void> {
    const now = this.now()
    subSession.status = status
    if (status === "running" && subSession.startedAt === undefined) {
      subSession.startedAt = now
    }
    if (status === "completed" || status === "needs_revision" || status === "failed" || status === "cancelled") {
      subSession.finishedAt = now
    }
    await this.dependencies.updateSubSession(subSession)
  }

  private async reviewResultReport(
    input: RunSubSessionInput,
    resultReport: ResultReport,
    subSession: SubSessionContract,
  ): Promise<SubAgentResultReview> {
    if (this.customReviewResultReport) {
      return this.customReviewResultReport({ input, resultReport, subSession })
    }
    return reviewSubAgentResult({
      resultReport,
      expectedOutputs: input.command.expectedOutputs,
      retryBudgetRemaining: subSession.retryBudgetRemaining,
      retryClass: classifyRetryClass(input),
      additionalContextRefs: input.command.contextPackageIds,
    })
  }

  private async runWithTimeout(
    run: () => Promise<ResultReport> | ResultReport,
    controller: AbortController,
    timeoutMs: number | undefined,
    setTimer: (timer: NodeJS.Timeout) => void,
  ): Promise<ResultReport> {
    if (!timeoutMs || timeoutMs <= 0) return run()
    return Promise.race([
      Promise.resolve().then(run),
      new Promise<ResultReport>((_resolve, reject) => {
        const timer = setTimeout(() => {
          controller.abort()
          reject(new SubSessionTimeoutError())
        }, timeoutMs)
        setTimer(timer)
      }),
    ])
  }
}

function classifyRetryClass(input: RunSubSessionInput): SubAgentRetryClass {
  const outputKinds = new Set(input.command.expectedOutputs.map((output) => output.kind))
  if (outputKinds.has("state_change") || outputKinds.has("tool_result") || input.command.contextPackageIds.some((ref) => ref.startsWith("cost:high") || ref.startsWith("external:"))) {
    return "risk_or_external"
  }
  if (input.command.expectedOutputs.every((output) =>
    !output.acceptance.artifactRequired
    && output.acceptance.requiredEvidenceKinds.length === 0
    && output.kind === "text"
  )) {
    return "format_only"
  }
  return "default"
}

export async function runParallelSubSessionGroup(
  group: Pick<ParallelSubSessionGroup, "groupId" | "dependencyEdges" | "concurrencyLimit">,
  items: SubSessionWorkItem[],
  options: ParallelSubSessionGroupRunOptions = {},
): Promise<ParallelSubSessionGroupRunResult> {
  const now = options.now ?? (() => Date.now())
  const waves = planSubSessionExecutionWaves(items, group)
  const outcomes: SubSessionRunOutcome[] = []
  const skipped: ParallelSubSessionGroupRunResult["skipped"] = []
  const completedTasks = new Set<string>()
  const blockedTasks = new Set<string>()
  const groupStartedAt = now()
  const appendParentEvent = options.appendParentEvent ?? appendRunEvent

  if (options.runId) {
    const waitSummary = buildDeferredWaveSummary(group.groupId, waves)
    if (waitSummary) await appendParentEvent(options.runId, waitSummary)
  }

  for (const wave of waves) {
    const waveStartedAt = now()
    const runnable = wave.items.filter((item) => {
      const dependencies = new Set(item.dependencies ?? [])
      for (const edge of group.dependencyEdges ?? []) {
        if (edge.toTaskId === item.taskId) dependencies.add(edge.fromTaskId)
      }
      const blocked = [...dependencies].some((dep) => blockedTasks.has(dep) || !completedTasks.has(dep))
      if (blocked) {
        skipped.push({ taskId: item.taskId, subSessionId: item.subSessionId, reasonCode: "dependency_not_completed" })
        blockedTasks.add(item.taskId)
      }
      return !blocked
    })
    for (const item of runnable) {
      const waitReasonCodes = wave.waitReasonCodesByTask?.[item.taskId] ?? []
      if (!waitReasonCodes.includes("resource_lock")) continue
      recordLatencyMetric({
        name: "resource_lock_wait_ms",
        durationMs: Math.max(0, waveStartedAt - groupStartedAt),
        ...(options.runId ? { runId: options.runId } : {}),
        ...(options.sessionId ? { sessionId: options.sessionId } : {}),
        ...(options.requestGroupId ? { requestGroupId: options.requestGroupId } : {}),
        ...(options.source ? { source: options.source } : {}),
        detail: {
          groupId: group.groupId,
          taskId: item.taskId,
          subSessionId: item.subSessionId,
          waveIndex: wave.waveIndex,
          waitReasonCodes,
        },
      })
    }

    const settled = await Promise.allSettled(runnable.map((item) => item.run()))
    for (const [index, result] of settled.entries()) {
      const item = runnable[index]
      if (!item) continue
      if (result.status === "fulfilled") {
        outcomes.push(result.value)
        if (result.value.status === "completed") completedTasks.add(item.taskId)
        else blockedTasks.add(item.taskId)
      } else {
        blockedTasks.add(item.taskId)
      }
    }
  }

  const status = skipped.length > 0 || outcomes.some((outcome) => outcome.status !== "completed")
    ? "failed"
    : "completed"

  return {
    groupId: group.groupId,
    status,
    waves: waves.map((wave) => ({
      waveIndex: wave.waveIndex,
      taskIds: wave.items.map((item) => item.taskId),
      subSessionIds: wave.items.map((item) => item.subSessionId),
      reasonCodes: wave.reasonCodes,
    })),
    outcomes,
    skipped,
  }
}

export function classifySubSessionRecovery(subSession: SubSessionContract): SubSessionRecoveryDecision {
  if (!ACTIVE_RECOVERY_STATUSES.has(subSession.status)) {
    return {
      subSessionId: subSession.subSessionId,
      previousStatus: subSession.status,
      nextStatus: subSession.status,
      action: "unchanged",
      reasonCode: "sub_session_status_not_active_on_restart",
    }
  }
  return {
    subSessionId: subSession.subSessionId,
    previousStatus: subSession.status,
    nextStatus: "failed",
    action: "mark_failed",
    reasonCode: "sub_session_recovery_degraded",
  }
}

export async function recoverInterruptedSubSessions(input: {
  subSessions: SubSessionContract[]
  updateSubSession: (subSession: SubSessionContract) => Promise<void> | void
  appendParentEvent?: (parentRunId: string, label: string) => Promise<void> | void
  now?: () => number
}): Promise<SubSessionRecoveryResult> {
  const now = input.now ?? (() => Date.now())
  const decisions: SubSessionRecoveryDecision[] = []
  const updatedSubSessions: SubSessionContract[] = []

  for (const subSession of input.subSessions) {
    const decision = classifySubSessionRecovery(subSession)
    decisions.push(decision)
    if (decision.action !== "mark_failed") continue
    const updated = {
      ...subSession,
      status: decision.nextStatus,
      finishedAt: now(),
    } satisfies SubSessionContract
    await input.updateSubSession(updated)
    await input.appendParentEvent?.(updated.parentRunId, `sub_session_recovered_degraded:${updated.subSessionId}`)
    updatedSubSessions.push(updated)
  }

  return { decisions, updatedSubSessions }
}

export function createSubSessionRunner(dependencies: SubSessionRuntimeDependencies = {}): SubSessionRunner {
  return new SubSessionRunner(dependencies)
}

function defaultLoadSubSessionByIdempotencyKey(idempotencyKey: string): SubSessionContract | undefined {
  const row = getRunSubSessionByIdempotencyKey(idempotencyKey)
  return row ? parseStoredSubSession(row.contract_json) : undefined
}

function defaultPersistSubSession(subSession: SubSessionContract): boolean {
  return insertRunSubSession(subSession)
}

function defaultUpdateSubSession(subSession: SubSessionContract): void {
  updateRunSubSession(subSession)
}

function defaultAppendParentEvent(parentRunId: string, label: string): void {
  appendRunEvent(parentRunId, label)
}

function defaultIsParentCancelled(parentRunId: string): boolean {
  const run = getRootRun(parentRunId)
  return run?.status === "cancelled" || run?.status === "interrupted"
}

class SubSessionTimeoutError extends Error {
  constructor() {
    super("sub-session execution timed out")
    this.name = "SubSessionTimeoutError"
  }
}

export function createTextResultReport(input: {
  command: CommandRequest
  idProvider?: () => string
  status?: ResultReport["status"]
  text?: string
  risksOrGaps?: string[]
}): ResultReport {
  const idProvider = input.idProvider ?? defaultIdProvider
  const value: JsonValue = input.text ?? ""
  return {
    identity: {
      ...input.command.identity,
      entityType: "sub_session",
      entityId: input.command.subSessionId,
      idempotencyKey: `sub-session-result:${input.command.subSessionId}:${idProvider()}`,
      parent: {
        ...input.command.identity.parent,
        parentRunId: input.command.parentRunId,
      },
    },
    resultReportId: idProvider(),
    parentRunId: input.command.parentRunId,
    subSessionId: input.command.subSessionId,
    status: input.status ?? "completed",
    outputs: [{
      outputId: input.command.expectedOutputs[0]?.outputId ?? "answer",
      status: input.status === "failed" ? "missing" : "satisfied",
      value,
    }],
    evidence: [],
    artifacts: [],
    risksOrGaps: input.risksOrGaps ?? [],
  }
}
