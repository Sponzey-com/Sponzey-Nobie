import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { validateOrchestrationPlan } from "../packages/core/src/contracts/sub-agent-orchestration.js"
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
  type CapabilityRiskLevel,
  type MemoryPolicy,
  type PermissionProfile,
  type RuntimeIdentity,
  type SkillMcpAllowlist,
  type SubAgentConfig,
  type TeamConfig,
  type TeamMembership,
} from "../packages/core/src/index.ts"
import type { OrchestrationModeSnapshot } from "../packages/core/src/orchestration/mode.ts"
import {
  buildOrchestrationPlan,
  classifyFastPath,
} from "../packages/core/src/orchestration/planner.ts"
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
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task010-planner-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
}

function owner(agentId: string): RuntimeIdentity["owner"] {
  return { ownerType: "sub_agent", ownerId: agentId }
}

function permissionProfile(riskCeiling: CapabilityRiskLevel = "moderate"): PermissionProfile {
  return {
    profileId: `profile:${riskCeiling}`,
    riskCeiling,
    approvalRequiredFrom: "moderate",
    allowExternalNetwork: true,
    allowFilesystemWrite: false,
    allowShellExecution: false,
    allowScreenControl: false,
    allowedPaths: [],
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

function allowlist(agentId: string): SkillMcpAllowlist {
  return {
    enabledSkillIds: ["skill:research"],
    enabledMcpServerIds: [],
    enabledToolNames: ["web_search"],
    disabledToolNames: [],
    secretScopeId: `scope:${agentId}`,
  }
}

function subAgent(agentId: string, overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  const riskCeiling = overrides.capabilityPolicy?.permissionProfile.riskCeiling ?? "moderate"
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    agentType: "sub_agent",
    agentId,
    displayName: agentId.replace("agent:", ""),
    nickname: agentId.replace("agent:", ""),
    status: "enabled",
    role: "researcher",
    personality: "Precise",
    specialtyTags: ["research"],
    avoidTasks: [],
    modelProfile: {
      providerId: "openai",
      modelId: "gpt-5.4",
      timeoutMs: 30_000,
      retryCount: 2,
      costBudget: 5,
    },
    memoryPolicy: memoryPolicy(agentId),
    capabilityPolicy: {
      permissionProfile: permissionProfile(riskCeiling),
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

function teamConfig(): TeamConfig {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    teamId: "team:research",
    displayName: "Research Team",
    nickname: "Research Team",
    status: "enabled",
    purpose: "Research together.",
    ownerAgentId: "agent:nobie",
    leadAgentId: "agent:alpha",
    memberCountMin: 1,
    memberCountMax: 2,
    requiredTeamRoles: ["lead"],
    requiredCapabilityTags: ["research"],
    resultPolicy: "lead_synthesis",
    conflictPolicy: "lead_decides",
    memberships: [membership("team:research", "agent:alpha", ["lead"], 0)],
    memberAgentIds: ["agent:alpha"],
    roleHints: ["lead"],
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
  }
}

function modeSnapshot(): OrchestrationModeSnapshot {
  return {
    mode: "orchestration",
    status: "ready",
    featureFlagEnabled: true,
    requestedMode: "orchestration",
    activeSubAgentCount: 1,
    totalSubAgentCount: 1,
    disabledSubAgentCount: 0,
    activeSubAgents: [{ agentId: "agent:alpha", displayName: "alpha", source: "db" }],
    reasonCode: "orchestration_ready",
    reason: "test",
    generatedAt: now,
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

function seedSkill(): void {
  upsertSkillCatalogEntry(
    {
      skillId: "skill:research",
      displayName: "Research",
      risk: "safe",
      toolNames: ["web_search"],
    },
    { now },
  )
}

function registrySnapshot() {
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

describe("task010 planner fast path and explicit targets", () => {
  it("classifies direct, workflow, and delegation fast path candidates", () => {
    expect(classifyFastPath({ userRequest: "안녕", now: () => now }).classification).toBe(
      "direct_nobie",
    )
    expect(
      classifyFastPath({ userRequest: "매일 오전 9시에 알려줘", now: () => now }).classification,
    ).toBe("workflow_candidate")
    expect(
      classifyFastPath({
        userRequest: "시장 조사를 웹 검색으로 정리해줘",
        intent: { requiredSkillIds: ["skill:research"] },
        now: () => now,
      }).classification,
    ).toBe("delegation_candidate")
  })

  it("creates a direct Nobie plan for simple requests", () => {
    const result = buildOrchestrationPlan({
      parentRunId: "run:direct",
      parentRequestId: "request:direct",
      userRequest: "안녕",
      modeSnapshot: modeSnapshot(),
      now: () => now,
      idProvider: () => "plan:direct",
    })

    expect(result.fastPathClassification.classification).toBe("direct_nobie")
    expect(result.plan.directNobieTasks).toHaveLength(1)
    expect(result.plan.delegatedTasks).toHaveLength(0)
    expect(result.plan.plannerMetadata?.fastPath?.reasonCodes).toContain("fast_path_direct_nobie")
    expect(validateOrchestrationPlan(result.plan).ok).toBe(true)
  })

  it("marks repeated requests as deterministic workflow recommendations", () => {
    const result = buildOrchestrationPlan({
      parentRunId: "run:workflow",
      parentRequestId: "request:workflow",
      userRequest: "매일 오전 9시에 요약을 보내줘",
      modeSnapshot: modeSnapshot(),
      now: () => now,
      idProvider: () => "plan:workflow",
    })

    expect(result.fastPathClassification.classification).toBe("workflow_candidate")
    expect(result.plan.directNobieTasks).toHaveLength(0)
    expect(result.plan.delegatedTasks).toHaveLength(0)
    expect(result.plan.plannerMetadata?.status).toBe("requires_workflow_recommendation")
    expect(result.reasonCodes).toContain("requires_workflow_recommendation")
  })

  it("delegates only to Nobie's top-level sub-agent candidates", () => {
    seedSkill()
    upsertAgentConfig(subAgent("agent:alpha"), { source: "manual", now })
    upsertAgentConfig(subAgent("agent:beta"), { source: "manual", now })
    upsertAgentRelationship(relationship("agent:nobie", "agent:alpha"), { now })
    upsertAgentRelationship(relationship("agent:alpha", "agent:beta"), { now })

    const input = {
      parentRunId: "run:delegate",
      parentRequestId: "request:delegate",
      userRequest: "시장 조사를 웹 검색으로 정리해줘",
      modeSnapshot: modeSnapshot(),
      registrySnapshot: registrySnapshot(),
      intent: { requiredSkillIds: ["skill:research"] },
      now: () => now,
      idProvider: () => "plan:delegate",
    }
    const result = buildOrchestrationPlan(input)
    const repeated = buildOrchestrationPlan(input)

    expect(repeated.plan).toEqual(result.plan)
    expect(result.plan.delegatedTasks[0]?.assignedAgentId).toBe("agent:alpha")
    expect(
      result.candidateScores.find((candidate) => candidate.agentId === "agent:beta")
        ?.excludedReasonCodes,
    ).toContain("not_direct_child_candidate")
  })

  it("lets a sub-agent see only its own direct child, not siblings or cross-tree agents", () => {
    seedSkill()
    upsertAgentConfig(subAgent("agent:alpha"), { source: "manual", now })
    upsertAgentConfig(subAgent("agent:beta"), { source: "manual", now })
    upsertAgentConfig(subAgent("agent:gamma"), { source: "manual", now })
    upsertAgentRelationship(relationship("agent:nobie", "agent:alpha", 0), { now })
    upsertAgentRelationship(relationship("agent:nobie", "agent:gamma", 1), { now })
    upsertAgentRelationship(relationship("agent:alpha", "agent:beta", 0), { now })

    const result = buildOrchestrationPlan({
      parentRunId: "run:sub-agent",
      parentRequestId: "request:sub-agent",
      parentAgentId: "agent:alpha",
      userRequest: "시장 조사를 웹 검색으로 정리해줘",
      modeSnapshot: modeSnapshot(),
      registrySnapshot: registrySnapshot(),
      intent: { requiredSkillIds: ["skill:research"] },
      now: () => now,
      idProvider: () => "plan:sub-agent",
    })

    expect(result.plan.delegatedTasks[0]?.assignedAgentId).toBe("agent:beta")
    expect(
      result.candidateScores.find((candidate) => candidate.agentId === "agent:gamma")
        ?.excludedReasonCodes,
    ).toContain("not_direct_child_candidate")
  })

  it("does not substitute explicit agent targets that are not visible direct children", () => {
    seedSkill()
    upsertAgentConfig(subAgent("agent:alpha"), { source: "manual", now })
    upsertAgentConfig(subAgent("agent:beta"), { source: "manual", now })
    upsertAgentRelationship(relationship("agent:nobie", "agent:alpha"), { now })
    upsertAgentRelationship(relationship("agent:alpha", "agent:beta"), { now })

    const result = buildOrchestrationPlan({
      parentRunId: "run:explicit-grandchild",
      parentRequestId: "request:explicit-grandchild",
      userRequest: "agent beta에게 맡겨줘",
      modeSnapshot: modeSnapshot(),
      registrySnapshot: registrySnapshot(),
      intent: { explicitAgentId: "agent:beta" },
      now: () => now,
      idProvider: () => "plan:explicit-grandchild",
    })

    expect(result.plan.delegatedTasks).toHaveLength(0)
    expect(result.plan.fallbackStrategy.mode).toBe("ask_user")
    expect(result.plan.fallbackStrategy.reasonCode).toBe("explicit_agent_target_unavailable")
    expect(result.reasonCodes).toContain("explicit_agent_not_direct_child")
  })

  it("returns permission reason codes for explicit targets without substituting another agent", () => {
    seedSkill()
    upsertAgentConfig(
      subAgent("agent:alpha", {
        capabilityPolicy: {
          permissionProfile: permissionProfile("safe"),
          skillMcpAllowlist: allowlist("agent:alpha"),
          rateLimit: { maxConcurrentCalls: 2 },
        },
      }),
      { source: "manual", now },
    )
    upsertAgentConfig(subAgent("agent:other"), { source: "manual", now })
    upsertAgentRelationship(relationship("agent:nobie", "agent:alpha", 0), { now })
    upsertAgentRelationship(relationship("agent:nobie", "agent:other", 1), { now })

    const result = buildOrchestrationPlan({
      parentRunId: "run:permission",
      parentRequestId: "request:permission",
      userRequest: "위험한 작업을 alpha에게 맡겨줘",
      modeSnapshot: modeSnapshot(),
      registrySnapshot: registrySnapshot(),
      intent: { explicitAgentId: "agent:alpha", requiredRisk: "dangerous" },
      now: () => now,
      idProvider: () => "plan:permission",
    })

    expect(result.plan.delegatedTasks).toHaveLength(0)
    expect(result.plan.fallbackStrategy.reasonCode).toBe("explicit_agent_permission_denied")
    expect(result.reasonCodes).toContain("risk_above_agent_ceiling")
    expect(
      result.candidateScores.find((candidate) => candidate.agentId === "agent:other")
        ?.excludedReasonCodes,
    ).toContain("not_explicit_target")
  })

  it("keeps explicit team targets as non-execution plans until team expansion", () => {
    seedSkill()
    upsertAgentConfig(subAgent("agent:alpha"), { source: "manual", now })
    upsertAgentRelationship(relationship("agent:nobie", "agent:alpha"), { now })
    upsertTeamConfig(teamConfig(), { source: "manual", now })

    const result = buildOrchestrationPlan({
      parentRunId: "run:team",
      parentRequestId: "request:team",
      userRequest: "research team에게 맡겨줘",
      modeSnapshot: modeSnapshot(),
      registrySnapshot: registrySnapshot(),
      intent: { explicitTeamId: "team:research" },
      now: () => now,
      idProvider: () => "plan:team",
    })

    expect(result.plan.directNobieTasks).toHaveLength(0)
    expect(result.plan.delegatedTasks).toHaveLength(0)
    expect(result.plan.plannerMetadata?.status).toBe("requires_team_expansion")
    expect(result.reasonCodes).toContain("requires_team_expansion")
    expect(validateOrchestrationPlan(result.plan).ok).toBe(true)
  })

  it("falls back to degraded single Nobie plan on planner timeout", () => {
    let tick = now
    const result = buildOrchestrationPlan({
      parentRunId: "run:timeout",
      parentRequestId: "request:timeout",
      userRequest: "시장 조사를 웹 검색으로 정리해줘",
      modeSnapshot: modeSnapshot(),
      loadRegistrySnapshot: registrySnapshot,
      intent: { requiredSkillIds: ["skill:research"] },
      now: () => {
        tick += 1_000
        return tick
      },
      timeoutMs: 1,
      idProvider: () => "plan:timeout",
    })

    expect(result.timedOut).toBe(true)
    expect(result.plan.plannerMetadata?.status).toBe("degraded")
    expect(result.plan.fallbackStrategy.reasonCode).toBe("planning_timeout_single_nobie")
  })
})
