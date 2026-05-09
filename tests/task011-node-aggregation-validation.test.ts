import { describe, expect, it } from "vitest"
import {
  aggregateNodeRuntimeResults,
  buildExampleEnterpriseTopology,
  buildWorkOrder,
  compileTopologyOrThrow,
  createWorkOrderRuntimeEnvelope,
  runNodeRuntime,
  validateAggregatedNodeResult,
  validateNodeResultReport,
  type AggregationResult,
  type CompiledTopologySnapshot,
  type EnterpriseTopology,
  type NodeResultOutput,
  type NodeResultReport,
  type WorkOrder,
  type WorkOrderRuntimeEnvelope,
} from "../packages/core/src/index.ts"

const now = Date.UTC(2026, 3, 29, 6, 0, 0)

function topologyFixture(): EnterpriseTopology {
  const topology = structuredClone(buildExampleEnterpriseTopology(now))
  topology.status = "active"
  topology.nodes = topology.nodes.map((node) => ({ ...node, status: "active" }))
  return topology
}

function compiledFixture(topology = topologyFixture()): CompiledTopologySnapshot {
  return compileTopologyOrThrow(topology, {
    sourceTopologyVersion: "task011",
    compiledAt: now,
  })
}

function workOrderFixture(overrides: Partial<WorkOrder> = {}): WorkOrder {
  const order = buildWorkOrder({
    workOrderId: "work-order:intake",
    topologyRunId: "topology-run:task011",
    parentWorkOrderId: null,
    fromNodeId: "node:nobie",
    to: { type: "node", id: "node:intake" },
    objective: "Triage the customer request and assign priority.",
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
  })

  return {
    ...order,
    ...overrides,
  }
}

function runtimeEnvelope(input: {
  topology?: EnterpriseTopology
  compiled?: CompiledTopologySnapshot
  workOrder?: WorkOrder
} = {}): {
  topology: EnterpriseTopology
  compiled: CompiledTopologySnapshot
  workOrder: WorkOrder
  envelope: WorkOrderRuntimeEnvelope
} {
  const topology = input.topology ?? topologyFixture()
  const compiled = input.compiled ?? compiledFixture(topology)
  const workOrder = input.workOrder ?? workOrderFixture()
  const node = topology.nodes.find((candidate) => candidate.id === workOrder.to.id)
  if (node === undefined) throw new Error("expected node")
  const result = createWorkOrderRuntimeEnvelope({
    workOrder,
    nodeContractSnapshot: node,
    compiledTopologySnapshot: compiled,
    commandRequestId: "command:task011",
    subSessionId: "sub-session:task011",
    now: () => now,
  })

  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error("expected runtime envelope")
  return { topology, compiled, workOrder, envelope: result.envelope }
}

function schemaOutput(workOrder = workOrderFixture(), value = { summary: "triaged", priority: "high" }): NodeResultOutput {
  return {
    outputId: `${workOrder.workOrderId}:expected-output-schema`,
    status: "satisfied",
    value,
  }
}

function priorityOutput(value: string): NodeResultOutput {
  return {
    outputId: "criterion:priority",
    status: "satisfied",
    value,
  }
}

function childReport(input: {
  nodeId: string
  outputs: NodeResultOutput[]
  status?: NodeResultReport["status"]
}): NodeResultReport {
  return {
    schemaVersion: 1,
    resultReportId: `result:${input.nodeId}`,
    topologyRunId: "topology-run:task011",
    nodeRunId: `node-run:${input.nodeId}`,
    workOrderId: `work-order:${input.nodeId}`,
    nodeId: input.nodeId,
    status: input.status ?? "completed",
    outputs: input.outputs,
    unmetSuccessCriteriaIds: [],
    risksOrGaps: [],
    createdAt: now,
  }
}

function validate(workOrder: WorkOrder, aggregation: AggregationResult, allowPartialSuccess = false) {
  return validateAggregatedNodeResult({
    workOrder,
    aggregation,
    allowPartialSuccess,
  })
}

