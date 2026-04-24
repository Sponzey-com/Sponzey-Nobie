import type { AgentContextMode } from "../agent/index.js";
import type { IntentContract } from "../contracts/index.js";
import { analyzeRequestEntrySemantics } from "./entry-semantics.js";
import { compareRequestContinuationWithAI } from "./entry-comparison.js";
import type { RootRun, TaskProfile } from "./types.js";
import type { InboundMessageRecord } from "./request-isolation.js";
import type { WorkerRuntimeTarget } from "./worker-runtime.js";
import { buildStartPlan, type StartPlan } from "./start-plan.js";
import type { OrchestrationPlannerIntent } from "../orchestration/planner.js";
import { applyStartInitialization } from "./start-initialization.js";
import { findLatestWorkerSessionRun, getRequestGroupDelegationTurnCount, isReusableRequestGroup, listActiveSessionRequestGroups, createRootRun } from "./store.js";
interface StartLaunchDependencies {
    buildStartPlan: typeof buildStartPlan;
    analyzeRequestEntrySemantics: typeof analyzeRequestEntrySemantics;
    isReusableRequestGroup: typeof isReusableRequestGroup;
    listActiveSessionRequestGroups: typeof listActiveSessionRequestGroups;
    compareRequestContinuation: typeof compareRequestContinuationWithAI;
    getRequestGroupDelegationTurnCount: typeof getRequestGroupDelegationTurnCount;
    buildWorkerSessionId: (params: {
        runId: string;
        isRootRequest: boolean;
        requestGroupId: string;
        taskProfile: TaskProfile;
        targetId?: string;
        workerRuntime?: WorkerRuntimeTarget;
        orchestrationPlannerIntent?: OrchestrationPlannerIntent;
    }) => string | undefined;
    normalizeTaskProfile: (taskProfile: string | undefined) => TaskProfile;
    findLatestWorkerSessionRun: typeof findLatestWorkerSessionRun;
    resolveOrchestrationMode?: Parameters<typeof buildStartPlan>[1]["resolveOrchestrationMode"];
    buildOrchestrationPlan?: Parameters<typeof buildStartPlan>[1]["buildOrchestrationPlan"];
    ensureSessionExists: (sessionId: string, source: RootRun["source"], now: number) => void;
    createRootRun: typeof createRootRun;
    applyStartInitialization: typeof applyStartInitialization;
    rememberRunInstruction: Parameters<typeof applyStartInitialization>[1]["rememberRunInstruction"];
    bindActiveRunController: Parameters<typeof applyStartInitialization>[1]["bindActiveRunController"];
    interruptOrphanWorkerSessionRuns: Parameters<typeof applyStartInitialization>[1]["interruptOrphanWorkerSessionRuns"];
    appendRunEvent: Parameters<typeof applyStartInitialization>[1]["appendRunEvent"];
    updateRunSummary: Parameters<typeof applyStartInitialization>[1]["updateRunSummary"];
    setRunStepStatus: Parameters<typeof applyStartInitialization>[1]["setRunStepStatus"];
    updateRunStatus: Parameters<typeof applyStartInitialization>[1]["updateRunStatus"];
}
export interface PreparedStartLaunch {
    startPlan: StartPlan;
    run: RootRun;
    queuedBehindRequestGroupRun: boolean;
}
export declare function prepareStartLaunch(params: {
    message: string;
    sessionId: string;
    runId: string;
    targetRunId?: string | undefined;
    source: RootRun["source"];
    incomingIntentContract?: IntentContract | undefined;
    controller: AbortController;
    now: number;
    maxDelegationTurns: number;
    requestGroupId?: string | undefined;
    parentRunId?: string | undefined;
    originRunId?: string | undefined;
    originRequestGroupId?: string | undefined;
    forceRequestGroupReuse?: boolean | undefined;
    contextMode?: AgentContextMode | undefined;
    taskProfile?: TaskProfile | undefined;
    runScope?: "root" | "child" | "analysis" | undefined;
    handoffSummary?: string | undefined;
    targetId?: string | undefined;
    targetLabel?: string | undefined;
    model?: string | undefined;
    workerRuntime?: WorkerRuntimeTarget | undefined;
    orchestrationPlannerIntent?: OrchestrationPlannerIntent | undefined;
    inboundMessage?: InboundMessageRecord | undefined;
    hasRequestGroupExecutionQueue: (requestGroupId: string) => boolean;
}, dependencies?: StartLaunchDependencies): Promise<PreparedStartLaunch>;
export {};
//# sourceMappingURL=start-launch.d.ts.map