import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig, type OrchestrationConfig } from "../packages/core/src/config/index.js"
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
import { buildOrchestrationRegistrySnapshot } from "../packages/core/src/orchestration/registry.ts"
import { createEnterpriseTopologyRegistry } from "../packages/core/src/topology/registry.js"

const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG
const now = Date.UTC(2026, 4, 7, 1, 0, 0)

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-topology-root-direct-children-"))
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

function node(id: string, name: string, children: string[] = []): NodeContract {
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
  id?: string
  nodes: NodeContract[]
  relations: EnterpriseRelation[]
}): EnterpriseTopology {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "topology",
    id: input.id ?? "workspace:draft",
    name: input.id ?? "workspace:draft",
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

function registrySnapshot() {
  return buildOrchestrationRegistrySnapshot({
    getConfig: () => ({ orchestration: orchestrationConfig() }),
    now: () => now,
  })
}

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

function subAgent(agentId: string): SubAgentConfig {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    agentType: "sub_agent",
    agentId,
    displayName: agentId,
    nickname: agentId,
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

describe("topology relation root direct child projection", () => {
  it("keeps incoming topology relation targets out of Nobie direct children", () => {
    createEnterpriseTopologyRegistry({ now: () => now }).appendTopologyVersion({
      topology: topology({
        nodes: [
          node("node:executor-1", "마당쇠", ["node:executor-2"]),
          node("node:executor-2", "삼식이"),
          node("node:executor-5", "행랑아범"),
        ],
        relations: [delegatesTo("relation:executor-1-executor-2", "node:executor-1", "node:executor-2")],
      }),
      createdBy: "task002-test",
    })

    const snapshot = registrySnapshot()
    const hierarchy = snapshot.hierarchy

    expect(hierarchy?.directChildrenByParent["agent:nobie"]).toEqual([
      "workspace:draft:node:executor-1",
      "workspace:draft:node:executor-5",
    ])
    expect(hierarchy?.directChildrenByParent["workspace:draft:node:executor-1"]).toEqual([
      "workspace:draft:node:executor-2",
    ])
    expect(hierarchy?.topLevelSubAgentIds).toEqual([
      "workspace:draft:node:executor-1",
      "workspace:draft:node:executor-5",
    ])
    expect(hierarchy?.directChildren).toEqual(expect.arrayContaining([
      expect.objectContaining({
        parentAgentId: "workspace:draft:node:executor-1",
        childAgentId: "workspace:draft:node:executor-2",
        source: "topology_relation",
        executionCandidate: true,
      }),
      expect.objectContaining({
        parentAgentId: "agent:nobie",
        childAgentId: "workspace:draft:node:executor-5",
        source: "unparented_root",
        executionCandidate: true,
      }),
    ]))
  })

  it("adds db/config agents without an active parent as Nobie direct children", () => {
    upsertAgentConfig(subAgent("agent:lead"), { now })
    upsertAgentConfig(subAgent("agent:worker"), { now })
    upsertAgentConfig(subAgent("agent:solo"), { now })
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

    const hierarchy = registrySnapshot().hierarchy

    expect(hierarchy?.directChildrenByParent["agent:nobie"]).toEqual(["agent:lead", "agent:solo"])
    expect(hierarchy?.directChildrenByParent["agent:lead"]).toEqual(["agent:worker"])
    expect(hierarchy?.directChildren).toEqual(expect.arrayContaining([
      expect.objectContaining({
        parentAgentId: "agent:lead",
        childAgentId: "agent:worker",
        source: "agent_relationship",
      }),
      expect.objectContaining({
        parentAgentId: "agent:nobie",
        childAgentId: "agent:solo",
        source: "unparented_root",
      }),
    ]))
  })
})

