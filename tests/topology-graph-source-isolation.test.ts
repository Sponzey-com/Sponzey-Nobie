import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  type EnterpriseRelation,
  type EnterpriseTopology,
  type NodeContract,
} from "../packages/core/src/contracts/enterprise-topology.ts"
import { closeDb } from "../packages/core/src/db/index.js"
import {
  WORKSPACE_DRAFT_TOPOLOGY_ID,
  buildExecutionGraphSnapshot,
} from "../packages/core/src/orchestration/execution-graph-snapshot.ts"
import { EXECUTOR_PROFILE_METADATA_KEY } from "../packages/core/src/topology/executor-profile.ts"
import { createEnterpriseTopologyRegistry } from "../packages/core/src/topology/registry.ts"

const now = Date.UTC(2026, 4, 7, 3, 0, 0)
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG
const tempDirs: string[] = []

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-topology-graph-source-isolation-"))
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

function node(id: string, name = id, children: string[] = []): NodeContract {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "node",
    id,
    name,
    displayName: name,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    nodeType: "function",
    description: `${name} handles saved user-defined work.`,
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

function topology(input: {
  id: string
  name?: string
  status?: EnterpriseTopology["status"]
  nodes: NodeContract[]
  relations?: EnterpriseRelation[]
  metadata?: EnterpriseTopology["metadata"]
  updatedAt?: number
}): EnterpriseTopology {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "topology",
    id: input.id,
    name: input.name ?? input.id,
    status: input.status ?? "draft",
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
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
    relations: input.relations ?? [],
    metadata: input.metadata,
  }
}

