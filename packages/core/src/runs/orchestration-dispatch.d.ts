import { type OrchestrationPlan } from "../contracts/sub-agent-orchestration.js";
import { type AgentRegistryEntry } from "../orchestration/registry.js";
import type { StartRootRunParams, StartedRootRun } from "./start.js";
import type { RootRun } from "./types.js";
export interface DelegatedTaskDispatchOutcome {
    taskId: string;
    subSessionId?: string;
    agentId?: string;
    agentDisplayName?: string;
    agentSource?: AgentRegistryEntry["source"];
    topologyId?: string;
    topologyExecutorId?: string;
    status: "completed" | "failed" | "skipped";
    reasonCode?: string;
    childRunId?: string;
    summary?: string;
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
export declare function dispatchDelegatedSubAgentTasks(params: DelegatedTaskDispatchParams, dependencies: DelegatedTaskDispatchDependencies): Promise<DelegatedTaskDispatchResult>;
//# sourceMappingURL=orchestration-dispatch.d.ts.map