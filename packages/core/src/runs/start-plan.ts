import type { AgentContextMode } from "../agent/index.js"
import {
  analyzeRequestEntrySemantics,
  type RequestEntrySemantics,
} from "./entry-semantics.js"
import {
  compareRequestContinuationWithAI,
  type RequestContinuationDecision,
} from "./entry-comparison.js"
import {
  findLatestWorkerSessionRun,
  getRequestGroupDelegationTurnCount,
  isReusableRequestGroup,
  listActiveSessionRequestGroups,
} from "./store.js"
import type { RootRun, TaskProfile } from "./types.js"
import type { WorkerRuntimeTarget } from "./worker-runtime.js"

export interface StartPlan {
  entrySemantics: RequestEntrySemantics
  requestedClosedRequestGroup: boolean
  shouldReconnectGroup: boolean
  reconnectTarget?: RootRun | undefined
  reconnectCandidateCount: number
  reconnectNeedsClarification: boolean
  requestGroupId: string
  isRootRequest: boolean
  effectiveTaskProfile: TaskProfile
  initialDelegationTurnCount: number
  shouldReuseContext: boolean
  effectiveContextMode: AgentContextMode
  workerSessionId?: string | undefined
  reusableWorkerSessionRun?: RootRun | undefined
}

interface StartPlanDependencies {
  analyzeRequestEntrySemantics: typeof analyzeRequestEntrySemantics
  isReusableRequestGroup: typeof isReusableRequestGroup
  listActiveSessionRequestGroups: typeof listActiveSessionRequestGroups
  compareRequestContinuation: (params: {
    message: string
    sessionId: string
    candidates: RootRun[]
    model?: string
  }) => Promise<RequestContinuationDecision>
  getRequestGroupDelegationTurnCount: typeof getRequestGroupDelegationTurnCount
  buildWorkerSessionId: (params: {
    runId: string
    isRootRequest: boolean
    requestGroupId: string
    taskProfile: TaskProfile
    targetId?: string
    workerRuntime?: WorkerRuntimeTarget
  }) => string | undefined
  normalizeTaskProfile: (taskProfile: TaskProfile | undefined) => TaskProfile
  findLatestWorkerSessionRun: typeof findLatestWorkerSessionRun
}

const defaultDependencies: StartPlanDependencies = {
  analyzeRequestEntrySemantics,
  isReusableRequestGroup,
  listActiveSessionRequestGroups,
  compareRequestContinuation: async ({ message, candidates, model }) => compareRequestContinuationWithAI({
    message,
    candidates,
    ...(model ? { model } : {}),
  }),
  getRequestGroupDelegationTurnCount,
  buildWorkerSessionId: () => undefined,
  normalizeTaskProfile: (taskProfile) => taskProfile ?? "general_chat",
  findLatestWorkerSessionRun,
}

export async function buildStartPlan(
  params: {
    message: string
    sessionId: string
    runId: string
    requestGroupId?: string | undefined
    forceRequestGroupReuse?: boolean | undefined
    contextMode?: AgentContextMode | undefined
    taskProfile?: TaskProfile | undefined
    model?: string | undefined
    targetId?: string | undefined
    workerRuntime?: WorkerRuntimeTarget | undefined
  },
  dependencies: StartPlanDependencies,
): Promise<StartPlan> {
  const entrySemanticsBase = dependencies.analyzeRequestEntrySemantics(params.message)
  const explicitReusableRequestGroupId =
    params.requestGroupId && (params.forceRequestGroupReuse || dependencies.isReusableRequestGroup(params.requestGroupId))
      ? params.requestGroupId
      : undefined
  const requestedClosedRequestGroup = Boolean(params.requestGroupId && !params.forceRequestGroupReuse && !explicitReusableRequestGroupId)
  const reconnectCandidates = params.requestGroupId == null
    ? dependencies.listActiveSessionRequestGroups(params.sessionId, params.runId)
    : []
  const shouldCompareContinuation =
    params.requestGroupId == null
    && reconnectCandidates.length > 0
    && entrySemanticsBase.active_queue_cancellation_mode == null
  const reconnectDecision: RequestContinuationDecision = shouldCompareContinuation
    ? await dependencies.compareRequestContinuation({
        message: params.message,
        sessionId: params.sessionId,
        candidates: reconnectCandidates,
        ...(params.model ? { model: params.model } : {}),
      }).catch((): RequestContinuationDecision => ({ kind: "new", reason: "comparison failed" }))
    : { kind: "new", reason: "no comparison required" }
  const reconnectTarget = reconnectDecision.requestGroupId
    ? reconnectCandidates.find((candidate) => candidate.requestGroupId === reconnectDecision.requestGroupId)
    : undefined
  const reconnectCandidateCount = reconnectCandidates.length
  const shouldReconnectGroup = reconnectDecision.kind !== "new"
  const reconnectNeedsClarification = Boolean(
    reconnectDecision.kind === "clarify"
      && explicitReusableRequestGroupId == null
      && reconnectCandidateCount > 0
      && !reconnectTarget,
  )
  const requestGroupId =
    explicitReusableRequestGroupId
    ?? (reconnectNeedsClarification ? params.runId : reconnectTarget?.requestGroupId)
    ?? params.runId
  const isRootRequest = requestGroupId === params.runId
  const effectiveTaskProfile = dependencies.normalizeTaskProfile(params.taskProfile)
  const initialDelegationTurnCount = isRootRequest ? 0 : dependencies.getRequestGroupDelegationTurnCount(requestGroupId)
  const shouldReuseContext = Boolean(explicitReusableRequestGroupId || reconnectTarget)
  const entrySemantics: RequestEntrySemantics = {
    ...entrySemanticsBase,
    reuse_conversation_context: shouldReuseContext,
  }
  const effectiveContextMode =
    params.contextMode
    ?? (isRootRequest ? (shouldReuseContext ? "full" : "isolated") : "request_group")
  const workerSessionId = dependencies.buildWorkerSessionId({
    runId: params.runId,
    isRootRequest,
    requestGroupId,
    taskProfile: effectiveTaskProfile,
    ...(params.targetId ? { targetId: params.targetId } : {}),
    ...(params.workerRuntime ? { workerRuntime: params.workerRuntime } : {}),
  })
  const reusableWorkerSessionRun = workerSessionId
    ? dependencies.findLatestWorkerSessionRun(requestGroupId, workerSessionId)
    : undefined

  return {
    entrySemantics,
    requestedClosedRequestGroup,
    shouldReconnectGroup,
    ...(reconnectTarget ? { reconnectTarget } : {}),
    reconnectCandidateCount,
    reconnectNeedsClarification,
    requestGroupId,
    isRootRequest,
    effectiveTaskProfile,
    initialDelegationTurnCount,
    shouldReuseContext,
    effectiveContextMode,
    ...(workerSessionId ? { workerSessionId } : {}),
    ...(reusableWorkerSessionRun ? { reusableWorkerSessionRun } : {}),
  }
}

export { defaultDependencies as defaultStartPlanDependencies }
