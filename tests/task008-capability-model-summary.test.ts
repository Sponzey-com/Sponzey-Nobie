import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import {
  closeDb,
  listAgentCapabilityBindings,
  listMcpServerCatalogEntries,
  listSkillCatalogEntries,
  upsertAgentCapabilityBinding,
  upsertAgentConfig,
  upsertMcpServerCatalogEntry,
  upsertSkillCatalogEntry,
} from "../packages/core/src/db/index.js"
import {
  CONTRACT_SCHEMA_VERSION,
  type MemoryPolicy,
  type ModelProfile,
  type PermissionProfile,
  type RuntimeIdentity,
  type SkillMcpAllowlist,
  type SubAgentConfig,
} from "../packages/core/src/index.ts"
import { resolveAgentCapabilityModelSummary } from "../packages/core/src/orchestration/capability-model.js"
import { buildOrchestrationRegistrySnapshot } from "../packages/core/src/orchestration/registry.js"

const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG
const now = Date.UTC(2026, 3, 24, 0, 0, 0)

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task008-capability-model-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
}

function owner(
  ownerType: RuntimeIdentity["owner"]["ownerType"] = "sub_agent",
  ownerId = "agent:alpha",
): RuntimeIdentity["owner"] {
  return { ownerType, ownerId }
}

const safePermissionProfile: PermissionProfile = {
  profileId: "profile:safe",
  riskCeiling: "moderate",
  approvalRequiredFrom: "moderate",
  allowExternalNetwork: true,
  allowFilesystemWrite: false,
  allowShellExecution: false,
  allowScreenControl: false,
  allowedPaths: [],
}

