import type { ParentAggregationNextAction } from "../agent/sub-agent-result-review.js";
import { type OrchestrationPlan, type OrchestrationTask } from "../contracts/sub-agent-orchestration.js";
import { type AgentRegistryEntry } from "../orchestration/registry.js";
import type { StartRootRunParams, StartedRootRun } from "./start.js";
import type { RootRun } from "./types.js";
export type DelegatedTaskDispatchOutcomeStatus = "running" | "pending_result" | "completed" | "failed" | "skipped";
export interface DelegatedTaskDispatchLifecycleEntry {
    status: DelegatedTaskDispatchOutcomeStatus;
    at: number;
    reasonCode?: string;
    parentRunId?: string;
    selectedExecutorId?: string;
    subSessionId?: string;
    childRunId?: string;
    summary?: string;
}
export interface DelegatedTaskDispatchOutcome {
    taskId: string;
    subSessionId?: string;
    agentId?: string;
    agentDisplayName?: string;
    agentSource?: AgentRegistryEntry["source"];
    topologyId?: string;
    topologyExecutorId?: string;
    status: DelegatedTaskDispatchOutcomeStatus;
    reasonCode?: string;
    childRunId?: string;
    summary?: string;
    parentAggregationNextAction?: ParentAggregationNextAction;
    feedbackRequestId?: string;
    startedAt?: number;
    completedAt?: number;
    lifecycle?: DelegatedTaskDispatchLifecycleEntry[];
}
export interface DelegatedTaskDispatchResult {
    attempted: number;
    completed: number;
    failed: number;
    skipped: number;
    outcomes: DelegatedTaskDispatchOutcome[];
}
export interface DelegatedTaskDispatchParams {
    plan: OrchestrationPlan;
    parentRunId: string;
    parentSessionId: string;
    parentRequestGroupId: string;
    source: StartRootRunParams["source"];
    message: string;
    originalRequest?: string;
    workDir: string;
    controller: AbortController;
}
export interface DelegatedTaskDispatchDependencies {
    startSubAgentRun: (params: StartRootRunParams) => StartedRootRun;
    appendParentEvent?: (runId: string, label: string) => void;
    updateParentSummary?: (runId: string, summary: string) => RootRun | undefined;
    now?: () => number;
    idProvider?: () => string;
}
export type DispatchToChildExecutorValidation = {
    ok: true;
    reasonCodes: string[];
    selectedExecutorId?: string;
} | {
    ok: false;
    reasonCode: string;
    summary: string;
    selectedExecutorId?: string;
};
export declare function validateDispatchToChildExecutorInput(input: {
    task: OrchestrationTask;
    agent: AgentRegistryEntry;
}): DispatchToChildExecutorValidation;
export declare class DispatchToChildExecutor {
    validate(input: {
        task: OrchestrationTask;
        agent: AgentRegistryEntry;
    }): DispatchToChildExecutorValidation;
}
export declare function dispatchDelegatedSubAgentTasks(params: DelegatedTaskDispatchParams, dependencies: DelegatedTaskDispatchDependencies): Promise<DelegatedTaskDispatchResult>;
//# sourceMappingURL=orchestration-dispatch.d.ts.map