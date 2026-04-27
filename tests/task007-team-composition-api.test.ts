import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerAgentRoutes } from "../packages/core/src/api/routes/agent.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, insertRunSubSession } from "../packages/core/src/db/index.js"
import {
  CONTRACT_SCHEMA_VERSION,
  type MemoryPolicy,
  type PermissionProfile,
  type RuntimeIdentity,
  type SkillMcpAllowlist,
  type SubAgentConfig,
  type SubSessionContract,
  type TeamConfig,
  type TeamMembership,
} from "../packages/core/src/index.ts"

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

type FastifyTestApp = ReturnType<typeof Fastify>

const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG
const now = Date.UTC(2026, 3, 24, 0, 0, 0)

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task007-team-composition-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
}

function owner(
  ownerType: RuntimeIdentity["owner"]["ownerType"] = "nobie",
  ownerId = "agent:nobie",
): RuntimeIdentity["owner"] {
  return { ownerType, ownerId }
}

const allowlist: SkillMcpAllowlist = {
  enabledSkillIds: ["research"],
  enabledMcpServerIds: ["browser"],
  enabledToolNames: ["web_search"],
  disabledToolNames: [],
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

const shellPermissionProfile: PermissionProfile = {
  ...permissionProfile,
  profileId: "profile:shell",
  allowShellExecution: true,
}

function memoryPolicy(agentId: string): MemoryPolicy {
  return {
    owner: owner("sub_agent", agentId),
    visibility: "private",
    readScopes: [owner("sub_agent", agentId)],
    writeScope: owner("sub_agent", agentId),
    retentionPolicy: "short_term",
    writebackReviewRequired: true,
  }
}

function subAgentConfig(
  agentId: string,
  nickname: string,
  overrides: Partial<SubAgentConfig> = {},
): SubAgentConfig {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    agentType: "sub_agent",
    agentId,
    displayName: nickname,
    nickname,
    status: "enabled",
    role: `${nickname} worker`,
    personality: "Precise and concise",
    specialtyTags: ["research"],
    avoidTasks: [],
    memoryPolicy: memoryPolicy(agentId),
    capabilityPolicy: {
      permissionProfile,
      skillMcpAllowlist: { ...allowlist, secretScopeId: agentId },
      rateLimit: { maxConcurrentCalls: 2 },
    },
    delegationPolicy: {
      enabled: true,
      maxParallelSessions: 2,
      retryBudget: 2,
    },
    teamIds: ["team:composition"],
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
  const teamId = overrides.teamId ?? "team:composition"
  const memberAgentIds = overrides.memberAgentIds ?? ["agent:alpha"]
  const roleHints = overrides.roleHints ?? memberAgentIds.map(() => "member")
  const memberships =
    overrides.memberships ??
    memberAgentIds.map((agentId, index) =>
      membership(teamId, agentId, [roleHints[index] ?? "member"], index),
    )
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    teamId,
    displayName: "Composition Team",
    nickname: "Composition Team",
    status: "enabled",
    purpose: "Validate executable team composition.",
    ownerAgentId: "agent:nobie",
    leadAgentId: memberAgentIds[0],
    memberCountMin: 1,
    memberCountMax: 6,
    requiredTeamRoles: ["member"],
    requiredCapabilityTags: ["research"],
    resultPolicy: "lead_synthesis",
    conflictPolicy: "lead_decides",
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
      entityId: `subsession:${agentId}:running`,
      owner: owner("sub_agent", agentId),
      idempotencyKey: `subsession:${agentId}:running`,
      parent: {
        parentRunId: "run:task007",
        parentSessionId: "session:task007",
        parentRequestId: "request:task007",
      },
    },
    subSessionId: `subsession:${agentId}:running`,
    parentSessionId: "session:task007",
    parentRunId: "run:task007",
    agentId,
    agentDisplayName: agentId,
    agentNickname: agentId.replace("agent:", ""),
    commandRequestId: "command:task007",
    status: "running",
    retryBudgetRemaining: 0,
    promptBundleId: "prompt:task007",
    startedAt: now,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toEqual(expect.any(Object))
  return value as Record<string, unknown>
}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  expect(Array.isArray(value)).toBe(true)
  return value as Array<Record<string, unknown>>
}

