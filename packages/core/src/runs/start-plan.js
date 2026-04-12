import { analyzeRequestEntrySemantics, } from "./entry-semantics.js";
import { compareRequestContinuationWithAI, } from "./entry-comparison.js";
import { findLatestWorkerSessionRun, getRequestGroupDelegationTurnCount, isReusableRequestGroup, listActiveSessionRequestGroups, } from "./store.js";
const defaultDependencies = {
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
};
export async function buildStartPlan(params, dependencies) {
    const entrySemanticsBase = dependencies.analyzeRequestEntrySemantics(params.message);
    const explicitReusableRequestGroupId = params.requestGroupId && (params.forceRequestGroupReuse || dependencies.isReusableRequestGroup(params.requestGroupId))
        ? params.requestGroupId
        : undefined;
    const requestedClosedRequestGroup = Boolean(params.requestGroupId && !params.forceRequestGroupReuse && !explicitReusableRequestGroupId);
    const reconnectCandidates = params.requestGroupId == null
        ? dependencies.listActiveSessionRequestGroups(params.sessionId, params.runId)
        : [];
    const shouldCompareContinuation = params.requestGroupId == null
        && reconnectCandidates.length > 0
        && entrySemanticsBase.active_queue_cancellation_mode == null;
    const reconnectDecision = shouldCompareContinuation
        ? await dependencies.compareRequestContinuation({
            message: params.message,
            sessionId: params.sessionId,
            candidates: reconnectCandidates,
            ...(params.model ? { model: params.model } : {}),
        }).catch(() => ({ kind: "new", reason: "comparison failed" }))
        : { kind: "new", reason: "no comparison required" };
    const reconnectTarget = reconnectDecision.requestGroupId
        ? reconnectCandidates.find((candidate) => candidate.requestGroupId === reconnectDecision.requestGroupId)
        : undefined;
    const reconnectCandidateCount = reconnectCandidates.length;
    const shouldReconnectGroup = reconnectDecision.kind !== "new";
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
    };
}
export { defaultDependencies as defaultStartPlanDependencies };
//# sourceMappingURL=start-plan.js.map