import { describe, expect, it } from "vitest"
import {
  type EnterpriseEntityType,
  type EnterpriseRelation,
  type EnterpriseTopology,
  type Position,
} from "../packages/core/src/contracts/enterprise-topology.ts"
import { buildWorkOrder } from "../packages/core/src/topology-runtime/work-order.ts"
import { checkNodeRuntimePermission } from "../packages/core/src/topology-runtime/permission-checker.ts"
import { compileTopologyOrThrow } from "../packages/core/src/topology/compiler.ts"
import { analyzeTopologyGaps } from "../packages/core/src/topology/gap-analysis.ts"
import { projectEnterpriseOrgWorkloadMetrics } from "../packages/core/src/topology/metrics.ts"
import { simulateApprovalLine } from "../packages/core/src/topology/enterprise-rules.ts"
import { validateTopology } from "../packages/core/src/topology/validator.ts"
import { buildExampleEnterpriseTopology } from "../packages/core/src/topology/examples.ts"

const now = Date.UTC(2026, 3, 30, 9, 0, 0)

function cloneTopology(): EnterpriseTopology {
  return structuredClone(buildExampleEnterpriseTopology(now))
}

function base<TType extends EnterpriseEntityType>(entityType: TType, id: string, name: string) {
  return {
    schemaVersion: 1 as const,
    entityType,
    id,
    name,
    status: "draft" as const,
    createdAt: now,
    updatedAt: now,
  }
}

function relation(id: string, overrides: Partial<EnterpriseRelation>): EnterpriseRelation {
  return {
    ...base("relation", id, id),
    relationType: "approves",
    from: { entityType: "position", id: "position:cs-lead" },
    to: { entityType: "node", id: "node:intake" },
    ...overrides,
  }
}

function nodeById(topology: EnterpriseTopology, nodeId: string) {
  const node = topology.nodes.find((candidate) => candidate.id === nodeId)
  if (node === undefined) throw new Error(`missing node ${nodeId}`)
  return node
}

function csLead(topology: EnterpriseTopology): Position {
  const position = topology.positions.find((candidate) => candidate.id === "position:cs-lead")
  if (position === undefined) throw new Error("missing cs lead")
  return position
}

