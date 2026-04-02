import { bootstrapLoopState } from "./loop-bootstrap.js"
import type { LoopDirective } from "./loop-directive.js"
import type { ExecutionCycleState } from "./execution-cycle-pass.js"
import type { RootLoopDependencies, RootLoopParams } from "./root-loop.js"

export interface RootLoopBootstrapState {
  intakeProcessed: boolean
  pendingLoopDirective: LoopDirective | null
  state: ExecutionCycleState
}

export function prepareRootLoopBootstrapState(
  params: RootLoopParams,
  dependencies: RootLoopDependencies,
): RootLoopBootstrapState {
  const loopBootstrap = bootstrapLoopState({
    runId: params.runId,
    sessionId: params.sessionId,
    skipIntake: params.skipIntake,
    immediateCompletionText: params.immediateCompletionText,
    reconnectNeedsClarification: params.reconnectNeedsClarification,
    ...(params.reconnectTargetTitle ? { reconnectTarget: { title: params.reconnectTargetTitle } } : {}),
    ...(params.reconnectSelection ? { reconnectSelection: params.reconnectSelection } : {}),
    queuedBehindRequestGroupRun: params.queuedBehindRequestGroupRun,
    aborted: params.controller.signal.aborted,
    ...(params.activeWorkerRuntime ? { activeWorkerRuntime: params.activeWorkerRuntime } : {}),
    requiresFilesystemMutation: params.requiresFilesystemMutation,
    requiresPrivilegedToolExecution: params.requiresPrivilegedToolExecution,
  }, {
    appendRunEvent: dependencies.appendRunEvent,
    updateRunSummary: dependencies.updateRunSummary,
    setRunStepStatus: dependencies.setRunStepStatus,
    updateRunStatus: dependencies.updateRunStatus,
    logInfo: dependencies.onBootstrapInfo ?? (() => {}),
  })

  return {
    intakeProcessed: loopBootstrap.intakeProcessed,
    pendingLoopDirective: loopBootstrap.pendingLoopDirective,
    state: {
      currentMessage: params.currentMessage,
      currentModel: params.currentModel,
      currentProviderId: params.currentProviderId,
      currentProvider: params.currentProvider,
      currentTargetId: params.currentTargetId,
      currentTargetLabel: params.currentTargetLabel,
      activeWorkerRuntime: loopBootstrap.activeWorkerRuntime,
      executionRecoveryLimitStop: null,
      llmRecoveryLimitStop: null,
      sawRealFilesystemMutation: false,
      filesystemMutationRecoveryAttempted: false,
      truncatedOutputRecoveryAttempted: false,
    },
  }
}
