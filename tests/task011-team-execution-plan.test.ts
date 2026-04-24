import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerAgentRoutes } from "../packages/core/src/api/routes/agent.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { validateTeamExecutionPlan } from "../packages/core/src/contracts/sub-agent-orchestration.js"
import {
  closeDb,
  getDb,
  getTeamExecutionPlan,
  insertRunSubSession,
  upsertAgentConfig,
  upsertAgentRelationship,
  upsertTeamConfig,
} from "../packages/core/src/db/index.js"
import {
  type AgentRelationship,
  CONTRACT_SCHEMA_VERSION,
  type MemoryPolicy,
  type PermissionProfile,
  type RuntimeIdentity,
  type SkillMcpAllowlist,
  type SubAgentConfig,
  type SubSessionContract,
  type TeamConfig,
  type TeamExecutionPlan,
  type TeamExecutionPlanAssignment,
  type TeamMembership,
} from "../packages/core/src/index.ts"
import { buildTeamExecutionPlan } from "../packages/core/src/orchestration/team-execution-plan.ts"

const require = createRequire(import.meta.url)
const Fastify = require("../packages/core/node_modules/fastify") as (options: {
  logger: boolean
}) => {
  ready(): Promise<void>
  close(): Promise<void>
  inject(options: {
    method: string
    url: string
    payload?: unknown
    headers?: Record<string, string>
    remoteAddress?: string
  }): Promise<{ statusCode: number; json(): Record<string, unknown> }>
}

const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG
const now = Date.UTC(2026, 3, 24, 0, 0, 0)

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task011-team-plan-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
}

function owner(agentId = "agent:nobie"): RuntimeIdentity["owner"] {
  return agentId === "agent:nobie"
    ? { ownerType: "nobie", ownerId: agentId }
    : { ownerType: "sub_agent", ownerId: agentId }
}

