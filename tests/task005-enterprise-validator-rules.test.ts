import { describe, expect, it } from "vitest"
import {
  assertTopologyValidationExecutable,
  buildExampleEnterpriseTopology,
  TopologyValidationGateError,
  validateTopology,
  type AuthorityRule,
  type EnterpriseEntityType,
  type EnterpriseRelation,
  type EnterpriseTopology,
  type ProcessDefinition,
  type TopologyValidatorIssue,
} from "../packages/core/src/index.ts"

const now = Date.UTC(2026, 3, 29, 0, 0, 0)

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

function authorityRule(id: string, overrides: Partial<AuthorityRule> = {}): AuthorityRule {
  return {
    ...base("authority_rule", id, id),
    subject: { entityType: "position", id: "position:cs-lead" },
    action: "approve",
    object: { entityType: "node", id: "node:intake" },
    condition: { risk: "medium" },
    delegable: false,
    requiresAuditLog: true,
    ...overrides,
  }
}

function processDefinition(id: string, overrides: Partial<ProcessDefinition> = {}): ProcessDefinition {
  return {
    ...base("process_definition", id, id),
    ownerNodeId: "node:intake",
    stepNodeIds: ["node:intake"],
    accountablePositionId: "position:cs-lead",
    ...overrides,
  }
}

function relation(id: string, overrides: Partial<EnterpriseRelation>): EnterpriseRelation {
  return {
    ...base("relation", id, id),
    relationType: "depends_on",
    from: { entityType: "process_definition", id: "process:customer-response" },
    to: { entityType: "node", id: "node:intake" },
    ...overrides,
  }
}

function findIssue(issues: TopologyValidatorIssue[], code: TopologyValidatorIssue["code"]): TopologyValidatorIssue {
  const issue = issues.find((candidate) => candidate.code === code)
  if (issue === undefined) throw new Error(`Missing issue ${code}`)
  return issue
}

describe("task005 enterprise validator rules", () => {
  it("keeps the shared fixture enterprise-valid for compiler and runtime follow-up tasks", () => {
    const result = validateTopology(cloneTopology())

    expect(result.executable).toBe(true)
    expect(result.issues).toEqual([])
  })

  it("blocks conflicting authority rules for the same subject, action, object, and condition", () => {
    const topology = cloneTopology()
    topology.authorityRules = [
      authorityRule("authority:approve-intake-a"),
      authorityRule("authority:approve-intake-b", { delegable: true }),
    ]

    const result = validateTopology(topology)
    const issue = findIssue(result.issues, "authority_rule_conflict")

    expect(result.executable).toBe(false)
    expect(issue).toMatchObject({
      severity: "blocked",
      path: "$.authorityRules[1]",
      entityId: "authority:approve-intake-b",
      entityType: "authority_rule",
      refId: "authority:approve-intake-a",
      refType: "authority_rule",
    })
  })

  it("blocks approval nodes when no approval relation or authority rule covers the target", () => {
    const topology = cloneTopology()
    const triage = topology.nodes.find((node) => node.id === "node:triage")
    if (triage === undefined) throw new Error("expected triage node")
    triage.nodeType = "approval_node"

    const result = validateTopology(topology)
    const issue = findIssue(result.issues, "approval_authority_missing")

    expect(result.executable).toBe(false)
    expect(issue).toMatchObject({
      severity: "blocked",
      path: "$.nodes[1].nodeType",
      entityId: "node:triage",
      entityType: "node",
    })
  })

  it("blocks tool and backing-system usage that is not present in node permission scope", () => {
    const topology = cloneTopology()
    const intake = topology.nodes.find((node) => node.id === "node:intake")
    if (intake === undefined) throw new Error("expected intake node")
    intake.allowedToolIds = []
    intake.allowedSystemIds = []

    const result = validateTopology(topology)

    expect(result.executable).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "tool_permission_missing",
          severity: "blocked",
          path: "$.relations[2]",
          entityId: "node:intake",
          relationId: "relation:intake-crm-search",
          refId: "tool:crm-search",
        }),
        expect.objectContaining({
          code: "system_permission_missing",
          severity: "blocked",
          relationId: "relation:intake-crm",
          refId: "system:crm",
        }),
      ]),
    )
  })

  it("blocks process owner and process transition reference gaps", () => {
    const topology = cloneTopology()
    topology.processes = [
      processDefinition("process:customer-response", {
        ownerNodeId: undefined,
        stepNodeIds: ["node:triage"],
      }),
    ]
    topology.relations.push(
      relation("relation:process-intake-dependency", {
        from: { entityType: "process_definition", id: "process:customer-response" },
        to: { entityType: "node", id: "node:intake" },
      }),
    )

    const result = validateTopology(topology)

    expect(result.executable).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "process_owner_missing",
          severity: "blocked",
          path: "$.processes[0].ownerNodeId",
          entityId: "process:customer-response",
        }),
        expect.objectContaining({
          code: "process_transition_reference_invalid",
          severity: "blocked",
          relationId: "relation:process-intake-dependency",
          refId: "node:intake",
        }),
      ]),
    )
  })

  it("keeps responsibility matrix gaps as warnings for activation policy to decide separately", () => {
    const topology = cloneTopology()
    topology.responsibilities = []

    const result = validateTopology(topology)
    const issue = findIssue(result.issues, "responsibility_matrix_missing")

    expect(result.executable).toBe(true)
    expect(result.issueCounts.warning).toBeGreaterThan(0)
    expect(issue).toMatchObject({
      severity: "warning",
      entityType: "node",
    })
  })

  it("blocks nodes that omit runtime failure and recovery policies", () => {
    const topology = cloneTopology()
    const intake = topology.nodes.find((node) => node.id === "node:intake")
    if (intake === undefined) throw new Error("expected intake node")
    delete intake.failurePolicy
    delete intake.recoveryPolicy

    const result = validateTopology(topology)

    expect(result.executable).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "failure_policy_missing",
          severity: "blocked",
          path: "$.nodes[0].failurePolicy",
          entityId: "node:intake",
        }),
        expect.objectContaining({
          code: "recovery_policy_missing",
          severity: "blocked",
          path: "$.nodes[0].recoveryPolicy",
          entityId: "node:intake",
        }),
      ]),
    )
    expect(() => assertTopologyValidationExecutable(result)).toThrow(TopologyValidationGateError)
  })
})