describe("task024 enterprise extension rules and metrics", () => {
  it("detects incomplete RACI entries as validation issue and analysis finding", () => {
    const topology = cloneTopology()
    const responsibility = topology.responsibilities.find((entry) => entry.id === "resp:intake-owner")
    if (responsibility === undefined) throw new Error("missing responsibility")
    delete responsibility.accountable

    const validation = validateTopology(topology)
    const analysis = analyzeTopologyGaps({ topology, observedEdges: [], now })

    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "raci_accountable_missing",
        severity: "warning",
        entityId: "resp:intake-owner",
      }),
    ]))
    expect(analysis.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        findingKind: "raci_incomplete",
        severity: "medium",
        detail: expect.objectContaining({ reasonCode: "raci_accountable_missing" }),
      }),
    ]))
  })

  it("blocks approval authority rules that exceed the subject position approval limit", () => {
    const topology = cloneTopology()
    csLead(topology).approvalLimit = 100
    topology.authorityRules.push({
      ...base("authority_rule", "authority:approve-large-discount", "Approve Large Discount"),
      subject: { entityType: "position", id: "position:cs-lead" },
      action: "approve_discount",
      object: { entityType: "node", id: "node:intake" },
      condition: { amount: 250 },
      delegable: true,
      requiresAuditLog: true,
    })

    const validation = validateTopology(topology)

    expect(validation.executable).toBe(false)
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "approval_limit_exceeded",
        severity: "blocked",
        entityId: "authority:approve-large-discount",
      }),
    ]))
  })

  it("simulates an approval line through reports_to escalation", () => {
    const topology = cloneTopology()
    csLead(topology).approvalLimit = 100
    csLead(topology).reportsToPositionId = "position:cs-manager"
    topology.positions.push({
      ...base("position", "position:cs-manager", "CS Manager"),
      orgUnitId: "org:customer-success",
      personIds: [],
      approvalLimit: 500,
      responsibilityIds: [],
    })

    const line = simulateApprovalLine({
      topology,
      requester: { entityType: "position", id: "position:cs-lead" },
      target: { entityType: "node", id: "node:intake" },
      action: "approve_discount",
      amount: 250,
    })

    expect(line.approved).toBe(true)
    expect(line.reasonCode).toBe("approval_line_approved")
    expect(line.escalationPath).toEqual([{ entityType: "position", id: "position:cs-manager" }])
    expect(line.authorityContext.approvedBy).toEqual([{ entityType: "position", id: "position:cs-manager" }])
  })

  it("blocks runtime permission when a work order requests an undeclared data domain", () => {
    const topology = cloneTopology()
    const compiled = compileTopologyOrThrow(topology, { sourceTopologyVersion: "task024-data-domain", compiledAt: now })
    const workOrder = buildWorkOrder({
      workOrderId: "work-order:data-domain",
      topologyRunId: "topology-run:data-domain",
      parentWorkOrderId: null,
      fromNodeId: "node:nobie",
      to: { type: "node", id: "node:intake" },
      objective: "Read finance data for a support request.",
      scope: { included: ["finance data"], excluded: [] },
      input: { requestId: "request:finance" },
      expectedOutputSchema: { type: "object", required: ["answer"] },
      successCriteria: [{
        criterionId: "criterion:answer",
        description: "Answer is produced.",
        required: true,
        validationKind: "manual",
      }],
      permissionScope: {
        allowedToolIds: ["tool:crm-search"],
        allowedSystemIds: ["system:crm"],
        dataDomainIds: ["data:finance"],
        riskLevel: "high",
      },
      authorityScope: {
        requiredAuthorityRuleIds: [],
        approvalRequired: false,
      },
      failureReportRequired: true,
      delegationPath: ["node:nobie", "node:intake"],
      createdAt: now,
    })

    const decision = checkNodeRuntimePermission({
      workOrder,
      nodeContractSnapshot: nodeById(topology, "node:intake"),
      compiledTopologySnapshot: compiled,
    })

    expect(decision.allowed).toBe(false)
    expect(decision.reasonCode).toBe("permission_scope_denied")
    expect(decision.missingDataDomainIds).toEqual(["data:finance"])
    expect(decision.effectivePermissionScope.dataDomainIds).toEqual([])
  })

  it("requires critical system access to declare explicit data-domain access", () => {
    const topology = cloneTopology()
    const crm = topology.systems.find((system) => system.id === "system:crm")
    if (crm === undefined) throw new Error("missing crm")
    crm.criticality = "critical"

    const validation = validateTopology(topology)

    expect(validation.executable).toBe(false)
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "critical_system_access_missing",
        severity: "blocked",
        entityId: "node:intake",
      }),
    ]))
  })

  it("detects process owner gaps and missing process SLA", () => {
    const topology = cloneTopology()
    topology.processes.push({
      ...base("process_definition", "process:discount-review", "Discount Review"),
      stepNodeIds: ["node:intake"],
    })

    const validation = validateTopology(topology)
    const analysis = analyzeTopologyGaps({ topology, observedEdges: [], now })

    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "process_owner_missing", severity: "blocked" }),
      expect.objectContaining({ code: "process_sla_missing", severity: "warning" }),
    ]))
    expect(analysis.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        findingKind: "orphan_process",
        detail: expect.objectContaining({ reasonCode: "process_owner_missing" }),
      }),
      expect.objectContaining({
        findingKind: "process_sla_missing",
        detail: expect.objectContaining({ reasonCode: "process_sla_missing" }),
      }),
    ]))
  })

  it("validates multi-membership allocation and projects org workload bottleneck metrics", () => {
    const topology = cloneTopology()
    const membership = topology.memberships.find((candidate) => candidate.id === "membership:lee-cs-lead")
    if (membership === undefined) throw new Error("missing membership")
    membership.allocationPercent = 60
    topology.memberships.push({
      ...base("membership", "membership:lee-cs-shadow", "Lee as CS Shadow"),
      personId: "person:lee",
      positionId: "position:cs-lead",
      orgUnitId: "org:customer-success",
      allocationPercent: 50,
      validFrom: now - 1000,
      validTo: now + 1000,
    })
    topology.relations.push(
      relation("relation:lead-approves-intake", {
        from: { entityType: "position", id: "position:cs-lead" },
        to: { entityType: "node", id: "node:intake" },
      }),
      relation("relation:lead-approves-crm", {
        from: { entityType: "position", id: "position:cs-lead" },
        to: { entityType: "enterprise_system", id: "system:crm" },
      }),
    )

    const validation = validateTopology(topology, { asOf: now })
    const metrics = projectEnterpriseOrgWorkloadMetrics(topology, { asOf: now })
    const csMetric = metrics.find((metric) => metric.orgUnitId === "org:customer-success")

    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "person_membership_allocation_exceeded",
        severity: "blocked",
      }),
    ]))
    expect(csMetric).toMatchObject({
      personCount: 1,
      activeMembershipCount: 2,
      allocatedPercent: 110,
      responsibilityCount: 2,
      approvalTargetCount: 2,
    })
    expect(csMetric?.workloadScore).toBeGreaterThan(0)
    expect(csMetric?.bottleneckScore).toBeGreaterThan(1)
    expect(csMetric?.bottleneckReasons).toContain("membership_allocation_over_capacity")
  })
})
