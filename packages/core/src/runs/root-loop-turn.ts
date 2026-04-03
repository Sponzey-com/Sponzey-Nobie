import { applyLoopEntryPassResult } from "./loop-pass-application.js"
import { runLoopEntryPass } from "./loop-entry-pass.js"
import type { LoopDirective } from "./loop-directive.js"
import {
  prepareRootExecutionCyclePassLaunch,
  prepareRootLoopEntryPassLaunch,
} from "./root-loop-pass-launch.js"
import { runExecutionCyclePass, type ExecutionCycleState } from "./execution-cycle-pass.js"
import type { RunChunkDeliveryHandler } from "./delivery.js"
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js"
import type { RecoveryBudgetUsage } from "./recovery-budget.js"
import type { TaskProfile } from "./types.js"
import type { AgentContextMode } from "../agent/index.js"
import type { TaskExecutionSemantics, TaskStructuredRequest } from "../agent/intake.js"
import type { SyntheticApprovalRuntimeDependencies } from "./approval.js"

export interface RootLoopTurnDependencies {
  appendRunEvent: (runId: string, message: string) => void
  updateRunSummary: (runId: string, summary: string) => void
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
  incrementDelegationTurnCount: (runId: string, summary: string) => void
  markAbortedRunCancelledIfActive: (runId: string) => void
  getDelegationTurnState: () => { usedTurns: number; maxTurns: number }
  getFinalizationDependencies: () => FinalizationDependencies
  insertMessage: typeof import("../db/index.js").insertMessage
  writeReplyLog: typeof import("./delivery.js").logAssistantReply
  createId: () => string
  now: () => number
  runVerificationSubtask: () => Promise<{ ok: boolean; summary: string; reason?: string; remainingItems?: string[] }>
  rememberRunApprovalScope: (runId: string) => void
  grantRunApprovalScope: (runId: string) => void
  grantRunSingleApproval: (runId: string) => void
  onDeliveryError?: (message: string) => void
  onReviewError?: (message: string) => void
  executeLoopDirective: (directive: LoopDirective) => Promise<"break">
  tryHandleActiveQueueCancellation: () => Promise<LoopDirective | null>
  tryHandleIntakeBridge: (currentMessage: string) => Promise<LoopDirective | null>
  getSyntheticApprovalAlreadyApproved: () => boolean
}

interface RootLoopTurnModuleDependencies {
  prepareRootLoopEntryPassLaunch: typeof prepareRootLoopEntryPassLaunch
  runLoopEntryPass: typeof runLoopEntryPass
  applyLoopEntryPassResult: typeof applyLoopEntryPassResult
  prepareRootExecutionCyclePassLaunch: typeof prepareRootExecutionCyclePassLaunch
  runExecutionCyclePass: typeof runExecutionCyclePass
}

const defaultModuleDependencies: RootLoopTurnModuleDependencies = {
  prepareRootLoopEntryPassLaunch,
  runLoopEntryPass,
  applyLoopEntryPassResult,
  prepareRootExecutionCyclePassLaunch,
  runExecutionCyclePass,
}

export interface RootLoopTurnParams {
  runId: string
  sessionId: string
  requestGroupId: string
  source: FinalizationSource
  onChunk: RunChunkDeliveryHandler | undefined
  signal: AbortSignal
  abortExecutionStream: () => void
  pendingLoopDirective: LoopDirective | null
  intakeProcessed: boolean
  state: ExecutionCycleState
  recoveryBudgetUsage: RecoveryBudgetUsage
  executionSemantics: TaskExecutionSemantics
  originalRequest: string
  structuredRequest?: TaskStructuredRequest
  requestMessage: string
  workDir: string
  toolsEnabled?: boolean
  isRootRequest: boolean
  contextMode: AgentContextMode
  taskProfile: TaskProfile
  workerSessionId?: string
  wantsDirectArtifactDelivery: boolean
  requiresFilesystemMutation: boolean
  requiresPrivilegedToolExecution: boolean
  pendingToolParams: Map<string, unknown>
  filesystemMutationPaths: Set<string>
  seenFollowupPrompts: Set<string>
  seenCommandFailureRecoveryKeys: Set<string>
  seenExecutionRecoveryKeys: Set<string>
  seenDeliveryRecoveryKeys: Set<string>
  seenAiRecoveryKeys: Set<string>
  priorAssistantMessages: string[]
  syntheticApprovalRuntimeDependencies: SyntheticApprovalRuntimeDependencies
  defaultMaxDelegationTurns: number
}

