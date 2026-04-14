import { enqueueMemoryWritebackCandidate, getDb, getSession, insertSession, upsertSessionSnapshot, upsertTaskContinuity } from "../db/index.js"
import { createLogger } from "../logger/index.js"
import type { RunChunkDeliveryHandler } from "./delivery.js"
import {
  buildActiveQueueCancellationMessage,
  type ActiveQueueCancellationMode,
} from "./entry-semantics.js"
import {
  buildFilesystemVerificationPrompt,
  verifyFilesystemTargets,
} from "./filesystem-verification.js"
import {
  runFilesystemVerificationSubtask as runAnalysisOnlyFilesystemVerificationSubtask,
} from "./analysis-subrun.js"
import {
  buildRunFailureJournalRecord,
  buildRunInstructionJournalRecord,
  buildRunSuccessJournalRecord,
  safeInsertRunJournalRecord,
} from "./journaling.js"
import { condenseMemoryText } from "../memory/journal.js"
import { recordFlashFeedback } from "../memory/flash-feedback.js"
import { buildRunWritebackCandidates, isFlashFeedback, prepareMemoryWritebackQueueInput } from "../memory/writeback.js"
import type { FinalizationSource } from "./finalization.js"
import type { LoopDirective } from "./loop-directive.js"
import {
  appendRunEvent,
  cancelRootRun,
  createRootRun,
  getRootRun,
  listActiveSessionRequestGroups,
  setRunStepStatus,
  updateRunStatus,
} from "./store.js"
import type { RootRun, TaskProfile } from "./types.js"
import type { WorkerRuntimeTarget } from "./worker-runtime.js"

const log = createLogger("runs:start-support")

function mapTaskProfileToWorkerRole(taskProfile: TaskProfile): string {
  switch (taskProfile) {
    case "coding":
      return "coding"
    case "research":
      return "research"
    case "review":
      return "verification"
    case "operations":
    case "private_local":
      return "local-ops"
    case "planning":
    case "summarization":
      return "planning"
    default:
      return "general"
  }
}

export function normalizeTaskProfile(taskProfile: string | undefined): TaskProfile {
  switch (taskProfile) {
    case "planning":
    case "coding":
    case "review":
    case "research":
    case "private_local":
    case "summarization":
    case "operations":
      return taskProfile
    default:
      return "general_chat"
  }
}

