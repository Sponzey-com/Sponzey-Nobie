import type { AgentContextMode } from "../agent/index.js"
import type { IntentContract } from "../contracts/index.js"
import type { OrchestrationMode, OrchestrationPlan } from "../contracts/sub-agent-orchestration.js"
import {
  createExplicitIdProvider,
  createStoreCandidateProvider,
  runCandidateProviders,
} from "../candidates/index.js"
import { buildOrchestrationPlan } from "../orchestration/planner.js"
import type { OrchestrationPlannerIntent } from "../orchestration/planner.js"
import {
  resolveOrchestrationModeSnapshot,
  type OrchestrationModeSnapshot,
} from "../orchestration/mode.js"
import {
  buildLatencyEventLabel,
  buildLatencyEventLabelForMeasurement,
  recordLatencyMetric,
} from "../observability/latency.js"
import {
  analyzeRequestEntrySemantics,
  type RequestEntrySemantics,
} from "./entry-semantics.js"
import {
  compareRequestContinuationWithAI,
  type RequestContinuationDecision,
} from "./entry-comparison.js"
import {
  buildActiveRunProjections,
  buildIncomingIntentContract,
  type ActiveRunContractProjection,
} from "./active-run-projection.js"
import {
  findLatestWorkerSessionRun,
  getRequestGroupDelegationTurnCount,
  isReusableRequestGroup,
  listActiveSessionRequestGroups,
} from "./store.js"
import type { RootRun, TaskProfile } from "./types.js"
import type { WorkerRuntimeTarget } from "./worker-runtime.js"
import {
  detectExplicitToolIntent,
  hasExplicitContinuationReference,
  shouldInspectActiveRunCandidates,
} from "./request-isolation.js"

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
  orchestrationMode: OrchestrationMode
  orchestrationRegistrySnapshot: OrchestrationModeSnapshot
  orchestrationPlanSnapshot: OrchestrationPlan
  workerSessionId?: string | undefined
  reusableWorkerSessionRun?: RootRun | undefined
  latencyEvents: string[]
}

