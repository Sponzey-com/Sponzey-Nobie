import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerAgentRoutes } from "../packages/core/src/api/routes/agent.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
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
  }): Promise<{ statusCode: number; json(): Record<string, unknown> }>
}

type FastifyTestApp = ReturnType<typeof Fastify>

const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG
const now = Date.UTC(2026, 3, 24, 0, 0, 0)

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task025-topology-"))
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
  disabledToolNames: ["shell_exec"],
  secretScopeId: "sk-task025-secret-scope-1234567890",
}

const permissionProfile: PermissionProfile = {
  profileId: "profile:safe",
  riskCeiling: "moderate",
  approvalRequiredFrom: "moderate",
  allowExternalNetwork: true,
  allowFilesystemWrite: false,
  allowShellExecution: false,
  allowScreenControl: false,
  allowedPaths: ["/Users/dongwooshin/private/topology-secret.txt"],
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
    personality: "Precise",
    specialtyTags: ["research"],
    avoidTasks: [],
    modelProfile: {
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      fallbackModelId: "gpt-5.4",
    },
    memoryPolicy: memoryPolicy(agentId),
    capabilityPolicy: {
      permissionProfile,
      skillMcpAllowlist: allowlist,
      rateLimit: { maxConcurrentCalls: 2 },
    },
    delegationPolicy: { enabled: true, maxParallelSessions: 2, retryBudget: 2 },
    teamIds: ["team:topology"],
    delegation: { enabled: true, maxParallelSessions: 2, retryBudget: 2 },
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
): TeamMembership {
  return {
    membershipId: `${teamId}:membership:${sortOrder}`,
    teamId,
    agentId,
    ownerAgentIdSnapshot: "agent:alpha",
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
    teamId: "team:topology",
    displayName: "Topology Team",
    nickname: "Topology Team",
    status: "enabled",
    purpose: "Validate topology overlays without raw memory.",
    ownerAgentId: "agent:alpha",
    leadAgentId: "agent:beta",
    memberCountMin: 1,
    memberCountMax: 4,
    requiredTeamRoles: ["lead", "reviewer"],
    requiredCapabilityTags: ["research"],
    resultPolicy: "lead_synthesis",
    conflictPolicy: "lead_decides",
    memberships: [
      membership("team:topology", "agent:beta", ["lead"], 0),
      membership("team:topology", "agent:gamma", ["reviewer"], 1),
    ],
    memberAgentIds: ["agent:beta", "agent:gamma"],
    roleHints: ["lead", "reviewer"],
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
  }
}

async function createAgent(app: FastifyTestApp, agentId: string, nickname: string): Promise<void> {
  const response = await app.inject({
    method: "POST",
    url: "/api/agents",
    payload: { agent: subAgentConfig(agentId, nickname) },
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

async function seedTopology(app: FastifyTestApp): Promise<void> {
  await createAgent(app, "agent:alpha", "Alpha")
  await createAgent(app, "agent:beta", "Beta")
  await createAgent(app, "agent:gamma", "Gamma")
  await createRelationship(app, "agent:nobie", "agent:alpha")
  await createRelationship(app, "agent:alpha", "agent:beta")
  await createRelationship(app, "agent:nobie", "agent:gamma")
  const team = await app.inject({
    method: "POST",
    url: "/api/teams",
    payload: { team: teamConfig() },
  })
  expect(team.statusCode).toBe(200)
}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  expect(Array.isArray(value)).toBe(true)
  return value as Array<Record<string, unknown>>
}

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toEqual(expect.any(Object))
  return value as Record<string, unknown>
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

describe("task025 topology projection", () => {
  it("projects hierarchy, team overlays, badges, inspectors, and redacted summaries", async () => {
    const app = Fastify({ logger: false })
    registerAgentRoutes(app)
    await app.ready()
    try {
      await seedTopology(app)

      const response = await app.inject({ method: "GET", url: "/api/agent-topology" })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      const nodes = asRecords(body.nodes)
      const edges = asRecords(body.edges)
      expect(nodes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "nobie" }),
          expect.objectContaining({ kind: "sub_agent", entityId: "agent:alpha" }),
          expect.objectContaining({ kind: "team", entityId: "team:topology" }),
          expect.objectContaining({ kind: "team_role" }),
          expect.objectContaining({ kind: "team_lead" }),
        ]),
      )
      expect(edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "parent_child", style: "hierarchy" }),
          expect.objectContaining({ kind: "team_membership", style: "membership" }),
          expect.objectContaining({ kind: "team_membership", style: "membership_reference" }),
        ]),
      )

      const inspectors = asRecord(body.inspectors)
      const agents = asRecord(inspectors.agents)
      const alpha = asRecord(agents["agent:alpha"])
      expect(asRecord(alpha.skillMcp).secretScope).toBe("configured")
      expect(asRecord(alpha.memory).visibility).toBe("private")
      const teams = asRecord(inspectors.teams)
      const team = asRecord(teams["team:topology"])
      const builder = asRecord(team.builder)
      const gamma = asRecords(builder.candidates).find(
        (candidate) => candidate.agentId === "agent:gamma",
      )
      expect(gamma).toEqual(
        expect.objectContaining({
          directChild: false,
          canActivate: false,
          reasonCodes: expect.arrayContaining(["owner_direct_child_required"]),
        }),
      )
      const serialized = JSON.stringify(body)
      expect(serialized).not.toContain("sk-task025-secret")
      expect(serialized).not.toContain("private/topology-secret")
      expect(serialized).not.toContain("private raw memory")
    } finally {
      await app.close()
    }
  })

  it("validates invalid hierarchy edges and blocks non-direct active team member saves", async () => {
    const app = Fastify({ logger: false })
    registerAgentRoutes(app)
    await app.ready()
    try {
      await seedTopology(app)

      const cycle = await app.inject({
        method: "POST",
        url: "/api/agent-topology/edges/validate",
        payload: {
          edge: {
            kind: "parent_child",
            relationship: { parentAgentId: "agent:beta", childAgentId: "agent:alpha" },
          },
        },
      })
      expect(cycle.statusCode).toBe(200)
      expect(cycle.json()).toEqual(expect.objectContaining({ valid: false }))
      expect(
        asRecords(cycle.json().diagnostics).map((diagnostic) => diagnostic.reasonCode),
      ).toContain("cycle_detected")

      const membershipValidation = await app.inject({
        method: "POST",
        url: "/api/agent-topology/edges/validate",
        payload: {
          edge: {
            kind: "team_membership",
            teamId: "team:topology",
            agentId: "agent:gamma",
            memberStatus: "active",
          },
        },
      })
      expect(membershipValidation.statusCode).toBe(200)
      expect(membershipValidation.json()).toEqual(expect.objectContaining({ valid: false }))

      const save = await app.inject({
        method: "PUT",
        url: "/api/teams/team:topology/members",
        payload: {
          memberAgentIds: ["agent:beta", "agent:gamma"],
          roleHints: ["lead", "reviewer"],
          memberships: [
            membership("team:topology", "agent:beta", ["lead"], 0),
            membership("team:topology", "agent:gamma", ["reviewer"], 1),
          ],
        },
      })
      expect(save.statusCode).toBe(400)
      expect(save.json()).toEqual(
        expect.objectContaining({ reasonCode: "owner_direct_child_required" }),
      )
    } finally {
      await app.close()
    }
  })
})
