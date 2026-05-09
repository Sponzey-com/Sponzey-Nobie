import { describe, expect, it } from "vitest"
import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  type FailurePolicy,
  type FailureReport,
  type NodeResultReport,
  type NodeRuntimeProfileSnapshot,
  type NodeRuntimeState,
  type RecoveryPolicy,
  type TraceEvent,
  type WorkOrder,
  validateFailureReport,
  validateNodeResultReport,
  validateTraceEvent,
  validateWorkOrder,
} from "../packages/core/src/contracts/index.ts"
import type { WorkOrder as WebWorkOrder } from "../packages/webui/src/contracts/enterprise-topology.ts"

const now = Date.UTC(2026, 3, 29, 1, 0, 0)

function workOrder(): WorkOrder {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    workOrderId: "work-order:intake",
    topologyRunId: "topology-run:001",
    parentWorkOrderId: null,
    fromNodeId: "node:nobie",
    to: { type: "node", id: "node:intake" },
    objective: "Triage the customer request.",
    scope: {
      included: ["customer request", "CRM account context"],
      excluded: ["billing write actions"],
    },
    input: {
      requestId: "request:001",
      customerId: "customer:alpha",
    },
    expectedOutputSchema: {
      kind: "object",
      required: ["summary", "priority"],
    },
    successCriteria: [
      {
        criterionId: "criterion:priority",
        description: "Priority is assigned with a supporting reason.",
        required: true,
        validationKind: "manual",
      },
    ],
    permissionScope: {
      allowedToolIds: ["tool:crm-search"],
      allowedSystemIds: ["system:crm"],
      dataDomainIds: ["data:customer"],
      riskLevel: "medium",
    },
    authorityScope: {
      requiredAuthorityRuleIds: [],
      approvalRequired: false,
    },
    failureReportRequired: true,
    delegationPath: ["node:nobie", "node:intake"],
    createdAt: now,
  }
}

function failureReport(): FailureReport {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    failureReportId: "failure:001",
    topologyRunId: "topology-run:001",
    nodeRunId: "node-run:intake",
    workOrderId: "work-order:intake",
    nodeId: "node:intake",
    exhaustionSummary: {
      selfExecutionAttempted: true,
      childDelegationAttempted: true,
      toolExecutionAttempted: true,
      retryAttempted: true,
      fallbackAttempted: true,
      partialSuccessChecked: true,
      parentRecoveryPossibleChecked: true,
      successCriteriaStillNotMet: true,
      complete: true,
    },
    attempts: [
      {
        attemptId: "attempt:self",
        kind: "self_execution",
        status: "failed",
        at: now,
        reasonCode: "input_insufficient",
      },
    ],
    untriedOptions: [],
    recommendedAction: "Ask customer success lead for missing account context.",
    createdAt: now,
  }
}

function traceEvent(): TraceEvent {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    traceEventId: "trace:001",
    topologyRunId: "topology-run:001",
    nodeRunId: "node-run:intake",
    workOrderId: "work-order:intake",
    parentWorkOrderId: null,
    delegationPath: ["node:nobie", "node:intake"],
    phase: "work_order",
    component: "work-order-builder",
    at: now,
    reasonCode: "work_order_created",
  }
}

describe("task002 WorkOrder, Result, Failure, Trace contracts", () => {
  it("validates WorkOrder and keeps a WebUI mirror type", () => {
    const order = workOrder()
    const result = validateWorkOrder(order)

    expect(result.ok).toBe(true)
    const webOrder: WebWorkOrder = order
    expect(webOrder.failureReportRequired).toBe(true)
  })

  it("requires WorkOrder success criteria", () => {
    const invalid = {
      ...workOrder(),
      successCriteria: [],
    }

    const result = validateWorkOrder(invalid)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "$.successCriteria",
            reasonCode: "missing_success_criteria",
          }),
        ]),
      )
    }
  })

  it("requires FailureReport exhaustion summary", () => {
    const { exhaustionSummary: _exhaustionSummary, ...invalid } = failureReport()

    const result = validateFailureReport(invalid)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "$.exhaustionSummary",
            reasonCode: "missing_exhaustion_summary",
          }),
        ]),
      )
    }
  })

  it("requires TraceEvent topology, node, work order, and path linkage", () => {
    const invalid = {
      ...traceEvent(),
      nodeRunId: "",
    }

    const result = validateTraceEvent(invalid)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "$.nodeRunId",
            reasonCode: "missing_trace_linkage",
          }),
        ]),
      )
    }
  })

  it("does not allow final failed NodeResultReport without FailureReport linkage", () => {
    const failedWithoutReport: NodeResultReport = {
      schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
      resultReportId: "result:001",
      topologyRunId: "topology-run:001",
      nodeRunId: "node-run:intake",
      workOrderId: "work-order:intake",
      nodeId: "node:intake",
      status: "failed",
      outputs: [],
      unmetSuccessCriteriaIds: ["criterion:priority"],
      risksOrGaps: ["Missing account context."],
      createdAt: now,
    }

    const failed = validateNodeResultReport(failedWithoutReport)

    expect(failed.ok).toBe(false)
    if (!failed.ok) {
      expect(failed.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "$.failureReportId",
            reasonCode: "final_failure_without_failure_report",
          }),
        ]),
      )
    }

    const failedCandidate = validateNodeResultReport({
      ...failedWithoutReport,
      status: "failed_candidate",
    })
    expect(failedCandidate.ok).toBe(true)
  })

  it("models runtime state, policies, profile snapshot, trace, and failure report together", () => {
    const state: NodeRuntimeState = "exhaustion_checking"
    const failurePolicy: FailurePolicy = {
      failureReportRequired: true,
      allowPartialSuccess: true,
      fallbackNodeIds: ["node:fallback"],
    }
    const recoveryPolicy: RecoveryPolicy = {
      retryAllowed: true,
      redelegationAllowed: true,
      fallbackAllowed: true,
      partialSuccessAllowed: true,
    }
    const profile: NodeRuntimeProfileSnapshot = {
      schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
      profileSnapshotId: "profile-snapshot:intake",
      topologyId: "topology:customer-success",
      compiledTopologySnapshotId: "compiled:001",
      nodeId: "node:intake",
      workOrderId: "work-order:intake",
      permissionScope: workOrder().permissionScope,
      authorityScope: workOrder().authorityScope,
      allowedToolIds: ["tool:crm-search"],
      allowedSystemIds: ["system:crm"],
      delegationPath: ["node:nobie", "node:intake"],
      createdAt: now,
      source: {
        nodeContractId: "node:intake",
        workOrderId: "work-order:intake",
        compiledTopologySnapshotId: "compiled:001",
      },
    }

    expect(state).toBe("exhaustion_checking")
    expect(failurePolicy.failureReportRequired).toBe(true)
    expect(recoveryPolicy.redelegationAllowed).toBe(true)
    expect(profile.source).toEqual({
      nodeContractId: "node:intake",
      workOrderId: "work-order:intake",
      compiledTopologySnapshotId: "compiled:001",
    })
    expect(validateFailureReport(failureReport()).ok).toBe(true)
    expect(validateTraceEvent(traceEvent()).ok).toBe(true)
  })
})
