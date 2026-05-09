import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  type EnterpriseRelation,
  type EnterpriseTopology,
  type NodeContract,
} from "../packages/core/src/contracts/enterprise-topology.ts"
import type {
  MemoryPolicy,
  PermissionProfile,
  SkillMcpAllowlist,
  SubAgentConfig,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import {
  closeDb,
  upsertAgentConfig,
  upsertAgentRelationship,
} from "../packages/core/src/db/index.js"
import {
  buildExecutionGraphSnapshot,
  WORKSPACE_DRAFT_TOPOLOGY_ID,
} from "../packages/core/src/orchestration/execution-graph-snapshot.ts"
import { buildExampleEnterpriseTopology } from "../packages/core/src/topology/examples.js"
import {
  createEnterpriseTopologyRegistry,
  type EnterpriseTopologyRegistryStore,
  type TopologyExportEnvelope,
} from "../packages/core/src/topology/registry.js"

const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG
const now = Date.UTC(2026, 4, 7, 0, 0, 0)

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-execution-graph-snapshot-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
}

beforeEach(() => {
  useTempState()
})

afterEach(() => {
  closeDb()
  if (previousStateDir === undefined) delete process.env.NOBIE_STATE_DIR
  else process.env.NOBIE_STATE_DIR = previousStateDir
  if (previousConfig === undefined) delete process.env.NOBIE_CONFIG
  else process.env.NOBIE_CONFIG = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

const permissionProfile: PermissionProfile = {
  profileId: "profile:test",
  riskCeiling: "moderate",
  approvalRequiredFrom: "sensitive",
  allowExternalNetwork: false,
  allowFilesystemWrite: false,
  allowShellExecution: false,
  allowScreenControl: false,
  allowedPaths: [],
}

const allowlist: SkillMcpAllowlist = {
  enabledSkillIds: [],
  enabledMcpServerIds: [],
  enabledToolNames: [],
  disabledToolNames: [],
}

function memoryPolicy(agentId: string): MemoryPolicy {
  return {
    owner: { ownerType: "sub_agent", ownerId: agentId },
    visibility: "private",
    readScopes: [{ ownerType: "sub_agent", ownerId: agentId }],
    writeScope: { ownerType: "sub_agent", ownerId: agentId },
    retentionPolicy: "long_term",
    writebackReviewRequired: true,
  }
}

function subAgent(agentId: string, displayName = agentId): SubAgentConfig {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    agentType: "sub_agent",
    agentId,
    displayName,
    nickname: displayName,
    status: "enabled",
    role: "worker",
    personality: "Precise executor.",
    specialtyTags: ["general"],
    avoidTasks: [],
    memoryPolicy: memoryPolicy(agentId),
    capabilityPolicy: {
      permissionProfile,
      skillMcpAllowlist: allowlist,
      rateLimit: { maxConcurrentCalls: 1 },
    },
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
    teamIds: [],
    delegation: {
      enabled: true,
      maxParallelSessions: 1,
    },
  }
}

function topologyFixture(id: string, updatedAt = now): EnterpriseTopology {
  return {
    ...structuredClone(buildExampleEnterpriseTopology(now)),
    id,
    name: id,
    updatedAt,
  }
}

function node(id: string, children: string[] = [], status: NodeContract["status"] = "draft"): NodeContract {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "node",
    id,
    name: id,
    status,
    createdAt: now,
    updatedAt: now,
    nodeType: "function",
    tags: [],
    children,
    allowedToolIds: [],
    allowedSystemIds: [],
  }
}

function delegatesTo(id: string, fromNodeId: string, toNodeId: string): EnterpriseRelation {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "relation",
    id,
    name: id,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    relationType: "delegates_to",
    from: { entityType: "node", id: fromNodeId },
    to: { entityType: "node", id: toNodeId },
  }
}

function topologyFromParts(input: {
  id?: string
  nodes: NodeContract[]
  relations: EnterpriseRelation[]
}): EnterpriseTopology {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "topology",
    id: input.id ?? WORKSPACE_DRAFT_TOPOLOGY_ID,
    name: input.id ?? WORKSPACE_DRAFT_TOPOLOGY_ID,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    nodes: input.nodes,
    teams: [],
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
  }
}

