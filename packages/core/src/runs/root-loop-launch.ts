import type { ExecutionLoopRuntimeState } from "./execution-profile.js"
import type { RootRunDriverDependencies } from "./root-run-driver.js"
import type { RootLoopDependencies, RootLoopParams } from "./root-loop.js"
import type { FinalizationSource } from "./finalization.js"
import type { SyntheticApprovalRuntimeDependencies } from "./approval.js"
import type { AgentContextMode } from "../agent/index.js"
import type { TaskExecutionSemantics } from "../agent/intake.js"
import type { LLMProvider } from "../llm/index.js"
import type { ReconnectRequestGroupSelection } from "./store.js"
import type { TaskProfile } from "./types.js"
import type { WorkerRuntimeTarget } from "./worker-runtime.js"
import type { RunChunkDeliveryHandler } from "./delivery.js"

export function prepareRootLoopLaunch(
  params: {
    runId: string
    sessionId: string
    requestGroupId: string
    source: FinalizationSource
    onChunk: RunChunkDeliveryHandler | undefined
    controller: AbortController
    message: string
    currentModel: string | undefined
    currentProviderId: string | undefined
    currentProvider: LLMProvider | undefined
    currentTargetId: string | undefined
    currentTargetLabel: string | undefined
    workDir: string
    skipIntake?: boolean
    immediateCompletionText?: string
    reconnectNeedsClarification: boolean
    reconnectTargetTitle?: string
    reconnectSelection?: ReconnectRequestGroupSelection
    queuedBehindRequestGroupRun: boolean
    activeWorkerRuntime: WorkerRuntimeTarget | undefined
    workerSessionId?: string
    toolsEnabled?: boolean
    isRootRequest: boolean
    contextMode: AgentContextMode
    taskProfile: TaskProfile
    syntheticApprovalRuntimeDependencies: SyntheticApprovalRuntimeDependencies
    defaultMaxDelegationTurns: number
  },
  dependencies: RootRunDriverDependencies,
  executionLoopRuntime: ExecutionLoopRuntimeState,
): {
  rootLoopParams: RootLoopParams
  rootLoopDependencies: RootLoopDependencies
} {
  const { executionProfile } = executionLoopRuntime
  const originalUserRequest = executionLoopRuntime.originalUserRequest

  const rootLoopParams: RootLoopParams = {
    runId: params.runId,
    sessionId: params.sessionId,
    requestGroupId: params.requestGroupId,
    source: params.source,
    onChunk: params.onChunk,
    controller: params.controller,
    ...(params.skipIntake ? { skipIntake: params.skipIntake } : {}),
    ...(params.immediateCompletionText ? { immediateCompletionText: params.immediateCompletionText } : {}),
    reconnectNeedsClarification: params.reconnectNeedsClarification,
    ...(params.reconnectTargetTitle ? { reconnectTargetTitle: params.reconnectTargetTitle } : {}),
    ...(params.reconnectSelection ? { reconnectSelection: params.reconnectSelection } : {}),
    queuedBehindRequestGroupRun: params.queuedBehindRequestGroupRun,
    currentMessage: params.message,
    currentModel: params.currentModel,
    currentProviderId: params.currentProviderId,
    currentProvider: params.currentProvider,
    currentTargetId: params.currentTargetId,
    currentTargetLabel: params.currentTargetLabel,
    activeWorkerRuntime: params.activeWorkerRuntime,
    ...(params.workerSessionId ? { workerSessionId: params.workerSessionId } : {}),
    requestMessage: params.message,
    originalRequest: originalUserRequest,
    executionSemantics: executionProfile.executionSemantics,
    workDir: params.workDir,
    ...(params.toolsEnabled === false ? { toolsEnabled: false } : {}),
    isRootRequest: params.isRootRequest,
    contextMode: params.contextMode,
    taskProfile: params.taskProfile,
    wantsDirectArtifactDelivery: executionProfile.wantsDirectArtifactDelivery,
    requiresFilesystemMutation: executionLoopRuntime.requiresFilesystemMutation,
    requiresPrivilegedToolExecution: executionLoopRuntime.requiresPrivilegedToolExecution,
    pendingToolParams: executionLoopRuntime.pendingToolParams,
    filesystemMutationPaths: executionLoopRuntime.filesystemMutationPaths,
    seenFollowupPrompts: executionLoopRuntime.seenFollowupPrompts,
    seenCommandFailureRecoveryKeys: executionLoopRuntime.seenCommandFailureRecoveryKeys,
    seenExecutionRecoveryKeys: executionLoopRuntime.seenExecutionRecoveryKeys,
    seenDeliveryRecoveryKeys: executionLoopRuntime.seenDeliveryRecoveryKeys,
    seenLlmRecoveryKeys: executionLoopRuntime.seenLlmRecoveryKeys,
    recoveryBudgetUsage: executionLoopRuntime.recoveryBudgetUsage,
    priorAssistantMessages: executionLoopRuntime.priorAssistantMessages,
    syntheticApprovalRuntimeDependencies: params.syntheticApprovalRuntimeDependencies,
    defaultMaxDelegationTurns: params.defaultMaxDelegationTurns,
  }

  const rootLoopDependencies: RootLoopDependencies = {
    appendRunEvent: dependencies.appendRunEvent,
    updateRunSummary: dependencies.updateRunSummary,
    setRunStepStatus: dependencies.setRunStepStatus,
    updateRunStatus: dependencies.updateRunStatus,
    rememberRunFailure: dependencies.rememberRunFailure,
    incrementDelegationTurnCount: dependencies.incrementDelegationTurnCount,
    markAbortedRunCancelledIfActive: dependencies.markAbortedRunCancelledIfActive,
    getDelegationTurnState: dependencies.getDelegationTurnState,
    getFinalizationDependencies: dependencies.getFinalizationDependencies,
    insertMessage: dependencies.insertMessage,
    writeReplyLog: dependencies.writeReplyLog,
    createId: dependencies.createId,
    now: dependencies.now,
    runVerificationSubtask: () =>
      dependencies.runVerificationSubtask({
        originalRequest: originalUserRequest,
        mutationPaths: [...executionLoopRuntime.filesystemMutationPaths],
      }),
    rememberRunApprovalScope: dependencies.rememberRunApprovalScope,
    grantRunApprovalScope: dependencies.grantRunApprovalScope,
    grantRunSingleApproval: dependencies.grantRunSingleApproval,
    ...(dependencies.onReviewError ? { onReviewError: dependencies.onReviewError } : {}),
    ...(dependencies.onDeliveryError ? { onDeliveryError: dependencies.onDeliveryError } : {}),
    executeLoopDirective: dependencies.executeLoopDirective,
    tryHandleActiveQueueCancellation: dependencies.tryHandleActiveQueueCancellation,
    tryHandleIntakeBridge: (currentMessage) =>
      dependencies.tryHandleIntakeBridge({
        currentMessage,
        originalRequest: originalUserRequest,
      }),
    getSyntheticApprovalAlreadyApproved: dependencies.getSyntheticApprovalAlreadyApproved,
    ...(dependencies.onBootstrapInfo ? { onBootstrapInfo: dependencies.onBootstrapInfo } : {}),
  }

  return {
    rootLoopParams,
    rootLoopDependencies,
  }
}
