import type { EnterpriseMetadata, EnterpriseTimestamp, EnterpriseTopology, FailureReport, TraceEvent, WorkOrder } from "../contracts/enterprise-topology.js";
import { type ExecutorDraft, type ExecutorInferenceEvidence } from "./executor-graph.js";
export declare const EXECUTOR_OBSERVABILITY_SCHEMA_VERSION: 1;
export declare const EXECUTOR_OBSERVABILITY_METADATA_KEY: "executorObservability";
export declare const EXECUTOR_FAILURE_OBSERVABILITY_METADATA_KEY: "executorObservabilityFailure";
export interface ExecutorRunObservabilityEvidence {
    schemaVersion: typeof EXECUTOR_OBSERVABILITY_SCHEMA_VERSION;
    evidenceId: string;
    topologyRunId: string;
    topologyId: string;
    topologyVersion?: number;
    topologyVersionId?: string;
    entryExecutorId: string;
    entryNodeContractId: string;
    runtimeProfileSnapshotId: string;
    workOrderId?: string;
    workOrderInference: {
        templateId: string;
        contextPresetId: string;
        source: "executor_run_panel" | "enterprise_topology_gui" | "unknown";
        requestText?: string;
        inferredFrom: Array<"executor_description" | "run_input" | "work_order_template" | "context_preset">;
    };
    inferenceEvidenceRef?: string;
    userDescription?: ExecutorInferenceEvidence["userDescription"];
    normalizedUnderstanding?: ExecutorInferenceEvidence["normalizedUnderstanding"];
    nodeContractRef: {
        topologyId: string;
        nodeId: string;
        sourceOfTruth: "executor_topology_v2";
    };
    generatedAt?: EnterpriseTimestamp;
}
export interface ExecutorFailureObservabilityEvidence {
    schemaVersion: typeof EXECUTOR_OBSERVABILITY_SCHEMA_VERSION;
    evidenceId: string;
    failureReportId: string;
    topologyRunId: string;
    nodeRunId: string;
    workOrderId: string;
    nodeId: string;
    traceEventIds: string[];
    runEvidenceRef?: string;
    inferenceEvidenceRef?: string;
    userDescription?: ExecutorInferenceEvidence["userDescription"];
    normalizedUnderstanding?: ExecutorInferenceEvidence["normalizedUnderstanding"];
    nodeContractRef: {
        topologyId?: string;
        nodeId: string;
        sourceOfTruth: "executor_topology_v2";
    };
}
export declare function buildExecutorRunObservabilityMetadata(input: {
    topology: EnterpriseTopology;
    topologyRunId: string;
    entryNodeId: string;
    templateId: string;
    contextPresetId: string;
    requestText?: string;
    source?: ExecutorRunObservabilityEvidence["workOrderInference"]["source"];
    topologyVersion?: number;
    topologyVersionId?: string;
    runtimeProfileSnapshotId?: string;
    workOrderId?: string;
    generatedAt?: EnterpriseTimestamp;
}): EnterpriseMetadata;
export declare function buildExecutorRunObservabilityEvidence(input: {
    topology: EnterpriseTopology;
    topologyRunId: string;
    entryNodeId: string;
    templateId: string;
    contextPresetId: string;
    requestText?: string;
    source?: ExecutorRunObservabilityEvidence["workOrderInference"]["source"];
    topologyVersion?: number;
    topologyVersionId?: string;
    runtimeProfileSnapshotId?: string;
    workOrderId?: string;
    generatedAt?: EnterpriseTimestamp;
    executor?: ExecutorDraft;
}): ExecutorRunObservabilityEvidence;
export declare function executorObservabilityFromWorkOrder(workOrder: WorkOrder): ExecutorRunObservabilityEvidence | null;
export declare function buildExecutorTraceEventPayload(input: {
    workOrder: WorkOrder;
    payload?: EnterpriseMetadata;
}): EnterpriseMetadata | undefined;
export declare function attachExecutorFailureEvidence(input: {
    failureReport: FailureReport;
    workOrder?: WorkOrder;
    traceEvents?: TraceEvent[];
}): FailureReport;
export declare function executorInferenceEvidenceForNode(input: {
    topology: EnterpriseTopology;
    nodeId: string;
}): ExecutorInferenceEvidence | null;
//# sourceMappingURL=executor-observability.d.ts.map