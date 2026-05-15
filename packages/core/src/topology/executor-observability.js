import { EXECUTOR_GRAPH_METADATA_KEY, buildExecutorGraphFromEnterpriseTopology, readExecutorGraphMetadata, } from "./executor-graph.js";
export const EXECUTOR_OBSERVABILITY_SCHEMA_VERSION = 1;
export const EXECUTOR_OBSERVABILITY_METADATA_KEY = "executorObservability";
export const EXECUTOR_FAILURE_OBSERVABILITY_METADATA_KEY = "executorObservabilityFailure";
export function buildExecutorRunObservabilityMetadata(input) {
    const graph = buildExecutorGraphFromEnterpriseTopology(input.topology, { mode: "simple" });
    const executor = graph.executors.find((candidate) => candidate.id === input.entryNodeId || candidate.sourceNodeId === input.entryNodeId);
    const evidence = buildExecutorRunObservabilityEvidence({
        ...input,
        ...(executor ? { executor } : {}),
    });
    return {
        [EXECUTOR_OBSERVABILITY_METADATA_KEY]: evidence,
    };
}
export function buildExecutorRunObservabilityEvidence(input) {
    const metadata = readExecutorGraphMetadata(input.topology);
    const executor = input.executor;
    const entryExecutorId = executor?.id ?? input.entryNodeId;
    const runtimeProfileSnapshotId = input.runtimeProfileSnapshotId ??
        `runtime-profile:${input.topology.id}:${input.entryNodeId}:${input.topologyVersionId ?? metadata?.updatedAt ?? "draft"}`;
    return {
        schemaVersion: EXECUTOR_OBSERVABILITY_SCHEMA_VERSION,
        evidenceId: `executor-run-evidence:${input.topologyRunId}:${entryExecutorId}`,
        topologyRunId: input.topologyRunId,
        topologyId: input.topology.id,
        ...(input.topologyVersion !== undefined ? { topologyVersion: input.topologyVersion } : {}),
        ...(input.topologyVersionId !== undefined ? { topologyVersionId: input.topologyVersionId } : {}),
        entryExecutorId,
        entryNodeContractId: executor?.sourceNodeId ?? input.entryNodeId,
        runtimeProfileSnapshotId,
        ...(input.workOrderId ? { workOrderId: input.workOrderId } : {}),
        workOrderInference: {
            templateId: input.templateId,
            contextPresetId: input.contextPresetId,
            source: input.source ?? "unknown",
            ...(input.requestText?.trim() ? { requestText: input.requestText.trim() } : {}),
            inferredFrom: ["executor_description", "run_input", "work_order_template", "context_preset"],
        },
        ...(executor?.inferenceEvidence?.evidenceId ? { inferenceEvidenceRef: executor.inferenceEvidence.evidenceId } : {}),
        ...(executor?.inferenceEvidence?.userDescription ? { userDescription: executor.inferenceEvidence.userDescription } : {}),
        ...(executor?.inferenceEvidence?.normalizedUnderstanding
            ? { normalizedUnderstanding: executor.inferenceEvidence.normalizedUnderstanding }
            : {}),
        nodeContractRef: {
            topologyId: input.topology.id,
            nodeId: executor?.sourceNodeId ?? input.entryNodeId,
            sourceOfTruth: "executor_topology_v2",
        },
        ...(input.generatedAt !== undefined ? { generatedAt: input.generatedAt } : {}),
    };
}
export function executorObservabilityFromWorkOrder(workOrder) {
    const record = metadataRecord(workOrder.input[EXECUTOR_OBSERVABILITY_METADATA_KEY]);
    if (!record || record.schemaVersion !== EXECUTOR_OBSERVABILITY_SCHEMA_VERSION)
        return null;
    if (typeof record.evidenceId !== "string" || typeof record.topologyRunId !== "string")
        return null;
    return record;
}
export function buildExecutorTraceEventPayload(input) {
    const runEvidence = executorObservabilityFromWorkOrder(input.workOrder);
    if (!runEvidence)
        return input.payload;
    return {
        ...(input.payload ?? {}),
        [EXECUTOR_OBSERVABILITY_METADATA_KEY]: {
            runEvidenceRef: runEvidence.evidenceId,
            topologyRunId: runEvidence.topologyRunId,
            entryExecutorId: runEvidence.entryExecutorId,
            entryNodeContractId: runEvidence.entryNodeContractId,
            runtimeProfileSnapshotId: runEvidence.runtimeProfileSnapshotId,
            inferenceEvidenceRef: runEvidence.inferenceEvidenceRef ?? null,
        },
    };
}
export function attachExecutorFailureEvidence(input) {
    const runEvidence = input.workOrder ? executorObservabilityFromWorkOrder(input.workOrder) : null;
    const traceEventIds = (input.traceEvents ?? [])
        .filter((event) => event.nodeRunId === input.failureReport.nodeRunId ||
        event.workOrderId === input.failureReport.workOrderId)
        .map((event) => event.traceEventId);
    const failureEvidence = {
        schemaVersion: EXECUTOR_OBSERVABILITY_SCHEMA_VERSION,
        evidenceId: `executor-failure-evidence:${input.failureReport.failureReportId}`,
        failureReportId: input.failureReport.failureReportId,
        topologyRunId: input.failureReport.topologyRunId,
        nodeRunId: input.failureReport.nodeRunId,
        workOrderId: input.failureReport.workOrderId,
        nodeId: input.failureReport.nodeId,
        traceEventIds,
        ...(runEvidence?.evidenceId ? { runEvidenceRef: runEvidence.evidenceId } : {}),
        ...(runEvidence?.inferenceEvidenceRef ? { inferenceEvidenceRef: runEvidence.inferenceEvidenceRef } : {}),
        ...(runEvidence?.userDescription ? { userDescription: runEvidence.userDescription } : {}),
        ...(runEvidence?.normalizedUnderstanding ? { normalizedUnderstanding: runEvidence.normalizedUnderstanding } : {}),
        nodeContractRef: {
            nodeId: runEvidence?.entryNodeContractId ?? input.failureReport.nodeId,
            sourceOfTruth: "executor_topology_v2",
            ...(runEvidence?.topologyId ? { topologyId: runEvidence.topologyId } : {}),
        },
    };
    return {
        ...input.failureReport,
        partialResult: {
            ...(input.failureReport.partialResult ?? {}),
            [EXECUTOR_FAILURE_OBSERVABILITY_METADATA_KEY]: failureEvidence,
        },
    };
}
export function executorInferenceEvidenceForNode(input) {
    const node = input.topology.nodes.find((candidate) => candidate.id === input.nodeId);
    const evidence = metadataRecord(node?.metadata?.[EXECUTOR_GRAPH_METADATA_KEY])?.inferenceEvidence;
    const record = metadataRecord(evidence);
    if (!record || record.schemaVersion !== 1 || typeof record.evidenceId !== "string")
        return null;
    return record;
}
function metadataRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    return value;
}
//# sourceMappingURL=executor-observability.js.map