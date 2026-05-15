import { describe, expect, it } from "vitest"
import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  type EnterpriseRelation,
  type EnterpriseTopology,
  type NodeContract,
} from "../packages/core/src/contracts/enterprise-topology.ts"
import {
  EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION,
  buildExecutorRuntimeGraphSnapshotV2,
  buildExecutorTopologyV2RuntimeReadModelFromEnterpriseTopology,
  loadExecutorTopologyV2ReadModelFromRegistry,
  migrateEnterpriseTopologyToExecutorTopologyV2,
  validateExecutorTopologyV2,
} from "../packages/core/src/topology/executor-topology-v2.ts"
import {
  legacyTopologyEnvelopeToExecutorCompatibilityEnvelope,
  type LegacyTopologyEnvelope,
  type LegacyTopologyRegistryStore,
} from "../packages/core/src/topology/legacy-enterprise-topology-adapter.ts"

const now = Date.UTC(2026, 4, 8, 14, 0, 0)

function node(input: {
  id: string
  name: string
  children?: string[]
  metadata?: NodeContract["metadata"]
  status?: NodeContract["status"]
}): NodeContract {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "node",
    id: input.id,
    name: input.name,
    displayName: input.name,
    status: input.status ?? "draft",
    createdAt: now,
    updatedAt: now,
    nodeType: "function",
    description: `${input.name} 업무를 처리합니다.`,
    tags: ["업무"],
    children: input.children ?? [],
    allowedToolIds: ["tool:web-research"],
    allowedSystemIds: ["system:legacy"],
    metadata: input.metadata,
  }
}

function relation(input: {
  id: string
  relationType: EnterpriseRelation["relationType"]
  from: EnterpriseRelation["from"]
  to: EnterpriseRelation["to"]
}): EnterpriseRelation {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "relation",
    id: input.id,
    name: input.id,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    relationType: input.relationType,
    from: input.from,
    to: input.to,
  }
}

function topology(input: {
  relations: EnterpriseRelation[]
  parentChildren?: string[]
}): EnterpriseTopology {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "topology",
    id: "workspace:draft",
    name: "Draft workspace",
    status: "active",
    createdAt: now,
    updatedAt: now,
    nodes: [
      node({
        id: "node:lead",
        name: "업무 리더",
        children: input.parentChildren ?? ["node:ghost"],
        metadata: {
          roleName: "업무 조율자",
          executorGraph: {
            position: { x: 120, y: 240 },
            inferredRuntimeMode: "auto",
            inferredTools: ["tool:web-research"],
            advancedMapping: { allowedToolIds: ["tool:web-research"] },
          },
        },
      }),
      node({ id: "node:worker", name: "실행자" }),
      node({ id: "node:finance", name: "재무 실행자" }),
    ],
    teams: [{
      schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
      entityType: "team",
      id: "team:legacy",
      name: "Legacy Team",
      status: "draft",
      createdAt: now,
      updatedAt: now,
      nodeIds: ["node:lead"],
      tags: [],
    }],
    orgUnits: [],
    positions: [],
    persons: [],
    memberships: [],
    authorityRules: [],
    responsibilities: [],
    systems: [],
    tools: [],
    processes: [],
    relations: input.relations,
    metadata: {
      executorGraph: {
        workspace: {
          executors: [{ id: "node:lead", inferredTools: ["tool:web-research"] }],
        },
      },
      recommendedEntry: "node:lead",
      lastSelectedNodeId: "node:worker",
      active_default_workflow_candidate: "node:finance",
    },
  }
}

function registryWithActiveTopology(sourceTopology: EnterpriseTopology): LegacyTopologyRegistryStore {
  const envelope: LegacyTopologyEnvelope = {
    topologyRecord: {
      topologyId: sourceTopology.id,
      name: sourceTopology.name,
      status: "active",
      activeVersion: 7,
      activeVersionId: `${sourceTopology.id}@7`,
      createdAt: sourceTopology.createdAt,
      updatedAt: sourceTopology.updatedAt,
    },
    version: {
      versionId: `${sourceTopology.id}@7`,
      topologyId: sourceTopology.id,
      version: 7,
      topology: sourceTopology,
      sourceHash: "fixture",
      validationSnapshotId: "validation:fixture",
      createdAt: sourceTopology.updatedAt,
    },
    validationSnapshot: {
      snapshotId: "validation:fixture",
      topologyId: sourceTopology.id,
      versionId: `${sourceTopology.id}@7`,
      version: 7,
      executable: true,
      validation: {
        ok: true,
        executable: true,
        issueCounts: { info: 0, warning: 0, blocked: 0, invalid: 0 },
        issues: [],
      },
      createdAt: sourceTopology.updatedAt,
    },
  }
  return {
    appendTopologyVersion: () => {
      throw new Error("not implemented")
    },
    activateTopologyVersion: () => {
      throw new Error("not implemented")
    },
    rollbackTopologyVersion: () => {
      throw new Error("not implemented")
    },
    archiveTopology: () => null,
    listTopologies: () => [envelope.topologyRecord],
    getTopology: () => envelope.topologyRecord,
    listVersions: () => [envelope.version],
    getVersion: () => envelope.version,
    exportTopology: () => envelope,
    listHistory: () => [],
  }
}

