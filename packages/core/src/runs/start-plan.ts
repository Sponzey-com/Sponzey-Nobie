import type { AgentContextMode } from "../agent/index.js"
import {
  analyzeRequestEntrySemantics,
  type RequestEntrySemantics,
} from "./entry-semantics.js"
import {
  findLatestWorkerSessionRun,
  findReconnectRequestGroupSelection,
  getRequestGroupDelegationTurnCount,
  isReusableRequestGroup,
  type ReconnectRequestGroupSelection,
} from "./store.js"
import type { RootRun, TaskProfile } from "./types.js"
import type { WorkerRuntimeTarget } from "./worker-runtime.js"

export interface StartPlan {
  entrySemantics: RequestEntrySemantics
  requestedClosedRequestGroup: boolean
  shouldReconnectGroup: boolean
  reconnectSelection?: ReconnectRequestGroupSelection | undefined
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
  findReconnectRequestGroupSelection: typeof findReconnectRequestGroupSelection
  getRequestGroupDelegationTurnCount: typeof getRequestGroupDelegationTurnCount
  buildWorkerSessionId: (params: {
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
  findReconnectRequestGroupSelection,
  getRequestGroupDelegationTurnCount,
  buildWorkerSessionId: () => undefined,
  normalizeTaskProfile: (taskProfile) => taskProfile ?? "general_chat",
  findLatestWorkerSessionRun,
}

export function buildStartPlan(
  params: {
    message: string
    sessionId: string
    runId: string
    requestGroupId?: string | undefined
    forceRequestGroupReuse?: boolean | undefined
    contextMode?: AgentContextMode | undefined
    taskProfile?: TaskProfile | undefined
    targetId?: string | undefined
    workerRuntime?: WorkerRuntimeTarget | undefined
  },
  dependencies: StartPlanDependencies,
): StartPlan {
  const entrySemantics = dependencies.analyzeRequestEntrySemantics(params.message)
  const explicitReusableRequestGroupId =
    params.requestGroupId && (params.forceRequestGroupReuse || dependencies.isReusableRequestGroup(params.requestGroupId))
      ? params.requestGroupId
      : undefined
  const requestedClosedRequestGroup = Boolean(params.requestGroupId && !params.forceRequestGroupReuse && !explicitReusableRequestGroupId)
  const shouldReconnectGroup = params.requestGroupId == null && entrySemantics.reuse_conversation_context
  const reconnectSelection = shouldReconnectGroup
    ? dependencies.findReconnectRequestGroupSelection(params.sessionId, params.message)
    : undefined
  const reconnectTarget = reconnectSelection?.best
  const reconnectCandidateCount = reconnectSelection?.candidates?.length ?? 0
  const reconnectNeedsClarification = Boolean(
    shouldReconnectGroup
      && explicitReusableRequestGroupId == null
      && reconnectCandidateCount > 0
      && (!reconnectTarget || reconnectSelection?.ambiguous),
  )
  const requestGroupId =
    explicitReusableRequestGroupId
    ?? (reconnectNeedsClarification ? params.runId : reconnectTarget?.requestGroupId)
    ?? params.runId
  const isRootRequest = requestGroupId === params.runId
  const effectiveTaskProfile = dependencies.normalizeTaskProfile(params.taskProfile)
  const initialDelegationTurnCount = isRootRequest ? 0 : dependencies.getRequestGroupDelegationTurnCount(requestGroupId)
  const shouldReuseContext = entrySemantics.reuse_conversation_context
  const effectiveContextMode =
    params.contextMode
    ?? (isRootRequest ? (shouldReuseContext ? "full" : "isolated") : "request_group")
  const workerSessionId = dependencies.buildWorkerSessionId({
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
    ...(reconnectSelection ? { reconnectSelection } : {}),
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
