import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
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

type FastifyTestApp = ReturnType<typeof Fastify>

const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG
const now = Date.UTC(2026, 3, 24, 0, 0, 0)

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task006-hierarchy-"))
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
    teamIds: ["team:default"],
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

function membership(teamId: string, agentId: string, sortOrder = 0): TeamMembership {
  return {
    membershipId: `${teamId}:membership:${sortOrder}`,
    teamId,
    agentId,
    ownerAgentIdSnapshot: "agent:nobie",
    teamRoles: ["member"],
    primaryRole: "member",
    required: true,
    sortOrder,
    status: "active",
  }
}

function teamConfig(overrides: Partial<TeamConfig> = {}): TeamConfig {
  const teamId = overrides.teamId ?? "team:default"
  const memberAgentIds = overrides.memberAgentIds ?? ["agent:beta"]
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    teamId,
    displayName: "Default Team",
    nickname: "Default Team",
    status: "enabled",
    purpose: "Test team membership separation.",
    ownerAgentId: "agent:nobie",
    leadAgentId: memberAgentIds[0],
    memberCountMin: 1,
    memberCountMax: 3,
    requiredTeamRoles: ["member"],
    requiredCapabilityTags: ["research"],
    resultPolicy: "lead_synthesis",
    conflictPolicy: "lead_decides",
    memberships: memberAgentIds.map((agentId, index) => membership(teamId, agentId, index)),
    memberAgentIds,
    roleHints: memberAgentIds.map(() => "member"),
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
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

async function createRelationship(
  app: FastifyTestApp,
  parentAgentId: string,
  childAgentId: string,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await app.inject({
    method: "POST",
    url: "/api/agent-relationships",
    payload: { relationship: { parentAgentId, childAgentId, ...extra } },
  })
  expect(response.statusCode).toBe(200)
  return response.json()
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

describe("task006 hierarchy relationship API", () => {
  it("creates, projects, queries, and deactivates parent-child relationships without treating team membership as hierarchy", async () => {
    const app = Fastify({ logger: false })
    registerAgentRoutes(app)
    await app.ready()
    try {
      await createAgent(app, "agent:alpha", "Alpha")
      await createAgent(app, "agent:beta", "Beta")
      await createAgent(app, "agent:gamma", "Gamma")
      await createRelationship(app, "agent:nobie", "agent:alpha")
      await createRelationship(app, "agent:alpha", "agent:beta")

      const team = await app.inject({
        method: "POST",
        url: "/api/teams",
        payload: {
          team: teamConfig({ memberAgentIds: ["agent:gamma"], nickname: "Hierarchy Team" }),
        },
      })
      expect(team.statusCode).toBe(200)

      const rootChildren = await app.inject({
        method: "GET",
        url: "/api/agents/agent:nobie/children",
      })
      expect(rootChildren.statusCode).toBe(200)
      expect(rootChildren.json().childAgentIds).toEqual(["agent:alpha"])

      const alphaChildren = await app.inject({
        method: "GET",
        url: "/api/agents/agent:alpha/children",
      })
      expect(alphaChildren.statusCode).toBe(200)
      expect(alphaChildren.json().childAgentIds).toEqual(["agent:beta"])

      const tree = await app.inject({ method: "GET", url: "/api/agent-tree" })
      expect(tree.statusCode).toBe(200)
      const treeBody = tree.json()
      expect(asRecords(treeBody.topLevelSubAgents)).toEqual([
        expect.objectContaining({ agentId: "agent:alpha" }),
      ])
      expect(asRecords(treeBody.edges)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            edgeType: "parent_child",
            fromNodeId: "agent:agent:nobie",
            toNodeId: "agent:agent:alpha",
          }),
          expect.objectContaining({
            edgeType: "parent_child",
            fromNodeId: "agent:agent:alpha",
            toNodeId: "agent:agent:beta",
          }),
        ]),
      )
      expect(asRecords(treeBody.edges)).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ edgeType: "team_membership" }),
          expect.objectContaining({ toNodeId: "agent:agent:gamma" }),
        ]),
      )

      const relationship = asRecords(treeBody.edges).find(
        (edge) => edge.toNodeId === "agent:agent:beta",
      )
      expect(relationship?.edgeId).toBe("relationship:agent:alpha->agent:beta")
      const deleted = await app.inject({
        method: "DELETE",
        url: `/api/agent-relationships/${encodeURIComponent(String(relationship?.edgeId))}`,
      })
      expect(deleted.statusCode).toBe(200)
      expect(deleted.json().relationship).toEqual(expect.objectContaining({ status: "disabled" }))

      const alphaChildrenAfterDelete = await app.inject({
        method: "GET",
        url: "/api/agents/agent:alpha/children",
      })
      expect(alphaChildrenAfterDelete.statusCode).toBe(200)
      expect(alphaChildrenAfterDelete.json().childAgentIds).toEqual([])
    } finally {
      await app.close()
    }
  })

  it("blocks cycles, multi-parent children, self-parenting, and Nobie-as-child relationships", async () => {
    const app = Fastify({ logger: false })
    registerAgentRoutes(app)
    await app.ready()
    try {
      await createAgent(app, "agent:alpha", "Alpha")
      await createAgent(app, "agent:beta", "Beta")
      await createRelationship(app, "agent:nobie", "agent:alpha")
      await createRelationship(app, "agent:alpha", "agent:beta")

      const cycle = await app.inject({
        method: "POST",
        url: "/api/agent-relationships",
        payload: { relationship: { parentAgentId: "agent:beta", childAgentId: "agent:alpha" } },
      })
      expect(cycle.statusCode).toBe(400)
      expect(reasonCodes(cycle.json())).toContain("cycle_detected")

      const multiParent = await app.inject({
        method: "POST",
        url: "/api/agent-relationships",
        payload: { relationship: { parentAgentId: "agent:nobie", childAgentId: "agent:beta" } },
      })
      expect(multiParent.statusCode).toBe(400)
      expect(reasonCodes(multiParent.json())).toContain("child_multi_parent_blocked")

      const selfParent = await app.inject({
        method: "POST",
        url: "/api/agent-relationships/validate",
        payload: { relationship: { parentAgentId: "agent:alpha", childAgentId: "agent:alpha" } },
      })
      expect(selfParent.statusCode).toBe(200)
      expect(selfParent.json()).toEqual(expect.objectContaining({ valid: false }))
      expect(reasonCodes(selfParent.json())).toContain("self_parent_blocked")

      const nobieAsChild = await app.inject({
        method: "POST",
        url: "/api/agent-relationships",
        payload: { relationship: { parentAgentId: "agent:alpha", childAgentId: "agent:nobie" } },
      })
      expect(nobieAsChild.statusCode).toBe(400)
      expect(reasonCodes(nobieAsChild.json())).toContain("nobie_parent_forbidden")
    } finally {
      await app.close()
    }
  })

  it("blocks max depth and max direct child count before persisting", async () => {
    const app = Fastify({ logger: false })
    registerAgentRoutes(app)
    await app.ready()
    try {
      await createAgent(app, "agent:alpha", "Alpha")
      await createAgent(app, "agent:beta", "Beta")
      await createAgent(app, "agent:gamma", "Gamma")
      await createRelationship(app, "agent:nobie", "agent:alpha")
      await createRelationship(app, "agent:alpha", "agent:beta")

      const tooDeep = await app.inject({
        method: "POST",
        url: "/api/agent-relationships",
        payload: {
          maxDepth: 2,
          relationship: { parentAgentId: "agent:beta", childAgentId: "agent:gamma" },
        },
      })
      expect(tooDeep.statusCode).toBe(400)
      expect(reasonCodes(tooDeep.json())).toContain("max_depth_exceeded")

      const secondRootChild = await app.inject({
        method: "POST",
        url: "/api/agent-relationships",
        payload: {
          maxChildCount: 1,
          relationship: { parentAgentId: "agent:nobie", childAgentId: "agent:gamma" },
        },
      })
      expect(secondRootChild.statusCode).toBe(400)
      expect(reasonCodes(secondRootChild.json())).toContain("max_child_count_exceeded")
    } finally {
      await app.close()
    }
  })

  it("uses enabled sub-agents as documented top-level fallback only when no hierarchy rows exist", async () => {
    const app = Fastify({ logger: false })
    registerAgentRoutes(app)
    await app.ready()
    try {
      await createAgent(app, "agent:alpha", "Alpha")
      await createAgent(app, "agent:beta", "Beta")

      const fallbackTree = await app.inject({ method: "GET", url: "/api/agent-tree" })
      expect(fallbackTree.statusCode).toBe(200)
      expect(fallbackTree.json()).toEqual(expect.objectContaining({ topLevelFallbackActive: true }))
      expect(
        asRecords(fallbackTree.json().topLevelSubAgents).map((agent) => agent.agentId),
      ).toEqual(["agent:alpha", "agent:beta"])
      expect(reasonCodes(fallbackTree.json())).toContain("hierarchy_fallback_enabled_sub_agents")

      await createRelationship(app, "agent:nobie", "agent:alpha")
      const hierarchyTree = await app.inject({ method: "GET", url: "/api/agent-tree" })
      expect(hierarchyTree.statusCode).toBe(200)
      expect(hierarchyTree.json()).toEqual(
        expect.objectContaining({ topLevelFallbackActive: false }),
      )
      expect(
        asRecords(hierarchyTree.json().topLevelSubAgents).map((agent) => agent.agentId),
      ).toEqual(["agent:alpha"])
    } finally {
      await app.close()
    }
  })

  it("marks descendants of disabled ancestors as non-executable while preserving direct child visibility", async () => {
    const app = Fastify({ logger: false })
    registerAgentRoutes(app)
    await app.ready()
    try {
      await createAgent(app, "agent:alpha", "Alpha")
      await createAgent(app, "agent:beta", "Beta")
      await createRelationship(app, "agent:nobie", "agent:alpha")
      await createRelationship(app, "agent:alpha", "agent:beta")

      const disabled = await app.inject({ method: "POST", url: "/api/agents/agent:alpha/disable" })
      expect(disabled.statusCode).toBe(200)

      const alphaChildren = await app.inject({
        method: "GET",
        url: "/api/agents/agent:alpha/children",
      })
      expect(alphaChildren.statusCode).toBe(200)
      expect(alphaChildren.json().childAgentIds).toEqual(["agent:beta"])
      expect(alphaChildren.json().executionCandidateAgentIds).toEqual([])
      expect(asRecords(alphaChildren.json().children)).toEqual([
        expect.objectContaining({
          isExecutionCandidate: false,
          blockedReason: "ancestor_disabled",
        }),
      ])
    } finally {
      await app.close()
    }
  })

  it("stores graph layout as UI preference and keeps remote access behind auth", async () => {
    writeConfig({ webui: { auth: { enabled: true, token: "task006-token" } } })
    const app = Fastify({ logger: false })
    registerAgentRoutes(app)
    await app.ready()
    try {
      const blocked = await app.inject({
        method: "GET",
        url: "/api/agent-tree/layout",
        remoteAddress: "203.0.113.10",
      })
      expect(blocked.statusCode).toBe(401)

      const saved = await app.inject({
        method: "PUT",
        url: "/api/agent-tree/layout",
        remoteAddress: "203.0.113.10",
        headers: { authorization: "Bearer task006-token" },
        payload: {
          layout: {
            layout: "freeform",
            nodes: {
              "agent:agent:nobie": { x: 10, y: 20, collapsed: true },
            },
            viewport: { x: 0, y: 0, zoom: 1.2 },
          },
        },
      })
      expect(saved.statusCode).toBe(200)
      expect(saved.json().layout).toEqual(
        expect.objectContaining({
          schemaVersion: 1,
          layout: "freeform",
          nodes: {
            "agent:agent:nobie": { x: 10, y: 20, collapsed: true },
          },
          viewport: { x: 0, y: 0, zoom: 1.2 },
          updatedAt: expect.any(Number),
        }),
      )

      const loaded = await app.inject({
        method: "GET",
        url: "/api/agent-tree/layout",
        remoteAddress: "203.0.113.10",
        headers: { authorization: "Bearer task006-token" },
      })
      expect(loaded.statusCode).toBe(200)
      expect(loaded.json().layout).toEqual(saved.json().layout)
    } finally {
      await app.close()
    }
  })
})
