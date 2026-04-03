import type { AgentContextMode } from "../agent/index.js"
import type { TaskExecutionSemantics, TaskStructuredRequest } from "../agent/intake.js"
import type { LoopDirective } from "./loop-directive.js"
import type { ExecutionCycleState } from "./execution-cycle-pass.js"
import { prepareRootLoopBootstrapState } from "./root-loop-bootstrap-state.js"
import { runRootLoopTurn } from "./root-loop-turn.js"
import type { RunChunkDeliveryHandler } from "./delivery.js"
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js"
import type { RecoveryBudgetUsage } from "./recovery-budget.js"
import type { ReconnectRequestGroupSelection } from "./store.js"
import type { TaskProfile } from "./types.js"
import type { WorkerRuntimeTarget } from "./worker-runtime.js"
import type { AIProvider } from "../ai/index.js"
import type { SyntheticApprovalRuntimeDependencies } from "./approval.js"

export interface RootLoopDependencies {
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
  onBootstrapInfo?: (message: string, payload?: Record<string, unknown>) => void
}

interface RootLoopModuleDependencies {
  prepareRootLoopBootstrapState: typeof prepareRootLoopBootstrapState
  runRootLoopTurn: typeof runRootLoopTurn
}

const defaultModuleDependencies: RootLoopModuleDependencies = {
  prepareRootLoopBootstrapState,
  runRootLoopTurn,
}

export interface RootLoopParams {
  runId: string
  sessionId: string
  requestGroupId: string
  source: FinalizationSource
  onChunk: RunChunkDeliveryHandler | undefined
  controller: AbortController
  skipIntake?: boolean
  immediateCompletionText?: string
  reconnectNeedsClarification: boolean
  reconnectTargetTitle?: string
  reconnectSelection?: ReconnectRequestGroupSelection
  queuedBehindRequestGroupRun: boolean
  currentMessage: string
  currentModel: string | undefined
  currentProviderId: string | undefined
  currentProvider: AIProvider | undefined
  currentTargetId: string | undefined
  currentTargetLabel: string | undefined
  activeWorkerRuntime: WorkerRuntimeTarget | undefined
  workerSessionId?: string
  requestMessage: string
  originalRequest: string
  structuredRequest?: TaskStructuredRequest
  executionSemantics: TaskExecutionSemantics
  workDir: string
  toolsEnabled?: boolean
  isRootRequest: boolean
  contextMode: AgentContextMode
  taskProfile: TaskProfile
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
  recoveryBudgetUsage: RecoveryBudgetUsage
  priorAssistantMessages: string[]
  syntheticApprovalRuntimeDependencies: SyntheticApprovalRuntimeDependencies
  defaultMaxDelegationTurns: number
}

export async function runRootLoop(
  params: RootLoopParams,
  dependencies: RootLoopDependencies,
  moduleDependencies: RootLoopModuleDependencies = defaultModuleDependencies,
): Promise<ExecutionCycleState> {
  const bootstrapState = moduleDependencies.prepareRootLoopBootstrapState(params, dependencies)

  let intakeProcessed = bootstrapState.intakeProcessed
  let pendingLoopDirective: LoopDirective | null = bootstrapState.pendingLoopDirective
  let state: ExecutionCycleState = bootstrapState.state

  while (!params.controller.signal.aborted) {
    const loopTurn = await moduleDependencies.runRootLoopTurn({
      runId: params.runId,
      sessionId: params.sessionId,
      requestGroupId: params.requestGroupId,
      source: params.source,
      onChunk: params.onChunk,
      signal: params.controller.signal,
      abortExecutionStream: () => params.controller.abort(),
      pendingLoopDirective,
      intakeProcessed,
      state,
      recoveryBudgetUsage: params.recoveryBudgetUsage,
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
      priorAssistantMessages: params.priorAssistantMessages,
      syntheticApprovalRuntimeDependencies: params.syntheticApprovalRuntimeDependencies,
      defaultMaxDelegationTurns: params.defaultMaxDelegationTurns,
    }, dependencies)

    if (loopTurn.kind === "break") {
      break
    }

    pendingLoopDirective = loopTurn.pendingLoopDirective
    intakeProcessed = loopTurn.intakeProcessed
    state = loopTurn.state
  }

  return state
}
