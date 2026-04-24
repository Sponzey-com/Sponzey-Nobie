import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildHistoryVersion, recordHistoryVersion } from "../packages/core/src/agent/learning.ts"
import { registerAgentRoutes } from "../packages/core/src/api/routes/agent.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { PATHS } from "../packages/core/src/config/paths.js"
import { closeDb } from "../packages/core/src/db/index.js"
import {
  CONTRACT_SCHEMA_VERSION,
  type MemoryPolicy,
  type PermissionProfile,
  type RuntimeIdentity,
  type SkillMcpAllowlist,
  type SubAgentConfig,
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

const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG
const now = Date.UTC(2026, 3, 24, 0, 0, 0)

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task005-agent-team-api-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
}

function writeConfig(value: unknown): void {
  mkdirSync(dirname(PATHS.configFile), { recursive: true })
  writeFileSync(PATHS.configFile, JSON.stringify(value, null, 2), "utf-8")
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

function subAgentConfig(overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  const agentId = overrides.agentId ?? "agent:researcher"
  const nickname = overrides.nickname ?? "Researcher"
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    agentType: "sub_agent",
    agentId,
    displayName: overrides.displayName ?? nickname,
    nickname,
    status: "enabled",
    role: "research worker",
    personality: "Evidence-first and concise",
    specialtyTags: ["research"],
    avoidTasks: ["unapproved shell"],
    modelProfile: {
      providerId: "openai",
      modelId: "gpt-5.4",
      maxOutputTokens: 1200,
    },
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
    teamIds: ["team:research"],
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
  teamId = "team:research",
  agentId = "agent:researcher",
  sortOrder = 0,
): TeamMembership {
  return {
    membershipId: `${teamId}:membership:${sortOrder}`,
    teamId,
    agentId,
    ownerAgentIdSnapshot: "agent:nobie",
    teamRoles: ["lead researcher"],
    primaryRole: "lead researcher",
    required: true,
    sortOrder,
    status: "active",
  }
}

function teamConfig(overrides: Partial<TeamConfig> = {}): TeamConfig {
  const teamId = overrides.teamId ?? "team:research"
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    teamId,
    displayName: "Research Team",
    nickname: "Research Team",
    status: "enabled",
    purpose: "Collect evidence and draft verified findings.",
    ownerAgentId: "agent:nobie",
    leadAgentId: "agent:researcher",
    memberCountMin: 1,
    memberCountMax: 2,
    requiredTeamRoles: ["lead researcher"],
    requiredCapabilityTags: ["research"],
    resultPolicy: "lead_synthesis",
    conflictPolicy: "lead_decides",
    memberships: [membership(teamId, "agent:researcher", 0)],
    memberAgentIds: ["agent:researcher"],
    roleHints: ["lead researcher"],
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
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

describe("task005 agent and team CRUD API", () => {
  it("supports agent CRUD, nickname conflict errors, disable/archive, and history restore dry-runs", async () => {
    const app = Fastify({ logger: false })
    registerAgentRoutes(app)
    await app.ready()
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/agents",
        payload: { agent: subAgentConfig(), idempotencyKey: "agent:create:researcher" },
      })
      expect(created.statusCode).toBe(200)
      const createdAgent = created.json().agent
      expect(createdAgent).toEqual(
        expect.objectContaining({
          agentId: "agent:researcher",
          normalizedNickname: "researcher",
          status: "enabled",
        }),
      )

      const listed = await app.inject({ method: "GET", url: "/api/agents" })
      expect(listed.statusCode).toBe(200)
      expect(listed.json().agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ agentId: "agent:researcher", status: "enabled" }),
        ]),
      )

      const fetched = await app.inject({ method: "GET", url: "/api/agents/agent:researcher" })
      expect(fetched.statusCode).toBe(200)
      expect(fetched.json().agent).toEqual(
        expect.objectContaining({ agentId: "agent:researcher", status: "enabled" }),
      )

      const patched = await app.inject({
        method: "PATCH",
        url: "/api/agents/agent:researcher",
        payload: { agent: { role: "senior research worker" } },
      })
      expect(patched.statusCode).toBe(200)
      expect(patched.json().agent).toEqual(
        expect.objectContaining({
          agentId: "agent:researcher",
          role: "senior research worker",
          profileVersion: 2,
        }),
      )

      const duplicate = await app.inject({
        method: "POST",
        url: "/api/agents",
        payload: {
          agent: subAgentConfig({
            agentId: "agent:writer",
            displayName: "Writer",
            nickname: "Researcher",
          }),
        },
      })
      expect(duplicate.statusCode).toBe(409)
      expect(duplicate.json()).toEqual(
        expect.objectContaining({
          ok: false,
          reasonCode: "nickname_conflict",
          details: expect.objectContaining({
            attemptedEntityType: "agent",
            attemptedEntityId: "agent:writer",
            existingEntityId: "agent:researcher",
          }),
        }),
      )

      const currentAgent = patched.json().agent as SubAgentConfig
      const history = buildHistoryVersion({
        targetEntityType: "agent",
        targetEntityId: "agent:researcher",
        before: {
          ...currentAgent,
          role: "research worker",
          profileVersion: 1,
        } as unknown as Record<string, unknown>,
        after: currentAgent as unknown as Record<string, unknown>,
        reasonCode: "api_patch",
        owner: owner("system", "test"),
      })
      expect(recordHistoryVersion(history)).toBe(true)

      const historyResponse = await app.inject({
        method: "GET",
        url: "/api/agents/agent:researcher/history",
      })
      expect(historyResponse.statusCode).toBe(200)
      expect(historyResponse.json().history).toEqual([
        expect.objectContaining({
          historyVersionId: history.historyVersionId,
          reasonCode: "api_patch",
        }),
      ])

      const restore = await app.inject({
        method: "POST",
        url: "/api/agents/agent:researcher/restore",
        payload: { historyVersionId: history.historyVersionId },
      })
      expect(restore.statusCode).toBe(200)
      expect(restore.json().result).toEqual(
        expect.objectContaining({
          ok: true,
          applied: false,
          inserted: true,
          restoredHistoryVersionId: history.historyVersionId,
        }),
      )

      const disabled = await app.inject({
        method: "POST",
        url: "/api/agents/agent:researcher/disable",
      })
      expect(disabled.statusCode).toBe(200)
      expect(disabled.json().agent).toEqual(expect.objectContaining({ status: "disabled" }))

      const archived = await app.inject({
        method: "POST",
        url: "/api/agents/agent:researcher/archive",
      })
      expect(archived.statusCode).toBe(200)
      expect(archived.json().agent).toEqual(expect.objectContaining({ status: "archived" }))
    } finally {
      await app.close()
    }
  })

  it("supports team CRUD, membership updates, and explicit diagnostics for unresolved members and invalid leads", async () => {
    const app = Fastify({ logger: false })
    registerAgentRoutes(app)
    await app.ready()
    try {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/agents",
            payload: { agent: subAgentConfig() },
          })
        ).statusCode,
      ).toBe(200)

      const nicknameConflict = await app.inject({
        method: "POST",
        url: "/api/teams",
        payload: { team: teamConfig({ teamId: "team:conflict", nickname: "Researcher" }) },
      })
      expect(nicknameConflict.statusCode).toBe(409)
      expect(nicknameConflict.json()).toEqual(
        expect.objectContaining({
          reasonCode: "nickname_conflict",
          details: expect.objectContaining({
            existingEntityType: "agent",
            existingEntityId: "agent:researcher",
          }),
        }),
      )

      const created = await app.inject({
        method: "POST",
        url: "/api/teams",
        payload: { team: teamConfig() },
      })
      expect(created.statusCode).toBe(200)
      expect(created.json()).toEqual(
        expect.objectContaining({
          team: expect.objectContaining({ teamId: "team:research", status: "enabled" }),
          diagnostics: [],
        }),
      )

      const listedTeams = await app.inject({ method: "GET", url: "/api/teams" })
      expect(listedTeams.statusCode).toBe(200)
      expect(listedTeams.json().teams).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ teamId: "team:research", status: "enabled" }),
        ]),
      )

      const fetchedTeam = await app.inject({ method: "GET", url: "/api/teams/team:research" })
      expect(fetchedTeam.statusCode).toBe(200)
      expect(fetchedTeam.json().team).toEqual(
        expect.objectContaining({ teamId: "team:research", status: "enabled" }),
      )

      const members = await app.inject({
        method: "PUT",
        url: "/api/teams/team:research/members",
        payload: {
          memberAgentIds: ["agent:researcher", "agent:missing"],
          roleHints: ["lead researcher", "backup researcher"],
        },
      })
      expect(members.statusCode).toBe(200)
      expect(members.json().members).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ agentId: "agent:researcher", status: "active" }),
          expect.objectContaining({ agentId: "agent:missing", status: "unresolved" }),
        ]),
      )
      expect(members.json().diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reasonCode: "invalid_member_unresolved",
            agentId: "agent:missing",
          }),
        ]),
      )

      const fetchedMembers = await app.inject({
        method: "GET",
        url: "/api/teams/team:research/members",
      })
      expect(fetchedMembers.statusCode).toBe(200)
      expect(fetchedMembers.json().members).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ agentId: "agent:missing", status: "unresolved" }),
        ]),
      )

      const invalidMembersPayload = await app.inject({
        method: "PUT",
        url: "/api/teams/team:research/members",
        payload: { memberAgentIds: ["agent:researcher", 42] },
      })
      expect(invalidMembersPayload.statusCode).toBe(400)
      expect(invalidMembersPayload.json()).toEqual(
        expect.objectContaining({
          reasonCode: "invalid_membership",
          issues: [expect.objectContaining({ path: "$.memberAgentIds" })],
        }),
      )

      const invalidLead = await app.inject({
        method: "PATCH",
        url: "/api/teams/team:research",
        payload: { team: { leadAgentId: "agent:missing-lead" } },
      })
      expect(invalidLead.statusCode).toBe(200)
      expect(invalidLead.json().diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            reasonCode: "invalid_lead_not_member",
            agentId: "agent:missing-lead",
          }),
        ]),
      )

      const disabled = await app.inject({ method: "POST", url: "/api/teams/team:research/disable" })
      expect(disabled.statusCode).toBe(200)
      expect(disabled.json().team).toEqual(expect.objectContaining({ status: "disabled" }))

      const archived = await app.inject({ method: "POST", url: "/api/teams/team:research/archive" })
      expect(archived.statusCode).toBe(200)
      expect(archived.json().team).toEqual(expect.objectContaining({ status: "archived" }))
    } finally {
      await app.close()
    }
  })

  it("stores imported agents and teams as disabled by default", async () => {
    const app = Fastify({ logger: false })
    registerAgentRoutes(app)
    await app.ready()
    try {
      const agent = await app.inject({
        method: "POST",
        url: "/api/agents",
        payload: {
          imported: true,
          agent: subAgentConfig({ agentId: "agent:imported", nickname: "Imported Agent" }),
        },
      })
      expect(agent.statusCode).toBe(200)
      expect(agent.json().agent).toEqual(
        expect.objectContaining({ agentId: "agent:imported", status: "disabled" }),
      )

      const team = await app.inject({
        method: "POST",
        url: "/api/teams",
        payload: {
          imported: true,
          team: teamConfig({
            teamId: "team:imported",
            nickname: "Imported Team",
            leadAgentId: "agent:imported",
            memberships: [membership("team:imported", "agent:imported", 0)],
            memberAgentIds: ["agent:imported"],
          }),
        },
      })
      expect(team.statusCode).toBe(200)
      expect(team.json().team).toEqual(
        expect.objectContaining({ teamId: "team:imported", status: "disabled" }),
      )
    } finally {
      await app.close()
    }
  })

  it("returns stable validation error bodies", async () => {
    const app = Fastify({ logger: false })
    registerAgentRoutes(app)
    await app.ready()
    try {
      const response = await app.inject({ method: "POST", url: "/api/agents", payload: null })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchInlineSnapshot(`
        {
          "error": "invalid_agent_config",
          "issues": [
            {
              "code": "contract_validation_failed",
              "message": "Agent config must be an object.",
              "path": "$",
            },
          ],
          "ok": false,
          "reasonCode": "invalid_agent_config",
        }
      `)
    } finally {
      await app.close()
    }
  })

  it("keeps CRUD routes behind the static auth guard for remote clients", async () => {
    writeConfig({ webui: { auth: { enabled: true, token: "task005-token" } } })
    const app = Fastify({ logger: false })
    registerAgentRoutes(app)
    await app.ready()
    try {
      const blocked = await app.inject({
        method: "GET",
        url: "/api/agents",
        remoteAddress: "203.0.113.10",
      })
      expect(blocked.statusCode).toBe(401)

      const allowed = await app.inject({
        method: "GET",
        url: "/api/agents",
        remoteAddress: "203.0.113.10",
        headers: { authorization: "Bearer task005-token" },
      })
      expect(allowed.statusCode).toBe(200)
      expect(allowed.json()).toEqual(expect.objectContaining({ ok: true, agents: [] }))
    } finally {
      await app.close()
    }
  })
})