function permissionProfile(overrides: Partial<PermissionProfile> = {}): PermissionProfile {
  return {
    profileId: "profile:task011",
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

function allowlist(agentId: string): SkillMcpAllowlist {
  return {
    enabledSkillIds: ["skill:research"],
    enabledMcpServerIds: [],
    enabledToolNames: ["web_search"],
    disabledToolNames: [],
    secretScopeId: `scope:${agentId}`,
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

function subAgent(
  agentId: string,
  specialtyTags: string[],
  overrides: Partial<SubAgentConfig> = {},
): SubAgentConfig {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    agentType: "sub_agent",
    agentId,
    displayName: agentId.replace("agent:", ""),
    nickname: agentId.replace("agent:", ""),
    status: "enabled",
    role: specialtyTags[0] ?? "member",
    personality: "Precise",
    specialtyTags,
    avoidTasks: [],
    memoryPolicy: memoryPolicy(agentId),
    capabilityPolicy: {
      permissionProfile: permissionProfile(),
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
  overrides: Partial<TeamMembership> = {},
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
    ...overrides,
  }
}

function teamConfig(overrides: Partial<TeamConfig> = {}): TeamConfig {
  const teamId = overrides.teamId ?? "team:execution"
  const memberAgentIds = overrides.memberAgentIds ?? [
    "agent:lead",
    "agent:writer",
    "agent:reviewer",
    "agent:verifier",
  ]
  const roleHints = overrides.roleHints ?? ["lead", "writer", "reviewer", "verifier"]
  const memberships =
    overrides.memberships ??
    memberAgentIds.map((agentId, index) =>
      membership(teamId, agentId, [roleHints[index] ?? "member"], index),
    )
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    teamId,
    displayName: "Execution Team",
    nickname: "Execution Team",
    status: "enabled",
    purpose: "Expand team target into member execution tasks.",
    ownerAgentId: "agent:nobie",
    leadAgentId: "agent:lead",
    memberCountMin: 1,
    memberCountMax: 8,
    requiredTeamRoles: ["lead", "writer", "reviewer", "verifier"],
    requiredCapabilityTags: ["research", "writing", "review", "verification"],
    resultPolicy: "reviewer_required",
    conflictPolicy: "reviewer_decides",
    memberships,
    memberAgentIds,
    roleHints,
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function subSession(agentId: string): SubSessionContract {
  return {
    identity: {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      entityType: "sub_session",
      entityId: `subsession:${agentId}:task011`,
      owner: owner(agentId),
      idempotencyKey: `subsession:${agentId}:task011`,
      parent: {
        parentRunId: "run:task011-overload",
        parentSessionId: "session:task011",
        parentRequestId: "request:task011",
      },
    },
    subSessionId: `subsession:${agentId}:task011`,
    parentSessionId: "session:task011",
    parentRunId: "run:task011-overload",
    agentId,
    agentDisplayName: agentId,
    agentNickname: agentId.replace("agent:", ""),
    commandRequestId: "command:task011",
    status: "running",
    retryBudgetRemaining: 0,
    promptBundleId: "prompt:task011",
    startedAt: now,
  }
}

function seedAgents(): void {
  upsertAgentConfig(subAgent("agent:lead", ["research"]), { now })
  upsertAgentConfig(subAgent("agent:writer", ["writing"]), { now })
  upsertAgentConfig(subAgent("agent:reviewer", ["review"]), { now })
  upsertAgentConfig(subAgent("agent:verifier", ["verification"]), { now })
  upsertAgentConfig(subAgent("agent:reference", ["review"]), { now })
  upsertAgentConfig(
    subAgent("agent:primary", ["writing"], {
      delegation: { enabled: true, maxParallelSessions: 1, retryBudget: 1 },
      delegationPolicy: { enabled: true, maxParallelSessions: 1, retryBudget: 1 },
    }),
    { now },
  )
  upsertAgentConfig(subAgent("agent:fallback", ["writing"]), { now })
  for (const [index, agentId] of [
    "agent:lead",
    "agent:writer",
    "agent:reviewer",
    "agent:verifier",
    "agent:primary",
    "agent:fallback",
  ].entries()) {
    upsertAgentRelationship(relationship("agent:nobie", agentId, index), { now })
  }
}

function seedTeam(team: TeamConfig = teamConfig()): void {
  upsertTeamConfig(team, { now })
}

function taskKinds(assignment: TeamExecutionPlanAssignment): string[] {
  return assignment.tasks?.map((task) => task.taskKind) ?? []
}

function expectPresent<T>(value: T | undefined, message: string): T {
  expect(value, message).toBeDefined()
  if (value === undefined) throw new Error(message)
  return value
}

function assignmentFor(plan: TeamExecutionPlan, agentId: string): TeamExecutionPlanAssignment {
  const assignment = plan.memberTaskAssignments.find((candidate) => candidate.agentId === agentId)
  return expectPresent(assignment, `${agentId} assignment should exist`)
}

function buildPlan(teamId = "team:execution"): TeamExecutionPlan {
  const result = buildTeamExecutionPlan(
    {
      teamId,
      teamExecutionPlanId: `team-plan:${teamId}`,
      parentRunId: "run:task011",
      parentRequestId: "request:task011",
      userRequest: "팀 실행 계획을 작성해줘",
      persist: true,
      auditId: "audit:task011",
    },
    { now: () => now, idProvider: (prefix) => `${prefix}:task011` },
  )
  expect(result.ok).toBe(true)
  return expectPresent(result.plan, "team execution plan should exist")
}

beforeEach(() => {
  useTempState()
})

afterEach(() => {
  closeDb()
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

describe("task011 team execution plan", () => {
  it("expands a team target into active direct-child member tasks with snapshots", () => {
    seedAgents()
    seedTeam(
      teamConfig({
        memberAgentIds: [
          "agent:lead",
          "agent:writer",
          "agent:reviewer",
          "agent:verifier",
          "agent:reference",
          "agent:missing",
        ],
        roleHints: ["lead", "writer", "reviewer", "verifier", "observer", "analyst"],
        memberships: [
          membership("team:execution", "agent:lead", ["lead"], 0),
          membership("team:execution", "agent:writer", ["writer"], 1, { required: false }),
          membership("team:execution", "agent:reviewer", ["reviewer"], 2),
          membership("team:execution", "agent:verifier", ["verifier"], 3),
          membership("team:execution", "agent:reference", ["observer"], 4),
          membership("team:execution", "agent:missing", ["analyst"], 5),
        ],
        requiredTeamRoles: ["lead", "writer", "reviewer", "verifier", "analyst"],
        requiredCapabilityTags: ["research", "writing", "review", "verification", "analysis"],
      }),
    )

    const plan = buildPlan()
    expect(validateTeamExecutionPlan(plan).ok).toBe(true)
    expect(plan.teamNicknameSnapshot).toBe("Execution Team")
    expect(plan.ownerAgentId).toBe("agent:nobie")
    expect(plan.leadAgentId).toBe("agent:lead")
    expect(plan.conflictPolicySnapshot).toBe("reviewer_decides")
    expect(plan.resultPolicySnapshot).toBe("reviewer_required")
    expect(plan.memberTaskAssignments.map((assignment) => assignment.agentId)).toEqual(
      expect.arrayContaining(["agent:lead", "agent:writer", "agent:reviewer", "agent:verifier"]),
    )
    expect(plan.memberTaskAssignments.map((assignment) => assignment.agentId)).not.toContain(
      "agent:reference",
    )
    expect(plan.memberTaskAssignments.map((assignment) => assignment.agentId)).not.toContain(
      "agent:missing",
    )

    const writer = assignmentFor(plan, "agent:writer")
    expect(writer.required).toBe(false)
    expect(taskKinds(writer)).toContain("member")
    expect(writer.inputContext).toEqual(
      expect.objectContaining({
        teamId: "team:execution",
        userRequest: "팀 실행 계획을 작성해줘",
      }),
    )
    expect(writer.expectedOutputs?.[0]).toEqual(
      expect.objectContaining({ required: false, description: "Output for writer." }),
    )
    expect(writer.validationCriteria).toEqual(
      expect.arrayContaining(["optional_assignment_reported", "member_output_addresses_role"]),
    )

    const coverage = plan.coverageReport
    expect(coverage.requiredCoverage).toEqual(
      expect.objectContaining({
        roles: expect.arrayContaining([
          expect.objectContaining({ name: "lead", fulfilled: true }),
          expect.objectContaining({ name: "writer", fulfilled: true }),
          expect.objectContaining({ name: "analyst", fulfilled: false }),
        ]),
        capabilityTags: expect.arrayContaining([
          expect.objectContaining({ name: "analysis", fulfilled: false }),
        ]),
      }),
    )
    expect(coverage.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "agent:reference",
          executionState: "reference",
          reasonCodes: expect.arrayContaining(["owner_direct_child_required"]),
        }),
        expect.objectContaining({
          agentId: "agent:missing",
          executionState: "unresolved",
          reasonCodes: expect.arrayContaining(["member_agent_missing"]),
        }),
      ]),
    )
    expect(getTeamExecutionPlan("team-plan:team:execution")?.contract_json).toContain(
      '"teamNicknameSnapshot":"Execution Team"',
    )
  })

  it("adds lead synthesis plus reviewer and verifier tasks after synthesis", () => {
    seedAgents()
    seedTeam()

    const plan = buildPlan()
    const lead = assignmentFor(plan, "agent:lead")
    const reviewer = assignmentFor(plan, "agent:reviewer")
    const verifier = assignmentFor(plan, "agent:verifier")
    const synthesisTaskId = expectPresent(
      lead.tasks?.find((task) => task.taskKind === "synthesis")?.taskId,
      "synthesis task id should exist",
    )
    const reviewTaskId = expectPresent(
      reviewer.tasks?.find((task) => task.taskKind === "review")?.taskId,
      "review task id should exist",
    )

    expect(taskKinds(lead)).toEqual(expect.arrayContaining(["member", "synthesis"]))
    expect(plan.reviewerAgentIds).toEqual(["agent:reviewer"])
    expect(plan.verifierAgentIds).toEqual(["agent:verifier"])
    expect(reviewer.tasks?.find((task) => task.taskKind === "review")?.dependsOnTaskIds).toEqual([
      synthesisTaskId,
    ])
    expect(
      verifier.tasks?.find((task) => task.taskKind === "verification")?.dependsOnTaskIds,
    ).toEqual(expect.arrayContaining([synthesisTaskId, reviewTaskId]))
  })

  it("falls back to owner synthesis when the configured lead is not executable", () => {
    seedAgents()
    seedTeam(
      teamConfig({
        teamId: "team:owner-synthesis",
        leadAgentId: "agent:reference",
        memberAgentIds: ["agent:writer", "agent:reference"],
        roleHints: ["writer", "lead"],
        memberships: [
          membership("team:owner-synthesis", "agent:writer", ["writer"], 0),
          membership("team:owner-synthesis", "agent:reference", ["lead"], 1),
        ],
        requiredTeamRoles: ["writer"],
        requiredCapabilityTags: ["writing"],
        resultPolicy: "owner_synthesis",
        conflictPolicy: "owner_decides",
      }),
    )

    const result = buildTeamExecutionPlan(
      {
        teamId: "team:owner-synthesis",
        teamExecutionPlanId: "team-plan:owner-synthesis",
        parentRunId: "run:task011",
        persist: false,
      },
      { now: () => now },
    )
    expect(result.ok).toBe(true)
    const plan = expectPresent(result.plan, "owner synthesis plan should exist")
    expect(plan.leadAgentId).toBe("agent:nobie")
    expect(plan.coverageReport.policySnapshot).toEqual(
      expect.objectContaining({
        effectiveSynthesisMode: "owner_synthesis",
        synthesisAgentId: "agent:nobie",
      }),
    )
    expect(taskKinds(assignmentFor(plan, "agent:nobie"))).toContain("synthesis")
  })

  it("selects fallback members only when their primary is unavailable", () => {
    seedAgents()
    expect(insertRunSubSession(subSession("agent:primary"), { now })).toBe(true)
    seedTeam(
      teamConfig({
        teamId: "team:fallback",
        leadAgentId: "agent:lead",
        memberAgentIds: ["agent:lead", "agent:primary", "agent:fallback"],
        roleHints: ["lead", "writer", "writer"],
        memberships: [
          membership("team:fallback", "agent:lead", ["lead"], 0),
          membership("team:fallback", "agent:primary", ["writer"], 1),
          membership("team:fallback", "agent:fallback", ["writer"], 2, {
            status: "fallback_only",
            fallbackForAgentId: "agent:primary",
          }),
        ],
        requiredTeamRoles: ["lead", "writer"],
        requiredCapabilityTags: ["research", "writing"],
      }),
    )

    const plan = buildPlan("team:fallback")
    expect(plan.memberTaskAssignments.map((assignment) => assignment.agentId)).toContain(
      "agent:fallback",
    )
    expect(assignmentFor(plan, "agent:fallback").executionState).toBe("fallback")
    expect(plan.fallbackAssignments).toEqual([
      {
        missingAgentId: "agent:primary",
        fallbackAgentId: "agent:fallback",
        reasonCode: "member_overloaded",
      },
    ])

    seedTeam(
      teamConfig({
        teamId: "team:fallback-missing-primary",
        displayName: "Fallback Missing Primary Team",
        nickname: "Fallback Missing Primary Team",
        leadAgentId: "agent:lead",
        memberAgentIds: ["agent:lead", "agent:missing-primary", "agent:fallback"],
        roleHints: ["lead", "writer", "writer"],
        memberships: [
          membership("team:fallback-missing-primary", "agent:lead", ["lead"], 0),
          membership("team:fallback-missing-primary", "agent:missing-primary", ["writer"], 1),
          membership("team:fallback-missing-primary", "agent:fallback", ["writer"], 2, {
            status: "fallback_only",
            fallbackForAgentId: "agent:missing-primary",
          }),
        ],
        requiredTeamRoles: ["lead", "writer"],
        requiredCapabilityTags: ["research", "writing"],
      }),
    )

    const missingPrimaryPlan = buildPlan("team:fallback-missing-primary")
    expect(missingPrimaryPlan.fallbackAssignments).toEqual([])
    expect(
      missingPrimaryPlan.memberTaskAssignments.map((assignment) => assignment.agentId),
    ).not.toContain("agent:fallback")
    expect(missingPrimaryPlan.coverageReport.exclusions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "agent:fallback",
          reasonCodes: expect.arrayContaining([
            "fallback_reason_not_allowed_for_team_execution_plan",
          ]),
        }),
      ]),
    )
  })

  it("creates and persists a plan through POST /api/teams/:teamId/plan", async () => {
    seedAgents()
    seedTeam()
    const app = Fastify({ logger: false })
    registerAgentRoutes(app)
    await app.ready()
    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/teams/team:execution/plan",
        payload: {
          teamExecutionPlanId: "team-plan:api",
          parentRunId: "run:api",
          parentRequestId: "request:api",
          userRequest: "API에서 팀 계획 생성",
          auditId: "audit:api",
        },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.ok).toBe(true)
      expect(body.persisted).toBe(true)
      expect(body.plan).toEqual(
        expect.objectContaining({
          teamExecutionPlanId: "team-plan:api",
          parentRunId: "run:api",
          teamNicknameSnapshot: "Execution Team",
        }),
      )
      expect(getTeamExecutionPlan("team-plan:api")).toEqual(
        expect.objectContaining({
          parent_run_id: "run:api",
          team_nickname_snapshot: "Execution Team",
          audit_id: "audit:api",
        }),
      )
      const subSessionCount = getDb()
        .prepare("SELECT COUNT(*) AS count FROM run_subsessions")
        .get() as { count: number }
      expect(subSessionCount.count).toBe(0)
    } finally {
      await app.close()
    }
  })
})
