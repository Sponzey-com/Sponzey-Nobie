import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PATHS, reloadConfig } from "../packages/core/src/config/index.js"
import { dryRunDatabaseMigrations, getDatabaseMigrationStatus } from "../packages/core/src/config/operations.ts"
import {
  closeDb,
  disableAgentConfig,
  getAgentConfig,
  getAgentDataExchange,
  getCapabilityDelegation,
  getDb,
  getSession,
  getRunSubSessionByIdempotencyKey,
  getTeamConfig,
  insertAuditLog,
  insertAgentDataExchange,
  insertCapabilityDelegation,
  insertLearningEvent,
  insertProfileHistoryVersion,
  insertProfileRestoreEvent,
  insertRunSubSession,
  insertSession,
  listAgentConfigs,
  listAgentTeamMemberships,
  listLearningEvents,
  listProfileHistoryVersions,
  listProfileRestoreEvents,
  storeMemoryDocument,
  subAgentStorageSchemaVersion,
  upsertAgentConfig,
  upsertTeamConfig,
} from "../packages/core/src/db/index.ts"
import { MIGRATIONS } from "../packages/core/src/db/migrations.ts"
import {
  CONTRACT_SCHEMA_VERSION,
  type CapabilityDelegationRequest,
  type DataExchangePackage,
  type HistoryVersion,
  type LearningEvent,
  type MemoryPolicy,
  type PermissionProfile,
  type RestoreEvent,
  type RuntimeIdentity,
  type SkillMcpAllowlist,
  type SubAgentConfig,
  type SubSessionContract,
  type TeamConfig,
} from "../packages/core/src/index.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const now = Date.UTC(2026, 3, 20, 0, 0, 0)

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task002-sub-agent-storage-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = join(stateDir, "config.json5")
  reloadConfig()
}

function owner(ownerId = "agent:nobie"): RuntimeIdentity["owner"] {
  return { ownerType: "nobie", ownerId }
}

function identity(entityType: RuntimeIdentity["entityType"], entityId: string): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType,
    entityId,
    owner: owner(),
    idempotencyKey: `idempotency:${entityType}:${entityId}`,
    auditCorrelationId: `audit:${entityId}`,
    parent: {
      parentRunId: "run-parent",
      parentRequestId: "request-parent",
    },
  }
}

const allowlist: SkillMcpAllowlist = {
  enabledSkillIds: ["research"],
  enabledMcpServerIds: ["browser"],
  enabledToolNames: ["web_search"],
  disabledToolNames: ["shell_exec"],
  secretScopeId: "agent:researcher",
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

const memoryPolicy: MemoryPolicy = {
  owner: { ownerType: "sub_agent", ownerId: "agent:researcher" },
  visibility: "private",
  readScopes: [{ ownerType: "sub_agent", ownerId: "agent:researcher" }],
  writeScope: { ownerType: "sub_agent", ownerId: "agent:researcher" },
  retentionPolicy: "long_term",
  writebackReviewRequired: true,
}

function subAgentConfig(status: SubAgentConfig["status"] = "enabled"): SubAgentConfig {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    agentType: "sub_agent",
    agentId: "agent:researcher",
    displayName: "Researcher",
    nickname: "Researcher",
    status,
    role: "research worker",
    personality: "Precise and evidence first",
    specialtyTags: ["research"],
    avoidTasks: ["shell execution"],
    memoryPolicy,
    capabilityPolicy: {
      permissionProfile,
      skillMcpAllowlist: allowlist,
      rateLimit: { maxConcurrentCalls: 2 },
    },
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
    teamIds: ["team:research"],
    delegation: {
      enabled: true,
      maxParallelSessions: 2,
      retryBudget: 2,
    },
  }
}

function teamConfig(memberAgentIds = ["agent:researcher"]): TeamConfig {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    teamId: "team:research",
    displayName: "Research Team",
    nickname: "Research",
    status: "enabled",
    purpose: "Research and evidence collection",
    memberAgentIds,
    roleHints: ["lead researcher"],
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
  }
}

