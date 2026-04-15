import type { AgentContextMode } from "../agent/index.js"
import type { IntentContract } from "../contracts/index.js"
import { analyzeRequestEntrySemantics } from "./entry-semantics.js"
import { compareRequestContinuationWithAI } from "./entry-comparison.js"
import type { RootRun, TaskProfile } from "./types.js"
import type { WorkerRuntimeTarget } from "./worker-runtime.js"
import { buildStartPlan, type StartPlan } from "./start-plan.js"
import { applyStartInitialization } from "./start-initialization.js"
import {
  buildWorkerSessionId,
  ensureSessionExists,
  normalizeTaskProfile,
  rememberRunInstruction,
} from "./start-support.js"
import {
  appendRunEvent,
  bindActiveRunController,
  interruptOrphanWorkerSessionRuns,
  findLatestWorkerSessionRun,
  getRequestGroupDelegationTurnCount,
  isReusableRequestGroup,
  listActiveSessionRequestGroups,
  createRootRun,
  setRunStepStatus,
  updateRunStatus,
  updateRunSummary,
} from "./store.js"

interface StartLaunchDependencies {
  buildStartPlan: typeof buildStartPlan
  analyzeRequestEntrySemantics: typeof analyzeRequestEntrySemantics
  isReusableRequestGroup: typeof isReusableRequestGroup
  listActiveSessionRequestGroups: typeof listActiveSessionRequestGroups
  compareRequestContinuation: typeof compareRequestContinuationWithAI
  getRequestGroupDelegationTurnCount: typeof getRequestGroupDelegationTurnCount
  buildWorkerSessionId: (params: {
    runId: string
    isRootRequest: boolean
    requestGroupId: string
    taskProfile: TaskProfile
    targetId?: string
    workerRuntime?: WorkerRuntimeTarget
  }) => string | undefined
  normalizeTaskProfile: (taskProfile: string | undefined) => TaskProfile
  findLatestWorkerSessionRun: typeof findLatestWorkerSessionRun
  ensureSessionExists: (sessionId: string, source: RootRun["source"], now: number) => void
  createRootRun: typeof createRootRun
  applyStartInitialization: typeof applyStartInitialization
  rememberRunInstruction: Parameters<typeof applyStartInitialization>[1]["rememberRunInstruction"]
  bindActiveRunController: Parameters<typeof applyStartInitialization>[1]["bindActiveRunController"]
  interruptOrphanWorkerSessionRuns: Parameters<typeof applyStartInitialization>[1]["interruptOrphanWorkerSessionRuns"]
  appendRunEvent: Parameters<typeof applyStartInitialization>[1]["appendRunEvent"]
  updateRunSummary: Parameters<typeof applyStartInitialization>[1]["updateRunSummary"]
  setRunStepStatus: Parameters<typeof applyStartInitialization>[1]["setRunStepStatus"]
  updateRunStatus: Parameters<typeof applyStartInitialization>[1]["updateRunStatus"]
}

const defaultDependencies: StartLaunchDependencies = {
  buildStartPlan,
  analyzeRequestEntrySemantics,
  isReusableRequestGroup,
  listActiveSessionRequestGroups,
  compareRequestContinuation: compareRequestContinuationWithAI,
  getRequestGroupDelegationTurnCount,
  buildWorkerSessionId,
  normalizeTaskProfile,
  findLatestWorkerSessionRun,
  ensureSessionExists,
  createRootRun,
  applyStartInitialization,
  rememberRunInstruction,
  bindActiveRunController,
  interruptOrphanWorkerSessionRuns,
  appendRunEvent,
  updateRunSummary,
  setRunStepStatus,
  updateRunStatus,
}

export interface PreparedStartLaunch {
  startPlan: StartPlan
  run: RootRun
  queuedBehindRequestGroupRun: boolean
}

