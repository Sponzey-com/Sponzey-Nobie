import type { AIProvider } from "../ai/index.js"
import type { DeliveryOutcome } from "./delivery.js"
import type { LoopDirective } from "./loop-directive.js"
import type { LoopEntryPassResult } from "./loop-entry-pass.js"
import type { PostExecutionPassResult } from "./post-execution-pass.js"
import type { RecoveryEntryPassResult } from "./recovery-entry-pass.js"
import type { ReviewOutcomePassResult } from "./review-outcome-pass.js"
import type { WorkerRuntimeTarget } from "./worker-runtime.js"

export interface LoopEntryApplicationState {
  pendingLoopDirective: LoopDirective | null
  intakeProcessed: boolean
}

export type LoopEntryApplicationResult =
  | { kind: "break" }
  | { kind: "retry"; nextMessage: string; state: LoopEntryApplicationState }
  | { kind: "continue"; state: LoopEntryApplicationState }

export function applyLoopEntryPassResult(result: LoopEntryPassResult): LoopEntryApplicationResult {
  if (result.kind === "break") {
    return { kind: "break" }
  }

  if (result.kind === "retry") {
    return {
      kind: "retry",
      nextMessage: result.nextMessage,
      state: {
        pendingLoopDirective: null,
        intakeProcessed: false,
      },
    }
  }

  if (result.kind === "set_directive") {
    return {
      kind: "continue",
      state: {
        pendingLoopDirective: result.directive,
        intakeProcessed: result.intakeProcessed,
      },
    }
  }

  return {
    kind: "continue",
    state: {
      pendingLoopDirective: null,
      intakeProcessed: result.intakeProcessed,
    },
  }
}

export interface RecoveryEntryApplicationState {
  currentMessage: string
  currentModel: string | undefined
  currentProviderId: string | undefined
  currentProvider: AIProvider | undefined
  currentTargetId: string | undefined
  currentTargetLabel: string | undefined
  activeWorkerRuntime: WorkerRuntimeTarget | undefined
}

export type RecoveryEntryApplicationResult =
  | { kind: "break" }
  | { kind: "continue" }
  | { kind: "retry"; state: RecoveryEntryApplicationState }

export function applyRecoveryEntryPassResult(params: {
  result: RecoveryEntryPassResult
  currentMessage: string
}): RecoveryEntryApplicationResult {
  if (params.result.kind === "break") {
    return { kind: "break" }
  }

  if (params.result.kind === "continue") {
    return { kind: "continue" }
  }

  return {
    kind: "retry",
    state: {
      currentMessage: params.result.nextMessage,
      currentModel: params.result.nextState.model,
      currentProviderId: params.result.nextState.providerId,
      currentProvider: params.result.nextState.provider,
      currentTargetId: params.result.nextState.targetId,
      currentTargetLabel: params.result.nextState.targetLabel,
      activeWorkerRuntime: params.result.nextState.workerRuntime,
    },
  }
}

export interface PostExecutionApplicationState {
  currentMessage: string
  filesystemMutationRecoveryAttempted: boolean
  activeWorkerRuntime: WorkerRuntimeTarget | undefined
}

export type PostExecutionApplicationResult =
  | { kind: "break" }
  | { kind: "retry"; state: PostExecutionApplicationState }
  | {
      kind: "continue"
      state: PostExecutionApplicationState
      preview: string
      deliveryOutcome: DeliveryOutcome
    }

export function applyPostExecutionPassResult(params: {
  result: PostExecutionPassResult
  currentMessage: string
  filesystemMutationRecoveryAttempted: boolean
  activeWorkerRuntime: WorkerRuntimeTarget | undefined
  seenCommandFailureRecoveryKeys: Set<string>
  seenExecutionRecoveryKeys: Set<string>
  seenDeliveryRecoveryKeys: Set<string>
}): PostExecutionApplicationResult {
  if (params.result.kind === "break") {
    return { kind: "break" }
  }

  if (params.result.kind === "retry") {
    if (params.result.seenCommandFailureRecoveryKey) {
      params.seenCommandFailureRecoveryKeys.add(params.result.seenCommandFailureRecoveryKey)
    }
    if (params.result.seenExecutionRecoveryKey) {
      params.seenExecutionRecoveryKeys.add(params.result.seenExecutionRecoveryKey)
    }
    if (params.result.seenDeliveryRecoveryKey) {
      params.seenDeliveryRecoveryKeys.add(params.result.seenDeliveryRecoveryKey)
    }

    return {
      kind: "retry",
      state: {
        currentMessage: params.result.nextMessage,
        filesystemMutationRecoveryAttempted: params.filesystemMutationRecoveryAttempted
          || Boolean(params.result.markMutationRecoveryAttempted),
        activeWorkerRuntime: params.result.clearWorkerRuntime ? undefined : params.activeWorkerRuntime,
      },
    }
  }

  return {
    kind: "continue",
    state: {
      currentMessage: params.currentMessage,
      filesystemMutationRecoveryAttempted: params.filesystemMutationRecoveryAttempted,
      activeWorkerRuntime: params.activeWorkerRuntime,
    },
    preview: params.result.preview,
    deliveryOutcome: params.result.deliveryOutcome,
  }
}

export interface ReviewCycleApplicationState {
  currentMessage: string
  truncatedOutputRecoveryAttempted: boolean
  activeWorkerRuntime: WorkerRuntimeTarget | undefined
  currentProvider: AIProvider | undefined
}

export type ReviewCycleApplicationResult =
  | { kind: "break" }
  | { kind: "retry"; state: ReviewCycleApplicationState }

export function applyReviewCyclePassResult(params: {
  result: ReviewOutcomePassResult
  currentMessage: string
  truncatedOutputRecoveryAttempted: boolean
  activeWorkerRuntime: WorkerRuntimeTarget | undefined
  currentProvider: AIProvider | undefined
  seenFollowupPrompts: Set<string>
}): ReviewCycleApplicationResult {
  if (params.result.kind === "break") {
    return { kind: "break" }
  }

  if (params.result.normalizedFollowupPrompt) {
    params.seenFollowupPrompts.add(params.result.normalizedFollowupPrompt)
  }

  return {
    kind: "retry",
    state: {
      currentMessage: params.result.nextMessage,
      truncatedOutputRecoveryAttempted: params.truncatedOutputRecoveryAttempted
        || Boolean(params.result.markTruncatedOutputRecoveryAttempted),
      activeWorkerRuntime: params.result.clearWorkerRuntime ? undefined : params.activeWorkerRuntime,
      currentProvider: params.result.clearProvider ? undefined : params.currentProvider,
    },
  }
}