function rawWorkspaceRegistry(topology: EnterpriseTopology): EnterpriseTopologyRegistryStore {
  const record = {
    topologyId: topology.id,
    name: topology.name,
    status: topology.status,
    createdAt: topology.createdAt,
    updatedAt: topology.updatedAt,
  }
  const envelope: TopologyExportEnvelope = {
    topologyRecord: record,
    version: {
      versionId: `${topology.id}@1`,
      topologyId: topology.id,
      version: 1,
      topology,
      sourceHash: "raw",
      validationSnapshotId: "validation:raw",
      createdAt: topology.updatedAt,
    },
    validationSnapshot: {
      snapshotId: "validation:raw",
      topologyId: topology.id,
      versionId: `${topology.id}@1`,
      version: 1,
      executable: true,
      validation: {
        ok: true,
        executable: true,
        issueCounts: { info: 0, warning: 0, blocked: 0, invalid: 0 },
        issues: [],
      },
      createdAt: topology.updatedAt,
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
    listTopologies: () => [record],
    getTopology: () => record,
    listVersions: () => [envelope.version],
    getVersion: () => envelope.version,
    exportTopology: () => envelope,
    listHistory: () => [],
  }
}

describe("ExecutionGraphSnapshot direct child projection", () => {
  it("uses the latest workspace:draft graph without mixing other non-archived topologies", () => {
    const registry = createEnterpriseTopologyRegistry({ now: () => now })
    registry.appendTopologyVersion({
      topology: topologyFixture("topology:other", now + 1),
      createdBy: "test",
    })
    registry.appendTopologyVersion({
      topology: topologyFixture(WORKSPACE_DRAFT_TOPOLOGY_ID, now + 2),
      createdBy: "test",
    })

    const snapshot = buildExecutionGraphSnapshot({
      mode: "workspace",
      now: () => now,
      topologyRegistry: registry,
    })

    expect(snapshot.graphSource).toBe("workspace_draft")
    expect(snapshot.topologyId).toBe(WORKSPACE_DRAFT_TOPOLOGY_ID)
    expect(snapshot.trace).toEqual({
      execution_graph_id: snapshot.graphId,
      graph_source: "workspace_draft",
      current_executor_id: "agent:nobie",
      available_executor_ids: [`${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:intake`],
    })
    expect(snapshot.allActiveExecutorIds).toEqual([
      `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:intake`,
      `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:triage`,
    ])
    expect(snapshot.rootDirectChildAgentIds).toEqual([`${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:intake`])
    expect(snapshot.availableExecutorIds).toEqual([`${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:intake`])
    expect(snapshot.directChildAgentIdsByParent[`${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:intake`]).toEqual([
      `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:triage`,
    ])
    expect(Object.keys(snapshot.agentsById)).not.toContain("topology:other:node:intake")
  })

  it("uses active topology versions in active deployment mode", () => {
    const registry = createEnterpriseTopologyRegistry({ now: () => now })
    registry.appendTopologyVersion({
      topology: topologyFixture(WORKSPACE_DRAFT_TOPOLOGY_ID, now + 1),
      createdBy: "test",
    })
    const activeTopology = topologyFixture("topology:active", now + 2)
    const appended = registry.appendTopologyVersion({
      topology: activeTopology,
      createdBy: "test",
    })
    const activation = registry.activateTopologyVersion(activeTopology.id, appended.version.version)
    expect(activation.ok).toBe(true)

    const snapshot = buildExecutionGraphSnapshot({
      mode: "active_deployment",
      now: () => now,
      topologyRegistry: registry,
    })

    expect(snapshot.graphSource).toBe("active_topology")
    expect(snapshot.topologyId).toBe("topology:active")
    expect(snapshot.topologyVersion).toBe(appended.version.version)
    expect(snapshot.allActiveExecutorIds).toEqual([
      "topology:active:node:intake",
      "topology:active:node:triage",
    ])
    expect(snapshot.rootDirectChildAgentIds).toEqual(["topology:active:node:intake"])
    expect(Object.keys(snapshot.agentsById)).not.toContain(`${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:intake`)
  })

  it("reports a configuration issue instead of auto-merging multiple active topologies", () => {
    const registry = createEnterpriseTopologyRegistry({ now: () => now })
    for (const topologyId of ["topology:active-a", "topology:active-b"]) {
      const topology = topologyFixture(topologyId, now)
      const appended = registry.appendTopologyVersion({ topology, createdBy: "test" })
      const activation = registry.activateTopologyVersion(topology.id, appended.version.version)
      expect(activation.ok).toBe(true)
    }

    const snapshot = buildExecutionGraphSnapshot({
      mode: "active_deployment",
      now: () => now,
      topologyRegistry: registry,
    })

    expect(snapshot.graphSource).toBe("active_topology")
    expect(snapshot.allActiveExecutorIds).toEqual([])
    expect(snapshot.availableExecutorIds).toEqual([])
    expect(snapshot.validationIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "multiple_active_topologies_without_selection_policy",
        severity: "invalid",
      }),
    ]))
  })

  it("falls back to db/config agents and separates all active executors from current direct children", () => {
    upsertAgentConfig(subAgent("agent:lead", "Lead"), { now })
    upsertAgentConfig(subAgent("agent:worker", "Worker"), { now })
    upsertAgentRelationship({
      edgeId: "edge:lead-worker",
      parentAgentId: "agent:lead",
      childAgentId: "agent:worker",
      relationshipType: "parent_child",
      status: "active",
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    }, { now })

    const rootSnapshot = buildExecutionGraphSnapshot({
      mode: "workspace",
      now: () => now,
    })
    const leadSnapshot = buildExecutionGraphSnapshot({
      mode: "workspace",
      currentExecutorId: "agent:lead",
      now: () => now,
    })

    expect(rootSnapshot.graphSource).toBe("db_config")
    expect(rootSnapshot.allActiveExecutorIds).toEqual(["agent:lead", "agent:worker"])
    expect(rootSnapshot.rootDirectChildAgentIds).toEqual(["agent:lead"])
    expect(rootSnapshot.availableExecutorIds).toEqual(["agent:lead"])
    expect(leadSnapshot.currentExecutorId).toBe("agent:lead")
    expect(leadSnapshot.allActiveExecutorIds).toEqual(["agent:lead", "agent:worker"])
    expect(leadSnapshot.availableExecutorIds).toEqual(["agent:worker"])
    expect(leadSnapshot.edgeIndex["agent:lead"]?.["agent:worker"]?.source).toBe("agent_relationship")
  })

  it("separates registered executors from active direct-child candidates", () => {
    const registry = createEnterpriseTopologyRegistry({ now: () => now })
    registry.appendTopologyVersion({
      topology: topologyFromParts({
        nodes: [
          node("node:active"),
          node("node:inactive", [], "inactive"),
        ],
        relations: [],
      }),
      createdBy: "test",
    })

    const snapshot = buildExecutionGraphSnapshot({
      mode: "workspace",
      now: () => now,
      topologyRegistry: registry,
    })

    expect(snapshot.allRegisteredExecutorIds).toEqual([
      `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:active`,
      `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:inactive`,
    ])
    expect(snapshot.allActiveExecutorIds).toEqual([`${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:active`])
    expect(snapshot.rootDirectChildAgentIds).toEqual([
      `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:active`,
      `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:inactive`,
    ])
    expect(snapshot.availableExecutorIds).toEqual([`${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:active`])
  })

  it("records normalized missing relation endpoint issues without parsing relation text", () => {
    const registry = createEnterpriseTopologyRegistry({ now: () => now })
    registry.appendTopologyVersion({
      topology: topologyFromParts({
        nodes: [
          node("node:parent", ["node:stale"]),
          node("node:child"),
        ],
        relations: [{
          ...delegatesTo("relation:parent-child", "node:parent", "node:child"),
          from: undefined,
        } as unknown as EnterpriseRelation],
      }),
      createdBy: "test",
    })

    const snapshot = buildExecutionGraphSnapshot({
      mode: "workspace",
      now: () => now,
      topologyRegistry: registry,
    })

    expect(snapshot.directChildAgentIdsByParent[`${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:parent`]).toBeUndefined()
    expect(snapshot.validationIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "missing_relation_endpoint",
        severity: "invalid",
        relationId: "relation:parent-child",
      }),
      expect.objectContaining({
        code: "topology_relation_endpoint_missing",
        severity: "invalid",
        relationId: "relation:parent-child",
      }),
    ]))
  })

  it("records children metadata mismatch while using relations as source of truth", () => {
    const registry = rawWorkspaceRegistry(
      topologyFromParts({
        nodes: [
          node("node:parent", ["node:stale"]),
          node("node:child"),
        ],
        relations: [delegatesTo("relation:parent-child", "node:parent", "node:child")],
      }),
    )

    const snapshot = buildExecutionGraphSnapshot({
      mode: "workspace",
      now: () => now,
      topologyRegistry: registry,
    })

    expect(snapshot.directChildAgentIdsByParent[`${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:parent`]).toEqual([
      `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:child`,
    ])
    expect(snapshot.validationIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "children_relation_mismatch",
        severity: "warning",
      }),
    ]))
  })

  it("excludes cycle edges from available executor candidates", () => {
    const registry = createEnterpriseTopologyRegistry({ now: () => now })
    registry.appendTopologyVersion({
      topology: topologyFromParts({
        nodes: [
          node("node:a"),
          node("node:b"),
        ],
        relations: [
          delegatesTo("relation:a-b", "node:a", "node:b"),
          delegatesTo("relation:b-a", "node:b", "node:a"),
        ],
      }),
      createdBy: "test",
    })

    const snapshot = buildExecutionGraphSnapshot({
      mode: "workspace",
      currentExecutorId: `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:a`,
      now: () => now,
      topologyRegistry: registry,
    })

    expect(snapshot.availableExecutorIds).toEqual([])
    expect(snapshot.edgeIndex[`${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:a`]?.[`${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:b`])
      .toEqual(expect.objectContaining({
        executionCandidate: false,
        reasonCodes: ["cycle_detected"],
      }))
    expect(snapshot.validationIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "cycle_detected",
        severity: "invalid",
      }),
    ]))
  })
})
