import type {
  EnterpriseMetadata,
  EnterpriseMetadataValue,
  EnterpriseTimestamp,
  EnterpriseTopology,
  FailureReport,
  TraceEvent,
  WorkOrder,
} from "../contracts/enterprise-topology.js"
import {
  EXECUTOR_GRAPH_METADATA_KEY,
  buildExecutorGraphFromEnterpriseTopology,
  readExecutorGraphMetadata,
  type ExecutorDraft,
  type ExecutorInferenceEvidence,
} from "./executor-graph.js"

export const EXECUTOR_OBSERVABILITY_SCHEMA_VERSION = 1 as const
export const EXECUTOR_OBSERVABILITY_METADATA_KEY = "executorObservability" as const
export const EXECUTOR_FAILURE_OBSERVABILITY_METADATA_KEY = "executorObservabilityFailure" as const

export interface ExecutorRunObservabilityEvidence {
  schemaVersion: typeof EXECUTOR_OBSERVABILITY_SCHEMA_VERSION
  evidenceId: string
  topologyRunId: string
  topologyId: string
  topologyVersion?: number
  topologyVersionId?: string
  entryExecutorId: string
  entryNodeContractId: string
  runtimeProfileSnapshotId: string
  workOrderId?: string
  workOrderInference: {
    templateId: string
    contextPresetId: string
    source: "executor_run_panel" | "enterprise_topology_gui" | "unknown"
    requestText?: string
    inferredFrom: Array<"executor_description" | "run_input" | "work_order_template" | "context_preset">
  }
  inferenceEvidenceRef?: string
  userDescription?: ExecutorInferenceEvidence["userDescription"]
  normalizedUnderstanding?: ExecutorInferenceEvidence["normalizedUnderstanding"]
  nodeContractRef: {
    topologyId: string
    nodeId: string
    sourceOfTruth: "enterprise_topology"
  }
  generatedAt?: EnterpriseTimestamp
}

export interface ExecutorFailureObservabilityEvidence {
  schemaVersion: typeof EXECUTOR_OBSERVABILITY_SCHEMA_VERSION
  evidenceId: string
  failureReportId: string
  topologyRunId: string
  nodeRunId: string
  workOrderId: string
  nodeId: string
  traceEventIds: string[]
  runEvidenceRef?: string
  inferenceEvidenceRef?: string
  userDescription?: ExecutorInferenceEvidence["userDescription"]
  normalizedUnderstanding?: ExecutorInferenceEvidence["normalizedUnderstanding"]
  nodeContractRef: {
    topologyId?: string
    nodeId: string
    sourceOfTruth: "enterprise_topology"
  }
}

export function buildExecutorRunObservabilityMetadata(input: {
  topology: EnterpriseTopology
  topologyRunId: string
  entryNodeId: string
  templateId: string
  contextPresetId: string
  requestText?: string
  source?: ExecutorRunObservabilityEvidence["workOrderInference"]["source"]
  topologyVersion?: number
  topologyVersionId?: string
  runtimeProfileSnapshotId?: string
  workOrderId?: string
  generatedAt?: EnterpriseTimestamp
}): EnterpriseMetadata {
  const graph = buildExecutorGraphFromEnterpriseTopology(input.topology, { mode: "simple" })
  const executor = graph.executors.find((candidate) =>
    candidate.id === input.entryNodeId || candidate.sourceNodeId === input.entryNodeId
  )
  const evidence = buildExecutorRunObservabilityEvidence({
    ...input,
    ...(executor ? { executor } : {}),
  })
  return {
    [EXECUTOR_OBSERVABILITY_METADATA_KEY]: evidence as unknown as EnterpriseMetadataValue,
  }
}

