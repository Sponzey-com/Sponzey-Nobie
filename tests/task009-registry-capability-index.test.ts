import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import {
  closeDb,
  getDb,
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
  type OrchestrationPlan,
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
import { dispatchDelegatedSubAgentTasks } from "../packages/core/src/runs/orchestration-dispatch.ts"
import type { StartRootRunParams } from "../packages/core/src/runs/start.ts"
import {
  createRootRun,
  updateRunStatus,
} from "../packages/core/src/runs/store.ts"

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

  it("keeps unassigned disabled and archived agents out of delegated candidates", () => {
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
    expect(snapshot.capabilityIndex?.candidateAgentIdsByParent["agent:nobie"] ?? []).toEqual([])
    expect(snapshot.capabilityIndex?.excludedCandidatesByParent["agent:nobie"] ?? []).toEqual([])
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      "candidate_excluded",
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

  it("inherits the runtime model profile for legacy sub-agents without model settings", () => {
    upsertAgentConfig(
      subAgent("agent:alpha", {
        modelProfile: {
          providerId: "provider:unknown",
          modelId: "model:unknown",
        },
      }),
      { source: "manual", now },
    )
    upsertAgentRelationship(relationship("agent:nobie", "agent:alpha"), { now })

    const snapshot = buildOrchestrationRegistrySnapshot({
      getConfig: () => ({
        ...emptyRegistryConfig(),
        ai: {
          connection: {
            provider: "openai",
            model: "gpt-5.4-mini",
          },
        },
      }),
      now: () => now,
    })
    const alpha = snapshot.agents.find((agent) => agent.agentId === "agent:alpha")

    expect(alpha?.config.modelProfile).toMatchObject({
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      retryCount: 0,
      timeoutMs: 30_000,
    })
    expect(alpha?.modelSummary.availability).toBe("available")
    expect(snapshot.capabilityIndex?.topLevelCandidateAgentIds).toContain("agent:alpha")
    expect(
      snapshot.capabilityIndex?.excludedCandidatesByParent["agent:nobie"]?.flatMap(
        (item) => item.reasonCodes,
      ) ?? [],
    ).not.toContain("model_unavailable")
  })

  it("dispatches delegated plan tasks as persisted sub-sessions and child agent runs", async () => {
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
    getDb()
      .prepare(
        `INSERT INTO sessions (id, source, source_id, created_at, updated_at, summary)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("session:parent", "webui", "test", now, now, "dispatch test")
    createRootRun({
      id: "run:parent",
      sessionId: "session:parent",
      requestGroupId: "request-group:parent",
      prompt: "투자 봇을 구현해줘.",
      source: "webui",
      orchestrationMode: "orchestration",
    })
    const plan: OrchestrationPlan = {
      identity: {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        entityType: "session",
        entityId: "plan:dispatch",
        owner: { ownerType: "nobie", ownerId: "agent:nobie" },
        idempotencyKey: "plan:dispatch",
        parent: {
          parentRunId: "run:parent",
          parentSessionId: "session:parent",
          parentRequestId: "request:parent",
        },
      },
      planId: "plan:dispatch",
      parentRunId: "run:parent",
      parentRequestId: "request:parent",
      directNobieTasks: [],
      delegatedTasks: [
        {
          taskId: "task:implement",
          executionKind: "delegated_sub_agent",
          scope: {
            goal: "투자 봇 구현 범위를 맡아 실제 파일 작업을 수행한다.",
            intentType: "execute_now",
            actionType: "implement_code",
            constraints: ["부모 요청 범위 안에서 처리한다."],
            expectedOutputs: [
              {
                outputId: "implementation_summary",
                kind: "text",
                description: "구현 결과 요약",
                required: true,
                acceptance: {
                  requiredEvidenceKinds: ["child_run"],
                  artifactRequired: false,
                  reasonCodes: ["child_run_completed"],
                },
              },
            ],
            reasonCodes: ["delegation_required"],
          },
          assignedAgentId: "agent:alpha",
          requiredCapabilities: ["research"],
          resourceLockIds: [],
        },
      ],
      dependencyEdges: [],
      resourceLocks: [],
      parallelGroups: [],
      approvalRequirements: [],
      fallbackStrategy: {
        mode: "single_nobie",
        reasonCode: "delegation_planned",
      },
      createdAt: now,
    }
    const childRunParams: StartRootRunParams[] = []
    const result = await dispatchDelegatedSubAgentTasks({
      plan,
      parentRunId: "run:parent",
      parentSessionId: "session:parent",
      parentRequestGroupId: "request-group:parent",
      source: "webui",
      message: "투자 봇을 구현해줘.",
      workDir: process.cwd(),
      controller: new AbortController(),
    }, {
      startSubAgentRun: (params) => {
        childRunParams.push(params)
        const child = createRootRun({
          id: "run:child",
          sessionId: params.sessionId ?? "session:parent",
          ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
          ...(params.lineageRootRunId ? { lineageRootRunId: params.lineageRootRunId } : {}),
          ...(params.parentRunId ? { parentRunId: params.parentRunId } : {}),
          runScope: "child",
          prompt: params.message,
          source: params.source,
          ...(params.taskProfile ? { taskProfile: params.taskProfile } : {}),
          ...(params.targetId ? { targetId: params.targetId } : {}),
          ...(params.targetLabel ? { targetLabel: params.targetLabel } : {}),
          contextMode: "handoff",
        })
        const completed = updateRunStatus(child.id, "completed", "alpha completed", false)
        return {
          runId: child.id,
          sessionId: child.sessionId,
          status: "started",
          finished: Promise.resolve(completed ?? child),
        }
      },
      now: () => now,
    })

    const stored = getDb()
      .prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM run_subsessions")
      .get()

    expect(result).toMatchObject({ attempted: 1, completed: 1, failed: 0, skipped: 0 })
    expect(stored?.count).toBe(1)
    expect(childRunParams[0]).toMatchObject({
      parentRunId: "run:parent",
      lineageRootRunId: "request-group:parent",
      runScope: "child",
      skipIntake: true,
      targetId: "agent:alpha",
      targetLabel: "alpha",
      model: "gpt-5.4",
      providerId: "openai",
    })
  })

  it("expands team-assigned tasks into team execution plan child runs", async () => {
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
    upsertAgentConfig(subAgent("agent:beta"), { source: "manual", now })
    upsertAgentRelationship(relationship("agent:nobie", "agent:alpha", 0), { now })
    upsertAgentRelationship(relationship("agent:nobie", "agent:beta", 1), { now })
    upsertTeamConfig(
      teamConfig({
        teamId: "team:delivery",
        leadAgentId: "agent:alpha",
        memberAgentIds: ["agent:alpha", "agent:beta"],
        roleHints: ["lead", "member"],
        memberships: [
          membership("team:delivery", "agent:alpha", ["lead"], 0),
          membership("team:delivery", "agent:beta", ["member"], 1),
        ],
      }),
      { source: "manual", now },
    )
    getDb()
      .prepare(
        `INSERT INTO sessions (id, source, source_id, created_at, updated_at, summary)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("session:team-parent", "telegram", "test", now, now, "team dispatch test")
    createRootRun({
      id: "run:team-parent",
      sessionId: "session:team-parent",
      requestGroupId: "request-group:team-parent",
      prompt: "개발팀에게 구현을 맡긴다.",
      source: "telegram",
      orchestrationMode: "orchestration",
    })

    const plan: OrchestrationPlan = {
      identity: {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        entityType: "session",
        entityId: "plan:team",
        owner: { ownerType: "nobie", ownerId: "agent:nobie" },
        idempotencyKey: "plan:team",
        parent: { parentRunId: "run:team-parent", parentRequestId: "request:team-parent" },
      },
      planId: "plan:team",
      parentRunId: "run:team-parent",
      parentRequestId: "request:team-parent",
      directNobieTasks: [],
      delegatedTasks: [
        {
          taskId: "plan:team:task:0",
          executionKind: "delegated_sub_agent",
          scope: {
            goal: "개발팀에게 구현을 맡긴다.",
            intentType: "user_request",
            actionType: "development",
            constraints: [],
            expectedOutputs: [
              {
                outputId: "implementation_summary",
                kind: "text",
                description: "구현 결과 요약",
                required: true,
                acceptance: {
                  requiredEvidenceKinds: ["child_run"],
                  artifactRequired: false,
                  reasonCodes: ["child_run_completed"],
                },
              },
            ],
            reasonCodes: ["explicit_team_target"],
          },
          assignedTeamId: "team:delivery",
          requiredCapabilities: ["filesystem_write"],
          resourceLockIds: [],
        },
      ],
      dependencyEdges: [],
      resourceLocks: [],
      parallelGroups: [],
      approvalRequirements: [],
      fallbackStrategy: {
        mode: "single_nobie",
        reasonCode: "delegation_planned",
      },
      createdAt: now,
    }
    const childRunParams: StartRootRunParams[] = []
    const result = await dispatchDelegatedSubAgentTasks({
      plan,
      parentRunId: "run:team-parent",
      parentSessionId: "session:team-parent",
      parentRequestGroupId: "request-group:team-parent",
      source: "telegram",
      message: "개발팀에게 구현을 맡긴다.",
      workDir: process.cwd(),
      controller: new AbortController(),
    }, {
      startSubAgentRun: (params) => {
        childRunParams.push(params)
        const child = createRootRun({
          id: `run:child:${childRunParams.length}`,
          sessionId: params.sessionId ?? "session:team-parent",
          ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
          ...(params.lineageRootRunId ? { lineageRootRunId: params.lineageRootRunId } : {}),
          ...(params.parentRunId ? { parentRunId: params.parentRunId } : {}),
          runScope: "child",
          prompt: params.message,
          source: params.source,
          ...(params.taskProfile ? { taskProfile: params.taskProfile } : {}),
          ...(params.targetId ? { targetId: params.targetId } : {}),
          ...(params.targetLabel ? { targetLabel: params.targetLabel } : {}),
          contextMode: "handoff",
        })
        const completed = updateRunStatus(
          child.id,
          "completed",
          `${params.targetId} completed`,
          false,
        )
        return {
          runId: child.id,
          sessionId: child.sessionId,
          status: "started",
          finished: Promise.resolve(completed ?? child),
        }
      },
      now: () => now,
    })

    const teamPlans = getDb()
      .prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM team_execution_plans")
      .get()

    expect(result.completed).toBeGreaterThanOrEqual(2)
    expect(result.failed).toBe(0)
    expect(teamPlans?.count).toBe(1)
    expect(childRunParams.map((params) => params.targetId)).toEqual(
      expect.arrayContaining(["agent:alpha", "agent:beta"]),
    )
    expect(childRunParams.every((params) => params.runScope === "child")).toBe(true)
    expect(childRunParams.every((params) => params.skipIntake === true)).toBe(true)
    expect(childRunParams.every((params) => params.lineageRootRunId === "request-group:team-parent")).toBe(true)
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
