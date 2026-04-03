import { runExecutionCyclePass, type ExecutionCycleState } from "./execution-cycle-pass.js"
import type { LoopDirective } from "./loop-directive.js"
import { runLoopEntryPass } from "./loop-entry-pass.js"
import type { RootLoopDependencies, RootLoopParams } from "./root-loop.js"
import { buildStructuredExecutionBrief } from "./request-prompt.js"

export interface RootLoopEntryPassLaunch {
  params: Parameters<typeof runLoopEntryPass>[0]
  dependencies: Parameters<typeof runLoopEntryPass>[1]
}

export interface RootExecutionCyclePassLaunch {
  params: Parameters<typeof runExecutionCyclePass>[0]
  dependencies: Parameters<typeof runExecutionCyclePass>[1]
}

export function prepareRootLoopEntryPassLaunch(
  params: {
    runId: string
    sessionId: string
    source: RootLoopParams["source"]
    onChunk: RootLoopParams["onChunk"]
    pendingLoopDirective: LoopDirective | null
    intakeProcessed: boolean
    currentMessage: string
    recoveryBudgetUsage: RootLoopParams["recoveryBudgetUsage"]
  },
  dependencies: RootLoopDependencies,
): RootLoopEntryPassLaunch {
  return {
    params: {
      runId: params.runId,
      sessionId: params.sessionId,
      source: params.source,
      onChunk: params.onChunk,
      pendingLoopDirective: params.pendingLoopDirective,
      intakeProcessed: params.intakeProcessed,
      recoveryBudgetUsage: params.recoveryBudgetUsage,
      finalizationDependencies: dependencies.getFinalizationDependencies(),
    },
    dependencies: {
      rememberRunFailure: dependencies.rememberRunFailure,
      incrementDelegationTurnCount: dependencies.incrementDelegationTurnCount,
      appendRunEvent: dependencies.appendRunEvent,
      setRunStepStatus: dependencies.setRunStepStatus,
      updateRunStatus: dependencies.updateRunStatus,
      getDelegationTurnState: dependencies.getDelegationTurnState,
      executeLoopDirective: dependencies.executeLoopDirective,
      tryHandleActiveQueueCancellation: dependencies.tryHandleActiveQueueCancellation,
      tryHandleIntakeBridge: () => dependencies.tryHandleIntakeBridge(params.currentMessage),
    },
  }
}