interface StartPlanDependencies {
  analyzeRequestEntrySemantics: typeof analyzeRequestEntrySemantics
  isReusableRequestGroup: typeof isReusableRequestGroup
  listActiveSessionRequestGroups: typeof listActiveSessionRequestGroups
  compareRequestContinuation: (params: {
    incomingContract: ReturnType<typeof buildIncomingIntentContract>
    sessionId: string
    candidates: ActiveRunContractProjection[]
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
  resolveOrchestrationMode?: typeof resolveOrchestrationModeSnapshot
  buildOrchestrationPlan?: typeof buildOrchestrationPlan
}

const defaultDependencies: StartPlanDependencies = {
  analyzeRequestEntrySemantics,
  isReusableRequestGroup,
  listActiveSessionRequestGroups,
  compareRequestContinuation: async ({ incomingContract, candidates, model }) => compareRequestContinuationWithAI({
    incomingContract,
    candidates,
    ...(model ? { model } : {}),
  }),
  getRequestGroupDelegationTurnCount,
  buildWorkerSessionId: () => undefined,
  normalizeTaskProfile: (taskProfile) => taskProfile ?? "general_chat",
  findLatestWorkerSessionRun,
  resolveOrchestrationMode: resolveOrchestrationModeSnapshot,
  buildOrchestrationPlan,
}

function isStandaloneLocalExecutionAction(message: string, explicitContinuationReference: boolean): boolean {
  return !explicitContinuationReference && detectExplicitToolIntent(message) != null
}

export async function buildStartPlan(
  params: {
    message: string
    sessionId: string
    runId: string
    targetRunId?: string | undefined
    source?: RootRun["source"] | undefined
    incomingIntentContract?: IntentContract | undefined
    requestGroupId?: string | undefined
    approvalId?: string | undefined
    forceRequestGroupReuse?: boolean | undefined
    contextMode?: AgentContextMode | undefined
    taskProfile?: TaskProfile | undefined
    model?: string | undefined
    targetId?: string | undefined
    workerRuntime?: WorkerRuntimeTarget | undefined
    orchestrationPlannerIntent?: OrchestrationPlannerIntent | undefined
  },
  dependencies: StartPlanDependencies,
): Promise<StartPlan> {
  const latencyEvents: string[] = []
  const normalizerStartedAt = Date.now()
  const entrySemanticsBase = dependencies.analyzeRequestEntrySemantics(params.message)
  latencyEvents.push(buildLatencyEventLabel(recordLatencyMetric({
    name: "normalizer_latency_ms",
    durationMs: Date.now() - normalizerStartedAt,
    runId: params.runId,
    sessionId: params.sessionId,
    ...(params.source ? { source: params.source } : {}),
  })))
  const orchestrationModeStartedAt = Date.now()
  const orchestrationRegistrySnapshot = await (dependencies.resolveOrchestrationMode ?? resolveOrchestrationModeSnapshot)()
  const orchestrationRegistryLatencyMs = Date.now() - orchestrationModeStartedAt
  recordLatencyMetric({
    name: "registry_lookup_latency_ms",
    durationMs: orchestrationRegistryLatencyMs,
    runId: params.runId,
    sessionId: params.sessionId,
    ...(params.source ? { source: params.source } : {}),
  })
  latencyEvents.push(`${buildLatencyEventLabel(recordLatencyMetric({
    name: "orchestration_mode_latency_ms",
    durationMs: orchestrationRegistryLatencyMs,
    runId: params.runId,
    sessionId: params.sessionId,
    ...(params.source ? { source: params.source } : {}),
  }))} mode=${orchestrationRegistrySnapshot.mode}; reason=${orchestrationRegistrySnapshot.reasonCode}`)
  const orchestrationPlanStartedAt = Date.now()
  const orchestrationPlanSnapshot = (dependencies.buildOrchestrationPlan ?? buildOrchestrationPlan)({
    parentRunId: params.runId,
    parentRequestId: params.runId,
    userRequest: params.message,
    modeSnapshot: orchestrationRegistrySnapshot,
    ...(params.orchestrationPlannerIntent ? { intent: params.orchestrationPlannerIntent } : {}),
  }).plan
  latencyEvents.push(`${buildLatencyEventLabel(recordLatencyMetric({
    name: "orchestration_planning_latency_ms",
    durationMs: Date.now() - orchestrationPlanStartedAt,
    runId: params.runId,
    sessionId: params.sessionId,
    ...(params.source ? { source: params.source } : {}),
  }))} plan=${orchestrationPlanSnapshot.planId}; fallback=${orchestrationPlanSnapshot.fallbackStrategy.reasonCode}`)
  const explicitReusableRequestGroupId =
    params.requestGroupId && (params.forceRequestGroupReuse || dependencies.isReusableRequestGroup(params.requestGroupId))
      ? params.requestGroupId
      : undefined
  const requestedClosedRequestGroup = Boolean(params.requestGroupId && !params.forceRequestGroupReuse && !explicitReusableRequestGroupId)
  const hasStructuredIncomingContract = params.incomingIntentContract != null
  const hasExplicitCandidateId = Boolean(params.targetRunId || params.approvalId)
  const shouldInspectActiveRuns = shouldInspectActiveRunCandidates({
    message: params.message,
    hasStructuredIncomingContract,
    hasExplicitCandidateId,
    hasRequestGroupId: params.requestGroupId != null,
    ...(params.forceRequestGroupReuse ? { forceRequestGroupReuse: params.forceRequestGroupReuse } : {}),
    ...(params.incomingIntentContract ? { incomingIntentContract: params.incomingIntentContract } : {}),
  })
  const reconnectCandidates = shouldInspectActiveRuns
    ? dependencies.listActiveSessionRequestGroups(params.sessionId, params.runId)
    : []
  const rawReconnectCandidateProjections = buildActiveRunProjections(reconnectCandidates)
  const candidateSearch = await runCandidateProviders({
    runId: params.runId,
    sessionId: params.sessionId,
    ...(params.source ? { source: params.source } : {}),
    explicitIds: {
      ...(params.targetRunId ? { runId: params.targetRunId } : {}),
      ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
      ...(params.approvalId ? { approvalId: params.approvalId } : {}),
    },
    limit: 50,
  }, [
    createExplicitIdProvider({
      id: "active-run-explicit-id",
      candidateKind: "run",
      ids: (input) => [
        input.explicitIds?.runId,
        input.explicitIds?.requestGroupId,
        input.explicitIds?.approvalId,
      ],
      resolve: (id) => rawReconnectCandidateProjections.find((candidate) => (
        candidate.runId === id
        || candidate.requestGroupId === id
        || candidate.approvalId === id
      )),
      candidateId: (candidate) => candidate.runId,
    }),
    createStoreCandidateProvider({
      id: "active-run-store",
      source: "run_store",
      candidateKind: "run",
      candidateReason: "run_contract_projection",
      find: () => rawReconnectCandidateProjections,
      candidateId: (candidate) => candidate.runId,
      matchedKeys: (candidate) => [candidate.comparisonHash],
      requiresFinalDecision: true,
    }),
  ], {
    providerTimeoutMs: 100,
    skipSlowOnFastPath: true,
  })
  const reconnectCandidateProjections = candidateSearch.candidates.map((candidate) => candidate.payload)
  for (const trace of candidateSearch.traces) {
    if (trace.skipped) continue
    latencyEvents.push(`${buildLatencyEventLabelForMeasurement({
      name: "candidate_search_latency_ms",
      durationMs: trace.durationMs,
      timeout: trace.timedOut === true,
    })} provider=${trace.providerId}`)
  }
  const explicitTarget = candidateSearch.candidates.find((candidate) => candidate.source === "explicit_id")?.payload
  const incomingContract = params.incomingIntentContract ?? buildIncomingIntentContract({
    sessionId: params.sessionId,
    ...(params.source ? { source: params.source } : {}),
    ...(params.targetId ? { targetId: params.targetId } : {}),
  })
  const explicitContinuationReference = hasExplicitContinuationReference(params.message)
  const shouldBypassReconnectComparison = isStandaloneLocalExecutionAction(params.message, explicitContinuationReference)
  const shouldCompareContinuation =
    hasStructuredIncomingContract
    && params.requestGroupId == null
    && !explicitTarget
    && reconnectCandidateProjections.length > 0
    && entrySemanticsBase.active_queue_cancellation_mode == null
    && !shouldBypassReconnectComparison
    && explicitContinuationReference
  const reconnectDecision: RequestContinuationDecision = shouldCompareContinuation
    ? await (async (): Promise<RequestContinuationDecision> => {
        const comparisonStartedAt = Date.now()
        try {
          return await dependencies.compareRequestContinuation({
            // nobie-critical-decision-audit: start-plan.contract_continuation_boundary
            // Continuation comparison receives contracts and projection ids, never candidate raw prompts.
            incomingContract,
            sessionId: params.sessionId,
            candidates: reconnectCandidateProjections,
            ...(params.model ? { model: params.model } : {}),
          })
        } catch {
          return { kind: "new_run", decisionSource: "safe_fallback", reason: "comparison failed" }
        } finally {
          latencyEvents.push(buildLatencyEventLabel(recordLatencyMetric({
            name: "contract_ai_comparison_latency_ms",
            durationMs: Date.now() - comparisonStartedAt,
            runId: params.runId,
            sessionId: params.sessionId,
            ...(params.source ? { source: params.source } : {}),
          })))
        }
      })()
    : explicitTarget
      ? {
          kind: "same_run",
          requestGroupId: explicitTarget.requestGroupId,
          runId: explicitTarget.runId,
          decisionSource: "explicit_id",
          reason: "explicit id matched active run",
        }
      : { kind: "new_run", decisionSource: "safe_fallback", reason: "no comparison required" }
  const reconnectTarget = reconnectDecision.requestGroupId
    ? reconnectCandidates.find((candidate) => candidate.requestGroupId === reconnectDecision.requestGroupId)
    : undefined
  const reconnectCandidateCount = reconnectCandidates.length
  const shouldReconnectGroup = reconnectDecision.kind !== "new_run"
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
    orchestrationMode: orchestrationRegistrySnapshot.mode,
    orchestrationRegistrySnapshot,
    orchestrationPlanSnapshot,
    ...(workerSessionId ? { workerSessionId } : {}),
    ...(reusableWorkerSessionRun ? { reusableWorkerSessionRun } : {}),
    latencyEvents,
  }
}

export { defaultDependencies as defaultStartPlanDependencies }
