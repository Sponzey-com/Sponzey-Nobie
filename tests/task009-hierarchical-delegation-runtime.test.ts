import { describe, expect, it } from "vitest"
import {
  buildExampleEnterpriseTopology,
  buildWorkOrder,
  compileTopologyOrThrow,
  createWorkOrderRuntimeEnvelope,
  describeTopologyNestedDelegationCompatibilityBoundary,
  planChildDelegation,
  runNodeRuntime,
  validateNodeResultReport,
  validateTraceEvent,
  type CompiledTopologySnapshot,
  type EnterpriseTopology,
  type NodeContract,
  type WorkOrder,
  type WorkOrderRuntimeEnvelope,
} from "../packages/core/src/index.ts"

const now = Date.UTC(2026, 3, 29, 4, 0, 0)

function topologyFixture(): EnterpriseTopology {
  const topology = structuredClone(buildExampleEnterpriseTopology(now))
  topology.status = "active"
  topology.nodes = topology.nodes.map((node) => ({ ...node, status: "active" }))
  return topology
}

function threeLevelTopologyFixture(): EnterpriseTopology {
  const topology = topologyFixture()
  const triage = topology.nodes.find((node) => node.id === "node:triage")
  if (triage === undefined) throw new Error("expected triage node")
  triage.children = ["node:review"]
  topology.nodes.push({
    schemaVersion: 1,
    entityType: "node",
    id: "node:review",
    name: "Customer Request Review",
    status: "active",
    createdAt: now,
    updatedAt: now,
    nodeType: "review_node",
    tags: ["customer-success", "review"],
    children: [],
    allowedToolIds: [],
    allowedSystemIds: [],
    failurePolicy: {
      failureReportRequired: true,
      allowPartialSuccess: true,
      fallbackNodeIds: [],
    },
    recoveryPolicy: {
      retryAllowed: false,
      redelegationAllowed: false,
      fallbackAllowed: false,
      partialSuccessAllowed: true,
    },
  })
  topology.relations.push({
    schemaVersion: 1,
    entityType: "relation",
    id: "relation:triage-review",
    name: "Triage delegates to review",
    status: "active",
    createdAt: now,
    updatedAt: now,
    relationType: "delegates_to",
    from: { entityType: "node", id: "node:triage" },
    to: { entityType: "node", id: "node:review" },
  })
  return topology
}

function compiledFixture(topology = topologyFixture()): CompiledTopologySnapshot {
  return compileTopologyOrThrow(topology, {
    sourceTopologyVersion: "task009",
    compiledAt: now,
  })
}

function nodeById(topology: EnterpriseTopology, nodeId: string): NodeContract {
  const node = topology.nodes.find((candidate) => candidate.id === nodeId)
  if (node === undefined) throw new Error(`expected node ${nodeId}`)
  return node
}

function nodeContractsById(topology: EnterpriseTopology): Record<string, NodeContract> {
  return Object.fromEntries(topology.nodes.map((node) => [node.id, node]))
}