function reasonCodes(body: Record<string, unknown>): string[] {
  return asRecords(body.diagnostics).map((diagnostic) => String(diagnostic.reasonCode))
}

async function createAgent(
  app: FastifyTestApp,
  agentId: string,
  nickname: string,
  overrides: Partial<SubAgentConfig> = {},
): Promise<void> {
  const response = await app.inject({
    method: "POST",
    url: "/api/agents",
    payload: { agent: subAgentConfig(agentId, nickname, overrides) },
  })
  expect(response.statusCode).toBe(200)
}

async function createTeam(app: FastifyTestApp, team: TeamConfig): Promise<void> {
  const response = await app.inject({
    method: "POST",
    url: "/api/teams",
    payload: { team },
  })
  expect(response.statusCode).toBe(200)
}

async function createRelationship(
  app: FastifyTestApp,
  parentAgentId: string,
  childAgentId: string,
): Promise<void> {
  const response = await app.inject({
    method: "POST",
    url: "/api/agent-relationships",
    payload: { relationship: { parentAgentId, childAgentId } },
  })
  expect(response.statusCode).toBe(200)
}

async function disableAgent(app: FastifyTestApp, agentId: string): Promise<void> {
  const response = await app.inject({
    method: "POST",
    url: `/api/agents/${agentId}/disable`,
  })
  expect(response.statusCode).toBe(200)
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

describe("task007 team composition API", () => {
  it("limits active coverage to owner direct children and separates reference and unresolved members", async () => {
    const app = Fastify({ logger: false })
    registerAgentRoutes(app)
    await app.ready()
    try {
      await createAgent(app, "agent:alpha", "Alpha")
      await createAgent(app, "agent:gamma", "Gamma")
      await createRelationship(app, "agent:nobie", "agent:alpha")
      await createTeam(
        app,
        teamConfig({
          teamId: "team:coverage",
          leadAgentId: "agent:alpha",
          memberAgentIds: ["agent:alpha", "agent:gamma", "agent:missing"],
          roleHints: ["lead", "reviewer", "verifier"],
          memberships: [
            membership("team:coverage", "agent:alpha", ["lead"], 0),
            membership("team:coverage", "agent:gamma", ["reviewer"], 1),
            membership("team:coverage", "agent:missing", ["verifier"], 2),
          ],
          requiredTeamRoles: ["lead"],
          requiredCapabilityTags: ["research"],
        }),
      )

      const response = await app.inject({
        method: "GET",
        url: "/api/teams/team:coverage/coverage",
      })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      const coverage = asRecord(body.coverage)
      expect(coverage.activeMemberAgentIds).toEqual(["agent:alpha"])
      expect(coverage.referenceMemberAgentIds).toEqual(["agent:gamma"])
      expect(coverage.unresolvedMemberAgentIds).toEqual(["agent:missing"])
      expect(asRecords(coverage.members)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ agentId: "agent:alpha", executionState: "active" }),
          expect.objectContaining({ agentId: "agent:gamma", executionState: "reference" }),
          expect.objectContaining({ agentId: "agent:missing", executionState: "unresolved" }),
        ]),
      )
      expect(reasonCodes(body)).toEqual(
        expect.arrayContaining(["owner_direct_child_required", "member_unresolved"]),
      )
    } finally {
      await app.close()
    }
  })

  it("marks a team invalid when the lead is not an active owner-direct-child member", async () => {
    const app = Fastify({ logger: false })
    registerAgentRoutes(app)
    await app.ready()
    try {
      await createAgent(app, "agent:alpha", "Alpha")
      await createAgent(app, "agent:gamma", "Gamma")
      await createRelationship(app, "agent:nobie", "agent:alpha")
      await createTeam(
        app,
        teamConfig({
          teamId: "team:lead",
          leadAgentId: "agent:gamma",
          memberAgentIds: ["agent:alpha", "agent:gamma"],
          roleHints: ["lead", "reviewer"],
          memberships: [
            membership("team:lead", "agent:alpha", ["lead"], 0),
            membership("team:lead", "agent:gamma", ["reviewer"], 1),
          ],
          requiredTeamRoles: ["lead"],
          requiredCapabilityTags: ["research"],
        }),
      )

      const response = await app.inject({
        method: "GET",
        url: "/api/teams/team:lead/health",
      })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(asRecord(body.health).status).toBe("invalid")
      expect(reasonCodes(body)).toEqual(expect.arrayContaining(["lead_not_active_member"]))
    } finally {
      await app.close()
    }
  })

  it("excludes overloaded members from role and capability coverage with recalculation hooks", async () => {
    const app = Fastify({ logger: false })
    registerAgentRoutes(app)
    await app.ready()
    try {
      await createAgent(app, "agent:alpha", "Alpha", { specialtyTags: ["research"] })
      await createAgent(app, "agent:beta", "Beta", {
        specialtyTags: ["writing"],
        delegation: { enabled: true, maxParallelSessions: 1, retryBudget: 1 },
        delegationPolicy: { enabled: true, maxParallelSessions: 1, retryBudget: 1 },
      })
      await createRelationship(app, "agent:nobie", "agent:alpha")
      await createRelationship(app, "agent:nobie", "agent:beta")
      expect(insertRunSubSession(subSession("agent:beta"), { now })).toBe(true)
      await createTeam(
        app,
        teamConfig({
          teamId: "team:overload",
          leadAgentId: "agent:alpha",
          memberAgentIds: ["agent:alpha", "agent:beta"],
          roleHints: ["lead", "writer"],
          memberships: [
            membership("team:overload", "agent:alpha", ["lead"], 0),
            membership("team:overload", "agent:beta", ["writer"], 1),
          ],
          requiredTeamRoles: ["lead", "writer"],
          requiredCapabilityTags: ["research", "writing"],
        }),
      )

      const response = await app.inject({
        method: "GET",
        url: "/api/teams/team:overload/health",
      })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      const health = asRecord(body.health)
      expect(health.status).toBe("degraded")
      expect(reasonCodes(body)).toEqual(
        expect.arrayContaining([
          "member_overloaded",
          "required_role_missing",
          "required_capability_missing",
        ]),
      )
      expect(asRecord(health.coverageSummary).recalculationKeys).toEqual(
        expect.arrayContaining([
          "task008.skill_mcp_binding_recalculation_pending",
          "task009.model_state_recalculation_pending",
        ]),
      )
    } finally {
      await app.close()
    }
  })

  it("marks owner-unavailable teams invalid before execution", async () => {
    const app = Fastify({ logger: false })
    registerAgentRoutes(app)
    await app.ready()
    try {
      await createAgent(app, "agent:owner", "Owner")
      await createAgent(app, "agent:child", "Child")
      await createRelationship(app, "agent:nobie", "agent:owner")
      await createRelationship(app, "agent:owner", "agent:child")
      await disableAgent(app, "agent:owner")
      await createTeam(
        app,
        teamConfig({
          teamId: "team:owner-disabled",
          ownerAgentId: "agent:owner",
          leadAgentId: "agent:child",
          memberAgentIds: ["agent:child"],
          roleHints: ["lead"],
          memberships: [membership("team:owner-disabled", "agent:child", ["lead"], 0)],
          requiredTeamRoles: ["lead"],
          requiredCapabilityTags: ["research"],
        }),
      )

      const response = await app.inject({
        method: "GET",
        url: "/api/teams/team:owner-disabled/health",
      })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(asRecord(body.health).status).toBe("invalid")
      expect(reasonCodes(body)).toEqual(
        expect.arrayContaining(["team_owner_unavailable", "no_active_team_members"]),
      )
    } finally {
      await app.close()
    }
  })

  it("allows narrow fallback candidates and rejects broader fallback permissions", async () => {
    const app = Fastify({ logger: false })
    registerAgentRoutes(app)
    await app.ready()
    try {
      await createAgent(app, "agent:lead", "Lead", { specialtyTags: ["research"] })
      await createAgent(app, "agent:primary", "Primary", { specialtyTags: ["writing"] })
      await createAgent(app, "agent:fallback", "Fallback", { specialtyTags: ["writing"] })
      await createAgent(app, "agent:broad-fallback", "Broad Fallback", {
        specialtyTags: ["writing"],
        capabilityPolicy: {
          permissionProfile: shellPermissionProfile,
          skillMcpAllowlist: { ...allowlist, secretScopeId: "agent:broad-fallback" },
          rateLimit: { maxConcurrentCalls: 2 },
        },
      })
      for (const agentId of [
        "agent:lead",
        "agent:primary",
        "agent:fallback",
        "agent:broad-fallback",
      ]) {
        await createRelationship(app, "agent:nobie", agentId)
      }
      await disableAgent(app, "agent:primary")

      await createTeam(
        app,
        teamConfig({
          teamId: "team:fallback",
          leadAgentId: "agent:lead",
          memberAgentIds: ["agent:lead", "agent:primary", "agent:fallback"],
          roleHints: ["lead", "writer", "writer"],
          memberships: [
            membership("team:fallback", "agent:lead", ["lead"], 0),
            membership("team:fallback", "agent:primary", ["writer"], 1),
            membership("team:fallback", "agent:fallback", ["writer"], 2, {
              fallbackForAgentId: "agent:primary",
              status: "fallback_only",
            }),
          ],
          requiredTeamRoles: ["lead", "writer"],
          requiredCapabilityTags: ["research", "writing"],
        }),
      )
      const validFallback = await app.inject({
        method: "POST",
        url: "/api/teams/team:fallback/validate",
      })
      expect(validFallback.statusCode).toBe(200)
      const validFallbackBody = validFallback.json()
      expect(validFallbackBody.valid).toBe(true)
      const validCoverage = asRecord(validFallbackBody.coverage)
      expect(validCoverage.fallbackCandidateAgentIds).toEqual(["agent:fallback"])
      expect(asRecord(validFallbackBody.health).status).toBe("degraded")

      const broadFallback = await app.inject({
        method: "POST",
        url: "/api/teams/team:fallback-broad/validate",
        payload: {
          team: teamConfig({
            teamId: "team:fallback-broad",
            leadAgentId: "agent:lead",
            memberAgentIds: ["agent:lead", "agent:primary", "agent:broad-fallback"],
            roleHints: ["lead", "writer", "writer"],
            memberships: [
              membership("team:fallback-broad", "agent:lead", ["lead"], 0),
              membership("team:fallback-broad", "agent:primary", ["writer"], 1),
              membership("team:fallback-broad", "agent:broad-fallback", ["writer"], 2, {
                fallbackForAgentId: "agent:primary",
                status: "fallback_only",
              }),
            ],
            requiredTeamRoles: ["lead", "writer"],
            requiredCapabilityTags: ["research", "writing"],
          }),
        },
      })
      expect(broadFallback.statusCode).toBe(200)
      const broadFallbackBody = broadFallback.json()
      expect(broadFallbackBody.valid).toBe(false)
      expect(reasonCodes(broadFallbackBody)).toEqual(
        expect.arrayContaining(["fallback_shell_permission_broader"]),
      )
    } finally {
      await app.close()
    }
  })

  it("validates import/export team payloads with the same composition rules before save", async () => {
    const app = Fastify({ logger: false })
    registerAgentRoutes(app)
    await app.ready()
    try {
      await createAgent(app, "agent:alpha", "Alpha")
      await createRelationship(app, "agent:nobie", "agent:alpha")

      const response = await app.inject({
        method: "POST",
        url: "/api/teams/team:import/validate",
        payload: {
          team: teamConfig({
            teamId: "team:import",
            leadAgentId: "agent:alpha",
            memberAgentIds: ["agent:alpha"],
            roleHints: ["lead"],
            memberships: [membership("team:import", "agent:alpha", ["lead"], 0)],
            requiredTeamRoles: ["lead"],
            requiredCapabilityTags: ["research"],
          }),
        },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.valid).toBe(true)
      expect(asRecord(body.health).status).toBe("healthy")

      const persistedCoverage = await app.inject({
        method: "GET",
        url: "/api/teams/team:import/coverage",
      })
      expect(persistedCoverage.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })
})
