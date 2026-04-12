import type { AgentContextMode } from "../agent/index.js";
import { analyzeRequestEntrySemantics, type RequestEntrySemantics } from "./entry-semantics.js";
import { type RequestContinuationDecision } from "./entry-comparison.js";
import { findLatestWorkerSessionRun, getRequestGroupDelegationTurnCount, isReusableRequestGroup, listActiveSessionRequestGroups } from "./store.js";
import type { RootRun, TaskProfile } from "./types.js";
import type { WorkerRuntimeTarget } from "./worker-runtime.js";
export interface StartPlan {
    entrySemantics: RequestEntrySemantics;
    requestedClosedRequestGroup: boolean;
    shouldReconnectGroup: boolean;
    reconnectTarget?: RootRun | undefined;
    reconnectCandidateCount: number;
    reconnectNeedsClarification: boolean;
    requestGroupId: string;
    isRootRequest: boolean;
    effectiveTaskProfile: TaskProfile;
    initialDelegationTurnCount: number;
    shouldReuseContext: boolean;
    effectiveContextMode: AgentContextMode;
    workerSessionId?: string | undefined;
    reusableWorkerSessionRun?: RootRun | undefined;
}
interface StartPlanDependencies {
    analyzeRequestEntrySemantics: typeof analyzeRequestEntrySemantics;
    isReusableRequestGroup: typeof isReusableRequestGroup;
    listActiveSessionRequestGroups: typeof listActiveSessionRequestGroups;
    compareRequestContinuation: (params: {
        message: string;
        sessionId: string;
        candidates: RootRun[];
        model?: string;
    }) => Promise<RequestContinuationDecision>;
    getRequestGroupDelegationTurnCount: typeof getRequestGroupDelegationTurnCount;
    buildWorkerSessionId: (params: {
        runId: string;
        isRootRequest: boolean;
        requestGroupId: string;
        taskProfile: TaskProfile;
        targetId?: string;
        workerRuntime?: WorkerRuntimeTarget;
    }) => string | undefined;
    normalizeTaskProfile: (taskProfile: TaskProfile | undefined) => TaskProfile;
    findLatestWorkerSessionRun: typeof findLatestWorkerSessionRun;
}
declare const defaultDependencies: StartPlanDependencies;
export declare function buildStartPlan(params: {
    message: string;
    sessionId: string;
    runId: string;
    requestGroupId?: string | undefined;
    forceRequestGroupReuse?: boolean | undefined;
    contextMode?: AgentContextMode | undefined;
    taskProfile?: TaskProfile | undefined;
    model?: string | undefined;
    targetId?: string | undefined;
    workerRuntime?: WorkerRuntimeTarget | undefined;
}, dependencies: StartPlanDependencies): Promise<StartPlan>;
export { defaultDependencies as defaultStartPlanDependencies };
//# sourceMappingURL=start-plan.d.ts.map