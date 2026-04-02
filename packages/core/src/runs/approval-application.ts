import type { ApprovalDecision } from "../events/index.js"
import type { SyntheticApprovalRequest } from "./approval.js"
import {
  applyRunningContinuationState,
  type AppliedRunningContinuation,
  type RunningContinuationDependencies,
} from "./running-application.js"

export type SyntheticApprovalContinuation =
  | {
      kind: "stop"
    }
  | {
      kind: "continue"
      eventLabel: string
      reviewSummary: string
      executingSummary: string
      continuationPrompt: string
      grantMode: "reuse_scope" | "run" | "single"
      clearWorkerRuntime: true
      clearProvider: true
    }

export function decideSyntheticApprovalContinuation(params: {
  request: SyntheticApprovalRequest
  decision?: ApprovalDecision
  alreadyApproved: boolean
}): SyntheticApprovalContinuation {
  if (params.alreadyApproved) {
    return {
      kind: "continue",
      eventLabel: `${params.request.toolName} 전체 승인 상태로 계속 진행합니다.`,
      reviewSummary: params.request.summary,
      executingSummary: "승인된 작업을 계속 진행합니다.",
      continuationPrompt: params.request.continuationPrompt,
      grantMode: "reuse_scope",
      clearWorkerRuntime: true,
      clearProvider: true,
    }
  }

  if (params.decision === "deny" || !params.decision) {
    return { kind: "stop" }
  }

  return {
    kind: "continue",
    eventLabel: params.decision === "allow_run"
      ? `${params.request.toolName} 전체 승인`
      : `${params.request.toolName} 단계 승인`,
    reviewSummary: params.request.summary,
    executingSummary: "승인된 작업을 계속 진행합니다.",
    continuationPrompt: params.request.continuationPrompt,
    grantMode: params.decision === "allow_run" ? "run" : "single",
    clearWorkerRuntime: true,
    clearProvider: true,
  }
}

export type AppliedSyntheticApprovalContinuation =
  | { kind: "stop" }
  | ({
      kind: "continue"
    } & AppliedRunningContinuation)

interface SyntheticApprovalApplicationDependencies extends RunningContinuationDependencies {
  rememberRunApprovalScope: (runId: string) => void
  grantRunApprovalScope: (runId: string) => void
  grantRunSingleApproval: (runId: string) => void
}

export function applySyntheticApprovalContinuation(params: {
  runId: string
  continuation: SyntheticApprovalContinuation
  aborted: boolean
}, dependencies: SyntheticApprovalApplicationDependencies): AppliedSyntheticApprovalContinuation {
  if (params.aborted || params.continuation.kind === "stop") {
    return { kind: "stop" }
  }

  if (params.continuation.grantMode === "run") {
    dependencies.rememberRunApprovalScope(params.runId)
    dependencies.grantRunApprovalScope(params.runId)
  } else if (params.continuation.grantMode === "single") {
    dependencies.grantRunSingleApproval(params.runId)
  }

  const runningContinuation = applyRunningContinuationState({
    runId: params.runId,
    state: {
      eventLabels: [params.continuation.eventLabel],
      reviewStepStatus: "completed",
      reviewSummary: params.continuation.reviewSummary,
      executingSummary: params.continuation.executingSummary,
      updateRunStatusSummary: params.continuation.executingSummary,
      nextMessage: params.continuation.continuationPrompt,
      clearWorkerRuntime: params.continuation.clearWorkerRuntime,
      clearProvider: params.continuation.clearProvider,
    },
  }, dependencies)

  return {
    kind: "continue",
    ...runningContinuation,
  }
}