describe("task011 Aggregation, Validation, Partial Success", () => {
  it("does not complete a parent node when required output is missing", async () => {
    const { compiled, envelope } = runtimeEnvelope()

    const result = await runNodeRuntime({
      envelope,
      compiledTopologySnapshot: compiled,
      nodeRunId: "node-run:required-output-missing",
      now: () => now,
      selfExecute: () => ({
        status: "completed",
        outputs: [priorityOutput("high")],
      }),
      aggregation: {
        enabled: true,
        allowPartialSuccess: false,
      },
    })

    expect(result.status).toBe("failed_candidate")
    expect(result.validation?.status).toBe("failed_candidate")
    expect(result.validation?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reasonCode: "required_output_missing" }),
      ]),
    )
    expect(result.nodeResultReport.risksOrGaps).toEqual(
      expect.arrayContaining(["required_output_missing:work-order:intake:expected-output-schema"]),
    )
    expect(validateNodeResultReport(result.nodeResultReport).ok).toBe(true)
  })

  it("detects conflicting child results instead of accepting them silently", () => {
    const workOrder = workOrderFixture()
    const aggregation = aggregateNodeRuntimeResults({
      workOrder,
      strategy: "merge_and_validate",
      selfOutputs: [schemaOutput(workOrder)],
      childReports: [
        childReport({ nodeId: "node:triage-a", outputs: [priorityOutput("high")] }),
        childReport({ nodeId: "node:triage-b", outputs: [priorityOutput("low")] }),
      ],
    })
    const validation = validate(workOrder, aggregation)

    expect(aggregation.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: "output_conflict_detected",
          outputId: "criterion:priority",
          sourceIds: ["node:triage-a", "node:triage-b"],
        }),
      ]),
    )
    expect(validation.status).toBe("needs_revision")
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reasonCode: "output_conflict_detected" }),
      ]),
    )
  })

  it("keeps partial success separate from failed_candidate", () => {
    const workOrder = workOrderFixture({
      successCriteria: [
        ...workOrderFixture().successCriteria,
        {
          criterionId: "criterion:optional-note",
          description: "Optional note is useful but not mandatory.",
          required: false,
          validationKind: "manual",
        },
      ],
    })
    const aggregation = aggregateNodeRuntimeResults({
      workOrder,
      selfOutputs: [schemaOutput(workOrder), priorityOutput("high")],
    })
    const validation = validate(workOrder, aggregation, true)

    expect(validation.status).toBe("partial_success")
    expect(validation.nodeResultStatus).toBe("partial_success")
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: "optional_success_criterion_unmet",
          criterionId: "criterion:optional-note",
        }),
      ]),
    )
  })

  it("can complete when require_all_child_results is false", () => {
    const workOrder = workOrderFixture()
    const aggregation = aggregateNodeRuntimeResults({
      workOrder,
      strategy: "best_effort_with_warnings",
      selfOutputs: [schemaOutput(workOrder), priorityOutput("high")],
      childReports: [
        childReport({ nodeId: "node:triage", outputs: [] }),
      ],
      expectedChildNodeIds: ["node:triage", "node:review"],
      requireAllChildResults: false,
    })
    const validation = validate(workOrder, aggregation)

    expect(aggregation.missingChildNodeIds).toEqual(["node:review"])
    expect(validation.status).toBe("valid")
    expect(validation.nodeResultStatus).toBe("completed")
  })

  it("returns failed_candidate when required success criteria are unmet", () => {
    const workOrder = workOrderFixture()
    const aggregation = aggregateNodeRuntimeResults({
      workOrder,
      selfOutputs: [schemaOutput(workOrder)],
    })
    const validation = validate(workOrder, aggregation, true)

    expect(validation.status).toBe("failed_candidate")
    expect(validation.unmetSuccessCriteriaIds).toEqual(["criterion:priority"])
    expect(validation.risksOrGaps).toEqual(
      expect.arrayContaining(["success_criterion_unmet:criterion:priority"]),
    )
  })
})
