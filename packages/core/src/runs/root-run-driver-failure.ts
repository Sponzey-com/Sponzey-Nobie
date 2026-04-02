import { deliverChunk, type RunChunkDeliveryHandler } from "./delivery.js"
import { applyFatalFailure } from "./failure-application.js"
import type { FinalizationSource } from "./finalization.js"

interface RootRunDriverFailureDependencies {
  appendRunEvent: (runId: string, message: string) => void
  setRunStepStatus: (
    runId: string,
    step: string,
    status: "pending" | "running" | "completed" | "failed" | "cancelled",
    summary: string,
  ) => void
  updateRunStatus: (
    runId: string,
    status: "queued" | "running" | "awaiting_approval" | "awaiting_user" | "completed" | "failed" | "cancelled" | "interrupted",
    summary: string,
    active: boolean,
  ) => void
  rememberRunFailure: (params: {
    runId: string
    sessionId: string
    source: FinalizationSource
    summary: string
    detail?: string
    title?: string
  }) => void
  markAbortedRunCancelledIfActive: (runId: string) => void
  onDeliveryError?: (message: string) => void
}

interface RootRunDriverFailureModuleDependencies {
  applyFatalFailure: typeof applyFatalFailure
  deliverChunk: typeof deliverChunk
}

const defaultModuleDependencies: RootRunDriverFailureModuleDependencies = {
  applyFatalFailure,
  deliverChunk,
}

export async function applyRootRunDriverFailure(
  params: {
    runId: string
    sessionId: string
    source: FinalizationSource
    onChunk: RunChunkDeliveryHandler | undefined
    aborted: boolean
    message: string
  },
  dependencies: RootRunDriverFailureDependencies,
  moduleDependencies: RootRunDriverFailureModuleDependencies = defaultModuleDependencies,
): Promise<void> {
  moduleDependencies.applyFatalFailure({
    runId: params.runId,
    sessionId: params.sessionId,
    source: params.source,
    message: params.message,
    aborted: params.aborted,
    summary: "예상하지 못한 실행 오류가 발생했습니다.",
    title: "unexpected_error",
  }, {
    appendRunEvent: dependencies.appendRunEvent,
    setRunStepStatus: dependencies.setRunStepStatus,
    updateRunStatus: dependencies.updateRunStatus,
    rememberRunFailure: dependencies.rememberRunFailure,
    markAbortedRunCancelledIfActive: dependencies.markAbortedRunCancelledIfActive,
  })

  await moduleDependencies.deliverChunk({
    onChunk: params.onChunk,
    chunk: { type: "error", message: params.message },
    runId: params.runId,
    onError: dependencies.onDeliveryError ?? (() => {}),
  })
}
