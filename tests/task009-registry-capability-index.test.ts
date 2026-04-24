import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import {
  closeDb,
  upsertAgentConfig,
  upsertAgentRelationship,
  upsertSkillCatalogEntry,
  upsertTeamConfig,
} from "../packages/core/src/db/index.js"
import {
  type AgentRelationship,
  CONTRACT_SCHEMA_VERSION,
  type MemoryPolicy,
  type ModelProfile,
  type PermissionProfile,
  type RuntimeIdentity,
  type SkillMcpAllowlist,
  type SubAgentConfig,
  type TeamConfig,
  type TeamMembership,
} from "../packages/core/src/index.ts"
import {
  buildOrchestrationRegistrySnapshot,
  clearAgentCapabilityIndexCache,
} from "../packages/core/src/orchestration/registry.ts"

const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG
let now = Date.UTC(2026, 3, 24, 0, 0, 0)

function useTempState(): void {
  closeDb()
  clearAgentCapabilityIndexCache()
  now = Date.UTC(2026, 3, 24, 0, 0, 0)
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task009-registry-index-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
}

function owner(ownerId: string): RuntimeIdentity["owner"] {
  return { ownerType: "sub_agent", ownerId }
}

const permissionProfile: PermissionProfile = {
  profileId: "profile:safe",
  riskCeiling: "moderate",
  approvalRequiredFrom: "moderate",
  allowExternalNetwork: true,
  allowFilesystemWrite: false,
  allowShellExecution: false,
  allowScreenControl: false,
  allowedPaths: [],
}

function modelProfile(): ModelProfile {
  return {
    providerId: "openai",
    modelId: "gpt-5.4",
    timeoutMs: 30_000,
    retryCount: 2,
    costBudget: 5,
  }
}

function memoryPolicy(agentId: string): MemoryPolicy {
  return {
    owner: owner(agentId),
    visibility: "private",
    readScopes: [owner(agentId)],
    writeScope: owner(agentId),
    retentionPolicy: "short_term",
    writebackReviewRequired: true,
  }
}

function allowlist(agentId: string, overrides: Partial<SkillMcpAllowlist> = {}): SkillMcpAllowlist {
  return {
    enabledSkillIds: ["skill:research"],
    enabledMcpServerIds: [],
    enabledToolNames: [],
    disabledToolNames: [],
    secretScopeId: `scope:${agentId}`,
    ...overrides,
  }
}

