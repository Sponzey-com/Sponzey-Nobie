import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  type CapabilityRiskLevel,
  type MemoryPolicy,
  type PermissionProfile,
  type SkillMcpAllowlist,
  type StructuredTaskScope,
  type SubAgentConfig,
  type TeamConfig,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import { validateOrchestrationPlan } from "../packages/core/src/contracts/sub-agent-orchestration.js"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb } from "../packages/core/src/db/index.js"
import type { OrchestrationModeSnapshot } from "../packages/core/src/orchestration/mode.ts"
import { buildOrchestrationPlan } from "../packages/core/src/orchestration/planner.ts"
import {
  buildOrchestrationRegistrySnapshot,
  type AgentRegistryEntry,
  type OrchestrationRegistrySnapshot,
} from "../packages/core/src/orchestration/registry.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const now = Date.UTC(2026, 3, 20, 0, 0, 0)

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task004-orchestration-planner-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = join(stateDir, "config.json5")
  reloadConfig()
}

beforeEach(() => {
  useTempState()
})

afterEach(() => {
  closeDb()
  if (previousStateDir === undefined) delete process.env["NOBIE_STATE_DIR"]
  else process.env["NOBIE_STATE_DIR"] = previousStateDir
  if (previousConfig === undefined) delete process.env["NOBIE_CONFIG"]
  else process.env["NOBIE_CONFIG"] = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

const allowlist: SkillMcpAllowlist = {
  enabledSkillIds: ["research"],
  enabledMcpServerIds: ["browser"],
  enabledToolNames: ["web_search"],
  disabledToolNames: ["shell_exec"],
  secretScopeId: "agent:researcher",
}

function permissionProfile(overrides: Partial<PermissionProfile> = {}): PermissionProfile {
  return {
    profileId: "profile:safe",
    riskCeiling: "moderate",
    approvalRequiredFrom: "moderate",
    allowExternalNetwork: true,
    allowFilesystemWrite: false,
    allowShellExecution: false,
    allowScreenControl: false,
    allowedPaths: [],
    ...overrides,
  }
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

function subAgent(input: {
  agentId: string
  displayName?: string
  status?: SubAgentConfig["status"]
  teamIds?: string[]
  specialtyTags?: string[]
  skillMcpAllowlist?: SkillMcpAllowlist
  riskCeiling?: CapabilityRiskLevel
  approvalRequiredFrom?: CapabilityRiskLevel
  maxParallelSessions?: number
  retryBudget?: number
}): SubAgentConfig {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    agentType: "sub_agent",
    agentId: input.agentId,
    displayName: input.displayName ?? input.agentId,
    nickname: input.displayName ?? input.agentId,
    status: input.status ?? "enabled",
    role: "structured worker",
    personality: "Precise",
    specialtyTags: input.specialtyTags ?? ["research"],
    avoidTasks: [],
    memoryPolicy: memoryPolicy(input.agentId),
    capabilityPolicy: {
      permissionProfile: permissionProfile({
        ...(input.riskCeiling ? { riskCeiling: input.riskCeiling } : {}),
        ...(input.approvalRequiredFrom ? { approvalRequiredFrom: input.approvalRequiredFrom } : {}),
      }),
      skillMcpAllowlist: input.skillMcpAllowlist ?? allowlist,
      rateLimit: { maxConcurrentCalls: input.maxParallelSessions ?? 2 },
    },
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
    teamIds: input.teamIds ?? [],
    delegation: {
      enabled: true,
      maxParallelSessions: input.maxParallelSessions ?? 2,
      retryBudget: input.retryBudget ?? 2,
    },
  }
}

function team(teamId: string, memberAgentIds: string[]): TeamConfig {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    teamId,
    displayName: "Research Team",
    nickname: "Research",
    status: "enabled",
    purpose: "Research support",
    memberAgentIds,
    roleHints: memberAgentIds.map(() => "research member"),
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
  }
}

function registryEntry(config: SubAgentConfig): AgentRegistryEntry {
  return {
    agentId: config.agentId,
    displayName: config.displayName,
    ...(config.nickname ? { nickname: config.nickname } : {}),
    status: config.status,
    role: config.role,
    specialtyTags: config.specialtyTags,
    avoidTasks: config.avoidTasks,
    teamIds: config.teamIds,
    delegationEnabled: config.delegation.enabled,
    retryBudget: config.delegation.retryBudget,
    source: "config",
    config,
    permissionProfile: config.capabilityPolicy.permissionProfile,
    capabilityPolicy: config.capabilityPolicy,
    skillMcpSummary: {
      enabledSkillIds: config.capabilityPolicy.skillMcpAllowlist.enabledSkillIds,
      enabledMcpServerIds: config.capabilityPolicy.skillMcpAllowlist.enabledMcpServerIds,
      enabledToolNames: config.capabilityPolicy.skillMcpAllowlist.enabledToolNames,
      disabledToolNames: config.capabilityPolicy.skillMcpAllowlist.disabledToolNames,
      ...(config.capabilityPolicy.skillMcpAllowlist.secretScopeId ? { secretScopeId: config.capabilityPolicy.skillMcpAllowlist.secretScopeId } : {}),
    },
    currentLoad: {
      activeSubSessions: 0,
      queuedSubSessions: 0,
      failedSubSessions: 0,
      completedSubSessions: 0,
      maxParallelSessions: config.delegation.maxParallelSessions,
      utilization: 0,
    },
    failureRate: {
      windowMs: 1,
      consideredSubSessions: 0,
      failedSubSessions: 0,
      value: 0,
    },
  }
}

function registry(agents: SubAgentConfig[], teams: TeamConfig[] = []): OrchestrationRegistrySnapshot {
  const enabledAgentIds = new Set(agents.filter((agent) => agent.status === "enabled").map((agent) => agent.agentId))
  return {
    generatedAt: now,
    agents: agents.map(registryEntry),
    teams: teams.map((entry) => ({
      teamId: entry.teamId,
      displayName: entry.displayName,
      ...(entry.nickname ? { nickname: entry.nickname } : {}),
      status: entry.status,
      purpose: entry.purpose,
      roleHints: entry.roleHints,
      memberAgentIds: entry.memberAgentIds,
      activeMemberAgentIds: entry.memberAgentIds.filter((agentId) => enabledAgentIds.has(agentId)),
      unresolvedMemberAgentIds: entry.memberAgentIds.filter((agentId) => !enabledAgentIds.has(agentId)),
      source: "config",
      config: entry,
    })),
    membershipEdges: teams.flatMap((entry) => entry.memberAgentIds.map((agentId, index) => ({
      teamId: entry.teamId,
      agentId,
      status: enabledAgentIds.has(agentId) ? "active" as const : "unresolved" as const,
      roleHint: entry.roleHints[index] ?? "member",
    }))),
    diagnostics: [],
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
    activeSubAgents: [{ agentId: "agent:researcher", displayName: "Researcher", source: "config" }],
    reasonCode: "orchestration_ready",
    reason: "test",
    generatedAt: now,
  }
}

function taskScope(id: string): StructuredTaskScope {
  return {
    goal: `task ${id}`,
    intentType: "structured_test",
    actionType: "research",
    constraints: [],
    expectedOutputs: [{
      outputId: `output:${id}`,
      kind: "text",
      description: "answer",
      required: true,
      acceptance: {
        requiredEvidenceKinds: [],
        artifactRequired: false,
        reasonCodes: ["ok"],
      },
    }],
    reasonCodes: [`scope:${id}`],
  }
}

describe("task004 orchestration registry and planner", () => {
  it("builds a registry snapshot with enabled agent state, team membership, permissions, skills, load, and failure rate", () => {
    const agent = subAgent({ agentId: "agent:researcher", displayName: "Researcher", teamIds: ["team:research"] })
    const researchTeam = team("team:research", ["agent:researcher"])

    const snapshot = buildOrchestrationRegistrySnapshot({
      getConfig: () => ({
        orchestration: {
          maxDelegationTurns: 5,
          mode: "orchestration",
          featureFlagEnabled: true,
          subAgents: [agent],
          teams: [researchTeam],
        },
      }),
      now: () => now,
    })

    expect(snapshot.agents).toHaveLength(1)
    expect(snapshot.agents[0]?.agentId).toBe("agent:researcher")
    expect(snapshot.agents[0]?.permissionProfile.profileId).toBe("profile:safe")
    expect(snapshot.agents[0]?.skillMcpSummary.enabledSkillIds).toContain("research")
    expect(snapshot.agents[0]?.currentLoad.activeSubSessions).toBe(0)
    expect(snapshot.agents[0]?.failureRate.value).toBe(0)
    expect(snapshot.teams[0]?.activeMemberAgentIds).toEqual(["agent:researcher"])
  })

  it("excludes disabled agents and chooses an eligible candidate by structured fields", () => {
    const disabled = subAgent({ agentId: "agent:disabled", status: "disabled" })
    const enabled = subAgent({ agentId: "agent:enabled", specialtyTags: ["market"] })
    const result = buildOrchestrationPlan({
      parentRunId: "run:1",
      parentRequestId: "request:1",
      userRequest: "이 문자열은 점수 계산에 직접 쓰이지 않는다",
      modeSnapshot: modeSnapshot(),
      registrySnapshot: registry([disabled, enabled]),
      intent: { specialtyTags: ["market"], requiredSkillIds: ["research"] },
      now: () => now,
      idProvider: () => "plan:disabled",
    })

    expect(result.plan.delegatedTasks[0]?.assignedAgentId).toBe("agent:enabled")
    expect(result.candidateScores.find((candidate) => candidate.agentId === "agent:disabled")?.excludedReasonCodes).toContain("agent_not_enabled")
    expect(result.plan.plannerMetadata?.semanticComparisonUsed).toBe(false)
  })

  it("honors an explicit agent target when the agent is eligible", () => {
    const preferred = subAgent({ agentId: "agent:preferred", specialtyTags: ["ops"] })
    const fallback = subAgent({ agentId: "agent:fallback", specialtyTags: ["ops"] })
    const result = buildOrchestrationPlan({
      parentRunId: "run:2",
      parentRequestId: "request:2",
      userRequest: "delegate explicitly",
      modeSnapshot: modeSnapshot(),
      registrySnapshot: registry([fallback, preferred]),
      intent: { explicitAgentId: "agent:preferred", specialtyTags: ["ops"] },
      now: () => now,
      idProvider: () => "plan:explicit",
    })

    expect(result.plan.delegatedTasks[0]?.assignedAgentId).toBe("agent:preferred")
    expect(result.candidateScores.find((candidate) => candidate.agentId === "agent:preferred")?.reasonCodes).toContain("explicit_agent_target")
  })

  it("does not substitute another agent when an explicit target is unavailable", () => {
    const requested = subAgent({ agentId: "agent:requested", status: "disabled" })
    const other = subAgent({ agentId: "agent:other" })
    const result = buildOrchestrationPlan({
      parentRunId: "run:3",
      parentRequestId: "request:3",
      userRequest: "explicit unavailable",
      modeSnapshot: modeSnapshot(),
      registrySnapshot: registry([requested, other]),
      intent: { explicitAgentId: "agent:requested" },
      now: () => now,
      idProvider: () => "plan:explicit-missing",
    })

    expect(result.plan.delegatedTasks).toHaveLength(0)
    expect(result.plan.directNobieTasks).toHaveLength(1)
    expect(result.plan.fallbackStrategy.mode).toBe("ask_user")
    expect(result.plan.fallbackStrategy.reasonCode).toBe("explicit_target_unavailable")
  })

  it("interprets an explicit team target as selecting an eligible member agent", () => {
    const member = subAgent({ agentId: "agent:team-member", teamIds: ["team:research"] })
    const outsider = subAgent({ agentId: "agent:outsider" })
    const result = buildOrchestrationPlan({
      parentRunId: "run:4",
      parentRequestId: "request:4",
      userRequest: "team target",
      modeSnapshot: modeSnapshot(),
      registrySnapshot: registry([member, outsider], [team("team:research", ["agent:team-member"])]),
      intent: { explicitTeamId: "team:research" },
      now: () => now,
      idProvider: () => "plan:team",
    })

    expect(result.plan.delegatedTasks[0]?.assignedAgentId).toBe("agent:team-member")
    expect(result.plan.delegatedTasks[0]?.assignedTeamId).toBe("team:research")
    expect(result.candidateScores.find((candidate) => candidate.agentId === "agent:outsider")?.excludedReasonCodes).toContain("not_explicit_target")
  })

  it("marks approval required when permission profile threshold requires it", () => {
    const agent = subAgent({
      agentId: "agent:risky",
      riskCeiling: "external",
      approvalRequiredFrom: "external",
    })
    const result = buildOrchestrationPlan({
      parentRunId: "run:5",
      parentRequestId: "request:5",
      userRequest: "external network check",
      modeSnapshot: modeSnapshot(),
      registrySnapshot: registry([agent]),
      intent: { requiredRisk: "external" },
      now: () => now,
      idProvider: () => "plan:approval",
    })

    expect(result.plan.delegatedTasks[0]?.assignedAgentId).toBe("agent:risky")
    expect(result.plan.approvalRequirements[0]?.reasonCode).toBe("agent_permission_profile_requires_approval")
  })

  it("serializes delegated tasks when exclusive resource locks conflict", () => {
    const first = subAgent({ agentId: "agent:first" })
    const second = subAgent({ agentId: "agent:second" })
    const locks = {
      "plan:locks:delegated:0": [{ lockId: "lock:file", kind: "file" as const, target: "/tmp/a.txt", mode: "exclusive" as const, reasonCode: "write_file" }],
      "plan:locks:delegated:1": [{ lockId: "lock:file", kind: "file" as const, target: "/tmp/a.txt", mode: "exclusive" as const, reasonCode: "write_file" }],
    }
    const result = buildOrchestrationPlan({
      parentRunId: "run:6",
      parentRequestId: "request:6",
      userRequest: "parallel conflict",
      modeSnapshot: modeSnapshot(),
      registrySnapshot: registry([first, second]),
      taskScopes: [taskScope("a"), taskScope("b")],
      resourceLocksByTaskId: locks,
      now: () => now,
      idProvider: () => "plan:locks",
    })

    expect(result.plan.delegatedTasks).toHaveLength(2)
    expect(result.plan.parallelGroups).toHaveLength(0)
    expect(result.plan.dependencyEdges[0]?.reasonCode).toBe("exclusive_resource_lock_conflict")
  })

  it("falls back to degraded single_nobie plan when planning exceeds the budget", () => {
    let tick = now
    const result = buildOrchestrationPlan({
      parentRunId: "run:7",
      parentRequestId: "request:7",
      userRequest: "timeout",
      modeSnapshot: modeSnapshot(),
      loadRegistrySnapshot: () => registry([subAgent({ agentId: "agent:slow" })]),
      now: () => {
        tick += 1_000
        return tick
      },
      timeoutMs: 1,
      idProvider: () => "plan:timeout",
    })

    expect(result.timedOut).toBe(true)
    expect(result.plan.delegatedTasks).toHaveLength(0)
    expect(result.plan.plannerMetadata?.status).toBe("degraded")
    expect(result.plan.fallbackStrategy.reasonCode).toBe("planning_timeout_single_nobie")
  })

  it("creates a valid OrchestrationPlan without semantic string matching as a core condition", () => {
    const agent = subAgent({ agentId: "agent:generic", specialtyTags: [] })
    const result = buildOrchestrationPlan({
      parentRunId: "run:8",
      parentRequestId: "request:8",
      userRequest: "research라는 단어가 있어도 specialtyTags 입력이 없으면 문자열 의미 비교를 하지 않는다",
      modeSnapshot: modeSnapshot(),
      registrySnapshot: registry([agent]),
      now: () => now,
      idProvider: () => "plan:no-semantic",
    })

    expect(result.plan.delegatedTasks[0]?.assignedAgentId).toBe("agent:generic")
    expect(result.plan.plannerMetadata?.semanticComparisonUsed).toBe(false)
    expect(validateOrchestrationPlan(result.plan).ok).toBe(true)
  })
})
