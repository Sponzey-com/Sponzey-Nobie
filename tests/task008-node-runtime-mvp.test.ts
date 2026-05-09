import { describe, expect, it } from "vitest"
import {
  buildExampleEnterpriseTopology,
  buildWorkOrder,
  compileTopologyOrThrow,
  createWorkOrderRuntimeEnvelope,
  getCompiledEntryNode,
  runNodeRuntime,
  validateNodeResultReport,
  validateResultReport,
  validateTraceEvent,
  type CompiledTopologySnapshot,
  type EnterpriseTopology,
  type NodeContract,
  type WorkOrder,
  type WorkOrderRuntimeEnvelope,
} from "../packages/core/src/index.ts"

const now = Date.UTC(2026, 3, 29, 3, 0, 0)

function topologyFixture(): EnterpriseTopology {
  const topology = structuredClone(buildExampleEnterpriseTopology(now))
  topology.status = "active"
  topology.nodes = topology.nodes.map((node) => ({ ...node, status: "active" }))
  return topology
}

function compiledFixture(topology = topologyFixture()): CompiledTopologySnapshot {
  return compileTopologyOrThrow(topology, {
    sourceTopologyVersion: "task008",
    compiledAt: now,
  })
}

function entryNode(topology: EnterpriseTopology, compiled: CompiledTopologySnapshot): NodeContract {
  const entryId = compiled.runtimeExecutionContext.rootChildNodeIds[0]
  if (entryId === undefined) throw new Error("expected root child node")
  expect(getCompiledEntryNode(compiled)).toBeUndefined()
  const node = topology.nodes.find((candidate) => candidate.id === entryId)
  if (node === undefined) throw new Error("expected entry node contract")
  return node
}

