import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerCapabilitiesRoute } from "../packages/core/src/api/routes/capabilities.js"
import { registerStatusRoute } from "../packages/core/src/api/routes/status.js"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import type {
  MemoryPolicy,
  PermissionProfile,
  SkillMcpAllowlist,
  SubAgentConfig,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import { reloadConfig, type OrchestrationConfig } from "../packages/core/src/config/index.js"
import { closeDb, upsertAgentConfig } from "../packages/core/src/db/index.js"
import {
  orchestrationCapabilityStatus,
  resolveOrchestrationModeSnapshotSync,
} from "../packages/core/src/orchestration/mode.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const now = Date.UTC(2026, 3, 23, 0, 0, 0)

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task001-orchestration-mode-"))
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

const allowlist: SkillMcpAllowlist = {
  enabledSkillIds: [],
  enabledMcpServerIds: [],
  enabledToolNames: [],
  disabledToolNames: [],
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

function orchestrationConfig(overrides: Partial<OrchestrationConfig> = {}): OrchestrationConfig {
  return {
    maxDelegationTurns: 5,
    mode: "single_nobie",
    featureFlagEnabled: false,
    subAgents: [],
    teams: [],
    ...overrides,
  }
}

function subAgent(input: {
  agentId: string
  status?: SubAgentConfig["status"]
  delegationEnabled?: boolean
}): SubAgentConfig {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    agentType: "sub_agent",
    agentId: input.agentId,
    displayName: input.agentId,
    nickname: input.agentId,
    status: input.status ?? "enabled",
    role: "worker",
    personality: "Precise",
    specialtyTags: ["general"],
    avoidTasks: [],
    memoryPolicy: memoryPolicy(input.agentId),
    capabilityPolicy: {
      permissionProfile,
      skillMcpAllowlist: allowlist,
      rateLimit: { maxConcurrentCalls: 1 },
    },
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
    teamIds: [],
    delegation: {
      enabled: input.delegationEnabled ?? true,
      maxParallelSessions: 1,
      retryBudget: 1,
    },
  }
}

describe("task001 orchestration mode baseline", () => {
  it("does not load the registry when the feature flag is off", () => {
    const snapshot = resolveOrchestrationModeSnapshotSync({
      getConfig: () => ({
        orchestration: orchestrationConfig({
          mode: "orchestration",
          featureFlagEnabled: false,
          subAgents: [subAgent({ agentId: "agent:ready" })],
        }),
      }),
      loadRegistry: () => {
        throw new Error("registry should not be loaded")
      },
      now: () => now,
    })

    expect(snapshot).toMatchObject({
      mode: "single_nobie",
      status: "ready",
      requestedMode: "orchestration",
      featureFlagEnabled: false,
      reasonCode: "feature_flag_off",
      activeSubAgentCount: 0,
    })
  })

  it("falls back to single_nobie and counts disabled DB agents when no active agent is available", () => {
    upsertAgentConfig(subAgent({ agentId: "agent:disabled", status: "disabled" }), { now })

    const snapshot = resolveOrchestrationModeSnapshotSync({
      getConfig: () => ({
        orchestration: orchestrationConfig({
          mode: "orchestration",
          featureFlagEnabled: true,
        }),
      }),
      now: () => now,
    })

    expect(snapshot).toMatchObject({
      mode: "single_nobie",
      status: "ready",
      reasonCode: "no_active_sub_agents",
      activeSubAgentCount: 0,
      totalSubAgentCount: 1,
      disabledSubAgentCount: 1,
    })
  })

  it("treats delegation-disabled DB agents as unavailable for orchestration", () => {
    upsertAgentConfig(subAgent({ agentId: "agent:no-delegation", delegationEnabled: false }), { now })

    const snapshot = resolveOrchestrationModeSnapshotSync({
      getConfig: () => ({
        orchestration: orchestrationConfig({
          mode: "orchestration",
          featureFlagEnabled: true,
        }),
      }),
      now: () => now,
    })

    expect(snapshot).toMatchObject({
      mode: "single_nobie",
      reasonCode: "no_active_sub_agents",
      totalSubAgentCount: 1,
      disabledSubAgentCount: 1,
    })
  })

  it("returns a degraded single_nobie snapshot when registry loading fails", () => {
    const snapshot = resolveOrchestrationModeSnapshotSync({
      getConfig: () => ({
        orchestration: orchestrationConfig({
          mode: "orchestration",
          featureFlagEnabled: true,
        }),
      }),
      loadRegistry: () => {
        throw new Error("boom")
      },
      now: () => now,
    })

    expect(snapshot).toMatchObject({
      mode: "single_nobie",
      status: "degraded",
      reasonCode: "registry_load_failed",
      activeSubAgentCount: 0,
    })
    expect(orchestrationCapabilityStatus(snapshot)).toEqual({ status: "error", enabled: false })
  })

  it("exposes the orchestration mode snapshot through status and capabilities APIs", async () => {
    const routes = new Map<string, () => unknown | Promise<unknown>>()
    const app = {
      get(path: string, _options: unknown, handler: () => unknown | Promise<unknown>) {
        routes.set(path, handler)
      },
    }
    registerStatusRoute(app as never)
    registerCapabilitiesRoute(app as never)

    const statusBody = await routes.get("/api/status")?.()
    expect(statusBody).toMatchObject({
      orchestration: {
        mode: "single_nobie",
        status: "ready",
        reasonCode: "mode_single_nobie",
      },
      orchestratorStatus: {
        mode: "single_nobie",
        reasonCode: "mode_single_nobie",
      },
    })

    const capabilitiesBody = await routes.get("/api/capabilities")?.() as {
      orchestration: unknown
      items: Array<{ key: string }>
    }
    expect(capabilitiesBody.orchestration).toMatchObject({
      mode: "single_nobie",
      status: "ready",
      reasonCode: "mode_single_nobie",
    })
    expect(capabilitiesBody.items.find((item) => item.key === "gateway.orchestrator")).toMatchObject({
      enabled: false,
      metadata: expect.objectContaining({
        mode: "single_nobie",
        reasonCode: "mode_single_nobie",
      }),
    })
  })
})