const allowlist: SkillMcpAllowlist = {
  enabledSkillIds: ["skill:research"],
  enabledMcpServerIds: ["mcp:browser"],
  enabledToolNames: ["web_search"],
  disabledToolNames: [],
  secretScopeId: "scope:alpha",
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

function modelProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    providerId: "openai",
    modelId: "gpt-5.4",
    timeoutMs: 30_000,
    retryCount: 2,
    costBudget: 5,
    fallbackModelId: "gpt-5.4-mini",
    ...overrides,
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
    modelProfile: modelProfile(),
    memoryPolicy: memoryPolicy(agentId),
    capabilityPolicy: {
      permissionProfile: safePermissionProfile,
      skillMcpAllowlist: {
        ...allowlist,
        secretScopeId: `scope:${agentId}`,
      },
      rateLimit: { maxConcurrentCalls: 2, maxCallsPerMinute: 30 },
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

describe("task008 capability and model summaries", () => {
  it("stores common skill and MCP catalogs separately from agent binding ids", () => {
    upsertSkillCatalogEntry(
      {
        skillId: "skill:research",
        displayName: "Research",
        risk: "external",
        toolNames: ["web_search"],
        metadata: { apiKey: "sk-raw-secret-never-expose" },
      },
      { now },
    )
    upsertMcpServerCatalogEntry(
      {
        mcpServerId: "mcp:browser",
        displayName: "Browser MCP",
        risk: "external",
        toolNames: ["mcp__browser__search"],
        metadata: { token: "sk-mcp-secret-never-expose" },
      },
      { now },
    )
    const agent = subAgentConfig("agent:alpha", "Alpha")
    upsertAgentConfig(agent, { source: "manual", now })
    upsertAgentCapabilityBinding(
      {
        bindingId: "binding:alpha:research",
        agentId: "agent:alpha",
        capabilityKind: "skill",
        catalogId: "skill:research",
        enabledToolNames: ["web_search"],
        secretScopeId: "scope:alpha:research",
      },
      { now },
    )
    upsertAgentCapabilityBinding(
      {
        bindingId: "binding:alpha:browser",
        agentId: "agent:alpha",
        capabilityKind: "mcp_server",
        catalogId: "mcp:browser",
        enabledToolNames: ["mcp__browser__search"],
        secretScopeId: "scope:alpha:browser",
      },
      { now },
    )

    expect(listSkillCatalogEntries({ includeArchived: true })).toHaveLength(1)
    expect(listMcpServerCatalogEntries({ includeArchived: true })).toHaveLength(1)
    expect(
      listAgentCapabilityBindings({ agentId: "agent:alpha", includeArchived: true }),
    ).toHaveLength(2)

    const snapshot = buildOrchestrationRegistrySnapshot({
      getConfig: emptyRegistryConfig,
      now: () => now,
    })
    const entry = snapshot.agents.find((candidate) => candidate.agentId === "agent:alpha")
    expect(entry?.capabilitySummary.skillBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bindingId: "binding:alpha:research",
          catalogId: "skill:research",
          available: true,
        }),
      ]),
    )
    expect(entry?.capabilitySummary.mcpServerBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bindingId: "binding:alpha:browser",
          catalogId: "mcp:browser",
          available: true,
        }),
      ]),
    )
    expect(entry?.skillMcpSummary.enabledToolNames).toEqual(
      expect.arrayContaining(["web_search", "mcp__browser__search"]),
    )
    expect(JSON.stringify(entry?.capabilitySummary)).not.toContain("sk-raw-secret")
    expect(JSON.stringify(entry?.capabilitySummary)).not.toContain("sk-mcp-secret")
  })

  it("keeps agent-scoped binding changes isolated between agents", () => {
    upsertSkillCatalogEntry(
      {
        skillId: "skill:research",
        displayName: "Research",
        risk: "safe",
        toolNames: ["web_search"],
      },
      { now },
    )
    upsertAgentConfig(subAgentConfig("agent:alpha", "Alpha"), { source: "manual", now })
    upsertAgentConfig(
      subAgentConfig("agent:beta", "Beta", {
        capabilityPolicy: {
          permissionProfile: safePermissionProfile,
          skillMcpAllowlist: {
            ...allowlist,
            secretScopeId: "scope:beta",
          },
          rateLimit: { maxConcurrentCalls: 1 },
        },
      }),
      { source: "manual", now },
    )
    upsertAgentCapabilityBinding(
      {
        agentId: "agent:alpha",
        capabilityKind: "skill",
        catalogId: "skill:research",
        status: "enabled",
      },
      { now },
    )
    upsertAgentCapabilityBinding(
      {
        agentId: "agent:beta",
        capabilityKind: "skill",
        catalogId: "skill:research",
        status: "disabled",
      },
      { now },
    )

    const snapshot = buildOrchestrationRegistrySnapshot({
      getConfig: emptyRegistryConfig,
      now: () => now,
    })
    const alpha = snapshot.agents.find((candidate) => candidate.agentId === "agent:alpha")
    const beta = snapshot.agents.find((candidate) => candidate.agentId === "agent:beta")
    expect(alpha?.capabilitySummary.enabledSkillIds).toContain("skill:research")
    expect(alpha?.capabilitySummary.diagnosticReasonCodes).not.toContain(
      "capability_binding_disabled",
    )
    expect(beta?.capabilitySummary.disabledSkillIds).toContain("skill:research")
    expect(beta?.capabilitySummary.diagnosticReasonCodes).toContain("capability_binding_disabled")
  })

  it("reflects common catalog disabled state in related binding summaries", () => {
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
    upsertMcpServerCatalogEntry(
      {
        mcpServerId: "mcp:browser",
        displayName: "Browser MCP",
        status: "disabled",
        risk: "external",
        toolNames: ["mcp__browser__search"],
      },
      { now },
    )
    upsertAgentConfig(subAgentConfig("agent:alpha", "Alpha"), { source: "manual", now })

    const snapshot = buildOrchestrationRegistrySnapshot({
      getConfig: emptyRegistryConfig,
      now: () => now,
    })
    const alpha = snapshot.agents.find((candidate) => candidate.agentId === "agent:alpha")
    expect(alpha?.capabilitySummary.disabledSkillIds).toEqual(["skill:research"])
    expect(alpha?.capabilitySummary.disabledMcpServerIds).toEqual(["mcp:browser"])
    expect(alpha?.capabilitySummary.diagnosticReasonCodes).toEqual(
      expect.arrayContaining(["skill_catalog_disabled", "mcp_server_catalog_disabled"]),
    )
    expect(alpha?.skillMcpSummary.enabledToolNames).not.toContain("mcp__browser__search")
  })

  it("summarizes model availability and degraded fallback cost policy", () => {
    const healthy = resolveAgentCapabilityModelSummary(subAgentConfig("agent:healthy", "Healthy"))
    const missing = resolveAgentCapabilityModelSummary(
      subAgentConfig("agent:missing", "Missing", {
        modelProfile: undefined,
      }),
    )
    const fallbackWithoutBudget = resolveAgentCapabilityModelSummary(
      subAgentConfig("agent:fallback", "Fallback", {
        modelProfile: modelProfile({ fallbackModelId: "gpt-5.4-mini", costBudget: undefined }),
      }),
    )

    expect(healthy.modelSummary.availability).toBe("available")
    expect(missing.modelSummary.availability).toBe("unavailable")
    expect(missing.modelSummary.diagnosticReasonCodes).toContain("model_profile_missing")
    expect(fallbackWithoutBudget.modelSummary.availability).toBe("degraded")
    expect(fallbackWithoutBudget.modelSummary.diagnosticReasonCodes).toContain(
      "model_fallback_cost_budget_missing",
    )
  })

  it("stabilizes capability and model diagnostic reason codes for team coverage recalculation", () => {
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
    const agent = subAgentConfig("agent:alpha", "Alpha", {
      modelProfile: undefined,
      capabilityPolicy: {
        permissionProfile: safePermissionProfile,
        skillMcpAllowlist: {
          enabledSkillIds: ["skill:research"],
          enabledMcpServerIds: ["mcp:browser"],
          enabledToolNames: [],
          disabledToolNames: [],
        },
        rateLimit: { maxConcurrentCalls: 1 },
      },
    })
    upsertAgentConfig(agent, { source: "manual", now })

    const snapshot = buildOrchestrationRegistrySnapshot({
      getConfig: emptyRegistryConfig,
      now: () => now,
    })
    const alpha = snapshot.agents.find((candidate) => candidate.agentId === "agent:alpha")
    expect(alpha?.degradedReasonCodes).toEqual(
      expect.arrayContaining([
        "skill_catalog_disabled",
        "mcp_secret_scope_missing",
        "model_provider_unknown",
        "model_id_unknown",
      ]),
    )
    expect(snapshot.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "skill_catalog_disabled",
        "mcp_secret_scope_missing",
        "model_provider_unknown",
        "model_id_unknown",
      ]),
    )
  })
})
