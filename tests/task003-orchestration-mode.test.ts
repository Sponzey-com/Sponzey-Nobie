import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { OrchestrationConfig } from "../packages/core/src/config/index.js"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { createCapabilities } from "../packages/core/src/control-plane/index.ts"
import { closeDb } from "../packages/core/src/db/index.ts"
import {
  resolveOrchestrationModeSnapshot,
  resolveOrchestrationModeSnapshotSync,
  type OrchestrationModeSnapshot,
  type RegistryLoadResult,
} from "../packages/core/src/orchestration/mode.ts"
import { buildStartPlan } from "../packages/core/src/runs/start-plan.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const now = Date.UTC(2026, 3, 20, 0, 0, 0)

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task003-orchestration-mode-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = join(stateDir, "config.json5")
  reloadConfig()
}

function orchestrationConfig(overrides: Partial<OrchestrationConfig> = {}): OrchestrationConfig {
  return {
    maxDelegationTurns: 5,
    mode: "orchestration",
    featureFlagEnabled: true,
    subAgents: [],
    teams: [],
    ...overrides,
  }
}

function registryResult(overrides: Partial<RegistryLoadResult> = {}): RegistryLoadResult {
  return {
    activeSubAgents: [],
    totalSubAgentCount: 0,
    disabledSubAgentCount: 0,
    ...overrides,
  }
}

function singleNobieSnapshot(reasonCode: OrchestrationModeSnapshot["reasonCode"] = "feature_flag_off"): OrchestrationModeSnapshot {
  return {
    mode: "single_nobie",
    status: "ready",
    featureFlagEnabled: false,
    requestedMode: "orchestration",
    activeSubAgentCount: 0,
    totalSubAgentCount: 0,
    disabledSubAgentCount: 0,
    activeSubAgents: [],
    reasonCode,
    reason: "test single mode",
    generatedAt: now,
  }
}

