import type { AgentContextMode } from "../agent/index.js"
import type { TaskExecutionSemantics, TaskIntentEnvelope, TaskStructuredRequest } from "../agent/intake.js"
import type { insertMessage } from "../db/index.js"
import type { LLMProvider } from "../llm/index.js"
import type { SyntheticApprovalRuntimeDependencies } from "./approval.js"
import type { RunChunkDeliveryHandler, logAssistantReply } from "./delivery.js"
import { createExecutionLoopRuntimeState } from "./execution-profile.js"
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js"
import type { LoopDirective } from "./loop-directive.js"
import { applyRootRunDriverFailure } from "./root-run-driver-failure.js"
import { prepareRootLoopLaunch } from "./root-loop-launch.js"
import { runRootLoop } from "./root-loop.js"
import type { ReconnectRequestGroupSelection } from "./store.js"
import type { TaskProfile } from "./types.js"
import type { WorkerRuntimeTarget } from "./worker-runtime.js"

export interface RootRunDriverDependencies {
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
  insertMessage: typeof insertMessage
  writeReplyLog: typeof logAssistantReply
  createId: () => string
  now: () => number
  runVerificationSubtask: (params: {
    originalRequest: string
    mutationPaths: string[]
  }) => Promise<{ ok: boolean; summary: string; reason?: string; remainingItems?: string[] }>
  rememberRunApprovalScope: (runId: string) => void
  grantRunApprovalScope: (runId: string) => void
  grantRunSingleApproval: (runId: string) => void
  onDeliveryError?: (message: string) => void
  onReviewError?: (message: string) => void
  executeLoopDirective: (directive: LoopDirective) => Promise<"break">
  tryHandleActiveQueueCancellation: () => Promise<LoopDirective | null>
  tryHandleIntakeBridge: (params: {
    currentMessage: string
    originalRequest: string
  }) => Promise<LoopDirective | null>
  getSyntheticApprovalAlreadyApproved: () => boolean
  onBootstrapInfo?: (message: string, payload?: Record<string, unknown>) => void
  onFinally?: () => void
}

interface RootRunDriverModuleDependencies {
  createExecutionLoopRuntimeState: typeof createExecutionLoopRuntimeState
  prepareRootLoopLaunch: typeof prepareRootLoopLaunch
  runRootLoop: typeof runRootLoop
  applyRootRunDriverFailure: typeof applyRootRunDriverFailure
}

const defaultModuleDependencies: RootRunDriverModuleDependencies = {
  createExecutionLoopRuntimeState,
  prepareRootLoopLaunch,
  runRootLoop,
  applyRootRunDriverFailure,
}

export async function executeRootRunDriver(
  params: {
    runId: string
    sessionId: string
    requestGroupId: string
    source: FinalizationSource
    onChunk: RunChunkDeliveryHandler | undefined
    controller: AbortController
    message: string
    originalRequest?: string
    executionSemantics?: TaskExecutionSemantics
    structuredRequest?: TaskStructuredRequest
    intentEnvelope?: TaskIntentEnvelope
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
  moduleDependencies: RootRunDriverModuleDependencies = defaultModuleDependencies,
): Promise<void> {
  const executionLoopRuntime = moduleDependencies.createExecutionLoopRuntimeState({
    message: params.message,
    ...(params.originalRequest ? { originalRequest: params.originalRequest } : {}),
    ...(params.executionSemantics ? { executionSemantics: params.executionSemantics } : {}),
    ...(params.structuredRequest ? { structuredRequest: params.structuredRequest } : {}),
    ...(params.intentEnvelope ? { intentEnvelope: params.intentEnvelope } : {}),
  })
  const rootLoopLaunch = moduleDependencies.prepareRootLoopLaunch({
    runId: params.runId,
    sessionId: params.sessionId,
    requestGroupId: params.requestGroupId,
    source: params.source,
    onChunk: params.onChunk,
    controller: params.controller,
    message: params.message,
    currentModel: params.currentModel,
    currentProviderId: params.currentProviderId,
    currentProvider: params.currentProvider,
    currentTargetId: params.currentTargetId,
    currentTargetLabel: params.currentTargetLabel,
    workDir: params.workDir,
    ...(params.skipIntake ? { skipIntake: params.skipIntake } : {}),
    ...(params.immediateCompletionText ? { immediateCompletionText: params.immediateCompletionText } : {}),
    reconnectNeedsClarification: params.reconnectNeedsClarification,
    ...(params.reconnectTargetTitle ? { reconnectTargetTitle: params.reconnectTargetTitle } : {}),
    ...(params.reconnectSelection ? { reconnectSelection: params.reconnectSelection } : {}),
    queuedBehindRequestGroupRun: params.queuedBehindRequestGroupRun,
    activeWorkerRuntime: params.activeWorkerRuntime,
    ...(params.workerSessionId ? { workerSessionId: params.workerSessionId } : {}),
    ...(params.toolsEnabled === false ? { toolsEnabled: false } : {}),
    isRootRequest: params.isRootRequest,
    contextMode: params.contextMode,
    taskProfile: params.taskProfile,
    syntheticApprovalRuntimeDependencies: params.syntheticApprovalRuntimeDependencies,
    defaultMaxDelegationTurns: params.defaultMaxDelegationTurns,
  }, dependencies, executionLoopRuntime)

  try {
    await new Promise<void>((resolve) => setImmediate(resolve))
    await moduleDependencies.runRootLoop(rootLoopLaunch.rootLoopParams, rootLoopLaunch.rootLoopDependencies)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await moduleDependencies.applyRootRunDriverFailure({
      runId: params.runId,
      sessionId: params.sessionId,
      source: params.source,
      onChunk: params.onChunk,
      aborted: params.controller.signal.aborted,
      message,
    }, {
      appendRunEvent: dependencies.appendRunEvent,
      setRunStepStatus: dependencies.setRunStepStatus,
      updateRunStatus: dependencies.updateRunStatus,
      rememberRunFailure: dependencies.rememberRunFailure,
      markAbortedRunCancelledIfActive: dependencies.markAbortedRunCancelledIfActive,
      ...(dependencies.onDeliveryError ? { onDeliveryError: dependencies.onDeliveryError } : {}),
    })
  } finally {
    dependencies.onFinally?.()
  }
}
