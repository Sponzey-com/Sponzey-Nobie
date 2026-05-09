import { describe, expect, it } from "vitest"
import {
  buildExampleEnterpriseTopology,
  buildWorkOrder,
  compileTopologyOrThrow,
  createWorkOrderRuntimeEnvelope,
  planNodeToolExecution,
  runNodeRuntime,
  validateNodeResultReport,
  validateTraceEvent,
  type CompiledTopologySnapshot,
  type EnterpriseTopology,
  type NodeContract,
  type ToolContext,
  type ToolResult,
  type WorkOrder,
  type WorkOrderRuntimeEnvelope,
} from "../packages/core/src/index.ts"

const now = Date.UTC(2026, 3, 29, 5, 0, 0)

function topologyFixture(): EnterpriseTopology {
  const topology = structuredClone(buildExampleEnterpriseTopology(now))
  topology.status = "active"
  topology.nodes = topology.nodes.map((node) => ({ ...node, status: "active" }))
  return topology
}

function topologyWithWriteTool(): EnterpriseTopology {
  const topology = topologyFixture()
  const intake = topology.nodes.find((node) => node.id === "node:intake")
  if (intake === undefined) throw new Error("expected intake node")
  intake.allowedToolIds = [...intake.allowedToolIds, "tool:crm-write"]
  topology.tools.push({
    schemaVersion: 1,
    entityType: "enterprise_tool",
    id: "tool:crm-write",
    name: "CRM Write",
    status: "active",
    createdAt: now,
    updatedAt: now,
    toolType: "write",
    systemId: "system:crm",
  })
  topology.relations.push({
    schemaVersion: 1,
    entityType: "relation",
    id: "relation:intake-crm-write",
    name: "Intake uses CRM Write",
    status: "active",
    createdAt: now,
    updatedAt: now,
    relationType: "uses_tool",
    from: { entityType: "node", id: "node:intake" },
    to: { entityType: "enterprise_tool", id: "tool:crm-write" },
  }, {
    schemaVersion: 1,
    entityType: "relation",
    id: "relation:cs-lead-approves-crm-write",
    name: "CS Lead approves CRM Write",
    status: "active",
    createdAt: now,
    updatedAt: now,
    relationType: "approves",
    from: { entityType: "position", id: "position:cs-lead" },
    to: { entityType: "enterprise_tool", id: "tool:crm-write" },
  })
  return topology
}

function compiledFixture(topology = topologyFixture()): CompiledTopologySnapshot {
  return compileTopologyOrThrow(topology, {
    sourceTopologyVersion: "task010",
    compiledAt: now,
  })
}

function nodeById(topology: EnterpriseTopology, nodeId: string): NodeContract {
  const node = topology.nodes.find((candidate) => candidate.id === nodeId)
  if (node === undefined) throw new Error(`expected node ${nodeId}`)
  return node
}

function workOrderFixture(overrides: Partial<WorkOrder> = {}): WorkOrder {
  const order = buildWorkOrder({
    workOrderId: "work-order:intake",
    topologyRunId: "topology-run:task010",
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
    commandRequestId: "command:task010",
    subSessionId: "sub-session:task010",
    now: () => now,
  })

  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error("expected runtime envelope")
  return { topology, compiled, workOrder, envelope: result.envelope }
}

function toolContext(): ToolContext {
  return {
    sessionId: "session:task010",
    runId: "run:task010",
    requestGroupId: "group:task010",
    workDir: process.cwd(),
    userMessage: "run topology tool",
    source: "webui",
    allowWebAccess: false,
    onProgress: () => undefined,
    signal: new AbortController().signal,
  }
}

function dispatcher(result: ToolResult | Promise<ToolResult>): {
  calls: Array<{ name: string; params: Record<string, unknown> }>
  dispatch(name: string, params: Record<string, unknown>): Promise<ToolResult>
} {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = []
  return {
    calls,
    async dispatch(name, params) {
      calls.push({ name, params })
      return result
    },
  }
}