function subSession(): SubSessionContract {
  return {
    identity: identity("sub_session", "sub-session:1"),
    subSessionId: "sub-session:1",
    parentSessionId: "session:parent",
    parentRunId: "run-parent",
    agentId: "agent:researcher",
    agentDisplayName: "Researcher",
    agentNickname: "Researcher",
    commandRequestId: "command:1",
    status: "queued",
    retryBudgetRemaining: 2,
    promptBundleId: "bundle:1",
  }
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

describe("task002 sub-agent storage", () => {
  it("creates storage tables and reports the latest migration version", () => {
    const db = getDb()
    const requiredTables = [
      "agent_configs",
      "team_configs",
      "agent_team_memberships",
      "run_subsessions",
      "agent_data_exchanges",
      "capability_delegations",
      "learning_events",
      "profile_history_versions",
      "profile_restore_events",
    ]
    const existingTables = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name)

    expect(requiredTables.every((table) => existingTables.includes(table))).toBe(true)
    expect(subAgentStorageSchemaVersion()).toBe(CONTRACT_SCHEMA_VERSION)
    expect(getDatabaseMigrationStatus().currentVersion).toBe(MIGRATIONS[MIGRATIONS.length - 1]?.version)
  })

  it("keeps existing session, audit, and memory storage usable after the migration", () => {
    insertSession({
      id: "session:existing",
      source: "telegram",
      source_id: "chat:1",
      created_at: now,
      updated_at: now,
      summary: "existing session",
    })
    insertAuditLog({
      timestamp: now,
      session_id: "session:existing",
      source: "test",
      tool_name: "storage_check",
      params: null,
      output: null,
      result: "ok",
      duration_ms: 1,
      approval_required: 0,
      approved_by: null,
    })
    const memory = storeMemoryDocument({
      scope: "long-term",
      ownerId: "agent:nobie",
      sourceType: "test",
      sourceRef: "task002",
      title: "Existing memory",
      rawText: "Existing memory content",
      checksum: "sha256:existing-memory",
      chunks: [{
        ordinal: 0,
        tokenEstimate: 3,
        content: "Existing memory content",
        checksum: "sha256:existing-memory-chunk",
      }],
    })

    expect(getSession("session:existing")?.summary).toBe("existing session")
    expect(getDb().prepare<[], { count: number }>("SELECT COUNT(*) AS count FROM audit_logs").get()?.count).toBe(1)
    expect(memory.documentId).toBeTruthy()
  })

  it("stores imported agents and teams as disabled by default, then supports enable and disable updates", () => {
    upsertAgentConfig(subAgentConfig(), { imported: true, idempotencyKey: "import:agent:researcher", now })
    expect(getAgentConfig("agent:researcher")?.status).toBe("disabled")
    expect(listAgentConfigs({ enabledOnly: true })).toHaveLength(0)

    upsertAgentConfig(subAgentConfig("enabled"), { source: "manual", now: now + 1 })
    expect(getAgentConfig("agent:researcher")?.status).toBe("enabled")
    expect(listAgentConfigs({ enabledOnly: true }).map((agent) => agent.agent_id)).toContain("agent:researcher")

    expect(disableAgentConfig("agent:researcher", now + 2)).toBe(true)
    expect(getAgentConfig("agent:researcher")?.status).toBe("disabled")

    upsertTeamConfig(teamConfig(), { imported: true, idempotencyKey: "import:team:research", now })
    expect(getTeamConfig("team:research")?.status).toBe("disabled")
  })

  it("marks team memberships active or unresolved without deleting prior membership rows", () => {
    upsertTeamConfig(teamConfig(["agent:missing"]), { now })
    expect(listAgentTeamMemberships("team:research")).toMatchObject([
      { agent_id: "agent:missing", status: "unresolved" },
    ])

    upsertAgentConfig(subAgentConfig(), { now: now + 1 })
    upsertTeamConfig(teamConfig(["agent:researcher"]), { now: now + 2 })
    expect(listAgentTeamMemberships("team:research")).toEqual(expect.arrayContaining([
      expect.objectContaining({ agent_id: "agent:missing", status: "removed" }),
      expect.objectContaining({ agent_id: "agent:researcher", status: "active" }),
    ]))
  })

  it("persists sub-session, data exchange, capability delegation, and learning events with idempotency", () => {
    const session = subSession()
    expect(insertRunSubSession(session, { now })).toBe(true)
    expect(insertRunSubSession(session, { now })).toBe(false)
    expect(getRunSubSessionByIdempotencyKey(session.identity.idempotencyKey)).toMatchObject({
      sub_session_id: "sub-session:1",
      agent_display_name: "Researcher",
    })

    const exchange: DataExchangePackage = {
      identity: identity("data_exchange", "exchange:1"),
      exchangeId: "exchange:1",
      sourceOwner: { ownerType: "nobie", ownerId: "agent:nobie" },
      recipientOwner: { ownerType: "sub_agent", ownerId: "agent:researcher" },
      purpose: "verification context",
      allowedUse: "verification_only",
      retentionPolicy: "session_only",
      redactionState: "redacted",
      provenanceRefs: ["audit:source"],
      payload: { summary: "redacted context" },
      createdAt: now,
    }
    expect(insertAgentDataExchange(exchange, { expiresAt: now + 1_000 })).toBe(true)
    expect(insertAgentDataExchange(exchange, { expiresAt: now + 1_000 })).toBe(false)
    expect(getAgentDataExchange("exchange:1")?.expires_at).toBe(now + 1_000)

    const delegation: CapabilityDelegationRequest = {
      identity: identity("capability", "delegation:1"),
      delegationId: "delegation:1",
      requester: { ownerType: "nobie", ownerId: "agent:nobie" },
      provider: { ownerType: "sub_agent", ownerId: "agent:researcher" },
      capability: "web_search",
      risk: "safe",
      inputPackageIds: ["exchange:1"],
      status: "requested",
    }
    expect(insertCapabilityDelegation(delegation, { now })).toBe(true)
    expect(getCapabilityDelegation("delegation:1")?.capability).toBe("web_search")

    const learningEvent: LearningEvent = {
      identity: identity("sub_agent", "learning:1"),
      learningEventId: "learning:1",
      agentId: "agent:researcher",
      learningTarget: "role",
      beforeSummary: "generic research worker",
      afterSummary: "market data worker",
      evidenceRefs: ["result:1"],
      confidence: 0.8,
      approvalState: "pending_review",
    }
    expect(insertLearningEvent(learningEvent, { now })).toBe(true)
    expect(listLearningEvents("agent:researcher")).toHaveLength(1)
  })

  it("keeps profile history append-only and records restore events instead of overwriting history", () => {
    const history1: HistoryVersion = {
      identity: identity("sub_agent", "history:1"),
      historyVersionId: "history:1",
      targetEntityType: "agent",
      targetEntityId: "agent:researcher",
      version: 1,
      before: { role: "research" },
      after: { role: "market research" },
      reasonCode: "learning_update",
      createdAt: now,
    }
    const history2: HistoryVersion = {
      ...history1,
      identity: identity("sub_agent", "history:2"),
      historyVersionId: "history:2",
      version: 2,
      before: { role: "market research" },
      after: { role: "financial data research" },
      createdAt: now + 1,
    }
    expect(insertProfileHistoryVersion(history1)).toBe(true)
    expect(insertProfileHistoryVersion(history2)).toBe(true)
    expect(insertProfileHistoryVersion(history2)).toBe(false)
    expect(listProfileHistoryVersions("agent", "agent:researcher").map((row) => row.version)).toEqual([1, 2])

    const restore: RestoreEvent = {
      identity: identity("sub_agent", "restore:1"),
      restoreEventId: "restore:1",
      targetEntityType: "agent",
      targetEntityId: "agent:researcher",
      restoredHistoryVersionId: "history:1",
      dryRun: true,
      effectSummary: ["Would restore role to market research."],
      createdAt: now + 2,
    }
    expect(insertProfileRestoreEvent(restore)).toBe(true)
    expect(listProfileHistoryVersions("agent", "agent:researcher")).toHaveLength(2)
    expect(listProfileRestoreEvents("agent", "agent:researcher")).toMatchObject([
      { restore_event_id: "restore:1", dry_run: 1 },
    ])
  })

  it("dry-runs the sub-agent storage migration without mutating schema_migrations", () => {
    getDb().prepare("DELETE FROM schema_migrations WHERE version = ?").run(35)
    const before = getDb().prepare("SELECT version FROM schema_migrations ORDER BY version").all()
    const dryRun = dryRunDatabaseMigrations(PATHS.dbFile)
    const after = getDb().prepare("SELECT version FROM schema_migrations ORDER BY version").all()

    expect(dryRun.changesDatabase).toBe(false)
    expect(dryRun.willApply.map((migration) => migration.version)).toContain(35)
    expect(after).toEqual(before)
  })
})