describe("EnterpriseTopology V1 to ExecutorTopologyV2 migration", () => {
  it("projects V1 nodes and delegates_to relations into the V2 runtime source", () => {
    const migrated = migrateEnterpriseTopologyToExecutorTopologyV2(topology({
      relations: [
        relation({
          id: "relation:lead-worker",
          relationType: "delegates_to",
          from: { entityType: "node", id: "node:lead" },
          to: { entityType: "node", id: "node:worker" },
        }),
        relation({
          id: "relation:lead-tool",
          relationType: "uses_tool",
          from: { entityType: "node", id: "node:lead" },
          to: { entityType: "enterprise_tool", id: "tool:web-research" },
        }),
      ],
    }))
    const validation = validateExecutorTopologyV2(migrated.topology)
    const snapshot = buildExecutorRuntimeGraphSnapshotV2(migrated.topology)
    const lead = migrated.topology.nodes.find((candidate) => candidate.id === "node:lead")

    expect(validation).toEqual({ ok: true, issues: [] })
    expect(migrated.topology.schemaVersion).toBe(EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION)
    expect(lead).toMatchObject({
      id: "node:lead",
      name: "업무 리더",
      roleName: "업무 조율자",
      description: "업무 리더 업무를 처리합니다.",
      position: { x: 120, y: 240 },
      status: "active",
    })
    expect(migrated.topology.edges).toEqual([{
      id: "edge:relation:lead-worker",
      sourceNodeId: "node:lead",
      targetNodeId: "node:worker",
      type: "delegates_to",
      status: "active",
    }])
    expect(snapshot.rootDirectChildIds).toEqual(["node:lead", "node:finance"])
    expect(snapshot.directChildrenByNodeId["node:lead"]).toEqual(["node:worker"])
    expect(JSON.stringify(migrated.topology)).not.toContain("tool:web-research")
    expect(JSON.stringify(migrated.topology)).not.toContain('"workspace":')
    expect(JSON.stringify(migrated.topology)).not.toContain("uses_tool")
    expect(JSON.stringify(migrated.topology)).not.toContain("team:legacy")
  })

  it("uses children only as a legacy input when no delegates_to relation exists", () => {
    const migrated = buildExecutorTopologyV2RuntimeReadModelFromEnterpriseTopology(topology({
      relations: [],
      parentChildren: ["node:worker"],
    }))

    expect(migrated.topology.edges).toEqual([{
      id: "edge:legacy-child:node:lead:node:worker",
      sourceNodeId: "node:lead",
      targetNodeId: "node:worker",
      type: "delegates_to",
      status: "active",
    }])
    expect(buildExecutorRuntimeGraphSnapshotV2(migrated.topology).directChildrenByNodeId["node:lead"])
      .toEqual(["node:worker"])
  })

  it("loads an active V1 registry topology as a stale-free V2 read model", () => {
    const sourceTopology = topology({
      relations: [
        relation({
          id: "relation:lead-worker",
          relationType: "delegates_to",
          from: { entityType: "node", id: "node:lead" },
          to: { entityType: "node", id: "node:worker" },
        }),
      ],
    })
    const loaded = loadExecutorTopologyV2ReadModelFromRegistry({
      registry: registryWithActiveTopology(sourceTopology),
    })

    expect(loaded.ok).toBe(true)
    expect(loaded.topology?.schemaVersion).toBe(EXECUTOR_TOPOLOGY_V2_SCHEMA_VERSION)
    expect(loaded.envelope?.version.topology).toBe(sourceTopology)
    expect(loaded.topology?.edges.map((edge) => edge.id)).toEqual(["edge:relation:lead-worker"])
    expect(JSON.stringify(loaded.topology)).not.toContain("tool:web-research")
    expect(JSON.stringify(loaded.topology)).not.toContain('"workspace":')
  })

  it("adapts a V1 envelope into an executor-only compatibility projection for runtime reads", () => {
    const sourceTopology = topology({
      relations: [
        relation({
          id: "relation:lead-worker",
          relationType: "delegates_to",
          from: { entityType: "node", id: "node:lead" },
          to: { entityType: "node", id: "node:worker" },
        }),
      ],
      parentChildren: ["node:ghost"],
    })
    const sourceEnvelope = registryWithActiveTopology(sourceTopology).exportTopology(sourceTopology.id)
    expect(sourceEnvelope).not.toBeNull()

    const adapted = legacyTopologyEnvelopeToExecutorCompatibilityEnvelope(sourceEnvelope!)
    const runtimeTopology = adapted.envelope.version.topology
    const lead = runtimeTopology.nodes.find((candidate) => candidate.id === "node:lead")

    expect(runtimeTopology).not.toBe(sourceTopology)
    expect(runtimeTopology.metadata?.executorTopologyV2).toMatchObject({
      sourceOfTruth: "executor_topology_v2",
      migrationSource: "legacy_enterprise_topology_adapter",
      sourceTopologyVersion: 7,
      sourceVersionId: "workspace:draft@7",
    })
    expect(runtimeTopology.teams).toEqual([])
    expect(runtimeTopology.tools).toEqual([])
    expect(runtimeTopology.systems).toEqual([])
    expect(lead?.children).toEqual([])
    expect(lead?.allowedToolIds).toEqual([])
    expect(runtimeTopology.relations.map((edge) => ({
      relationType: edge.relationType,
      from: edge.from,
      to: edge.to,
    }))).toEqual([{
      relationType: "delegates_to",
      from: { entityType: "node", id: "node:lead" },
      to: { entityType: "node", id: "node:worker" },
    }])
    expect(adapted.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "children_relation_mismatch",
        severity: "warning",
      }),
      expect.objectContaining({
        code: "executor_topology_v2_legacy_children_ignored",
        severity: "info",
      }),
    ]))
    expect(JSON.stringify(runtimeTopology)).not.toContain("tool:web-research")
    expect(JSON.stringify(runtimeTopology)).not.toContain("team:legacy")
  })
})
