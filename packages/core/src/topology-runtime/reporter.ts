import {
  CONTRACT_SCHEMA_VERSION,
  type JsonValue,
} from "../contracts/index.js"
import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  type EnterpriseMetadata,
  type EnterpriseMetadataValue,
  type EnterpriseTimestamp,
  type NodeResultOutput,
  type NodeResultReport,
  type NodeResultStatus,
  type NodeRuntimeProfileSnapshot,
  type WorkOrder,
} from "../contracts/enterprise-topology.js"
import type { ResultReport, RuntimeIdentity } from "../contracts/sub-agent-orchestration.js"
import type { WorkOrderRuntimeEnvelope } from "./work-order.js"

export interface CreateNodeResultReportInput {
  profileSnapshot: NodeRuntimeProfileSnapshot
  workOrder: WorkOrder
  nodeRunId: string
  status: NodeResultStatus
  outputs: NodeResultOutput[]
  unmetSuccessCriteriaIds: string[]
  risksOrGaps: string[]
  partialResult?: EnterpriseMetadata
  failureReportId?: string
  resultReportId?: string
  createdAt?: EnterpriseTimestamp
}

export interface CreateLegacyResultReportInput {
  nodeResultReport: NodeResultReport
  envelope: WorkOrderRuntimeEnvelope
}

export function createNodeResultReportFromRuntime(input: CreateNodeResultReportInput): NodeResultReport {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    resultReportId: input.resultReportId ?? `node-result:${input.workOrder.workOrderId}`,
    topologyRunId: input.workOrder.topologyRunId,
    nodeRunId: input.nodeRunId,
    workOrderId: input.workOrder.workOrderId,
    nodeId: input.profileSnapshot.nodeId,
    status: input.status,
    outputs: input.outputs.map((output) => cloneNodeResultOutput(output)),
    unmetSuccessCriteriaIds: [...input.unmetSuccessCriteriaIds],
    risksOrGaps: [...input.risksOrGaps],
    ...(input.partialResult !== undefined ? { partialResult: structuredClone(input.partialResult) } : {}),
    ...(input.failureReportId !== undefined ? { failureReportId: input.failureReportId } : {}),
    createdAt: input.createdAt ?? Date.now(),
  }
}

export function createLegacyResultReportFromNodeResult(input: CreateLegacyResultReportInput): ResultReport {
  const command = input.envelope.subSessionCommandRequest
  const nodeResult = input.nodeResultReport

  return {
    identity: buildResultReportIdentity({
      resultReportId: nodeResult.resultReportId,
      workOrderId: nodeResult.workOrderId,
      parentRunId: command.parentRunId,
      subSessionId: command.subSessionId,
      idempotencyKey: input.envelope.subSessionIdempotencyKey,
      auditCorrelationId: nodeResult.topologyRunId,
    }),
    resultReportId: `legacy:${nodeResult.resultReportId}`,
    parentRunId: command.parentRunId,
    subSessionId: command.subSessionId,
    status: legacyResultStatusForNodeResultStatus(nodeResult.status),
    outputs: nodeResult.outputs.map((output) => ({
      outputId: output.outputId,
      status: output.status,
      ...(output.value !== undefined ? { value: enterpriseValueToJsonValue(output.value) } : {}),
    })),
    evidence: [
      {
        evidenceId: `evidence:${nodeResult.resultReportId}:node-result`,
        kind: "node_result_report",
        sourceRef: nodeResult.resultReportId,
        sourceTimestamp: String(nodeResult.createdAt),
      },
    ],
    artifacts: [],
    risksOrGaps: [...nodeResult.risksOrGaps],
  }
}

export function legacyResultStatusForNodeResultStatus(status: NodeResultStatus): ResultReport["status"] {
  if (status === "completed") return "completed"
  if (status === "failed") return "failed"
  return "needs_revision"
}

function buildResultReportIdentity(input: {
  resultReportId: string
  workOrderId: string
  parentRunId: string
  subSessionId: string
  idempotencyKey: string
  auditCorrelationId: string
}): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType: "sub_session",
    entityId: input.subSessionId,
    owner: { ownerType: "system", ownerId: "topology-runtime" },
    idempotencyKey: `${input.idempotencyKey}:result:${input.resultReportId}`,
    auditCorrelationId: input.auditCorrelationId,
    parent: {
      parentRunId: input.parentRunId,
      parentSubSessionId: input.subSessionId,
      parentRequestId: input.workOrderId,
    },
  }
}

function cloneNodeResultOutput(output: NodeResultOutput): NodeResultOutput {
  return {
    outputId: output.outputId,
    status: output.status,
    ...(output.value !== undefined ? { value: structuredClone(output.value) } : {}),
  }
}

function enterpriseValueToJsonValue(value: EnterpriseMetadataValue): JsonValue {
  return structuredClone(value) as JsonValue
}
