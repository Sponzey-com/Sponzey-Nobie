import type { RootRun, RunContextMode, RunScope, RunStatus, RunStepStatus, TaskProfile } from "./types.js";
export interface StaleRunCleanupResult {
    cleanedRunCount: number;
    skippedRunCount: number;
    cleanedRunIds: string[];
    skippedRunIds: string[];
    thresholdMs: number;
}
export declare function listRootRuns(limit?: number): RootRun[];
export declare function listActiveRootRuns(limit?: number): RootRun[];
export declare function listActiveSessionRequestGroups(sessionId: string, excludingRunId?: string): RootRun[];
export declare function listRunsForActiveRequestGroups(limitGroups?: number, limitRuns?: number): RootRun[];
export declare function listRunsForRecentRequestGroups(limitGroups?: number, limitRuns?: number): RootRun[];
export declare function recoverActiveRunsOnStartup(): RootRun[];
export declare function getRootRun(runId: string): RootRun | undefined;
export declare function listRequestGroupRuns(requestGroupId: string): RootRun[];
export declare function hasActiveRequestGroupRuns(requestGroupId: string): boolean;
export declare function isReusableRequestGroup(requestGroupId: string): boolean;
export declare function getRequestGroupDelegationTurnCount(requestGroupId: string): number;
export interface ReconnectRequestGroupSelection {
    best?: RootRun;
    candidates: RootRun[];
    ambiguous: boolean;
}
export declare function findReconnectRequestGroupSelection(sessionId: string, message: string): ReconnectRequestGroupSelection;
export declare function findReconnectRequestGroup(sessionId: string, message: string): RootRun | undefined;
export declare function findLatestWorkerSessionRun(requestGroupId: string, workerSessionId: string, excludingRunId?: string): RootRun | undefined;
export declare function interruptOrphanWorkerSessionRuns(params: {
    requestGroupId: string;
    workerSessionId: string;
    keepRunId: string;
    summary?: string;
}): RootRun[];
export declare function createRootRun(params: {
    id: string;
    sessionId: string;
    requestGroupId?: string;
    lineageRootRunId?: string;
    parentRunId?: string;
    runScope?: RunScope;
    handoffSummary?: string;
    prompt: string;
    source: RootRun["source"];
    taskProfile?: TaskProfile;
    targetId?: string;
    targetLabel?: string;
    workerRuntimeKind?: string;
    workerSessionId?: string;
    contextMode?: RunContextMode;
    promptSourceSnapshot?: Record<string, unknown>;
    maxDelegationTurns?: number;
    delegationTurnCount?: number;
}): RootRun;
export declare function appendRunEvent(runId: string, label: string): void;
export declare function updateRunSummary(runId: string, summary: string): RootRun | undefined;
export declare function updateRunStatus(runId: string, status: RunStatus, summary?: string, canCancel?: boolean): RootRun | undefined;
export declare function incrementDelegationTurnCount(runId: string, summary?: string): RootRun | undefined;
export declare function updateActiveRunsMaxDelegationTurns(maxDelegationTurns: number): RootRun[];
export declare function setRunStepStatus(runId: string, stepKey: string, status: RunStepStatus, summary: string): RootRun | undefined;
export declare function bindActiveRunController(runId: string, controller: AbortController): void;
export declare function clearActiveRunController(runId: string): void;
interface CancelRootRunOptions {
    eventLabel?: string;
    stepSummary?: string;
    runSummary?: string;
}
export declare function cancelRootRun(runId: string, options?: CancelRootRunOptions): RootRun | undefined;
export declare function cleanupStaleRunStates(options?: {
    staleMs?: number;
    now?: number;
}): StaleRunCleanupResult;
export declare function deleteRunHistory(runId: string): {
    deletedRunCount: number;
    blockedRunCount?: number;
} | undefined;
export declare function clearHistoricalRunHistory(): {
    deletedRunCount: number;
};
export {};
//# sourceMappingURL=store.d.ts.map