function subAgent(agentId: string, overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    agentType: "sub_agent",
    agentId,
    displayName: agentId.replace("agent:", ""),
    nickname: agentId.replace("agent:", ""),
    status: "enabled",
    role: "registry test worker",
    personality: "Precise",
    specialtyTags: ["research"],
    avoidTasks: [],
    modelProfile: modelProfile(),
    memoryPolicy: memoryPolicy(agentId),
    capabilityPolicy: {
      permissionProfile,
      skillMcpAllowlist: allowlist(agentId),
      rateLimit: { maxConcurrentCalls: 2 },
    },
    delegationPolicy: {
      enabled: true,
      maxParallelSessions: 2,
      retryBudget: 2,
    },
    teamIds: [],
    delegation: {
      enabled: true,
      maxParallelSessions: 2,
      retryBudget: 2,
    },
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function relationship(
  parentAgentId: string,
  childAgentId: string,
  sortOrder = 0,
): AgentRelationship {
  return {
    edgeId: `relationship:${parentAgentId}->${childAgentId}`,
    parentAgentId,
    childAgentId,
    relationshipType: "parent_child",
    status: "active",
    sortOrder,
    createdAt: now,
    updatedAt: now,
  }
}

function membership(
  teamId: string,
  agentId: string,
  roles: string[],
  sortOrder: number,
): TeamMembership {
  return {
    membershipId: `${teamId}:membership:${sortOrder}`,
    teamId,
    agentId,
    ownerAgentIdSnapshot: "agent:nobie",
    teamRoles: roles,
    primaryRole: roles[0] ?? "member",
    required: true,
    sortOrder,
    status: "active",
  }
}

function teamConfig(overrides: Partial<TeamConfig> = {}): TeamConfig {
  const teamId = overrides.teamId ?? "team:registry"
  const memberAgentIds = overrides.memberAgentIds ?? ["agent:alpha"]
  const roleHints = overrides.roleHints ?? memberAgentIds.map(() => "member")
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    teamId,
    displayName: "Registry Team",
    nickname: "Registry Team",
    status: "enabled",
    purpose: "Registry coverage smoke.",
    ownerAgentId: "agent:nobie",
    leadAgentId: memberAgentIds[0],
    memberCountMin: 1,
    memberCountMax: 6,
    requiredTeamRoles: ["member"],
    requiredCapabilityTags: ["research"],
    resultPolicy: "lead_synthesis",
    conflictPolicy: "lead_decides",
    memberships: memberAgentIds.map((agentId, index) =>
      membership(teamId, agentId, [roleHints[index] ?? "member"], index),
    ),
    memberAgentIds,
    roleHints,
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function emptyRegistryConfig() {
  return {
    orchestration: {
      maxDelegationTurns: 5,
      mode: "orchestration" as const,
      featureFlagEnabled: true,
      subAgents: [],
      teams: [],
    },
  }
}

function buildSnapshot() {
  return buildOrchestrationRegistrySnapshot({
    getConfig: emptyRegistryConfig,
    now: () => now,
  })
}

beforeEach(() => {
  useTempState()
})

afterEach(() => {
  closeDb()
  clearAgentCapabilityIndexCache()
  if (previousStateDir === undefined) process.env.NOBIE_STATE_DIR = undefined
  else process.env.NOBIE_STATE_DIR = previousStateDir
  if (previousConfig === undefined) process.env.NOBIE_CONFIG = undefined
  else process.env.NOBIE_CONFIG = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("task009 registry snapshot and capability index", () => {
  it("builds deterministic active registry snapshots with hierarchy, capability, model, and latency metrics", () => {
    upsertSkillCatalogEntry(
      {
        skillId: "skill:research",
        displayName: "Research",
        risk: "safe",
        toolNames: ["web_search"],
      },
      { now },
    )
    upsertAgentConfig(subAgent("agent:alpha"), { source: "manual", now })
    upsertAgentRelationship(relationship("agent:nobie", "agent:alpha"), { now })

    const first = buildSnapshot()
    const second = buildSnapshot()

    expect(second).toEqual(first)
    expect(first.status).toBe("ready")
    expect(first.agents[0]?.status).toBe("enabled")
    expect(first.agents[0]?.capabilitySummary.enabledSkillIds).toEqual(["skill:research"])
    expect(first.agents[0]?.modelSummary.availability).toBe("available")
    expect(first.hierarchy?.directChildrenByParent["agent:nobie"]).toEqual(["agent:alpha"])
    expect(first.capabilityIndex?.topLevelCandidateAgentIds).toEqual(["agent:alpha"])
    expect(first.metrics?.coldSnapshotTargetP95Ms).toBe(500)
    expect(first.capabilityIndex?.metrics.targetP95Ms).toBe(100)
  })

  it("keeps disabled and archived agents out of delegated candidates with exclusion diagnostics", () => {
    upsertAgentConfig(subAgent("agent:alpha"), { source: "manual", now })
    upsertAgentConfig(subAgent("agent:beta", { status: "disabled" }), {
      source: "manual",
      now,
    })
    upsertAgentConfig(subAgent("agent:gamma", { status: "archived" }), {
      source: "manual",
      now,
    })

    const snapshot = buildSnapshot()

    expect(snapshot.agents.map((agent) => agent.agentId)).toEqual(["agent:alpha", "agent:beta"])
    expect(snapshot.capabilityIndex?.candidateAgentIdsByParent["agent:nobie"]).toEqual([
      "agent:alpha",
    ])
    expect(snapshot.capabilityIndex?.excludedCandidatesByParent["agent:nobie"]).toEqual([
      { agentId: "agent:beta", reasonCodes: ["agent_disabled"] },
    ])
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["candidate_excluded", "agent_disabled"]),
    )
  })

  it("uses Nobie top-level children and sub-agent direct children as separate candidate scopes", () => {
    upsertAgentConfig(subAgent("agent:alpha"), { source: "manual", now })
    upsertAgentConfig(subAgent("agent:beta"), { source: "manual", now })
    upsertAgentRelationship(relationship("agent:nobie", "agent:alpha"), { now })
    upsertAgentRelationship(relationship("agent:alpha", "agent:beta"), { now })

    const snapshot = buildSnapshot()

    expect(snapshot.hierarchy?.topLevelSubAgentIds).toEqual(["agent:alpha"])
    expect(snapshot.capabilityIndex?.candidateAgentIdsByParent["agent:nobie"]).toEqual([
      "agent:alpha",
    ])
    expect(snapshot.capabilityIndex?.candidateAgentIdsByParent["agent:alpha"]).toEqual([
      "agent:beta",
    ])
    expect(snapshot.capabilityIndex?.topLevelCandidateAgentIds).not.toContain("agent:beta")
  })

  it("recalculates team coverage conservatively with capability and model summaries", () => {
    upsertSkillCatalogEntry(
      {
        skillId: "skill:research",
        displayName: "Research",
        status: "disabled",
        risk: "safe",
        toolNames: ["web_search"],
      },
      { now },
    )
    upsertAgentConfig(
      subAgent("agent:lead", {
        specialtyTags: ["lead"],
        capabilityPolicy: {
          permissionProfile,
          skillMcpAllowlist: allowlist("agent:lead", {
            enabledSkillIds: [],
          }),
          rateLimit: { maxConcurrentCalls: 2 },
        },
      }),
      { source: "manual", now },
    )
    upsertAgentConfig(subAgent("agent:researcher"), { source: "manual", now })
    upsertAgentRelationship(relationship("agent:nobie", "agent:lead", 0), { now })
    upsertAgentRelationship(relationship("agent:nobie", "agent:researcher", 1), { now })
    upsertTeamConfig(
      teamConfig({
        teamId: "team:coverage",
        leadAgentId: "agent:lead",
        memberAgentIds: ["agent:lead", "agent:researcher"],
        roleHints: ["lead", "researcher"],
        memberships: [
          membership("team:coverage", "agent:lead", ["lead"], 0),
          membership("team:coverage", "agent:researcher", ["researcher"], 1),
        ],
        requiredTeamRoles: ["lead"],
        requiredCapabilityTags: ["research"],
      }),
      { source: "manual", now },
    )

    const snapshot = buildSnapshot()
    const team = snapshot.teams.find((candidate) => candidate.teamId === "team:coverage")

    expect(team?.health?.status).toBe("degraded")
    expect(team?.coverage?.activeMemberAgentIds).toEqual(["agent:lead"])
    expect(team?.coverage?.capabilityCoverage.missing).toEqual(["research"])
    expect(team?.coverage?.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "member_skill_binding_unavailable",
        "required_capability_missing",
        "coverage_recalculated_conservative",
      ]),
    )
  })

  it("returns a degraded single Nobie fallback snapshot when registry loading fails", () => {
    const snapshot = buildOrchestrationRegistrySnapshot({
      getConfig: () => {
        throw new Error("config unavailable")
      },
      now: () => now,
    })

    expect(snapshot.status).toBe("degraded")
    expect(snapshot.fallback).toEqual(
      expect.objectContaining({
        mode: "single_nobie",
        reasonCode: "registry_load_failed",
      }),
    )
    expect(snapshot.agents).toEqual([])
    expect(snapshot.capabilityIndex?.topLevelCandidateAgentIds).toEqual([])
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "registry_load_failed",
    )
  })

  it("invalidates the hot capability index when catalog state changes", () => {
    upsertSkillCatalogEntry(
      {
        skillId: "skill:research",
        displayName: "Research",
        risk: "safe",
        toolNames: ["web_search"],
      },
      { now },
    )
    upsertAgentConfig(subAgent("agent:alpha"), { source: "manual", now })
    upsertAgentRelationship(relationship("agent:nobie", "agent:alpha"), { now })
    const before = buildSnapshot()

    now += 1_000
    upsertSkillCatalogEntry(
      {
        skillId: "skill:research",
        displayName: "Research",
        status: "disabled",
        risk: "safe",
        toolNames: ["web_search"],
      },
      { now },
    )
    const after = buildSnapshot()

    expect(after.invalidation?.cacheKey).not.toBe(before.invalidation?.cacheKey)
    expect(before.capabilityIndex?.candidateAgentIdsByParent["agent:nobie"]).toEqual([
      "agent:alpha",
    ])
    expect(after.capabilityIndex?.candidateAgentIdsByParent["agent:nobie"]).toEqual([])
    expect(after.capabilityIndex?.excludedCandidatesByParent["agent:nobie"]).toEqual([
      { agentId: "agent:alpha", reasonCodes: ["capability_unavailable"] },
    ])
  })
})