export type RootLoopTurnResult =
  | { kind: "break" }
  | {
      kind: "continue"
      pendingLoopDirective: LoopDirective | null
      intakeProcessed: boolean
      state: ExecutionCycleState
    }

export async function runRootLoopTurn(
  params: RootLoopTurnParams,
  dependencies: RootLoopTurnDependencies,
  moduleDependencies: RootLoopTurnModuleDependencies = defaultModuleDependencies,
): Promise<RootLoopTurnResult> {
  const loopEntryLaunch = moduleDependencies.prepareRootLoopEntryPassLaunch({
    runId: params.runId,
    sessionId: params.sessionId,
    source: params.source,
    onChunk: params.onChunk,
    pendingLoopDirective: params.pendingLoopDirective,
    intakeProcessed: params.intakeProcessed,
    currentMessage: params.state.currentMessage,
    recoveryBudgetUsage: params.recoveryBudgetUsage,
  }, dependencies)
  const loopEntryPass = await moduleDependencies.runLoopEntryPass(
    loopEntryLaunch.params,
    loopEntryLaunch.dependencies,
  )

  const loopEntryApplication = moduleDependencies.applyLoopEntryPassResult(loopEntryPass)
  if (loopEntryApplication.kind === "break") {
    return { kind: "break" }
  }

  const nextPendingLoopDirective = loopEntryApplication.state.pendingLoopDirective
  const nextIntakeProcessed = loopEntryApplication.state.intakeProcessed

  if (loopEntryApplication.kind === "retry") {
    return {
      kind: "continue",
      pendingLoopDirective: nextPendingLoopDirective,
      intakeProcessed: nextIntakeProcessed,
      state: {
        ...params.state,
        currentMessage: loopEntryApplication.nextMessage,
      },
    }
  }

  if (nextPendingLoopDirective) {
    return {
      kind: "continue",
      pendingLoopDirective: nextPendingLoopDirective,
      intakeProcessed: nextIntakeProcessed,
      state: params.state,
    }
  }

  const executionCycleLaunch = moduleDependencies.prepareRootExecutionCyclePassLaunch({
    runId: params.runId,
    sessionId: params.sessionId,
    requestGroupId: params.requestGroupId,
    source: params.source,
    onChunk: params.onChunk,
    signal: params.signal,
    abortExecutionStream: params.abortExecutionStream,
    state: params.state,
    executionSemantics: params.executionSemantics,
    originalRequest: params.originalRequest,
    ...(params.structuredRequest ? { structuredRequest: params.structuredRequest } : {}),
    requestMessage: params.requestMessage,
    workDir: params.workDir,
    ...(params.toolsEnabled === false ? { toolsEnabled: false } : {}),
    isRootRequest: params.isRootRequest,
    contextMode: params.contextMode,
    taskProfile: params.taskProfile,
    ...(params.workerSessionId ? { workerSessionId: params.workerSessionId } : {}),
    wantsDirectArtifactDelivery: params.wantsDirectArtifactDelivery,
    requiresFilesystemMutation: params.requiresFilesystemMutation,
    requiresPrivilegedToolExecution: params.requiresPrivilegedToolExecution,
    pendingToolParams: params.pendingToolParams,
    filesystemMutationPaths: params.filesystemMutationPaths,
    seenFollowupPrompts: params.seenFollowupPrompts,
    seenCommandFailureRecoveryKeys: params.seenCommandFailureRecoveryKeys,
    seenExecutionRecoveryKeys: params.seenExecutionRecoveryKeys,
    seenDeliveryRecoveryKeys: params.seenDeliveryRecoveryKeys,
    seenAiRecoveryKeys: params.seenAiRecoveryKeys,
    recoveryBudgetUsage: params.recoveryBudgetUsage,
    priorAssistantMessages: params.priorAssistantMessages,
    syntheticApprovalRuntimeDependencies: params.syntheticApprovalRuntimeDependencies,
    defaultMaxDelegationTurns: params.defaultMaxDelegationTurns,
  }, dependencies)
  const executionCyclePass = await moduleDependencies.runExecutionCyclePass(
    executionCycleLaunch.params,
    executionCycleLaunch.dependencies,
  )

  if (executionCyclePass.kind === "retry") {
    return {
      kind: "continue",
      pendingLoopDirective: nextPendingLoopDirective,
      intakeProcessed: nextIntakeProcessed,
      state: executionCyclePass.state,
    }
  }

  return { kind: "break" }
}
