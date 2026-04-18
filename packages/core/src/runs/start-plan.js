import { createExplicitIdProvider, createStoreCandidateProvider, runCandidateProviders, } from "../candidates/index.js";
import { buildLatencyEventLabel, buildLatencyEventLabelForMeasurement, recordLatencyMetric, } from "../observability/latency.js";
import { analyzeRequestEntrySemantics, } from "./entry-semantics.js";
import { compareRequestContinuationWithAI, } from "./entry-comparison.js";
import { buildActiveRunProjections, buildIncomingIntentContract, } from "./active-run-projection.js";
import { findLatestWorkerSessionRun, getRequestGroupDelegationTurnCount, isReusableRequestGroup, listActiveSessionRequestGroups, } from "./store.js";
import { detectExplicitToolIntent, hasExplicitContinuationReference, shouldInspectActiveRunCandidates, } from "./request-isolation.js";
const defaultDependencies = {
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
};
function isStandaloneLocalExecutionAction(message, explicitContinuationReference) {
    return !explicitContinuationReference && detectExplicitToolIntent(message) != null;
}
export async function buildStartPlan(params, dependencies) {
    const latencyEvents = [];
    const normalizerStartedAt = Date.now();
    const entrySemanticsBase = dependencies.analyzeRequestEntrySemantics(params.message);
    latencyEvents.push(buildLatencyEventLabel(recordLatencyMetric({
        name: "normalizer_latency_ms",
        durationMs: Date.now() - normalizerStartedAt,
        runId: params.runId,
        sessionId: params.sessionId,
        ...(params.source ? { source: params.source } : {}),
    })));
    const explicitReusableRequestGroupId = params.requestGroupId && (params.forceRequestGroupReuse || dependencies.isReusableRequestGroup(params.requestGroupId))
        ? params.requestGroupId
        : undefined;
    const requestedClosedRequestGroup = Boolean(params.requestGroupId && !params.forceRequestGroupReuse && !explicitReusableRequestGroupId);
    const hasStructuredIncomingContract = params.incomingIntentContract != null;
    const hasExplicitCandidateId = Boolean(params.targetRunId || params.approvalId);
    const shouldInspectActiveRuns = shouldInspectActiveRunCandidates({
        message: params.message,
        hasStructuredIncomingContract,
        hasExplicitCandidateId,
        hasRequestGroupId: params.requestGroupId != null,
        ...(params.forceRequestGroupReuse ? { forceRequestGroupReuse: params.forceRequestGroupReuse } : {}),
        ...(params.incomingIntentContract ? { incomingIntentContract: params.incomingIntentContract } : {}),
    });
    const reconnectCandidates = shouldInspectActiveRuns
        ? dependencies.listActiveSessionRequestGroups(params.sessionId, params.runId)
        : [];
    const rawReconnectCandidateProjections = buildActiveRunProjections(reconnectCandidates);
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
            resolve: (id) => rawReconnectCandidateProjections.find((candidate) => (candidate.runId === id
                || candidate.requestGroupId === id
                || candidate.approvalId === id)),
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
    });
    const reconnectCandidateProjections = candidateSearch.candidates.map((candidate) => candidate.payload);
    for (const trace of candidateSearch.traces) {
        if (trace.skipped)
            continue;
        latencyEvents.push(`${buildLatencyEventLabelForMeasurement({
            name: "candidate_search_latency_ms",
            durationMs: trace.durationMs,
            timeout: trace.timedOut === true,
        })} provider=${trace.providerId}`);
    }
    const explicitTarget = candidateSearch.candidates.find((candidate) => candidate.source === "explicit_id")?.payload;
    const incomingContract = params.incomingIntentContract ?? buildIncomingIntentContract({
        sessionId: params.sessionId,
        ...(params.source ? { source: params.source } : {}),
        ...(params.targetId ? { targetId: params.targetId } : {}),
    });
    const explicitContinuationReference = hasExplicitContinuationReference(params.message);
    const shouldBypassReconnectComparison = isStandaloneLocalExecutionAction(params.message, explicitContinuationReference);
    const shouldCompareContinuation = hasStructuredIncomingContract
        && params.requestGroupId == null
        && !explicitTarget
        && reconnectCandidateProjections.length > 0
        && entrySemanticsBase.active_queue_cancellation_mode == null
        && !shouldBypassReconnectComparison
        && explicitContinuationReference;
    const reconnectDecision = shouldCompareContinuation
        ? await (async () => {
            const comparisonStartedAt = Date.now();
            try {
                return await dependencies.compareRequestContinuation({
                    // nobie-critical-decision-audit: start-plan.contract_continuation_boundary
                    // Continuation comparison receives contracts and projection ids, never candidate raw prompts.
                    incomingContract,
                    sessionId: params.sessionId,
                    candidates: reconnectCandidateProjections,
                    ...(params.model ? { model: params.model } : {}),
                });
            }
            catch {
                return { kind: "new_run", decisionSource: "safe_fallback", reason: "comparison failed" };
            }
            finally {
                latencyEvents.push(buildLatencyEventLabel(recordLatencyMetric({
                    name: "contract_ai_comparison_latency_ms",
                    durationMs: Date.now() - comparisonStartedAt,
                    runId: params.runId,
                    sessionId: params.sessionId,
                    ...(params.source ? { source: params.source } : {}),
                })));
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
            : { kind: "new_run", decisionSource: "safe_fallback", reason: "no comparison required" };
    const reconnectTarget = reconnectDecision.requestGroupId
        ? reconnectCandidates.find((candidate) => candidate.requestGroupId === reconnectDecision.requestGroupId)
        : undefined;
    const reconnectCandidateCount = reconnectCandidates.length;
    const shouldReconnectGroup = reconnectDecision.kind !== "new_run";
    const reconnectNeedsClarification = Boolean(reconnectDecision.kind === "clarify"
        && explicitReusableRequestGroupId == null
        && reconnectCandidateCount > 0
        && !reconnectTarget);
    const requestGroupId = explicitReusableRequestGroupId
        ?? (reconnectNeedsClarification ? params.runId : reconnectTarget?.requestGroupId)
        ?? params.runId;
    const isRootRequest = requestGroupId === params.runId;
    const effectiveTaskProfile = dependencies.normalizeTaskProfile(params.taskProfile);
    const initialDelegationTurnCount = isRootRequest ? 0 : dependencies.getRequestGroupDelegationTurnCount(requestGroupId);
    const shouldReuseContext = Boolean(explicitReusableRequestGroupId || reconnectTarget);
    const entrySemantics = {
        ...entrySemanticsBase,
        reuse_conversation_context: shouldReuseContext,
    };
    const effectiveContextMode = params.contextMode
        ?? (isRootRequest ? (shouldReuseContext ? "full" : "isolated") : "request_group");
    const workerSessionId = dependencies.buildWorkerSessionId({
        runId: params.runId,
        isRootRequest,
        requestGroupId,
        taskProfile: effectiveTaskProfile,
        ...(params.targetId ? { targetId: params.targetId } : {}),
        ...(params.workerRuntime ? { workerRuntime: params.workerRuntime } : {}),
    });
    const reusableWorkerSessionRun = workerSessionId
        ? dependencies.findLatestWorkerSessionRun(requestGroupId, workerSessionId)
        : undefined;
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
        latencyEvents,
    };
}
export { defaultDependencies as defaultStartPlanDependencies };
//# sourceMappingURL=start-plan.js.map