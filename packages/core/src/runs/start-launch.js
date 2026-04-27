import { analyzeRequestEntrySemantics } from "./entry-semantics.js";
import { compareRequestContinuationWithAI } from "./entry-comparison.js";
import { buildStartPlan } from "./start-plan.js";
import { applyStartInitialization } from "./start-initialization.js";
import { buildWorkerSessionId, ensureSessionExists, normalizeTaskProfile, rememberRunInstruction, } from "./start-support.js";
import { appendRunEvent, bindActiveRunController, interruptOrphanWorkerSessionRuns, findLatestWorkerSessionRun, getRequestGroupDelegationTurnCount, isReusableRequestGroup, listActiveSessionRequestGroups, createRootRun, setRunStepStatus, updateRunStatus, updateRunSummary, } from "./store.js";
const defaultDependencies = {
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
};
export async function prepareStartLaunch(params, dependencies = defaultDependencies) {
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
        ...(params.orchestrationPlannerIntent
            ? { orchestrationPlannerIntent: params.orchestrationPlannerIntent }
            : {}),
    }, {
        analyzeRequestEntrySemantics: dependencies.analyzeRequestEntrySemantics,
        isReusableRequestGroup: dependencies.isReusableRequestGroup,
        listActiveSessionRequestGroups: dependencies.listActiveSessionRequestGroups,
        compareRequestContinuation: dependencies.compareRequestContinuation,
        getRequestGroupDelegationTurnCount: dependencies.getRequestGroupDelegationTurnCount,
        buildWorkerSessionId: dependencies.buildWorkerSessionId,
        normalizeTaskProfile: dependencies.normalizeTaskProfile,
        findLatestWorkerSessionRun: dependencies.findLatestWorkerSessionRun,
        ...(dependencies.resolveOrchestrationMode ? { resolveOrchestrationMode: dependencies.resolveOrchestrationMode } : {}),
        ...(dependencies.buildOrchestrationPlan ? { buildOrchestrationPlan: dependencies.buildOrchestrationPlan } : {}),
    });
    dependencies.ensureSessionExists(params.sessionId, params.source, params.now);
    const promptSourceSnapshot = {
        ...(params.inboundMessage ? { inboundMessage: params.inboundMessage } : {}),
        ...(startPlan.orchestrationRegistrySnapshot ? { orchestration: startPlan.orchestrationRegistrySnapshot } : {}),
        ...(startPlan.orchestrationPlanSnapshot ? { orchestrationPlan: startPlan.orchestrationPlanSnapshot } : {}),
    };
    const run = dependencies.createRootRun({
        id: params.runId,
        sessionId: params.sessionId,
        requestGroupId: startPlan.requestGroupId,
        lineageRootRunId: params.lineageRootRunId ?? startPlan.requestGroupId,
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
        orchestrationMode: startPlan.orchestrationMode ?? "single_nobie",
        ...(params.workerRuntime ? { workerRuntimeKind: params.workerRuntime.kind } : {}),
        ...(startPlan.workerSessionId ? { workerSessionId: startPlan.workerSessionId } : {}),
        contextMode: startPlan.effectiveContextMode,
        ...(Object.keys(promptSourceSnapshot).length > 0 ? { promptSourceSnapshot } : {}),
    });
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
    });
    return {
        startPlan,
        run,
        queuedBehindRequestGroupRun: startInitialization.queuedBehindRequestGroupRun,
    };
}
//# sourceMappingURL=start-launch.js.map