export function buildWorkerSessionId(params: {
  runId: string
  isRootRequest: boolean
  requestGroupId: string
  taskProfile: TaskProfile
  targetId?: string
  workerRuntime?: WorkerRuntimeTarget
}): string | undefined {
  if (params.isRootRequest && !params.workerRuntime) return undefined

  const workerRole = mapTaskProfileToWorkerRole(params.taskProfile)
  const rawTarget = params.workerRuntime?.kind || params.targetId || "default"
  const normalizedTarget = rawTarget
    .replace(/^provider:/, "")
    .replace(/^worker:/, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()

  return `B-${params.runId.slice(0, 8)}-${workerRole}-${normalizedTarget || "default"}`
}

export function markAbortedRunCancelledIfActive(runId: string): void {
  const current = getRootRun(runId)
  if (!current) return
  if (current.status === "interrupted" || current.status === "cancelled" || current.status === "completed" || current.status === "failed") {
    return
  }
  updateRunStatus(runId, "cancelled", "사용자가 실행을 취소했습니다.", false)
}

export async function tryHandleActiveQueueCancellation(params: {
  runId: string
  sessionId: string
  message: string
  mode: ActiveQueueCancellationMode | null
}): Promise<LoopDirective | null> {
  if (!params.mode) return null

  const activeGroups = listActiveSessionRequestGroups(params.sessionId, params.runId)
  if (activeGroups.length === 0) {
    return {
      kind: "complete",
      text: buildActiveQueueCancellationMessage({
        originalMessage: params.message,
        mode: params.mode,
        cancelledTitles: [],
        remainingCount: 0,
        hadTargets: false,
      }),
      eventLabel: "취소 요청 결과 전달",
    }
  }

  const targets = params.mode === "all" ? activeGroups : activeGroups.length > 0 ? [activeGroups[0]!] : []
  const cancelledTitles: string[] = []
  for (const target of targets) {
    const cancelled = cancelRootRun(target.id)
    if (cancelled) cancelledTitles.push(target.title)
  }

  const remainingCount = Math.max(0, activeGroups.length - cancelledTitles.length)
  return {
    kind: "complete",
    text: buildActiveQueueCancellationMessage({
      originalMessage: params.message,
      mode: params.mode,
      cancelledTitles,
      remainingCount,
      hadTargets: cancelledTitles.length > 0,
    }),
    eventLabel: "취소 요청 결과 전달",
  }
}

export function ensureSessionExists(sessionId: string, source: RootRun["source"], now: number): void {
  const existing = getSession(sessionId)
  if (!existing) {
    insertSession({
      id: sessionId,
      source,
      source_id: null,
      created_at: now,
      updated_at: now,
      summary: null,
    })
    return
  }

  getDb()
    .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
    .run(now, sessionId)
}

export function rememberRunInstruction(params: {
  runId: string
  sessionId: string
  requestGroupId: string
  source: FinalizationSource
  message: string
}): void {
  safeInsertRunJournalRecord(buildRunInstructionJournalRecord(params), {
    onError: (message) => log.warn(message),
  })
  if (isFlashFeedback(params.message)) {
    safeRecordFlashFeedback({
      runId: params.runId,
      sessionId: params.sessionId,
      requestGroupId: params.requestGroupId,
      source: params.source,
      content: condenseMemoryText(params.message, 480),
    })
  }
  safeEnqueueWritebackCandidates({
    runId: params.runId,
    candidates: buildRunWritebackCandidates({
      kind: "instruction",
      content: params.message,
      sessionId: params.sessionId,
      requestGroupId: params.requestGroupId,
      runId: params.runId,
      source: params.source,
    }),
  })
  safeUpsertTaskContinuity({
    lineageRootRunId: params.requestGroupId,
    ...(params.runId !== params.requestGroupId ? { parentRunId: params.runId } : {}),
    handoffSummary: condenseMemoryText(params.message, 280),
    lastGoodState: "instruction_received",
  })
}

export function rememberRunSuccess(params: {
  runId: string
  sessionId: string
  source: FinalizationSource
  text: string
  summary: string
}): void {
  const run = getRootRun(params.runId)
  const requestGroupId = run?.requestGroupId
  safeInsertRunJournalRecord(buildRunSuccessJournalRecord({
    ...params,
    ...(requestGroupId ? { requestGroupId } : {}),
  }), {
    onError: (message) => log.warn(message),
  })
  const summary = condenseMemoryText(params.summary || params.text, 360)
  if (summary) {
    safeEnqueueWritebackCandidates({
      runId: params.runId,
      candidates: buildRunWritebackCandidates({
        kind: "success",
        content: summary,
        sessionId: params.sessionId,
        ...(requestGroupId ? { requestGroupId } : {}),
        runId: params.runId,
        source: params.source,
        metadata: {
          ...(requestGroupId ? { requestGroupId } : {}),
        },
      }),
    })
    safeUpsertSessionSnapshot({
      sessionId: params.sessionId,
      summary,
      activeTaskIds: requestGroupId ? [requestGroupId] : [],
    })
    if (requestGroupId) {
      safeUpsertTaskContinuity({
        lineageRootRunId: requestGroupId,
        ...(run?.parentRunId ? { parentRunId: run.parentRunId } : {}),
        ...(run?.handoffSummary ? { handoffSummary: run.handoffSummary } : {}),
        lastGoodState: summary,
      })
    }
  }
}

export function rememberFlashFeedback(params: {
  runId: string
  sessionId: string
  source: FinalizationSource
  text: string
  requestGroupId?: string
  repeatCount?: number
}): void {
  const content = condenseMemoryText(params.text, 480)
  if (!content) return
  safeRecordFlashFeedback({
    runId: params.runId,
    sessionId: params.sessionId,
    ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
    source: params.source,
    content,
    severity: params.repeatCount && params.repeatCount >= 2 ? "high" : "normal",
  })
  safeEnqueueWritebackCandidates({
    runId: params.runId,
    candidates: buildRunWritebackCandidates({
      kind: "flash_feedback",
      content,
      sessionId: params.sessionId,
      ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
      runId: params.runId,
      source: params.source,
      ...(params.repeatCount !== undefined ? { repeatCount: params.repeatCount } : {}),
    }),
  })
}

export function rememberToolResultWriteback(params: {
  runId: string
  sessionId: string
  source: FinalizationSource
  toolName: string
  output: string
  requestGroupId?: string
}): void {
  const content = condenseMemoryText(params.output, 480)
  if (!content) return
  safeEnqueueWritebackCandidates({
    runId: params.runId,
    candidates: buildRunWritebackCandidates({
      kind: "tool_result",
      content,
      sessionId: params.sessionId,
      ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
      runId: params.runId,
      source: params.source,
      toolName: params.toolName,
    }),
  })
}

export function rememberRunFailure(params: {
  runId: string
  sessionId: string
  source: FinalizationSource
  summary: string
  detail?: string
  title?: string
}): void {
  const run = getRootRun(params.runId)
  const requestGroupId = run?.requestGroupId
  safeInsertRunJournalRecord(buildRunFailureJournalRecord({
    ...params,
    ...(requestGroupId ? { requestGroupId } : {}),
  }), {
    onError: (message) => log.warn(message),
  })
  const detail = condenseMemoryText(params.detail || params.summary, 480)
  if (detail) {
    safeEnqueueWritebackCandidates({
      runId: params.runId,
      candidates: buildRunWritebackCandidates({
        kind: "failure",
        content: detail,
        sessionId: params.sessionId,
        ...(requestGroupId ? { requestGroupId } : {}),
        runId: params.runId,
        source: params.source,
        metadata: {
          title: params.title || "failure",
        },
      }),
    })
    if (requestGroupId) {
      safeUpsertTaskContinuity({
        lineageRootRunId: requestGroupId,
        ...(run?.parentRunId ? { parentRunId: run.parentRunId } : {}),
        ...(run?.handoffSummary ? { handoffSummary: run.handoffSummary } : {}),
        lastGoodState: `failure: ${detail}`,
      })
    }
  }
}

function safeRecordFlashFeedback(input: {
  runId: string
  sessionId: string
  source: FinalizationSource
  content: string
  requestGroupId?: string
  severity?: "low" | "normal" | "high"
}): void {
  try {
    recordFlashFeedback({
      sessionId: input.sessionId,
      content: input.content,
      runId: input.runId,
      ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
      severity: input.severity ?? "high",
      metadata: { source: input.source },
    })
  } catch (error) {
    log.warn(`flash-feedback record failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function safeEnqueueWriteback(input: Parameters<typeof enqueueMemoryWritebackCandidate>[0]): void {
  try {
    enqueueMemoryWritebackCandidate(prepareMemoryWritebackQueueInput(input))
  } catch (error) {
    log.warn(`memory writeback enqueue failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function safeEnqueueWritebackCandidates(input: {
  runId: string
  candidates: ReturnType<typeof buildRunWritebackCandidates>
}): void {
  for (const candidate of input.candidates) {
    safeEnqueueWriteback({
      ...candidate,
      runId: input.runId,
    })
  }
}

function safeUpsertSessionSnapshot(input: Parameters<typeof upsertSessionSnapshot>[0]): void {
  try {
    upsertSessionSnapshot(input)
  } catch (error) {
    log.warn(`session snapshot upsert failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function safeUpsertTaskContinuity(input: Parameters<typeof upsertTaskContinuity>[0]): void {
  try {
    upsertTaskContinuity(input)
  } catch (error) {
    log.warn(`task continuity upsert failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function runFilesystemVerificationSubtask(params: {
  parentRunId: string
  requestGroupId: string
  sessionId: string
  source: FinalizationSource
  onChunk: RunChunkDeliveryHandler | undefined
  originalRequest: string
  mutationPaths: string[]
  workDir: string
}): Promise<{ ok: boolean; summary: string; reason?: string; remainingItems?: string[] }> {
  return runAnalysisOnlyFilesystemVerificationSubtask({
    ...params,
    dependencies: {
      createRun: createRootRun,
      appendRunEvent,
      setRunStepStatus,
      updateRunStatus,
      verifyFilesystemTargets,
      buildFilesystemVerificationPrompt,
      createId: () => crypto.randomUUID(),
    },
  })
}
