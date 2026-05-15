import type Database from "better-sqlite3";
import type { ChannelSource } from "../channels/contracts.js";
import type { OrchestrationPlan } from "../contracts/sub-agent-orchestration.js";
import type { DelegatedTaskDispatchResult } from "./orchestration-dispatch.js";
export declare const TOPOLOGY_DISPATCH_FOLLOWUP_ACTIONS: readonly ["redelegate", "self_solve", "ask_user", "return_to_parent", "fail_with_reason"];
export type TopologyDispatchFollowupAction = (typeof TOPOLOGY_DISPATCH_FOLLOWUP_ACTIONS)[number];
export interface TopologyDispatchFollowupDecision {
    action: TopologyDispatchFollowupAction;
    reasonCode: string;
    summary: string;
    failedExecutorIds: string[];
    failedExecutorNames: string[];
    failedReasonCodes: string[];
    blockedByPreflight: boolean;
    alternativeExecutorIds: string[];
    rootLoopContinuation: "allowed_with_trace" | "blocked";
}
export interface ResolveTopologyDispatchFollowupDecisionInput {
    dispatchResult: DelegatedTaskDispatchResult;
    plan: OrchestrationPlan;
    currentExecutorId?: string;
    availableDirectChildExecutorIds: string[];
}
export interface RecordTopologyDispatchFollowupTraceInput {
    decision: TopologyDispatchFollowupDecision;
    dispatchResult: DelegatedTaskDispatchResult;
    plan: OrchestrationPlan;
    runId: string;
    requestGroupId: string;
    sessionId?: string | undefined;
    source?: ChannelSource | undefined;
    topologyId: string;
    entryNodeId: string;
    topologyVersion?: number | undefined;
    db?: Database.Database | undefined;
    now?: (() => number) | undefined;
}
export interface TopologyDispatchFollowupTraceRecordResult {
    topologyRunId: string;
    decisionTraceId: string;
    traceEventCount: number;
}
export declare function resolveTopologyDispatchFollowupDecision(input: ResolveTopologyDispatchFollowupDecisionInput): TopologyDispatchFollowupDecision | undefined;
export declare function recordTopologyDispatchFollowupTrace(input: RecordTopologyDispatchFollowupTraceInput): TopologyDispatchFollowupTraceRecordResult;
//# sourceMappingURL=topology-dispatch-fallback.d.ts.map