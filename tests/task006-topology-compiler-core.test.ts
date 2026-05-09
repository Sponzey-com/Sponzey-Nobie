import { describe, expect, it } from "vitest"
import {
  buildCompiledEntityRefKey,
  buildExampleEnterpriseTopology,
  compileTopology,
  compileTopologyOrThrow,
  createInMemoryTopologyCompilerCache,
  getCompiledChildCandidates,
  getCompiledEntryNode,
  TOPOLOGY_COMPILER_VERSION,
  TopologyCompileError,
  type EnterpriseEntityType,
  type EnterpriseRelation,
  type EnterpriseTopology,
  type Position,
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

function relation(id: string, overrides: Partial<EnterpriseRelation>): EnterpriseRelation {
  return {
    ...base("relation", id, id),
    relationType: "reports_to",
    from: { entityType: "position", id: "position:cs-lead" },
    to: { entityType: "position", id: "position:cs-manager" },
    ...overrides,
  }
}

describe("task006 topology compiler core", () => {
  it("compiles a valid topology into runtime-ready entity indexes and delegation tree", () => {
    const result = compileTopology(cloneTopology(), {
      sourceTopologyVersion: "fixture-v1",
      compiledAt: now,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected compiled topology")

    const snapshot = result.snapshot
    expect(snapshot.compilerVersion).toBe(TOPOLOGY_COMPILER_VERSION)
    expect(snapshot.sourceTopologyVersion).toBe("fixture-v1")
    expect(snapshot.compiledTopologySnapshotId).toMatch(/^compiled:/)
    expect(Object.keys(snapshot.nodeIndex).sort()).toEqual(["node:intake", "node:triage"])
    expect(Object.keys(snapshot.teamIndex)).toEqual(["team:customer-success-coverage"])
    expect(Object.keys(snapshot.orgUnitIndex)).toEqual(["org:customer-success"])
    expect(Object.keys(snapshot.positionIndex)).toEqual(["position:cs-lead"])
    expect(Object.keys(snapshot.personIndex)).toEqual(["person:lee"])
    expect(Object.keys(snapshot.toolIndex)).toEqual(["tool:crm-search"])
    expect(Object.keys(snapshot.systemIndex)).toEqual(["system:crm"])
    expect(snapshot.parentChildTree).toMatchObject({
      rootNodeIds: ["node:intake"],
      rootChildNodeIds: ["node:intake"],
      entryNodeId: null,
      exitNodeIds: ["node:triage"],
      edges: {
        "node:intake": ["node:triage"],
        "node:triage": [],
      },
      parents: {
        "node:intake": [],
        "node:triage": ["node:intake"],
      },
    })
    expect(snapshot.runtimeExecutionContext.entryNodeId).toBeNull()
    expect(getCompiledEntryNode(snapshot)).toBeUndefined()
    expect(getCompiledChildCandidates(snapshot, "node:intake").map((node) => node.id)).toEqual(["node:triage"])
    expect(snapshot.delegationScopeMap["node:intake"]).toMatchObject({
      directChildNodeIds: ["node:triage"],
      descendantNodeIds: ["node:triage"],
      maxDepth: 1,
    })
  })

  it("keeps reports_to, approves, owns, and accountable_for out of execution delegation", () => {
    const topology = cloneTopology()
    const managerPosition: Position = {
      ...base("position", "position:cs-manager", "CS Manager"),
      orgUnitId: "org:customer-success",
      personIds: [],
      responsibilityIds: [],
    }
    topology.positions.push(managerPosition)
    topology.relations.push(
      relation("relation:cs-lead-reports-to-manager", {
        relationType: "reports_to",
        from: { entityType: "position", id: "position:cs-lead" },
        to: { entityType: "position", id: "position:cs-manager" },
      }),
      relation("relation:cs-lead-approves-triage", {
        relationType: "approves",
        from: { entityType: "position", id: "position:cs-lead" },
        to: { entityType: "node", id: "node:triage" },
      }),
      relation("relation:cs-lead-owns-intake", {
        relationType: "owns",
        from: { entityType: "position", id: "position:cs-lead" },
        to: { entityType: "node", id: "node:intake" },
      }),
      relation("relation:cs-lead-accountable-intake", {
        relationType: "accountable_for",
        from: { entityType: "position", id: "position:cs-lead" },
        to: { entityType: "node", id: "node:intake" },
      }),
    )

    const snapshot = compileTopologyOrThrow(topology, { sourceTopologyVersion: "relation-guard", compiledAt: now })

    expect(snapshot.parentChildTree.edges["node:intake"]).toEqual(["node:triage"])
    expect(Object.values(snapshot.parentChildTree.edges).flat()).not.toContain("position:cs-manager")
    expect(snapshot.runtimeExecutionContext.delegationEdgeCount).toBe(1)
  })

  it("builds tool scope index from tool, system, and backing-system relations", () => {
    const snapshot = compileTopologyOrThrow(cloneTopology(), { sourceTopologyVersion: "tool-scope", compiledAt: now })
    const toolScope = snapshot.toolScopeIndex["node:intake"]

    expect(toolScope).toMatchObject({
      nodeId: "node:intake",
      allowedToolIds: ["tool:crm-search"],
      declaredToolIds: ["tool:crm-search"],
      effectiveToolIds: ["tool:crm-search"],
      allowedSystemIds: ["system:crm"],
      declaredSystemIds: ["system:crm"],
      backingSystemIds: ["system:crm"],
      effectiveSystemIds: ["system:crm"],
      toolRelationIds: ["relation:intake-crm-search"],
      systemRelationIds: ["relation:intake-crm"],
    })
  })

  it("builds authority scope index from approves relations and authority rules", () => {
    const topology = cloneTopology()
    topology.relations.push(
      relation("relation:cs-lead-approves-triage", {
        relationType: "approves",
        from: { entityType: "position", id: "position:cs-lead" },
        to: { entityType: "node", id: "node:triage" },
      }),
    )
    topology.authorityRules.push({
      ...base("authority_rule", "authority:approve-triage", "Approve Triage"),
      subject: { entityType: "person", id: "person:lee" },
      action: "approve",
      object: { entityType: "node", id: "node:triage" },
      delegable: false,
      requiresAuditLog: true,
    })

    const snapshot = compileTopologyOrThrow(topology, { sourceTopologyVersion: "authority-scope", compiledAt: now })
    const targetKey = buildCompiledEntityRefKey({ entityType: "node", id: "node:triage" })

    expect(snapshot.authorityScopeIndex[targetKey]).toEqual({
      target: { entityType: "node", id: "node:triage" },
      authorityRuleIds: ["authority:approve-triage"],
      approvalRelationIds: ["relation:cs-lead-approves-triage"],
      approverRefs: [
        { entityType: "position", id: "position:cs-lead" },
        { entityType: "person", id: "person:lee" },
      ],
    })
  })

  it("rejects blocked or invalid validator results before compiling", () => {
    const topology = cloneTopology()
    const intake = topology.nodes.find((node) => node.id === "node:intake")
    if (intake === undefined) throw new Error("expected intake node")
    delete intake.failurePolicy

    const result = compileTopology(topology, { sourceTopologyVersion: "invalid", compiledAt: now })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected rejected topology")
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "failure_policy_missing",
          severity: "blocked",
          entityId: "node:intake",
        }),
      ]),
    )
    expect(() => compileTopologyOrThrow(topology, { sourceTopologyVersion: "invalid", compiledAt: now })).toThrow(
      TopologyCompileError,
    )
  })

  it("invalidates the in-memory compile cache when source version changes", () => {
    const topology = cloneTopology()
    const cache = createInMemoryTopologyCompilerCache()

    const first = cache.compileOrGet(topology, { sourceTopologyVersion: "v1", compiledAt: now })
    const second = cache.compileOrGet(topology, { sourceTopologyVersion: "v1", compiledAt: now + 1 })
    const third = cache.compileOrGet(topology, { sourceTopologyVersion: "v2", compiledAt: now + 2 })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(third.ok).toBe(true)
    if (!first.ok || !second.ok || !third.ok) throw new Error("expected cached compile results")

    expect(first.fromCache).toBe(false)
    expect(second.fromCache).toBe(true)
    expect(third.fromCache).toBe(false)
    expect(second.snapshot.compiledTopologySnapshotId).toBe(first.snapshot.compiledTopologySnapshotId)
    expect(third.snapshot.compiledTopologySnapshotId).not.toBe(first.snapshot.compiledTopologySnapshotId)
    expect(cache.list()).toHaveLength(2)
  })
})
