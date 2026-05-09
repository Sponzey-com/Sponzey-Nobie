import { describe, expect, it } from "vitest"
import {
  assertTopologyValidationExecutable,
  buildExampleEnterpriseTopology,
  isTopologyValidationExecutable,
  TopologyValidationGateError,
  validateTopology,
  type EnterpriseTopology,
  type TopologyValidatorIssue,
} from "../packages/core/src/index.ts"

function cloneTopology(): EnterpriseTopology {
  return structuredClone(buildExampleEnterpriseTopology())
}

function findIssue(issues: TopologyValidatorIssue[], code: TopologyValidatorIssue["code"]): TopologyValidatorIssue {
  const issue = issues.find((candidate) => candidate.code === code)
  if (issue === undefined) throw new Error(`Missing issue ${code}`)
  return issue
}

describe("task004 topology validator core", () => {
  it("accepts the shared fixture topology without blocking issues", () => {
    const result = validateTopology(cloneTopology())

    expect(result.ok).toBe(true)
    expect(result.executable).toBe(true)
    expect(result.issueCounts.invalid).toBe(0)
    expect(result.issueCounts.blocked).toBe(0)
    expect(result.issues).toEqual([])
    expect(isTopologyValidationExecutable(result)).toBe(true)
    expect(() => assertTopologyValidationExecutable(result)).not.toThrow()
  })

  it("reports duplicate node ids with UI-selectable entity context", () => {
    const topology = cloneTopology()
    const duplicateNode = structuredClone(topology.nodes[1])
    if (duplicateNode === undefined) throw new Error("expected example node")
    duplicateNode.id = "node:intake"
    topology.nodes.push(duplicateNode)

    const result = validateTopology(topology)
    const issue = findIssue(result.issues, "duplicate_entity_id")

    expect(result.executable).toBe(false)
    expect(issue).toMatchObject({
      severity: "invalid",
      path: "$.nodes[2].id",
      entityId: "node:intake",
      entityType: "node",
    })
  })

  it("detects delegates_to cycles before runtime compilation", () => {
    const topology = cloneTopology()
    const triageNode = topology.nodes.find((node) => node.id === "node:triage")
    if (triageNode === undefined) throw new Error("expected triage node")
    triageNode.children = ["node:intake"]

    const result = validateTopology(topology)
    const issue = findIssue(result.issues, "delegation_cycle")

    expect(result.executable).toBe(false)
    expect(issue).toMatchObject({
      severity: "invalid",
      entityId: "node:triage",
      sourceEntityId: "node:triage",
      targetEntityId: "node:intake",
    })
    expect(issue.path).toBe("$.nodes[1].children[0]")
  })

  it("blocks delegation trees that exceed the configured max depth", () => {
    const result = validateTopology(cloneTopology(), { maxDelegationDepth: 0 })
    const issue = findIssue(result.issues, "max_delegation_depth_exceeded")

    expect(result.executable).toBe(false)
    expect(result.issueCounts.blocked).toBeGreaterThan(0)
    expect(issue.severity).toBe("blocked")
    expect(issue.entityId).toBe("node:intake")
    expect(() => assertTopologyValidationExecutable(result)).toThrow(TopologyValidationGateError)
  })

  it("reports missing references with path, owner entity, and missing ref context", () => {
    const topology = cloneTopology()
    const team = topology.teams[0]
    if (team === undefined) throw new Error("expected example team")
    team.nodeIds = ["node:missing"]

    const result = validateTopology(topology)
    const issue = findIssue(result.issues, "missing_entity_reference")

    expect(result.executable).toBe(false)
    expect(issue).toMatchObject({
      severity: "invalid",
      path: "$.teams[0].nodeIds[0]",
      entityId: "team:customer-success-coverage",
      entityType: "team",
      refId: "node:missing",
      refType: "node",
    })
  })

  it("uses the relation source/target matrix and preserves relation selection ids", () => {
    const topology = cloneTopology()
    const usesTool = topology.relations.find((relation) => relation.id === "relation:intake-crm-search")
    if (usesTool === undefined) throw new Error("expected uses_tool relation")
    usesTool.to = { entityType: "enterprise_system", id: "system:crm" }

    const result = validateTopology(topology)
    const issue = findIssue(result.issues, "invalid_relation_endpoint")

    expect(result.executable).toBe(false)
    expect(issue).toMatchObject({
      severity: "invalid",
      path: "$.relations[2].to.entityType",
      entityId: "relation:intake-crm-search",
      entityType: "relation",
      relationId: "relation:intake-crm-search",
    })
  })

  it("keeps Team execution semantics and Team/OrgUnit confusion as invalid reason codes", () => {
    const topology = cloneTopology() as EnterpriseTopology & {
      teams: Array<EnterpriseTopology["teams"][number] & { delegationPolicy?: unknown; orgUnitId?: string }>
    }
    const team = topology.teams[0]
    if (team === undefined) throw new Error("expected example team")
    team.delegationPolicy = { mode: "runtime" }
    team.orgUnitId = "org:customer-success"

    const result = validateTopology(topology)

    expect(result.executable).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "team_execution_semantics_forbidden",
          reasonCode: "team_execution_semantics_forbidden",
          severity: "invalid",
          path: "$.teams[0].delegationPolicy",
          entityId: "team:customer-success-coverage",
        }),
        expect.objectContaining({
          code: "team_org_unit_mixed",
          reasonCode: "team_org_unit_mixed",
          severity: "invalid",
          path: "$.teams[0].orgUnitId",
          entityId: "team:customer-success-coverage",
        }),
      ]),
    )
  })
})
