import { createRequire } from "node:module"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import { registerOrchestrationRoute } from "../packages/core/src/api/routes/orchestration.ts"
import { listAuditEvents } from "../packages/core/src/api/routes/audit.ts"
import {
  closeDb,
  getAgentConfig,
  getDb,
  getTeamConfig,
  insertAgentDataExchange,
  insertCapabilityDelegation,
  insertRunSubSession,
  listAgentConfigs,
  upsertAgentConfig,
  upsertTeamConfig,
} from "../packages/core/src/db/index.js"
import type {
  AgentConfig,
  CapabilityDelegationRequest,
  DataExchangePackage,
  MemoryPolicy,
  PermissionProfile,
  RuntimeIdentity,
  SkillMcpAllowlist,
  SubAgentConfig,
  SubSessionContract,
  TeamConfig,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"

const require = createRequire(import.meta.url)
const Fastify = require("../packages/core/node_modules/fastify") as (options: { logger: boolean }) => {
  close(): Promise<void>
  inject(options: { method: string; url: string; payload?: unknown }): Promise<{ statusCode: number; json(): any }>
}

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const now = Date.UTC(2026, 3, 20, 0, 0, 0)

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task011-api-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
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

function identity(entityType: RuntimeIdentity["entityType"], entityId: string): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType,
    entityId,
    owner: { ownerType: "nobie", ownerId: "nobie:main" },
    idempotencyKey: `idem:${entityType}:${entityId}`,
    auditCorrelationId: `audit:${entityId}`,
    parent: {
      parentRunId: "run:task011",
      parentRequestId: "request:task011",
    },
  }
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

function allowlist(overrides: Partial<SkillMcpAllowlist> = {}): SkillMcpAllowlist {
  return {
    enabledSkillIds: ["research"],
    enabledMcpServerIds: ["browser"],
    enabledToolNames: ["web_search"],
    disabledToolNames: ["shell_exec"],
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

function subAgentConfig(agentId: string, overrides: Partial<SubAgentConfig> = {}): SubAgentConfig {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    agentType: "sub_agent",
    agentId,
    displayName: agentId.replace("task011:", "Agent "),
    nickname: agentId.replace("task011:", ""),
    status: "enabled",
    role: "research worker",
    personality: "Precise and evidence first",
    specialtyTags: ["research"],
    avoidTasks: ["shell execution"],
    memoryPolicy: memoryPolicy(agentId),
    capabilityPolicy: {
      permissionProfile: permissionProfile(),
      skillMcpAllowlist: allowlist(),
      rateLimit: { maxConcurrentCalls: 2 },
    },
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
    teamIds: ["task011:team"],
    delegation: {
      enabled: true,
      maxParallelSessions: 2,
      retryBudget: 2,
    },
    ...overrides,
  }
}

function teamConfig(memberAgentIds = ["task011:alpha"]): TeamConfig {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    teamId: "task011:team",
    displayName: "Task011 Team",
    nickname: "task011",
    status: "enabled",
    purpose: "API contract verification",
    memberAgentIds,
    roleHints: ["primary"],
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
  }
}

function subSession(agentId = "task011:alpha"): SubSessionContract {
  return {
    identity: identity("sub_session", "task011:subsession"),
    subSessionId: "task011:subsession",
    parentSessionId: "session:task011",
    parentRunId: "run:task011",
    agentId,
    agentDisplayName: "Agent alpha",
    agentNickname: "alpha",
    commandRequestId: "command:task011",
    status: "queued",
    retryBudgetRemaining: 2,
    promptBundleId: "bundle:task011",
  }
}

function dataExchangePackage(): DataExchangePackage {
  return {
    identity: identity("data_exchange", "exchange:task011"),
    exchangeId: "exchange:task011",
    sourceOwner: { ownerType: "sub_agent", ownerId: "task011:alpha" },
    recipientOwner: { ownerType: "sub_agent", ownerId: "task011:beta" },
    purpose: "verification evidence",
    allowedUse: "verification_only",
    retentionPolicy: "session_only",
    redactionState: "not_sensitive",
    provenanceRefs: ["run:task011"],
    payload: { answer: "ok" },
    expiresAt: now + 60_000,
    createdAt: now,
  }
}

function capabilityDelegation(): CapabilityDelegationRequest {
  return {
    identity: identity("capability", "delegation:task011"),
    delegationId: "delegation:task011",
    requester: { ownerType: "sub_agent", ownerId: "task011:alpha" },
    provider: { ownerType: "sub_agent", ownerId: "task011:beta" },
    capability: "web_search",
    risk: "external",
    inputPackageIds: ["exchange:task011"],
    status: "requested",
  }
}

async function withApp<T>(fn: (app: ReturnType<typeof Fastify>) => Promise<T>): Promise<T> {
  const app = Fastify({ logger: false })
  registerOrchestrationRoute(app as any)
  try {
    return await fn(app)
  } finally {
    await app.close()
  }
}