export function buildExecutorRunObservabilityEvidence(input: {
  topology: EnterpriseTopology
  topologyRunId: string
  entryNodeId: string
  templateId: string
  contextPresetId: string
  requestText?: string
  source?: ExecutorRunObservabilityEvidence["workOrderInference"]["source"]
  topologyVersion?: number
  topologyVersionId?: string
  runtimeProfileSnapshotId?: string
  workOrderId?: string
  generatedAt?: EnterpriseTimestamp
  executor?: ExecutorDraft
}): ExecutorRunObservabilityEvidence {
  const metadata = readExecutorGraphMetadata(input.topology)
  const executor = input.executor
  const entryExecutorId = executor?.id ?? input.entryNodeId
  const runtimeProfileSnapshotId = input.runtimeProfileSnapshotId ??
    `runtime-profile:${input.topology.id}:${input.entryNodeId}:${input.topologyVersionId ?? metadata?.updatedAt ?? "draft"}`
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
      sourceOfTruth: "enterprise_topology",
    },
    ...(input.generatedAt !== undefined ? { generatedAt: input.generatedAt } : {}),
  }
}

export function executorObservabilityFromWorkOrder(workOrder: WorkOrder): ExecutorRunObservabilityEvidence | null {
  const record = metadataRecord(workOrder.input[EXECUTOR_OBSERVABILITY_METADATA_KEY])
  if (!record || record.schemaVersion !== EXECUTOR_OBSERVABILITY_SCHEMA_VERSION) return null
  if (typeof record.evidenceId !== "string" || typeof record.topologyRunId !== "string") return null
  return record as unknown as ExecutorRunObservabilityEvidence
}

export function buildExecutorTraceEventPayload(input: {
  workOrder: WorkOrder
  payload?: EnterpriseMetadata
}): EnterpriseMetadata | undefined {
  const runEvidence = executorObservabilityFromWorkOrder(input.workOrder)
  if (!runEvidence) return input.payload
  return {
    ...(input.payload ?? {}),
    [EXECUTOR_OBSERVABILITY_METADATA_KEY]: {
      runEvidenceRef: runEvidence.evidenceId,
      topologyRunId: runEvidence.topologyRunId,
      entryExecutorId: runEvidence.entryExecutorId,
      entryNodeContractId: runEvidence.entryNodeContractId,
      runtimeProfileSnapshotId: runEvidence.runtimeProfileSnapshotId,
      inferenceEvidenceRef: runEvidence.inferenceEvidenceRef ?? null,
    } as EnterpriseMetadataValue,
  }
}

export function attachExecutorFailureEvidence(input: {
  failureReport: FailureReport
  workOrder?: WorkOrder
  traceEvents?: TraceEvent[]
}): FailureReport {
  const runEvidence = input.workOrder ? executorObservabilityFromWorkOrder(input.workOrder) : null
  const traceEventIds = (input.traceEvents ?? [])
    .filter((event) =>
      event.nodeRunId === input.failureReport.nodeRunId ||
      event.workOrderId === input.failureReport.workOrderId
    )
    .map((event) => event.traceEventId)
  const failureEvidence: ExecutorFailureObservabilityEvidence = {
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
      sourceOfTruth: "enterprise_topology",
      ...(runEvidence?.topologyId ? { topologyId: runEvidence.topologyId } : {}),
    },
  }
  return {
    ...input.failureReport,
    partialResult: {
      ...(input.failureReport.partialResult ?? {}),
      [EXECUTOR_FAILURE_OBSERVABILITY_METADATA_KEY]: failureEvidence as unknown as EnterpriseMetadataValue,
    },
  }
}

export function executorInferenceEvidenceForNode(input: {
  topology: EnterpriseTopology
  nodeId: string
}): ExecutorInferenceEvidence | null {
  const node = input.topology.nodes.find((candidate) => candidate.id === input.nodeId)
  const evidence = metadataRecord(node?.metadata?.[EXECUTOR_GRAPH_METADATA_KEY])?.inferenceEvidence
  const record = metadataRecord(evidence)
  if (!record || record.schemaVersion !== 1 || typeof record.evidenceId !== "string") return null
  return record as unknown as ExecutorInferenceEvidence
}

function metadataRecord(value: EnterpriseMetadataValue | undefined): Record<string, EnterpriseMetadataValue | undefined> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value
}