export function prepareRootExecutionCyclePassLaunch(
  params: {
    runId: string
    sessionId: string
    requestGroupId: string
    source: RootLoopParams["source"]
    onChunk: RootLoopParams["onChunk"]
    signal: AbortSignal
    abortExecutionStream: () => void
    state: ExecutionCycleState
    executionSemantics: RootLoopParams["executionSemantics"]
    originalRequest: string
    structuredRequest?: RootLoopParams["structuredRequest"]
    requestMessage: string
    workDir: string
    toolsEnabled?: boolean
    workerSessionId?: string
    isRootRequest: boolean
    contextMode: RootLoopParams["contextMode"]
    taskProfile: RootLoopParams["taskProfile"]
    wantsDirectArtifactDelivery: boolean
    requiresFilesystemMutation: boolean
    requiresPrivilegedToolExecution: boolean
    pendingToolParams: RootLoopParams["pendingToolParams"]
    filesystemMutationPaths: RootLoopParams["filesystemMutationPaths"]
    seenFollowupPrompts: RootLoopParams["seenFollowupPrompts"]
    seenCommandFailureRecoveryKeys: RootLoopParams["seenCommandFailureRecoveryKeys"]
    seenExecutionRecoveryKeys: RootLoopParams["seenExecutionRecoveryKeys"]
    seenDeliveryRecoveryKeys: RootLoopParams["seenDeliveryRecoveryKeys"]
    seenAiRecoveryKeys: RootLoopParams["seenAiRecoveryKeys"]
    recoveryBudgetUsage: RootLoopParams["recoveryBudgetUsage"]
    priorAssistantMessages: RootLoopParams["priorAssistantMessages"]
    syntheticApprovalRuntimeDependencies: RootLoopParams["syntheticApprovalRuntimeDependencies"]
    defaultMaxDelegationTurns: number
  },
  dependencies: RootLoopDependencies,
): RootExecutionCyclePassLaunch {
  const executionMessage = params.structuredRequest && params.state.currentMessage === params.requestMessage
    ? buildStructuredExecutionBrief({
      header: "[Root Task Execution]",
      introLines: [
        "이 요청은 intake를 마치고 실제 실행 단계로 전달되었습니다.",
      ],
      originalRequest: params.originalRequest,
      structuredRequest: params.structuredRequest,
      executionSemantics: params.executionSemantics,
      closingLines: [
        "체크리스트 기준으로 실제 작업을 순서대로 수행하세요.",
        "완료되지 않은 항목이 남아 있으면 종료하지 말고 계속 진행하세요.",
      ],
    })
    : params.state.currentMessage

  return {
    params: {
      runId: params.runId,
      sessionId: params.sessionId,
      requestGroupId: params.requestGroupId,
      source: params.source,
      onChunk: params.onChunk,
      signal: params.signal,
      state: {
        ...params.state,
        currentMessage: executionMessage,
      },
      executionSemantics: params.executionSemantics,
      originalRequest: params.originalRequest,
      memorySearchQuery: params.requestMessage,
      verificationRequest: params.requestMessage,
      workDir: params.workDir,
      ...(params.toolsEnabled === false ? { toolsEnabled: false } : {}),
      ...(dependencies.onDeliveryError ? { onDeliveryError: dependencies.onDeliveryError } : {}),
      abortExecutionStream: params.abortExecutionStream,
      isRootRequest: params.isRootRequest,
      contextMode: params.contextMode,
      taskProfile: params.taskProfile,
      ...(params.workerSessionId ? { workerSessionId: params.workerSessionId } : {}),
      wantsDirectArtifactDelivery: params.wantsDirectArtifactDelivery,
      requiresFilesystemMutation: params.requiresFilesystemMutation,
      requiresPrivilegedToolExecution: params.requiresPrivilegedToolExecution,
      pendingToolParams: params.pendingToolParams,
      filesystemMutationPaths: params.filesystemMutationPaths,
      successfulTools: [],
      seenFollowupPrompts: params.seenFollowupPrompts,
      seenCommandFailureRecoveryKeys: params.seenCommandFailureRecoveryKeys,
      seenExecutionRecoveryKeys: params.seenExecutionRecoveryKeys,
      seenDeliveryRecoveryKeys: params.seenDeliveryRecoveryKeys,
      seenAiRecoveryKeys: params.seenAiRecoveryKeys,
      recoveryBudgetUsage: params.recoveryBudgetUsage,
      priorAssistantMessages: params.priorAssistantMessages,
      syntheticApprovalAlreadyApproved: dependencies.getSyntheticApprovalAlreadyApproved(),
      syntheticApprovalRuntimeDependencies: params.syntheticApprovalRuntimeDependencies,
      defaultMaxDelegationTurns: params.defaultMaxDelegationTurns,
    },
    dependencies: {
      rememberRunFailure: dependencies.rememberRunFailure,
      incrementDelegationTurnCount: dependencies.incrementDelegationTurnCount,
      appendRunEvent: dependencies.appendRunEvent,
      updateRunSummary: dependencies.updateRunSummary,
      setRunStepStatus: dependencies.setRunStepStatus,
      updateRunStatus: dependencies.updateRunStatus,
      markAbortedRunCancelledIfActive: dependencies.markAbortedRunCancelledIfActive,
      getDelegationTurnState: dependencies.getDelegationTurnState,
      getFinalizationDependencies: dependencies.getFinalizationDependencies,
      insertMessage: dependencies.insertMessage,
      writeReplyLog: dependencies.writeReplyLog,
      createId: dependencies.createId,
      now: dependencies.now,
      runVerificationSubtask: dependencies.runVerificationSubtask,
      rememberRunApprovalScope: dependencies.rememberRunApprovalScope,
      grantRunApprovalScope: dependencies.grantRunApprovalScope,
      grantRunSingleApproval: dependencies.grantRunSingleApproval,
      ...(dependencies.onReviewError ? { onReviewError: dependencies.onReviewError } : {}),
    },
  }
}