function workOrderFixture(overrides: Partial<WorkOrder> = {}): WorkOrder {
  const order = buildWorkOrder({
    workOrderId: "work-order:intake",
    topologyRunId: "topology-run:task008",
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
  node?: NodeContract
  workOrder?: WorkOrder
  authorityPreflight?: Parameters<typeof createWorkOrderRuntimeEnvelope>[0]["authorityPreflight"]
} = {}): {
  topology: EnterpriseTopology
  compiled: CompiledTopologySnapshot
  node: NodeContract
  workOrder: WorkOrder
  envelope: WorkOrderRuntimeEnvelope
} {
  const topology = input.topology ?? topologyFixture()
  const compiled = input.compiled ?? compiledFixture(topology)
  const node = input.node ?? entryNode(topology, compiled)
  const workOrder = input.workOrder ?? workOrderFixture()
  const result = createWorkOrderRuntimeEnvelope({
    workOrder,
    nodeContractSnapshot: node,
    compiledTopologySnapshot: compiled,
    ...(input.authorityPreflight !== undefined ? { authorityPreflight: input.authorityPreflight } : {}),
    commandRequestId: "command:task008",
    subSessionId: "sub-session:task008",
    now: () => now,
  })

  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error("expected runtime envelope")
  return { topology, compiled, node, workOrder, envelope: result.envelope }
}

describe("task008 Node Runtime MVP", () => {
  it("runs the active compiled topology entry node directly from a WorkOrder", async () => {
    const { compiled, envelope } = runtimeEnvelope()

    const result = await runNodeRuntime({
      envelope,
      compiledTopologySnapshot: compiled,
      nodeRunId: "node-run:task008",
      now: () => now,
    })

    expect(result.status).toBe("completed")
    expect(result.finalState).toBe("completed")
    expect(result.stateTransitions.map((transition) => transition.state)).toEqual([
      "created",
      "work_order_received",
      "analyzing",
      "planning",
      "permission_checking",
      "self_executing",
      "validating",
      "reporting",
      "completed",
    ])
    expect(result.nodeResultReport.status).toBe("completed")
    expect(validateNodeResultReport(result.nodeResultReport).ok).toBe(true)
    expect(validateResultReport(result.legacyResultReport, { expectedOutputs: envelope.expectedOutputs }).ok).toBe(true)
    expect(result.traceEvents.every((event) => validateTraceEvent(event).ok)).toBe(true)
    expect(result.traceEvents.map((event) => event.phase)).toEqual(
      expect.arrayContaining(["work_order", "permission", "authority", "self_execution", "validation", "reporting"]),
    )
  })

  it("creates a runtime profile snapshot from NodeContract without AgentConfig", async () => {
    const { compiled, envelope, node, workOrder } = runtimeEnvelope()

    const result = await runNodeRuntime({
      envelope,
      compiledTopologySnapshot: compiled,
      nodeRunId: "node-run:profile",
      profileSnapshotId: "profile-snapshot:task008",
      now: () => now,
    })

    expect(result.profileSnapshot).toMatchObject({
      profileSnapshotId: "profile-snapshot:task008",
      topologyId: compiled.topologyId,
      compiledTopologySnapshotId: compiled.compiledTopologySnapshotId,
      nodeId: node.id,
      workOrderId: workOrder.workOrderId,
      allowedToolIds: ["tool:crm-search"],
      allowedSystemIds: ["system:crm"],
      source: {
        nodeContractId: node.id,
        workOrderId: workOrder.workOrderId,
        compiledTopologySnapshotId: compiled.compiledTopologySnapshotId,
      },
    })
    expect(JSON.stringify(result.profileSnapshot)).not.toContain("AgentConfig")
    expect(JSON.stringify(result.profileSnapshot)).not.toContain("agentConfig")
  })

  it("returns failed_candidate when node input schema validation fails", async () => {
    const topology = topologyFixture()
    const compiled = compiledFixture(topology)
    const node = {
      ...entryNode(topology, compiled),
      metadata: {
        inputSchema: {
          type: "object",
          required: ["customerId"],
          properties: {
            customerId: { type: "string" },
          },
        },
      },
    } satisfies NodeContract
    const { envelope } = runtimeEnvelope({
      topology,
      compiled,
      node,
      workOrder: workOrderFixture({
        input: {
          requestId: "request:001",
        },
      }),
    })

    const result = await runNodeRuntime({
      envelope,
      compiledTopologySnapshot: compiled,
      nodeRunId: "node-run:input-failure",
      now: () => now,
    })

    expect(result.inputValidation.ok).toBe(false)
    expect(result.status).toBe("failed_candidate")
    expect(result.finalState).toBe("failed_candidate")
    expect(result.nodeResultReport.status).toBe("failed_candidate")
    expect(result.nodeResultReport.risksOrGaps).toEqual(
      expect.arrayContaining(["input_required_field_missing:$.input.customerId"]),
    )
    expect(result.stateTransitions.map((transition) => transition.state)).toEqual(
      expect.arrayContaining(["reporting", "exhaustion_checking", "failed_candidate"]),
    )
    expect(validateNodeResultReport(result.nodeResultReport).ok).toBe(true)
  })

  it("distinguishes permission denied from authority denied", async () => {
    const permissionDenied = runtimeEnvelope({
      workOrder: workOrderFixture({
        permissionScope: {
          allowedToolIds: ["tool:crm-search", "tool:unapproved-write"],
          allowedSystemIds: ["system:crm", "system:unknown"],
          dataDomainIds: ["data:customer"],
          riskLevel: "high",
        },
      }),
    })

    const permissionResult = await runNodeRuntime({
      envelope: permissionDenied.envelope,
      compiledTopologySnapshot: permissionDenied.compiled,
      nodeRunId: "node-run:permission-denied",
      now: () => now,
    })

    expect(permissionResult.status).toBe("permission_limited")
    expect(permissionResult.permissionDecision).toMatchObject({
      allowed: false,
      status: "denied",
      reasonCode: "permission_scope_denied",
      missingToolIds: ["tool:unapproved-write"],
      missingSystemIds: ["system:unknown"],
    })
    expect(permissionResult.nodeResultReport.risksOrGaps).toEqual(
      expect.arrayContaining(["permission_denied", "missing_tool:tool:unapproved-write"]),
    )

    const authorityWorkOrder = workOrderFixture({
      authorityScope: {
        requiredAuthorityRuleIds: ["authority:approve-high-risk"],
        approvalRequired: true,
        approvedBy: [{ entityType: "position", id: "position:cs-lead" }],
      },
    })
    const authorityApprovedEnvelope = runtimeEnvelope({
      workOrder: authorityWorkOrder,
      authorityPreflight: {
        grantedAuthorityRuleIds: ["authority:approve-high-risk"],
      },
    })

    const authorityResult = await runNodeRuntime({
      envelope: authorityApprovedEnvelope.envelope,
      compiledTopologySnapshot: authorityApprovedEnvelope.compiled,
      nodeRunId: "node-run:authority-denied",
      authorityPreflight: {
        deniedAuthorityRuleIds: ["authority:approve-high-risk"],
      },
      now: () => now,
    })

    expect(authorityResult.status).toBe("permission_limited")
    expect(authorityResult.authorityDecision).toMatchObject({
      allowed: false,
      status: "denied",
      reasonCode: "authority_rule_denied",
      deniedAuthorityRuleIds: ["authority:approve-high-risk"],
    })
    expect(authorityResult.nodeResultReport.risksOrGaps).toEqual(
      expect.arrayContaining(["authority_denied", "authority_rule_denied"]),
    )
    expect(authorityResult.traceEvents.map((event) => event.phase)).toContain("authority")
  })

  it("generates NodeResultReport and legacy ResultReport without promoting failed_candidate to final failed", async () => {
    const { compiled, envelope } = runtimeEnvelope()

    const result = await runNodeRuntime({
      envelope,
      compiledTopologySnapshot: compiled,
      nodeRunId: "node-run:failed-candidate",
      now: () => now,
      selfExecute: () => ({
        status: "failed",
        reasonCode: "self_execution_unmet",
        risksOrGaps: ["missing account context"],
      }),
    })

    expect(result.status).toBe("failed_candidate")
    expect(result.finalState).toBe("failed_candidate")
    expect(result.stateTransitions.map((transition) => transition.state)).toEqual(
      expect.arrayContaining(["exhaustion_checking", "failed_candidate"]),
    )
    expect(result.stateTransitions.map((transition) => transition.state)).not.toContain("failed")
    expect(result.nodeResultReport.status).toBe("failed_candidate")
    expect(result.nodeResultReport.failureReportId).toBeUndefined()
    expect(result.nodeResultReport.risksOrGaps).toEqual(
      expect.arrayContaining(["failed_status_normalized_to_failed_candidate", "missing account context"]),
    )
    expect(result.legacyResultReport.status).toBe("needs_revision")
    expect(validateNodeResultReport(result.nodeResultReport).ok).toBe(true)
    expect(validateResultReport(result.legacyResultReport).ok).toBe(true)
  })
})