function createStartPlanDependencies(overrides?: Partial<Parameters<typeof buildStartPlan>[1]>): Parameters<typeof buildStartPlan>[1] {
  return {
    analyzeRequestEntrySemantics: vi.fn(() => ({
      reuse_conversation_context: false,
      active_queue_cancellation_mode: null,
    })),
    isReusableRequestGroup: vi.fn(() => false),
    listActiveSessionRequestGroups: vi.fn(() => []),
    compareRequestContinuation: vi.fn(async () => ({
      kind: "new_run",
      decisionSource: "safe_fallback",
      reason: "not used",
    })),
    getRequestGroupDelegationTurnCount: vi.fn(() => 0),
    buildWorkerSessionId: vi.fn(() => undefined),
    normalizeTaskProfile: vi.fn((taskProfile) => taskProfile ?? "general_chat"),
    findLatestWorkerSessionRun: vi.fn(() => undefined),
    resolveOrchestrationMode: vi.fn(async () => singleNobieSnapshot()),
    ...overrides,
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

describe("task003 orchestration mode fallback", () => {
  it("does not touch the registry when the orchestration feature flag is off", async () => {
    const loadRegistry = vi.fn(() => registryResult({
      activeSubAgents: [{ agentId: "agent:unused", displayName: "Unused", source: "config" }],
      totalSubAgentCount: 1,
    }))

    const snapshot = await resolveOrchestrationModeSnapshot({
      getConfig: () => ({ orchestration: orchestrationConfig({ featureFlagEnabled: false }) }),
      loadRegistry,
      now: () => now,
    })

    expect(loadRegistry).not.toHaveBeenCalled()
    expect(snapshot.mode).toBe("single_nobie")
    expect(snapshot.status).toBe("ready")
    expect(snapshot.reasonCode).toBe("feature_flag_off")
  })

  it("does not touch the registry when requested mode is single_nobie", () => {
    const loadRegistry = vi.fn(() => registryResult())

    const snapshot = resolveOrchestrationModeSnapshotSync({
      getConfig: () => ({ orchestration: orchestrationConfig({ mode: "single_nobie", featureFlagEnabled: true }) }),
      loadRegistry,
      now: () => now,
    })

    expect(loadRegistry).not.toHaveBeenCalled()
    expect(snapshot.mode).toBe("single_nobie")
    expect(snapshot.reasonCode).toBe("mode_single_nobie")
  })

  it("uses single_nobie mode when no active sub-agent exists", async () => {
    const snapshot = await resolveOrchestrationModeSnapshot({
      getConfig: () => ({ orchestration: orchestrationConfig() }),
      loadRegistry: () => registryResult(),
      now: () => now,
    })

    expect(snapshot.mode).toBe("single_nobie")
    expect(snapshot.status).toBe("ready")
    expect(snapshot.reasonCode).toBe("no_active_sub_agents")
  })

  it("keeps disabled-only registries on the existing single Nobie path", async () => {
    const snapshot = await resolveOrchestrationModeSnapshot({
      getConfig: () => ({ orchestration: orchestrationConfig() }),
      loadRegistry: () => registryResult({ totalSubAgentCount: 1, disabledSubAgentCount: 1 }),
      now: () => now,
    })

    expect(snapshot.mode).toBe("single_nobie")
    expect(snapshot.totalSubAgentCount).toBe(1)
    expect(snapshot.disabledSubAgentCount).toBe(1)
    expect(snapshot.reasonCode).toBe("no_active_sub_agents")
  })

  it("switches to orchestration only when an active sub-agent is available", async () => {
    const snapshot = await resolveOrchestrationModeSnapshot({
      getConfig: () => ({ orchestration: orchestrationConfig() }),
      loadRegistry: () => registryResult({
        activeSubAgents: [{ agentId: "agent:researcher", displayName: "Researcher", source: "db" }],
        totalSubAgentCount: 1,
      }),
      now: () => now,
    })

    expect(snapshot.mode).toBe("orchestration")
    expect(snapshot.status).toBe("ready")
    expect(snapshot.reasonCode).toBe("orchestration_ready")
    expect(snapshot.activeSubAgentCount).toBe(1)
  })

  it("falls back to single_nobie with degraded diagnostics when registry loading fails", async () => {
    const snapshot = await resolveOrchestrationModeSnapshot({
      getConfig: () => ({ orchestration: orchestrationConfig() }),
      loadRegistry: () => {
        throw new Error("registry unavailable")
      },
      now: () => now,
    })

    expect(snapshot.mode).toBe("single_nobie")
    expect(snapshot.status).toBe("degraded")
    expect(snapshot.reasonCode).toBe("registry_load_failed")
    expect(snapshot.reason).toContain("registry unavailable")
  })

  it("falls back to single_nobie when registry loading exceeds the timeout budget", async () => {
    const snapshot = await resolveOrchestrationModeSnapshot({
      getConfig: () => ({ orchestration: orchestrationConfig() }),
      loadRegistry: () => new Promise<RegistryLoadResult>(() => {}),
      now: () => now,
      timeoutMs: 1,
    })

    expect(snapshot.mode).toBe("single_nobie")
    expect(snapshot.status).toBe("degraded")
    expect(snapshot.reasonCode).toBe("registry_load_timeout")
  })

  it("adds the resolved orchestration mode to the start plan without changing the existing root path", async () => {
    const dependencies = createStartPlanDependencies()
    const result = await buildStartPlan({
      message: "기존 단일 노비 경로로 처리해줘",
      sessionId: "session:task003",
      runId: "run:task003",
      source: "telegram",
    }, dependencies)

    expect(result.orchestrationMode).toBe("single_nobie")
    expect(result.orchestrationRegistrySnapshot.reasonCode).toBe("feature_flag_off")
    expect(result.requestGroupId).toBe("run:task003")
    expect(result.isRootRequest).toBe(true)
    expect(result.latencyEvents.some((event) => event.includes("orchestration_mode_latency_ms"))).toBe(true)
  })

  it("reports single_nobie as a normal implemented gateway capability by default", () => {
    const orchestrator = createCapabilities().find((capability) => capability.key === "gateway.orchestrator")

    expect(orchestrator).toBeDefined()
    expect(orchestrator?.implemented).toBe(true)
    expect(orchestrator?.enabled).toBe(false)
    expect(orchestrator?.status).toBe("ready")
    expect(orchestrator?.metadata?.mode).toBe("single_nobie")
    expect(orchestrator?.metadata?.reasonCode).toBe("mode_single_nobie")
  })
})