function workOrderFixture(overrides: Partial<WorkOrder> = {}): WorkOrder {
  const order = buildWorkOrder({
    workOrderId: "work-order:intake",
    topologyRunId: "topology-run:task009",
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
  const result = createWorkOrderRuntimeEnvelope({
    workOrder,
    nodeContractSnapshot: nodeById(topology, workOrder.to.id),
    compiledTopologySnapshot: compiled,
    commandRequestId: "command:task009",
    subSessionId: "sub-session:task009",
    now: () => now,
  })

  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error("expected runtime envelope")
  return { topology, compiled, workOrder, envelope: result.envelope }
}

describe("task009 Hierarchical Delegation Runtime", () => {
  it("plans delegation only to compiled direct child nodes", () => {
    const topology = topologyFixture()
    const compiled = compiledFixture(topology)
    const workOrder = workOrderFixture()

    const plan = planChildDelegation({
      compiledTopologySnapshot: compiled,
      parentWorkOrder: workOrder,
      parentNodeId: "node:intake",
      now: () => now,
    })

    expect(plan.ok).toBe(true)
    expect(plan.status).toBe("planned")
    expect(plan.directChildCandidates.map((candidate) => candidate.childNode.id)).toEqual(["node:triage"])
    expect(plan.childWorkOrders.map((item) => item.childNodeId)).toEqual(["node:triage"])
    expect(plan.childWorkOrders[0]?.workOrder).toMatchObject({
      parentWorkOrderId: "work-order:intake",
      fromNodeId: "node:intake",
      to: { type: "node", id: "node:triage" },
      delegationPath: ["node:nobie", "node:intake", "node:triage"],
      permissionScope: {
        allowedToolIds: [],
        allowedSystemIds: [],
        dataDomainIds: ["data:customer"],
      },
    })

    expect(describeTopologyNestedDelegationCompatibilityBoundary()).toMatchObject({
      topologyRuntimeBoundary: "compiled_topology_direct_child_work_order",
      existingOrchestrationBoundary: "orchestration_nested_delegation_command_request",
    })
  })

  it("blocks direct delegation from parent to grandchild", () => {
    const topology = threeLevelTopologyFixture()
    const compiled = compiledFixture(topology)

    const plan = planChildDelegation({
      compiledTopologySnapshot: compiled,
      parentWorkOrder: workOrderFixture(),
      parentNodeId: "node:intake",
      targetChildNodeIds: ["node:review"],
      now: () => now,
    })

    expect(plan.ok).toBe(false)
    expect(plan.status).toBe("blocked")
    expect(plan.childWorkOrders).toHaveLength(0)
    expect(plan.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: "grandchild_direct_delegation_forbidden",
          parentNodeId: "node:intake",
          childNodeId: "node:review",
        }),
      ]),
    )
  })

  it("keeps child failure as parent failed_candidate instead of final failed", async () => {
    const topology = topologyFixture()
    const compiled = compiledFixture(topology)
    const { envelope } = runtimeEnvelope({ topology, compiled })

    const result = await runNodeRuntime({
      envelope,
      compiledTopologySnapshot: compiled,
      nodeRunId: "node-run:parent-child-failure",
      now: () => now,
      childDelegation: {
        enabled: true,
        childNodeContractsById: nodeContractsById(topology),
        childRunner: () => ({
          status: "failed",
          finalState: "failed",
          risksOrGaps: ["child hard failure"],
        }),
      },
    })

    expect(result.status).toBe("failed_candidate")
    expect(result.finalState).toBe("failed_candidate")
    expect(result.stateTransitions.map((transition) => transition.state)).toEqual(
      expect.arrayContaining(["child_delegating", "exhaustion_checking", "failed_candidate"]),
    )
    expect(result.stateTransitions.map((transition) => transition.state)).not.toContain("failed")
    expect(result.nodeResultReport.failureReportId).toBeUndefined()
    expect(result.nodeResultReport.risksOrGaps).toEqual(
      expect.arrayContaining([
        "child_failure_held_for_parent_exhaustion",
        "child_result_failed_candidate:node:triage",
        "child hard failure",
      ]),
    )
    expect(result.childDelegation?.failureCandidateResults.map((item) => item.childNodeId)).toEqual(["node:triage"])
    expect(validateNodeResultReport(result.nodeResultReport).ok).toBe(true)
  })

  it("blocks delegation when max delegation depth would be exceeded", () => {
    const topology = topologyFixture()
    const compiled = compiledFixture(topology)

    const plan = planChildDelegation({
      compiledTopologySnapshot: compiled,
      parentWorkOrder: workOrderFixture(),
      parentNodeId: "node:intake",
      maxDelegationDepth: 0,
      now: () => now,
    })

    expect(plan.ok).toBe(false)
    expect(plan.status).toBe("blocked")
    expect(plan.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: "max_delegation_depth_exceeded",
          childNodeId: "node:triage",
        }),
      ]),
    )
  })

  it("runs recursive child delegation with trace paths for parent and child WorkOrders", async () => {
    const topology = threeLevelTopologyFixture()
    const compiled = compiledFixture(topology)
    const { envelope } = runtimeEnvelope({ topology, compiled })

    const result = await runNodeRuntime({
      envelope,
      compiledTopologySnapshot: compiled,
      nodeRunId: "node-run:recursive-parent",
      now: () => now,
      childDelegation: {
        enabled: true,
        recursive: true,
        maxDelegationDepth: 2,
        childNodeContractsById: nodeContractsById(topology),
      },
    })

    expect(result.status).toBe("completed")
    expect(result.childDelegation?.results.map((item) => item.childNodeId)).toEqual(["node:triage"])
    expect(result.traceEvents.every((event) => validateTraceEvent(event).ok)).toBe(true)
    expect(result.traceEvents.map((event) => event.phase)).toContain("child_delegation")

    const reviewTrace = result.traceEvents.find((event) => event.workOrderId.includes("node:review"))
    expect(reviewTrace).toMatchObject({
      workOrderId: "work-order:intake:child:node:triage:child:node:review",
      delegationPath: ["node:nobie", "node:intake", "node:triage", "node:review"],
    })
  })
})