describe("task011 orchestration API import/export", () => {
  it("supports validation-only writes and paginated stable registry lists", async () => {
    await withApp(async (app) => {
      const alpha = subAgentConfig("task011:alpha")
      const dryRun = await app.inject({
        method: "PUT",
        url: "/api/orchestration/agents/task011%3Aalpha",
        payload: { config: alpha, validationOnly: true },
      })
      expect(dryRun.statusCode).toBe(200)
      expect(dryRun.json().stored).toBe(false)
      expect(getAgentConfig("task011:alpha")).toBeUndefined()

      for (const id of ["task011:alpha", "task011:beta", "task011:gamma"]) {
        const response = await app.inject({
          method: "PUT",
          url: `/api/orchestration/agents/${encodeURIComponent(id)}`,
          payload: { config: subAgentConfig(id), idempotencyKey: `idem:${id}` },
        })
        expect(response.statusCode).toBe(200)
      }

      const page = await app.inject({
        method: "GET",
        url: "/api/orchestration/agents?q=task011&page=1&limit=2",
      })
      expect(page.statusCode).toBe(200)
      expect(page.json()).toMatchObject({ total: 3, page: 1, limit: 2, pages: 2 })
      expect(page.json().items.map((item: { agentId: string }) => item.agentId)).toEqual(["task011:alpha", "task011:beta"])

      const auditEvents = listAuditEvents({ kind: "message_ledger", q: "agent config" }).items
      expect(auditEvents.some((event) => event.toolName === "agent_config_changed" && event.summary.includes("task011:alpha"))).toBe(true)
    })
  })

  it("redacts secrets on export and imports configs disabled with idempotent replay", async () => {
    const source = subAgentConfig("task011:secret", {
      role: "Use apiKey: sk-abcdefghijklmnopqrstuvwxyz012345 for fixture only",
    })
    upsertAgentConfig(source, { source: "manual", now })

    await withApp(async (app) => {
      const exported = await app.inject({
        method: "GET",
        url: "/api/orchestration/config/export/agent/task011%3Asecret",
      })
      expect(exported.statusCode).toBe(200)
      const exportBody = exported.json()
      expect(exportBody.canonicalJson).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345")
      expect(exportBody.exportPackage.redactionState).toBe("redacted")
      expect(listAuditEvents({ kind: "message_ledger", q: "agent config exported" }).items.length).toBeGreaterThan(0)

      const importPackage = {
        ...exportBody.exportPackage,
        config: {
          ...exportBody.exportPackage.config,
          agentId: "task011:secret",
          status: "enabled",
        },
      }
      const imported = await app.inject({
        method: "POST",
        url: "/api/orchestration/config/import",
        payload: {
          package: importPackage,
          conflictStrategy: "create_copy",
          idempotencyKey: "idem:task011:import-secret",
        },
      })
      expect(imported.statusCode).toBe(200)
      const first = imported.json()
      expect(first.stored).toBe(true)
      expect(first.action).toBe("copied")
      expect(first.config.status).toBe("disabled")
      expect(first.targetId).toContain("task011:secret:copy:")
      expect(listAuditEvents({ kind: "message_ledger", q: "agent config imported" }).items.length).toBeGreaterThan(0)

      const replay = await app.inject({
        method: "POST",
        url: "/api/orchestration/config/import",
        payload: {
          package: importPackage,
          conflictStrategy: "create_copy",
          idempotencyKey: "idem:task011:import-secret",
        },
      })
      expect(replay.statusCode).toBe(200)
      expect(replay.json().targetId).toBe(first.targetId)
      const rows = listAgentConfigs({ includeArchived: true }).filter((row) => row.idempotency_key === "idem:task011:import-secret")
      expect(rows).toHaveLength(1)
      expect(JSON.parse(rows[0]!.config_json).status).toBe("disabled")

      const yamlImport = await app.inject({
        method: "POST",
        url: "/api/orchestration/config/import",
        payload: {
          format: "yaml",
          validationOnly: true,
          content: `
targetType: agent
config:
  schemaVersion: 1
  agentType: sub_agent
  agentId: task011:yaml
  displayName: YAML Agent
  nickname: yaml
  status: enabled
  role: yaml import verification
  personality: concise
  specialtyTags:
    - import
  avoidTasks: []
  memoryPolicy:
    owner:
      ownerType: sub_agent
      ownerId: task011:yaml
    visibility: private
    readScopes:
      - ownerType: sub_agent
        ownerId: task011:yaml
    writeScope:
      ownerType: sub_agent
      ownerId: task011:yaml
    retentionPolicy: long_term
    writebackReviewRequired: true
  capabilityPolicy:
    permissionProfile:
      profileId: profile:yaml
      riskCeiling: moderate
      approvalRequiredFrom: moderate
      allowExternalNetwork: true
      allowFilesystemWrite: false
      allowShellExecution: false
      allowScreenControl: false
      allowedPaths: []
    skillMcpAllowlist:
      enabledSkillIds: []
      enabledMcpServerIds: []
      enabledToolNames: []
      disabledToolNames: []
    rateLimit:
      maxConcurrentCalls: 1
  profileVersion: 1
  createdAt: ${now}
  updatedAt: ${now}
  teamIds: []
  delegation:
    enabled: true
    maxParallelSessions: 1
    retryBudget: 1
`,
        },
      })
      expect(yamlImport.statusCode).toBe(200)
      expect(yamlImport.json()).toMatchObject({ action: "validated", targetId: "task011:yaml", stored: false })
    })
  })

  it("reports conflicts and permission expansion without activating imports", async () => {
    const safe = subAgentConfig("task011:guarded", {
      capabilityPolicy: {
        permissionProfile: permissionProfile({
          riskCeiling: "safe",
          allowExternalNetwork: false,
        }),
        skillMcpAllowlist: allowlist({ enabledMcpServerIds: [] }),
        rateLimit: { maxConcurrentCalls: 1 },
      },
    })
    upsertAgentConfig(safe, { source: "manual", now })
    const expanded = subAgentConfig("task011:guarded", {
      capabilityPolicy: {
        permissionProfile: permissionProfile({
          riskCeiling: "dangerous",
          allowExternalNetwork: true,
          allowFilesystemWrite: true,
        }),
        skillMcpAllowlist: allowlist({ enabledMcpServerIds: ["browser", "filesystem"], enabledToolNames: ["web_search", "file_write"] }),
        rateLimit: { maxConcurrentCalls: 3 },
      },
    })

    await withApp(async (app) => {
      const cancelled = await app.inject({
        method: "POST",
        url: "/api/orchestration/config/import",
        payload: {
          package: { targetType: "agent", config: expanded },
          conflictStrategy: "cancel",
        },
      })
      expect(cancelled.statusCode).toBe(409)
      expect(cancelled.json()).toMatchObject({ ok: false, action: "cancelled", conflict: "existing_target" })

      const dryRun = await app.inject({
        method: "POST",
        url: "/api/orchestration/config/import",
        payload: {
          package: { targetType: "agent", config: expanded },
          validationOnly: true,
          conflictStrategy: "overwrite",
        },
      })
      expect(dryRun.statusCode).toBe(200)
      expect(dryRun.json()).toMatchObject({
        stored: false,
        approvalRequired: true,
        activationRequired: true,
      })
      expect(getAgentConfig("task011:guarded")).toBeTruthy()
      expect(JSON.parse(getAgentConfig("task011:guarded")!.config_json).status).toBe("enabled")
    })
  })

  it("exposes graph, sub-session, data exchange, and capability delegation lists", async () => {
    upsertAgentConfig(subAgentConfig("task011:alpha"), { source: "manual", now })
    upsertAgentConfig(subAgentConfig("task011:beta"), { source: "manual", now })
    upsertTeamConfig(teamConfig(["task011:alpha", "task011:beta"]), { source: "manual", now })
    insertRunSubSession(subSession(), { now })
    insertAgentDataExchange(dataExchangePackage(), { now, expiresAt: now + 60_000 })
    insertCapabilityDelegation(capabilityDelegation(), { now })

    await withApp(async (app) => {
      const graph = await app.inject({ method: "GET", url: "/api/orchestration/relationship-graph" })
      expect(graph.statusCode).toBe(200)
      expect(graph.json().graph.nodes.some((node: { nodeId: string }) => node.nodeId === "team:task011:team")).toBe(true)
      expect(graph.json().graph.edges.some((edge: { edgeId: string }) => edge.edgeId === "team_membership:task011:team:task011:alpha")).toBe(true)

      const subs = await app.inject({ method: "GET", url: "/api/orchestration/sub-sessions?parentRunId=run%3Atask011" })
      expect(subs.statusCode).toBe(200)
      expect(subs.json().items).toHaveLength(1)

      const exchanges = await app.inject({
        method: "GET",
        url: "/api/orchestration/data-exchanges?ownerType=sub_agent&ownerId=task011%3Abeta&allowedUse=verification_only&includeExpired=true",
      })
      expect(exchanges.statusCode).toBe(200)
      expect(exchanges.json().items[0].exchangeId).toBe("exchange:task011")

      const delegations = await app.inject({
        method: "GET",
        url: "/api/orchestration/capability-delegations?ownerType=sub_agent&ownerId=task011%3Aalpha&ownerRole=requester",
      })
      expect(delegations.statusCode).toBe(200)
      expect(delegations.json().items[0].delegationId).toBe("delegation:task011")

      expect(getTeamConfig("task011:team")).toBeTruthy()
      expect(getDb().prepare("SELECT COUNT(*) AS count FROM agent_team_memberships WHERE team_id = ?").get("task011:team")).toMatchObject({ count: 2 })
    })
  })
})