describe("topology graph source isolation and persistence repair", () => {
  it("uses only the latest workspace:draft topology in workspace graph mode", () => {
    const registry = createEnterpriseTopologyRegistry({ now: () => now })
    registry.appendTopologyVersion({
      topology: topology({
        id: "topology:other",
        nodes: [node("node:other")],
        updatedAt: now + 1,
      }),
      createdBy: "task011-test",
    })
    registry.appendTopologyVersion({
      topology: topology({
        id: WORKSPACE_DRAFT_TOPOLOGY_ID,
        nodes: [node("node:old")],
        updatedAt: now + 2,
      }),
      createdBy: "task011-test",
    })
    registry.appendTopologyVersion({
      topology: topology({
        id: WORKSPACE_DRAFT_TOPOLOGY_ID,
        nodes: [node("node:latest")],
        updatedAt: now + 3,
      }),
      createdBy: "task011-test",
    })

    const snapshot = buildExecutionGraphSnapshot({
      mode: "workspace",
      topologyRegistry: registry,
      now: () => now,
    })

    expect(snapshot.graphSource).toBe("workspace_draft")
    expect(snapshot.topologyId).toBe(WORKSPACE_DRAFT_TOPOLOGY_ID)
    expect(Object.keys(snapshot.agentsById)).toEqual([`${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:latest`])
    expect(snapshot.allActiveExecutorIds).toEqual([`${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:latest`])
  })

  it("does not use draft or db/config candidates in active deployment mode without an active version", () => {
    const registry = createEnterpriseTopologyRegistry({ now: () => now })
    registry.appendTopologyVersion({
      topology: topology({
        id: WORKSPACE_DRAFT_TOPOLOGY_ID,
        nodes: [node("node:draft")],
      }),
      createdBy: "task011-test",
    })
    registry.appendTopologyVersion({
      topology: topology({
        id: "topology:active-status-without-version",
        status: "active",
        nodes: [node("node:should-not-run")],
      }),
      createdBy: "task011-test",
    })

    const snapshot = buildExecutionGraphSnapshot({
      mode: "active_deployment",
      topologyRegistry: registry,
      now: () => now,
    })

    expect(snapshot.graphSource).toBe("active_topology")
    expect(snapshot.allActiveExecutorIds).toEqual([])
    expect(snapshot.availableExecutorIds).toEqual([])
    expect(snapshot.validationIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "active_topology_not_found",
        severity: "invalid",
      }),
    ]))
  })

  it("does not recover missing runtime relation endpoints by parsing relation id or name text", () => {
    const registry = createEnterpriseTopologyRegistry({ now: () => now })
    registry.appendTopologyVersion({
      topology: topology({
        id: WORKSPACE_DRAFT_TOPOLOGY_ID,
        nodes: [
          node("node:executor-1", "Parent", ["node:executor-2"]),
          node("node:executor-2", "Child"),
        ],
        relations: [{
          ...delegatesTo("relation:executor-1-executor-2", "node:executor-1", "node:executor-2"),
          name: "executor-1 delegates to executor-2",
          from: undefined,
        } as unknown as EnterpriseRelation],
      }),
      createdBy: "task011-test",
    })

    const snapshot = buildExecutionGraphSnapshot({
      mode: "workspace",
      topologyRegistry: registry,
      now: () => now,
    })

    expect(snapshot.directChildAgentIdsByParent["workspace:draft:node:executor-1"]).toBeUndefined()
    expect(snapshot.rootDirectChildAgentIds).toEqual([
      "workspace:draft:node:executor-1",
      "workspace:draft:node:executor-2",
    ])
    expect(snapshot.validationIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "topology_relation_endpoint_missing",
        severity: "invalid",
        relationId: "relation:executor-1-executor-2",
      }),
    ]))
  })

  it("repairs structured legacy endpoints, reprojects children, and stores a minimal executor profile", () => {
    const registry = createEnterpriseTopologyRegistry({ now: () => now })
    const appended = registry.appendTopologyVersion({
      topology: topology({
        id: WORKSPACE_DRAFT_TOPOLOGY_ID,
        nodes: [
          node("node:executor-1", "Legacy Parent", ["node:stale"]),
          node("node:executor-2", "Legacy Child"),
        ],
        relations: [{
          ...delegatesTo("relation:legacy", "node:executor-1", "node:executor-2"),
          from: undefined,
          metadata: {
            fromNodeId: "node:executor-1",
            toNodeId: "node:executor-2",
          },
        } as unknown as EnterpriseRelation],
      }),
      createdBy: "task011-test",
    })
    const stored = registry.exportTopology(WORKSPACE_DRAFT_TOPOLOGY_ID, appended.version.version)
    const repairedRelation = stored?.version.topology.relations[0]
    const parent = stored?.version.topology.nodes.find((candidate) => candidate.id === "node:executor-1")
    const child = stored?.version.topology.nodes.find((candidate) => candidate.id === "node:executor-2")

    expect(repairedRelation?.from).toEqual({ entityType: "node", id: "node:executor-1" })
    expect(repairedRelation?.to).toEqual({ entityType: "node", id: "node:executor-2" })
    expect(parent?.children).toEqual(["node:executor-2"])
    expect(child?.metadata?.[EXECUTOR_PROFILE_METADATA_KEY]).toMatchObject({
      displayName: "Legacy Child",
      roleName: "function",
      definition: "Legacy Child handles saved user-defined work.",
      does: ["Legacy Child handles saved user-defined work."],
      delegationScope: ["function"],
      expectedOutputs: ["처리 결과"],
      declineCriteria: expect.any(Array),
      riskBoundary: expect.any(Array),
    })
    expect(appended.history.detail.repairIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "topology_relation_endpoint_repaired" }),
      expect.objectContaining({ code: "topology_node_children_reprojected", nodeId: "node:executor-1" }),
      expect.objectContaining({ code: "topology_executor_profile_created", nodeId: "node:executor-2" }),
    ]))
  })

  it("removes stale tool and system references before persisting topology versions", () => {
    const registry = createEnterpriseTopologyRegistry({ now: () => now })
    const staleNode = {
      ...node("node:finance", "Finance Executor"),
      allowedToolIds: ["tool:web-research"],
      allowedSystemIds: ["system:missing"],
      failurePolicy: {
        failureReportRequired: true,
        allowPartialSuccess: true,
        fallbackNodeIds: [],
      },
      recoveryPolicy: {
        retryAllowed: false,
        redelegationAllowed: true,
        fallbackAllowed: false,
        partialSuccessAllowed: true,
      },
      metadata: {
        executorGraph: {
          inferredTools: ["tool:web-research"],
        },
      },
    }
    const appended = registry.appendTopologyVersion({
      topology: topology({
        id: WORKSPACE_DRAFT_TOPOLOGY_ID,
        nodes: [staleNode],
        metadata: {
          executorGraph: {
            workspace: {
              executors: [{
                id: "node:finance",
                inferredTools: ["tool:web-research"],
              }],
            },
          },
        },
        relations: [{
          schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
          entityType: "relation",
          id: "relation:finance-tool",
          name: "Finance Executor uses missing tool",
          status: "draft",
          createdAt: now,
          updatedAt: now,
          relationType: "uses_tool",
          from: { entityType: "node", id: "node:finance" },
          to: { entityType: "enterprise_tool", id: "tool:web-research" },
        }],
      }),
      createdBy: "task012-repair-test",
    })
    const stored = registry.exportTopology(WORKSPACE_DRAFT_TOPOLOGY_ID, appended.version.version)

    expect(appended.validationSnapshot.executable).toBe(true)
    expect(stored?.version.topology.nodes[0]?.allowedToolIds).toEqual([])
    expect(stored?.version.topology.nodes[0]?.allowedSystemIds).toEqual([])
    expect(stored?.version.topology.nodes[0]?.metadata?.executorGraph).toEqual({ inferredTools: [] })
    expect(
      (stored?.version.topology.metadata?.executorGraph as { workspace?: { executors?: Array<{ inferredTools?: string[] }> } } | undefined)
        ?.workspace?.executors?.[0]?.inferredTools,
    ).toEqual([])
    expect(stored?.version.topology.relations).toEqual([])
    expect(appended.history.detail.repairIssues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "topology_missing_tool_reference_removed", nodeId: "node:finance" }),
      expect.objectContaining({ code: "topology_missing_system_reference_removed", nodeId: "node:finance" }),
      expect.objectContaining({ code: "topology_missing_resource_hint_removed", nodeId: "node:finance" }),
      expect.objectContaining({ code: "topology_missing_tool_relation_removed", relationId: "relation:finance-tool" }),
    ]))
  })
})