describe("task010 Node Tool Runtime", () => {
  it("executes an allowed topology tool and links the result to WorkOrder trace", async () => {
    const { compiled, envelope } = runtimeEnvelope()
    const fakeDispatcher = dispatcher({ success: true, output: "crm account found", details: { accountId: "acct:001" } })

    const result = await runNodeRuntime({
      envelope,
      compiledTopologySnapshot: compiled,
      nodeRunId: "node-run:tool-allowed",
      now: () => now,
      toolExecution: {
        enabled: true,
        dispatcher: fakeDispatcher,
        baseToolContext: toolContext(),
        toolRequests: [{ toolId: "tool:crm-search" }],
      },
    })

    expect(result.status).toBe("completed")
    expect(fakeDispatcher.calls).toEqual([
      {
        name: "tool:crm-search",
        params: {
          requestId: "request:001",
          customerId: "customer:alpha",
        },
      },
    ])
    expect(result.toolExecution?.status).toBe("completed")
    expect(result.toolExecution?.results[0]).toMatchObject({
      toolId: "tool:crm-search",
      status: "succeeded",
      reasonCode: "tool_execution_succeeded",
      output: "crm account found",
    })
    expect(result.traceEvents.every((event) => validateTraceEvent(event).ok)).toBe(true)
    expect(result.traceEvents.map((event) => event.phase)).toContain("tool_execution")
  })

  it("blocks tools outside the WorkOrder permission scope and does not dispatch them", async () => {
    const topology = topologyWithWriteTool()
    const compiled = compiledFixture(topology)
    const { envelope } = runtimeEnvelope({ topology, compiled })
    const fakeDispatcher = dispatcher({ success: true, output: "should not run" })

    const result = await runNodeRuntime({
      envelope,
      compiledTopologySnapshot: compiled,
      nodeRunId: "node-run:tool-denied",
      now: () => now,
      toolExecution: {
        enabled: true,
        dispatcher: fakeDispatcher,
        baseToolContext: toolContext(),
        toolRequests: [{ toolId: "tool:crm-write" }],
      },
    })

    expect(fakeDispatcher.calls).toHaveLength(0)
    expect(result.status).toBe("failed_candidate")
    expect(result.finalState).toBe("failed_candidate")
    expect(result.toolExecution?.failureCandidateResults[0]).toMatchObject({
      toolId: "tool:crm-write",
      status: "denied",
      reasonCode: "tool_permission_denied",
    })
    expect(result.nodeResultReport.risksOrGaps).toEqual(
      expect.arrayContaining(["tool_failure_held_for_retry_or_fallback", "tool_permission_denied"]),
    )

    const systemPlan = planNodeToolExecution({
      compiledTopologySnapshot: compiled,
      nodeContractSnapshot: nodeById(topology, "node:intake"),
      workOrder: workOrderFixture(),
      toolRequests: [{ toolId: "system:crm" }],
    })
    expect(systemPlan.blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reasonCode: "enterprise_system_not_executable_tool" }),
      ]),
    )
  })

  it("separates read-only tools from write tool approval policy", () => {
    const topology = topologyWithWriteTool()
    const compiled = compiledFixture(topology)
    const node = nodeById(topology, "node:intake")
    const workOrder = workOrderFixture({
      permissionScope: {
        allowedToolIds: ["tool:crm-search", "tool:crm-write"],
        allowedSystemIds: ["system:crm"],
        dataDomainIds: ["data:customer"],
        riskLevel: "medium",
      },
    })

    const withoutApproval = planNodeToolExecution({
      compiledTopologySnapshot: compiled,
      nodeContractSnapshot: node,
      workOrder,
      toolRequests: [{ toolId: "tool:crm-search" }, { toolId: "tool:crm-write" }],
    })
    expect(withoutApproval.toolCalls.map((call) => call.toolId)).toEqual(["tool:crm-search"])
    expect(withoutApproval.toolCalls[0]?.approvalStatus).toBe("not_required")
    expect(withoutApproval.blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: "tool:crm-write",
          reasonCode: "tool_approval_required",
        }),
      ]),
    )

    const withApproval = planNodeToolExecution({
      compiledTopologySnapshot: compiled,
      nodeContractSnapshot: node,
      workOrder,
      toolRequests: [{ toolId: "tool:crm-write" }],
      approvalDecisionsByToolId: {
        "tool:crm-write": "approved",
      },
    })
    expect(withApproval.toolCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolId: "tool:crm-write",
          approvalRequired: true,
          approvalStatus: "approved",
        }),
      ]),
    )
  })

  it("normalizes tool timeout as retry candidate instead of final node failure", async () => {
    const { compiled, envelope } = runtimeEnvelope()
    const neverDispatcher = dispatcher(new Promise<ToolResult>(() => undefined))

    const result = await runNodeRuntime({
      envelope,
      compiledTopologySnapshot: compiled,
      nodeRunId: "node-run:tool-timeout",
      now: () => now,
      toolExecution: {
        enabled: true,
        dispatcher: neverDispatcher,
        baseToolContext: toolContext(),
        toolRequests: [{ toolId: "tool:crm-search", timeoutMs: 1 }],
      },
    })

    expect(result.status).toBe("failed_candidate")
    expect(result.stateTransitions.map((transition) => transition.state)).toEqual(
      expect.arrayContaining(["tool_executing", "exhaustion_checking", "failed_candidate"]),
    )
    expect(result.stateTransitions.map((transition) => transition.state)).not.toContain("failed")
    expect(result.toolExecution?.failureCandidateResults[0]).toMatchObject({
      toolId: "tool:crm-search",
      status: "timeout",
      reasonCode: "tool_execution_timeout",
      retryPossible: true,
    })
    expect(result.nodeResultReport.failureReportId).toBeUndefined()
    expect(validateNodeResultReport(result.nodeResultReport).ok).toBe(true)
  })

  it("keeps tool execution errors as failed_candidate with retry and fallback metadata", async () => {
    const { compiled, envelope } = runtimeEnvelope()
    const fakeDispatcher = dispatcher({ success: false, output: "failed", error: "crm_down" })

    const result = await runNodeRuntime({
      envelope,
      compiledTopologySnapshot: compiled,
      nodeRunId: "node-run:tool-error",
      now: () => now,
      toolExecution: {
        enabled: true,
        dispatcher: fakeDispatcher,
        baseToolContext: toolContext(),
        toolRequests: [{ toolId: "tool:crm-search" }],
      },
    })

    expect(result.status).toBe("failed_candidate")
    expect(result.finalState).toBe("failed_candidate")
    expect(result.stateTransitions.map((transition) => transition.state)).not.toContain("failed")
    expect(result.toolExecution?.failureCandidateResults[0]).toMatchObject({
      toolId: "tool:crm-search",
      status: "execution_error",
      reasonCode: "crm_down",
      retryPossible: true,
      fallbackPossible: true,
      failureCandidateInfo: {
        reasonCode: "crm_down",
        retryPossible: true,
        fallbackPossible: true,
        fallbackNodeIds: ["node:triage"],
      },
    })
    expect(result.nodeResultReport.risksOrGaps).toEqual(
      expect.arrayContaining([
        "tool_failure_held_for_retry_or_fallback",
        "tool_result_execution_error:tool:crm-search",
        "tool_retry_possible",
        "tool_fallback_possible",
        "tool_error:crm_down",
      ]),
    )
    expect(validateNodeResultReport(result.nodeResultReport).ok).toBe(true)
  })
})
