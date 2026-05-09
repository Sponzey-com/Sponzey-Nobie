import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig, type OrchestrationConfig } from "../packages/core/src/config/index.js"
import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  type EnterpriseRelation,
  type EnterpriseTopology,
  type NodeContract,
} from "../packages/core/src/contracts/enterprise-topology.ts"
import { closeDb } from "../packages/core/src/db/index.js"
import { buildOrchestrationRegistrySnapshot } from "../packages/core/src/orchestration/registry.ts"
import { createEnterpriseTopologyRegistry } from "../packages/core/src/topology/registry.js"

const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG
const now = Date.UTC(2026, 4, 7, 2, 0, 0)

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-topology-relation-source-of-truth-"))
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

function orchestrationConfig(): OrchestrationConfig {
  return {
    maxDelegationTurns: 5,
    mode: "orchestration",
    featureFlagEnabled: true,
    subAgents: [],
    teams: [],
  }
}

function node(id: string, children: string[] = []): NodeContract {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "node",
    id,
    name: id,
    status: "draft",
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

function topology(input: {
  nodes: NodeContract[]
  relations: EnterpriseRelation[]
}): EnterpriseTopology {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "topology",
    id: "workspace:draft",
    name: "workspace:draft",
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

function saveTopology(input: EnterpriseTopology): void {
  createEnterpriseTopologyRegistry({ now: () => now }).appendTopologyVersion({
    topology: input,
    createdBy: "task002-test",
  })
}

function registrySnapshot() {
  return buildOrchestrationRegistrySnapshot({
    getConfig: () => ({ orchestration: orchestrationConfig() }),
    now: () => now,
  })
}

describe("topology relation source of truth", () => {
  it("uses delegates_to relations over stale node children metadata", () => {
    saveTopology(topology({
      nodes: [
        node("node:executor-1", ["node:ghost"]),
        node("node:executor-2"),
      ],
      relations: [delegatesTo("relation:executor-1-executor-2", "node:executor-1", "node:executor-2")],
    }))

    const snapshot = registrySnapshot()
    const hierarchy = snapshot.hierarchy

    expect(hierarchy?.directChildrenByParent["workspace:draft:node:executor-1"]).toEqual([
      "workspace:draft:node:executor-2",
    ])
    expect(hierarchy?.directChildrenByParent["workspace:draft:node:executor-1"]).not.toContain(
      "workspace:draft:node:ghost",
    )
    const stored = createEnterpriseTopologyRegistry({ now: () => now }).exportTopology("workspace:draft")
    expect(stored?.version.topology.nodes.find((entry) => entry.id === "node:executor-1")?.children)
      .toEqual(["node:executor-2"])
    expect(hierarchy?.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "topology_children_relation_mismatch",
      }),
    ]))
  })

  it("does not recover missing relation endpoints by parsing relation ids or names", () => {
    const invalidRelation = {
      ...delegatesTo("relation:executor-1-executor-2", "node:executor-1", "node:executor-2"),
      name: "executor-1 delegates to executor-2",
      from: undefined,
    } as unknown as EnterpriseRelation

    saveTopology(topology({
      nodes: [
        node("node:executor-1", ["node:executor-2"]),
        node("node:executor-2"),
      ],
      relations: [invalidRelation],
    }))

    const snapshot = registrySnapshot()
    const hierarchy = snapshot.hierarchy

    expect(hierarchy?.directChildrenByParent["workspace:draft:node:executor-1"]).toBeUndefined()
    expect(hierarchy?.directChildrenByParent["agent:nobie"]).toEqual([
      "workspace:draft:node:executor-1",
      "workspace:draft:node:executor-2",
    ])
    expect(hierarchy?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "topology_relation_endpoint_missing",
        severity: "invalid",
      }),
    ]))
  })

  it("marks cycle edges as non-executable hierarchy candidates", () => {
    saveTopology(topology({
      nodes: [
        node("node:executor-1", ["node:executor-2"]),
        node("node:executor-2", ["node:executor-1"]),
      ],
      relations: [
        delegatesTo("relation:executor-1-executor-2", "node:executor-1", "node:executor-2"),
        delegatesTo("relation:executor-2-executor-1", "node:executor-2", "node:executor-1"),
      ],
    }))

    const hierarchy = registrySnapshot().hierarchy

    expect(hierarchy?.directChildrenByParent["agent:nobie"]).toBeUndefined()
    expect(hierarchy?.directChildren).toEqual(expect.arrayContaining([
      expect.objectContaining({
        parentAgentId: "workspace:draft:node:executor-1",
        childAgentId: "workspace:draft:node:executor-2",
        source: "topology_relation",
        executionCandidate: false,
        reasonCodes: ["cycle_detected"],
      }),
      expect.objectContaining({
        parentAgentId: "workspace:draft:node:executor-2",
        childAgentId: "workspace:draft:node:executor-1",
        source: "topology_relation",
        executionCandidate: false,
        reasonCodes: ["cycle_detected"],
      }),
    ]))
    expect(hierarchy?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "cycle_detected",
        severity: "invalid",
      }),
    ]))
  })
})
