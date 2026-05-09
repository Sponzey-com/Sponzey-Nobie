import { describe, expect, it } from "vitest"
import {
  buildExampleEnterpriseTopology,
  buildWorkOrder,
  compileTopologyOrThrow,
  createWorkOrderRuntimeEnvelope,
  deriveEffectiveWorkOrderPermissionScope,
  evaluateWorkOrderAuthorityPreflight,
  validateCommandRequest,
  type CompiledTopologySnapshot,
  type EnterpriseTopology,
  type NodeContract,
  type WorkOrder,
} from "../packages/core/src/index.ts"

const now = Date.UTC(2026, 3, 29, 2, 0, 0)

function topologyFixture(): EnterpriseTopology {
  return structuredClone(buildExampleEnterpriseTopology(now))
}

function compiledFixture(topology = topologyFixture()): CompiledTopologySnapshot {
  return compileTopologyOrThrow(topology, {
    sourceTopologyVersion: "task007",
    compiledAt: now,
  })
}

function intakeNode(topology: EnterpriseTopology): NodeContract {
  const node = topology.nodes.find((candidate) => candidate.id === "node:intake")
  if (node === undefined) throw new Error("expected intake node")
  return node
}

function workOrderFixture(overrides: Partial<WorkOrder> = {}): WorkOrder {
  const order = buildWorkOrder({
    workOrderId: "work-order:intake",
    topologyRunId: "topology-run:task007",
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

describe("task007 WorkOrder runtime bridge", () => {
  it("adapts WorkOrder into a valid CommandRequest without requiring AgentConfig", () => {
    const topology = topologyFixture()
    const node = intakeNode(topology)
    const compiled = compiledFixture(topology)
    const workOrder = workOrderFixture()

    const result = createWorkOrderRuntimeEnvelope({
      workOrder,
      nodeContractSnapshot: node,
      compiledTopologySnapshot: compiled,
      parentRunId: "run:task007",
      parentSessionId: "session:task007",
      commandRequestId: "command:task007",
      subSessionId: "sub-session:task007",
      now: () => now,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected runtime envelope")

    const command = result.envelope.subSessionCommandRequest
    expect(validateCommandRequest(command).ok).toBe(true)
    expect(command).toMatchObject({
      commandRequestId: "command:task007",
      parentRunId: "topology-run:task007",
      subSessionId: "sub-session:task007",
      targetAgentId: "node:intake",
    })
    expect(command.identity.parent).toMatchObject({
      parentRunId: "run:task007",
      parentSessionId: "session:task007",
      parentRequestId: "work-order:intake",
    })
    expect(command.identity.idempotencyKey).toBe(result.envelope.subSessionIdempotencyKey)
    expect(command.taskScope).toMatchObject({
      goal: workOrder.objective,
      intentType: "topology_work_order",
      actionType: "execute_node",
    })
    expect(command.contextPackageIds).toEqual(["exchange:work-order:intake:input"])
    expect(result.envelope.inputDataExchangePackage.payload).toMatchObject({
      workOrderId: "work-order:intake",
      objective: workOrder.objective,
      input: {
        requestId: "request:001",
        customerId: "customer:alpha",
      },
    })
  })

  it("narrows permission scope against node contract and compiled tool scope", () => {
    const topology = topologyFixture()
    const node = intakeNode(topology)
    const compiled = compiledFixture(topology)
    const workOrder = workOrderFixture({
      permissionScope: {
        allowedToolIds: ["tool:crm-search", "tool:unapproved-write"],
        allowedSystemIds: ["system:crm", "system:unknown"],
        dataDomainIds: ["data:customer"],
        riskLevel: "high",
      },
    })

    const effective = deriveEffectiveWorkOrderPermissionScope({
      workOrder,
      nodeContractSnapshot: node,
      compiledTopologySnapshot: compiled,
    })
    const result = createWorkOrderRuntimeEnvelope({
      workOrder,
      nodeContractSnapshot: node,
      compiledTopologySnapshot: compiled,
      now: () => now,
    })

    expect(effective).toMatchObject({
      allowedToolIds: ["tool:crm-search"],
      allowedSystemIds: ["system:crm"],
      removedToolIds: ["tool:unapproved-write"],
      removedSystemIds: ["system:unknown"],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected runtime envelope")
    expect(result.envelope.capabilityPolicy.permissionProfile.riskCeiling).toBe("sensitive")
    expect(result.envelope.capabilityPolicy.skillMcpAllowlist.enabledToolNames).toEqual([
      "tool:crm-search",
      "system:crm",
    ])
    expect(result.envelope.capabilityPolicy.skillMcpAllowlist.disabledToolNames).toEqual([
      "tool:unapproved-write",
      "system:unknown",
    ])
  })

  it("propagates expected output schema and success criteria to prompt and result review bridges", () => {
    const topology = topologyFixture()
    const result = createWorkOrderRuntimeEnvelope({
      workOrder: workOrderFixture(),
      nodeContractSnapshot: intakeNode(topology),
      compiledTopologySnapshot: compiledFixture(topology),
      now: () => now,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected runtime envelope")

    const outputIds = result.envelope.expectedOutputs.map((output) => output.outputId)
    expect(outputIds).toEqual(["work-order:intake:expected-output-schema", "criterion:priority"])
    expect(result.envelope.promptBridge.completionCriteria).toEqual(result.envelope.expectedOutputs)
    expect(result.envelope.promptBridge.successCriterionIds).toEqual(["criterion:priority"])
    expect(result.envelope.resultReviewBridge.expectedOutputs).toEqual(result.envelope.expectedOutputs)
    expect(result.envelope.resultReviewBridge.successCriterionIds).toEqual(["criterion:priority"])
    expect(result.envelope.subSessionCommandRequest.expectedOutputs).toEqual(result.envelope.expectedOutputs)
  })

  it("denies authority preflight before producing a SubSession command", () => {
    const topology = topologyFixture()
    const workOrder = workOrderFixture({
      authorityScope: {
        requiredAuthorityRuleIds: ["authority:approve-high-risk"],
        approvalRequired: true,
      },
    })

    const decision = evaluateWorkOrderAuthorityPreflight(workOrder)
    const result = createWorkOrderRuntimeEnvelope({
      workOrder,
      nodeContractSnapshot: intakeNode(topology),
      compiledTopologySnapshot: compiledFixture(topology),
      now: () => now,
    })

    expect(decision).toMatchObject({
      allowed: false,
      status: "denied",
      reasonCode: "required_authority_rule_missing",
      missingAuthorityRuleIds: ["authority:approve-high-risk"],
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected denied preflight")
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "authority_preflight_denied",
          reasonCode: "required_authority_rule_missing",
        }),
      ]),
    )
  })

  it("allows authority preflight when required rules and approver are present", () => {
    const topology = topologyFixture()
    const workOrder = workOrderFixture({
      authorityScope: {
        requiredAuthorityRuleIds: ["authority:approve-high-risk"],
        approvalRequired: true,
        approvedBy: [{ entityType: "position", id: "position:cs-lead" }],
      },
    })

    const result = createWorkOrderRuntimeEnvelope({
      workOrder,
      nodeContractSnapshot: intakeNode(topology),
      compiledTopologySnapshot: compiledFixture(topology),
      authorityPreflight: {
        grantedAuthorityRuleIds: ["authority:approve-high-risk"],
      },
      now: () => now,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected approved authority preflight")
    expect(result.envelope.authorityDecision).toMatchObject({
      allowed: true,
      status: "approved",
      reasonCode: "authority_preflight_approved",
      grantedAuthorityRuleIds: ["authority:approve-high-risk"],
      approvedBy: [{ entityType: "position", id: "position:cs-lead" }],
    })
  })
})
