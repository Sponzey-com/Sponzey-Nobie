import type { ChannelSource } from "../channels/contracts.js";
import type { NodeResultReport } from "../contracts/enterprise-topology.js";
import { type FeatureFlagMode, type RuntimeFeatureFlag } from "../runtime/rollout-safety.js";
import type { AgentExecutionDecision } from "../orchestration/execution-decision-contract.js";
import type { OrchestrationModeSnapshot } from "../orchestration/mode.js";
import { type EnterpriseTopologyRegistryStore } from "../topology/registry.js";
import { type NodeRuntimeExecutionResult, type NodeRuntimeSelfExecutor } from "./node-runtime.js";
import { type TopologyTracePersistenceResult } from "./trace.js";
export declare const TOPOLOGY_RUNTIME_FEATURE_KEY: "topology_runtime_enabled";
export type TopologyRootRunRoutingMode = "route" | "fallback";
export type TopologyRootRunFallbackReasonCode = "feature_flag_off" | "non_root_request" | "topology_routing_not_opted_in" | "topology_not_found" | "topology_not_active" | "active_topology_not_found" | "topology_export_missing" | "topology_validation_blocked" | "compiled_snapshot_missing" | "entry_node_missing" | "selected_executor_missing" | "selected_executor_not_direct_child" | "selected_executor_path_invalid";
export type TopologyRootRunRouteReasonCode = "explicit_topology_target" | "execution_decision_selected_executor";
export type TopologyRootRunRoutingDecision = {
    mode: "fallback";
    reasonCode: TopologyRootRunFallbackReasonCode;
    featureFlagMode: FeatureFlagMode;
    explicitTopologyId?: string;
    activeTopologyCount?: number;
    issues?: string[];
} | {
    mode: "route";
    reasonCode: TopologyRootRunRouteReasonCode;
    featureFlagMode: FeatureFlagMode;
    topologyId: string;
    topologyName: string;
    topologyVersion: number;
    topologyVersionId: string;
    compiledTopologySnapshotId: string;
    entryNodeId: string;
    selectedExecutorId?: string;
    selectedConnectionPath?: string[];
    availableDirectChildExecutorIds: string[];
    entrySelection?: "execution_decision";
    executionDecision?: AgentExecutionDecision;
    explicit: boolean;
};
export type TopologyRootRunExecutionResult = {
    ok: true;
    topologyRunId: string;
    topologyId: string;
    topologyVersion: number;
    entryNodeId: string;
    entryNodeName: string;
    finalAnswer: string;
    nodeResultReport: NodeResultReport;
    runtimeResult: NodeRuntimeExecutionResult;
    persistence: TopologyTracePersistenceResult;
} | {
    ok: false;
    reasonCode: TopologyRootRunFallbackReasonCode | "work_order_envelope_invalid" | "topology_runtime_failed";
    fallbackSummary: string;
    issues: string[];
    runtimeResult?: NodeRuntimeExecutionResult;
    persistence?: TopologyTracePersistenceResult;
};
export interface ResolveTopologyRootRunRoutingInput {
    message: string;
    runId: string;
    sessionId: string;
    source?: ChannelSource;
    targetId?: string;
    taskProfile?: string;
    isRootRequest: boolean;
    registry?: EnterpriseTopologyRegistryStore;
    featureFlag?: RuntimeFeatureFlag;
    executionDecision?: AgentExecutionDecision;
    orchestrationModeSnapshot?: Pick<OrchestrationModeSnapshot, "mode" | "activeSubAgentCount">;
}
export interface RunTopologyRootRunInput {
    decision: Extract<TopologyRootRunRoutingDecision, {
        mode: "route";
    }>;
    runId: string;
    sessionId: string;
    source: ChannelSource;
    message: string;
    registry?: EnterpriseTopologyRegistryStore;
    now?: () => number;
    selfExecute?: NodeRuntimeSelfExecutor;
}
export declare function resolveTopologyRootRunRouting(input: ResolveTopologyRootRunRoutingInput): TopologyRootRunRoutingDecision;
export declare function runTopologyRootRun(input: RunTopologyRootRunInput): Promise<TopologyRootRunExecutionResult>;
//# sourceMappingURL=harness.d.ts.map