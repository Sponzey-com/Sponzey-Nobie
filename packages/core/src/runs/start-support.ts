import { getDb, getSession, insertSession } from "../db/index.js"
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
}

export function rememberRunSuccess(params: {
  runId: string
  sessionId: string
  source: FinalizationSource
  text: string
  summary: string
}): void {
  const run = getRootRun(params.runId)
  safeInsertRunJournalRecord(buildRunSuccessJournalRecord({
    ...params,
    ...(run?.requestGroupId ? { requestGroupId: run.requestGroupId } : {}),
  }), {
    onError: (message) => log.warn(message),
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
  safeInsertRunJournalRecord(buildRunFailureJournalRecord({
    ...params,
    ...(run?.requestGroupId ? { requestGroupId: run.requestGroupId } : {}),
  }), {
    onError: (message) => log.warn(message),
  })
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