export async function prepareStartLaunch(
  params: {
    message: string
    sessionId: string
    runId: string
    targetRunId?: string | undefined
    source: RootRun["source"]
    incomingIntentContract?: IntentContract | undefined
    controller: AbortController
    now: number
    maxDelegationTurns: number
    requestGroupId?: string | undefined
    parentRunId?: string | undefined
    originRunId?: string | undefined
    originRequestGroupId?: string | undefined
    forceRequestGroupReuse?: boolean | undefined
    contextMode?: AgentContextMode | undefined
    taskProfile?: TaskProfile | undefined
    runScope?: "root" | "child" | "analysis" | undefined
    handoffSummary?: string | undefined
    targetId?: string | undefined
    targetLabel?: string | undefined
    model?: string | undefined
    workerRuntime?: WorkerRuntimeTarget | undefined
    hasRequestGroupExecutionQueue: (requestGroupId: string) => boolean
  },
  dependencies: StartLaunchDependencies = defaultDependencies,
): Promise<PreparedStartLaunch> {
  const startPlan = await dependencies.buildStartPlan({
    message: params.message,
    sessionId: params.sessionId,
    runId: params.runId,
    ...(params.targetRunId ? { targetRunId: params.targetRunId } : {}),
    source: params.source,
    ...(params.incomingIntentContract ? { incomingIntentContract: params.incomingIntentContract } : {}),
    ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
    ...(params.forceRequestGroupReuse ? { forceRequestGroupReuse: params.forceRequestGroupReuse } : {}),
    ...(params.contextMode ? { contextMode: params.contextMode } : {}),
    ...(params.taskProfile ? { taskProfile: params.taskProfile } : {}),
    ...(params.model ? { model: params.model } : {}),
    ...(params.targetId ? { targetId: params.targetId } : {}),
    ...(params.workerRuntime ? { workerRuntime: params.workerRuntime } : {}),
  }, {
    analyzeRequestEntrySemantics: dependencies.analyzeRequestEntrySemantics,
    isReusableRequestGroup: dependencies.isReusableRequestGroup,
    listActiveSessionRequestGroups: dependencies.listActiveSessionRequestGroups,
    compareRequestContinuation: dependencies.compareRequestContinuation,
    getRequestGroupDelegationTurnCount: dependencies.getRequestGroupDelegationTurnCount,
    buildWorkerSessionId: dependencies.buildWorkerSessionId,
    normalizeTaskProfile: dependencies.normalizeTaskProfile,
    findLatestWorkerSessionRun: dependencies.findLatestWorkerSessionRun,
  } as Parameters<typeof buildStartPlan>[1])

  dependencies.ensureSessionExists(params.sessionId, params.source, params.now)

  const run = dependencies.createRootRun({
    id: params.runId,
    sessionId: params.sessionId,
    requestGroupId: startPlan.requestGroupId,
    lineageRootRunId: startPlan.requestGroupId,
    ...(params.parentRunId ? { parentRunId: params.parentRunId } : {}),
    ...(params.runScope ? { runScope: params.runScope } : {}),
    ...(params.handoffSummary ? { handoffSummary: params.handoffSummary } : {}),
    prompt: params.message,
    source: params.source,
    maxDelegationTurns: params.maxDelegationTurns,
    ...(params.targetId ? { targetId: params.targetId } : {}),
    ...(params.targetLabel?.trim() ? { targetLabel: params.targetLabel.trim() } : {}),
    taskProfile: startPlan.effectiveTaskProfile,
    delegationTurnCount: startPlan.initialDelegationTurnCount,
    ...(params.workerRuntime ? { workerRuntimeKind: params.workerRuntime.kind } : {}),
    ...(startPlan.workerSessionId ? { workerSessionId: startPlan.workerSessionId } : {}),
    contextMode: startPlan.effectiveContextMode,
  })

  const startInitialization = dependencies.applyStartInitialization({
    runId: params.runId,
    sessionId: params.sessionId,
    requestGroupId: startPlan.requestGroupId,
    ...(params.originRunId ? { originRunId: params.originRunId } : {}),
    ...(params.originRequestGroupId ? { originRequestGroupId: params.originRequestGroupId } : {}),
    source: params.source,
    message: params.message,
    controller: params.controller,
    requestGroupExecutionQueueActive: params.hasRequestGroupExecutionQueue(startPlan.requestGroupId),
    ...(params.targetLabel?.trim() ? { targetLabel: params.targetLabel.trim() } : {}),
    ...(params.model ? { model: params.model } : {}),
    ...(startPlan.reconnectTarget ? { reconnectTargetTitle: startPlan.reconnectTarget.title } : {}),
    shouldReconnectGroup: startPlan.shouldReconnectGroup,
    reconnectCandidateCount: startPlan.reconnectCandidateCount,
    requestedClosedRequestGroup: startPlan.requestedClosedRequestGroup,
    ...(startPlan.workerSessionId ? { workerSessionId: startPlan.workerSessionId } : {}),
    ...(startPlan.reusableWorkerSessionRun ? { reusableWorkerSessionRun: true } : {}),
  }, {
    rememberRunInstruction: dependencies.rememberRunInstruction,
    bindActiveRunController: dependencies.bindActiveRunController,
    interruptOrphanWorkerSessionRuns: dependencies.interruptOrphanWorkerSessionRuns,
    appendRunEvent: dependencies.appendRunEvent,
    updateRunSummary: dependencies.updateRunSummary,
    setRunStepStatus: dependencies.setRunStepStatus,
    updateRunStatus: dependencies.updateRunStatus,
  })

  return {
    startPlan,
    run,
    queuedBehindRequestGroupRun: startInitialization.queuedBehindRequestGroupRun,
  }
}
