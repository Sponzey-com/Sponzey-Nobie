import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resolveWebUiLiveUpdateAck } from "../packages/core/src/api/ws/stream.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import type {
  AgentPromptBundle,
  CommandRequest,
  ExpectedOutputContract,
  MemoryPolicy,
  PermissionProfile,
  RuntimeIdentity,
  SkillMcpAllowlist,
  StructuredTaskScope,
  SubSessionContract,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import { closeDb, getDb } from "../packages/core/src/db/index.ts"
import { ensurePromptSourceFiles } from "../packages/core/src/memory/nobie-md.ts"
import {
  listLatencyMetrics,
  recordLatencyMetric,
  resetLatencyMetrics,
} from "../packages/core/src/observability/latency.js"
import {
  type RunSubSessionInput,
  SubSessionRunner,
  type SubSessionRuntimeDependencies,
  createTextResultReport,
  runParallelSubSessionGroup,
} from "../packages/core/src/orchestration/sub-session-runner.ts"
import {
  buildReleaseManifest,
  buildReleaseOrchestrationEvidence,
  buildReleasePipelinePlan,
  buildReleaseRollbackRunbook,
} from "../packages/core/src/release/package.ts"
import { buildReleasePerformanceSummary } from "../packages/core/src/release/performance-gate.ts"
import { buildStartPlan } from "../packages/core/src/runs/start-plan.ts"
import {
  listFeatureFlags,
  setFeatureFlagMode,
} from "../packages/core/src/runtime/rollout-safety.ts"
import { acknowledgeLiveUpdateMessage } from "../packages/webui/src/api/ws.ts"

const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function writeFile(rootDir: string, relativePath: string, content: string): void {
  const filePath = join(rootDir, ...relativePath.split("/"))
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, "utf-8")
}

function createReleaseFixture(): string {
  const rootDir = makeTempDir("nobie-task014-release-root-")
  writeFile(rootDir, "package.json", JSON.stringify({ version: "9.9.9" }))
  writeFile(rootDir, "packages/cli/dist/index.js", "#!/usr/bin/env node\nconsole.log('cli')\n")
  writeFile(rootDir, "packages/core/dist/index.js", "export const core = true\n")
  writeFile(rootDir, "packages/webui/dist/index.html", "<html></html>\n")
  writeFile(rootDir, "packages/core/src/db/migrations.ts", "export const MIGRATIONS = []\n")
  writeFile(rootDir, "Yeonjang/src/protocol.rs", "pub struct Request;\n")
  writeFile(rootDir, "Yeonjang/manifests/permissions.json", "{}\n")
  writeFile(rootDir, "scripts/build-yeonjang-macos.sh", "#!/usr/bin/env bash\n")
  writeFile(rootDir, "scripts/start-yeonjang-macos.sh", "#!/usr/bin/env bash\n")
  writeFile(rootDir, "scripts/build-yeonjang-windows.bat", "@echo off\n")
  writeFile(rootDir, "scripts/start-yeonjang-windows.bat", "@echo off\n")
  writeFile(rootDir, "scripts/stop-yeonjang-windows.bat", "@echo off\n")
  writeFile(rootDir, "docs/release-runbook.md", "# Release Runbook\n")
  ensurePromptSourceFiles(rootDir)
  return rootDir
}

const expectedOutput: ExpectedOutputContract = {
  outputId: "answer",
  kind: "text",
  description: "Answer returned to Nobie review.",
  required: true,
  acceptance: {
    requiredEvidenceKinds: [],
    artifactRequired: false,
    reasonCodes: ["reviewable_result"],
  },
}

const taskScope: StructuredTaskScope = {
  goal: "Collect a small result for parent review.",
  intentType: "runtime_test",
  actionType: "sub_session_runtime",
  constraints: ["Do not deliver directly to the user."],
  expectedOutputs: [expectedOutput],
  reasonCodes: ["runtime_test"],
}

const allowlist: SkillMcpAllowlist = {
  enabledSkillIds: ["research"],
  enabledMcpServerIds: ["browser"],
  enabledToolNames: ["web_search"],
  disabledToolNames: ["shell_exec"],
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
  retentionPolicy: "short_term",
  writebackReviewRequired: true,
}

const modelProfile = {
  providerId: "openai",
  modelId: "gpt-5.4-mini",
  effort: "low",
  maxOutputTokens: 512,
  timeoutMs: 1000,
  retryCount: 0,
  costBudget: 1,
}

function identity(
  entityType: RuntimeIdentity["entityType"],
  entityId: string,
  idempotencyKey = `idem:${entityId}`,
): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType,
    entityId,
    owner: { ownerType: "sub_agent", ownerId: "agent:researcher" },
    idempotencyKey,
    auditCorrelationId: `audit:${entityId}`,
    parent: {
      parentRunId: "run-parent",
      parentRequestId: "request-parent",
    },
  }
}

function promptBundle(bundleId = "prompt-bundle:researcher"): AgentPromptBundle {
  return {
    identity: identity("sub_session", bundleId, `idem:${bundleId}`),
    bundleId,
    agentId: "agent:researcher",
    agentType: "sub_agent",
    role: "research worker",
    displayNameSnapshot: "Researcher",
    nicknameSnapshot: "Res",
    personalitySnapshot: "Precise",
    teamContext: [],
    memoryPolicy,
    capabilityPolicy: {
      permissionProfile,
      skillMcpAllowlist: allowlist,
      rateLimit: { maxConcurrentCalls: 2 },
    },
    modelProfileSnapshot: modelProfile,
    taskScope,
    safetyRules: ["Do not deliver sub-session results directly to the user."],
    sourceProvenance: [{ sourceId: "profile:agent:researcher", version: "1" }],
    createdAt: Date.UTC(2026, 3, 20, 0, 0, 0),
  }
}

function command(id: string, retryBudget = 2): CommandRequest {
  return {
    identity: identity("sub_session", id, `idem:${id}`),
    commandRequestId: `command:${id}`,
    parentRunId: "run-parent",
    subSessionId: `sub:${id}`,
    targetAgentId: "agent:researcher",
    taskScope,
    contextPackageIds: [],
    expectedOutputs: [expectedOutput],
    retryBudget,
  }
}

function runInput(id: string): RunSubSessionInput {
  return {
    command: command(id),
    agent: {
      agentId: "agent:researcher",
      displayName: "Researcher",
      nickname: "Res",
    },
    parentSessionId: "session-parent",
    promptBundle: promptBundle(),
  }
}

function makeRuntimeDependencies() {
  const sessions = new Map<string, SubSessionContract>()
  let time = Date.UTC(2026, 3, 20, 0, 0, 0)
  const clone = <T>(value: T): T => structuredClone(value)
  const dependencies: SubSessionRuntimeDependencies = {
    now: () => {
      time += 100
      return time
    },
    idProvider: () => {
      time += 1
      return `id-${time}`
    },
    loadSubSessionByIdempotencyKey: (idempotencyKey) =>
      clone(
        [...sessions.values()].find(
          (session) => session.identity.idempotencyKey === idempotencyKey,
        ),
      ),
    persistSubSession: (subSession) => {
      sessions.set(subSession.subSessionId, clone(subSession))
      return true
    },
    updateSubSession: (subSession) => {
      sessions.set(subSession.subSessionId, clone(subSession))
    },
    appendParentEvent: () => undefined,
    isParentCancelled: () => false,
  }
  return { dependencies, sessions }
}

beforeEach(() => {
  closeDb()
  resetLatencyMetrics()
  const stateDir = makeTempDir("nobie-task014-state-")
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
  getDb()
})

afterEach(() => {
  closeDb()
  resetLatencyMetrics()
  if (previousStateDir === undefined) Reflect.deleteProperty(process.env, "NOBIE_STATE_DIR")
  else process.env.NOBIE_STATE_DIR = previousStateDir
  if (previousConfig === undefined) Reflect.deleteProperty(process.env, "NOBIE_CONFIG")
  else process.env.NOBIE_CONFIG = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("task014 release readiness", () => {
  it("summarizes release-window latency targets and records missing metrics as warnings", () => {
    recordLatencyMetric({ name: "ingress_ack_latency_ms", durationMs: 220, createdAt: 10 })
    recordLatencyMetric({ name: "registry_lookup_latency_ms", durationMs: 310, createdAt: 20 })
    recordLatencyMetric({
      name: "orchestration_planning_latency_ms",
      durationMs: 1_400,
      createdAt: 30,
    })
    recordLatencyMetric({ name: "first_progress_latency_ms", durationMs: 2_200, createdAt: 40 })

    const summary = buildReleasePerformanceSummary({
      now: new Date(45),
      windowMs: 100,
      deliveryDedupeCount: 3,
      concurrencyBlockedCount: 2,
    })

    expect(summary.kind).toBe("nobie.release.performance")
    expect(summary.counters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "delivery_dedupe_count", count: 3 }),
        expect.objectContaining({ id: "concurrency_blocked_count", count: 2 }),
      ]),
    )
    expect(summary.metrics.find((metric) => metric.targetId === "intake_latency")?.status).toBe(
      "ok",
    )
    expect(
      summary.metrics.find((metric) => metric.targetId === "registry_lookup_latency")?.status,
    ).toBe("ok")
    expect(summary.missingRequiredMetrics).toContain("approval_aggregation_latency")
    expect(summary.gateStatus).toBe("warning")
  })

  it("includes approval aggregation and resource lock wait evidence in the release summary when the runtime collected them", () => {
    recordLatencyMetric({
      name: "approval_aggregation_latency_ms",
      durationMs: 450,
      createdAt: 10,
      runId: "run-approval",
    })
    recordLatencyMetric({
      name: "resource_lock_wait_ms",
      durationMs: 400,
      createdAt: 20,
      runId: "run-parent",
    })

    const summary = buildReleasePerformanceSummary({
      now: new Date(30),
      windowMs: 100,
    })

    expect(
      summary.metrics.find((metric) => metric.targetId === "approval_aggregation_latency"),
    ).toMatchObject({
      status: "ok",
      count: 1,
      p95Ms: 450,
    })
    expect(
      summary.metrics.find((metric) => metric.targetId === "resource_lock_wait"),
    ).toMatchObject({
      status: "ok",
      count: 1,
      p95Ms: 400,
    })
    expect(summary.missingRequiredMetrics).not.toContain("approval_aggregation_latency")
    expect(summary.missingRequiredMetrics).not.toContain("resource_lock_wait")
  })

  it("records WebUI live update latency from stamped websocket events and includes it in the release summary", () => {
    const outboundAcks: unknown[] = []

    acknowledgeLiveUpdateMessage(
      {
        type: "run.progress",
        emittedAt: 1_000,
        runId: "run-webui",
        sessionId: "session-webui",
        requestGroupId: "group-webui",
      },
      (payload) => outboundAcks.push(payload),
    )

    expect(outboundAcks).toEqual([
      {
        type: "ui.live_update_ack",
        eventType: "run.progress",
        emittedAt: 1_000,
        runId: "run-webui",
        sessionId: "session-webui",
        requestGroupId: "group-webui",
        source: "webui",
      },
    ])
    expect(
      resolveWebUiLiveUpdateAck(
        outboundAcks[0] as {
          type: string
          eventType: string
          emittedAt: number
          runId: string
          sessionId: string
          requestGroupId: string
          source: string
        },
        () => 1_650,
      ),
    ).toBe(true)

    expect(listLatencyMetrics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "webui_live_update_latency_ms",
          durationMs: 650,
          runId: "run-webui",
          sessionId: "session-webui",
          requestGroupId: "group-webui",
          source: "webui",
          detail: expect.objectContaining({ eventType: "run.progress" }),
        }),
      ]),
    )

    const summary = buildReleasePerformanceSummary({
      now: new Date(1_700),
      windowMs: 1_000,
    })

    expect(
      summary.metrics.find((metric) => metric.targetId === "webui_live_update_latency"),
    ).toMatchObject({
      status: "ok",
      count: 1,
      p95Ms: 650,
    })
    expect(summary.missingRequiredMetrics).not.toContain("webui_live_update_latency")
  })

  it("includes orchestration flag defaults, performance evidence, release notes, and admin diagnostics artifact in the release manifest", () => {
    const rootDir = createReleaseFixture()
    setFeatureFlagMode({
      featureKey: "sub_agent_orchestration",
      mode: "off",
      updatedBy: "task014",
      reason: "single nobie is the safe default",
    })
    recordLatencyMetric({
      name: "ingress_ack_latency_ms",
      durationMs: 180,
      createdAt: Date.UTC(2026, 3, 20, 0, 0, 0),
    })
    recordLatencyMetric({
      name: "registry_lookup_latency_ms",
      durationMs: 120,
      createdAt: Date.UTC(2026, 3, 20, 0, 0, 1),
    })

    const manifest = buildReleaseManifest({
      rootDir,
      releaseVersion: "v-task014",
      gitTag: "v-task014",
      gitCommit: "task014abc",
      targetPlatforms: ["macos", "windows"],
      now: new Date("2026-04-20T00:00:05.000Z"),
    })

    expect(listFeatureFlags().some((flag) => flag.featureKey === "sub_agent_orchestration")).toBe(
      true,
    )
    expect(manifest.featureFlags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ featureKey: "sub_agent_orchestration", mode: "off" }),
      ]),
    )
    expect(manifest.performanceEvidence.kind).toBe("nobie.release.performance")
    expect(manifest.orchestrationEvidence).toMatchObject({
      kind: "nobie.release.orchestration",
      gateStatus: "passed",
      checks: expect.arrayContaining([
        expect.objectContaining({ id: "feature_flag_off_parity", status: "passed" }),
        expect.objectContaining({ id: "no_agent_fallback", status: "passed" }),
        expect.objectContaining({ id: "runtime_flag_default", status: "passed" }),
      ]),
    })
    expect(manifest.releaseNotes.featureFlagDefaults.join("\n")).toContain(
      "sub_agent_orchestration: mode=off",
    )
    expect(manifest.releaseNotes.rollbackProcedure.join("\n")).toContain(
      "rollback compatibility mode",
    )
    expect(manifest.releaseNotes.knownLimitations.join("\n")).toContain(
      "Orchestration release gate: passed",
    )
    expect(manifest.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "admin:diagnostic-bundle",
          kind: "admin_diagnostic_bundle",
          status: "missing_optional",
        }),
      ]),
    )
    expect(
      manifest.cleanInstallChecklist.some(
        (item) => item.id === "performance-release-gate" && item.required,
      ),
    ).toBe(true)
    expect(
      manifest.cleanInstallChecklist.some(
        (item) => item.id === "admin-diagnostics" && item.required,
      ),
    ).toBe(true)
  })

  it("downgrades orchestration evidence to warning when the runtime flag is not off by default", () => {
    const evidence = buildReleaseOrchestrationEvidence({
      now: new Date("2026-04-20T00:00:05.000Z"),
      featureFlags: [
        {
          featureKey: "sub_agent_orchestration",
          mode: "enforced",
          compatibilityMode: false,
          source: "db",
        },
      ],
    })

    expect(evidence.gateStatus).toBe("warning")
    expect(evidence.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "runtime_flag_default",
          status: "warning",
        }),
      ]),
    )
    expect(evidence.warnings.join("\n")).toContain("runtime_flag_default")
  })

  it("extends the pipeline and rollback runbook with orchestration and performance release gates", () => {
    const pipeline = buildReleasePipelinePlan({ targetPlatforms: ["macos", "windows", "linux"] })
    const runbook = buildReleaseRollbackRunbook()

    expect(pipeline.order).toEqual(
      expect.arrayContaining([
        "orchestration-release-gate",
        "performance-release-gate",
        "admin-diagnostic-export",
      ]),
    )
    expect(runbook.steps.join("\n")).toContain("Disable the orchestration feature flag")
    expect(runbook.verification.join("\n")).toContain("Feature flags show orchestration disabled")
    expect(runbook.retryForbiddenWhen.join("\n")).toContain("no-agent fallback broken")
  })

  it("collects registry lookup, sub-session queue wait, first progress, and finalization latency from runtime paths", async () => {
    await buildStartPlan(
      {
        message: "작업을 병렬로 나눠줘",
        sessionId: "session-task014",
        runId: "run-task014",
        requestGroupId: "group-task014",
        source: "webui",
      },
      {
        analyzeRequestEntrySemantics: vi.fn(() => ({
          reuse_conversation_context: false,
          active_queue_cancellation_mode: null,
        })),
        isReusableRequestGroup: vi.fn(() => false),
        listActiveSessionRequestGroups: vi.fn(() => []),
        compareRequestContinuation: vi.fn(),
        getRequestGroupDelegationTurnCount: vi.fn(() => 0),
        buildWorkerSessionId: vi.fn(() => undefined),
        normalizeTaskProfile: vi.fn((profile) => profile ?? "general_chat"),
        findLatestWorkerSessionRun: vi.fn(() => undefined),
        resolveOrchestrationMode: vi.fn(async () => ({
          mode: "single_nobie",
          status: "ok",
          reasonCode: "feature_flag_off",
          reason: "orchestration disabled",
          configSubAgentCount: 0,
          activeSubAgentCount: 0,
          disabledSubAgentCount: 0,
          requestedMode: "single_nobie",
          featureFlagEnabled: false,
        })),
        buildOrchestrationPlan: vi.fn(() => ({
          plan: {
            planId: "plan-task014",
            plannerVersion: "structured-v1",
            mode: "single_nobie",
            delegatedTasks: [],
            directTasks: [],
            parallelGroups: [],
            fallbackStrategy: { reasonCode: "single_nobie_mode", summary: "direct execution" },
            audit: { rationale: [], warnings: [] },
          },
        })),
      },
    )

    const { dependencies } = makeRuntimeDependencies()
    const runner = new SubSessionRunner(dependencies)
    await runner.runSubSession(runInput("latency"), async (input, controls) => {
      await controls.emitProgress("first progress")
      return createTextResultReport({ command: input.command, text: "done" })
    })
    let time = Date.UTC(2026, 3, 20, 0, 1, 0)
    await runParallelSubSessionGroup(
      { groupId: "group-task014-resource-lock", dependencyEdges: [], concurrencyLimit: 2 },
      [
        {
          taskId: "left",
          subSessionId: "sub:left",
          resourceLocks: [
            {
              lockId: "lock:left",
              kind: "file",
              target: "/repo/file.ts",
              mode: "exclusive",
              reasonCode: "write_conflict",
            },
          ],
          run: async () => {
            time += 320
            return {
              subSession: {
                identity: identity("sub_session", "sub:left", "idem:sub:left"),
                subSessionId: "sub:left",
                parentSessionId: "session-parent",
                parentRunId: "run-parent",
                agentId: "agent:researcher",
                agentDisplayName: "Researcher",
                commandRequestId: "command:left",
                status: "completed",
                retryBudgetRemaining: 1,
                promptBundleId: "prompt-bundle:researcher",
              },
              status: "completed",
              replayed: false,
            }
          },
        },
        {
          taskId: "right",
          subSessionId: "sub:right",
          resourceLocks: [
            {
              lockId: "lock:right",
              kind: "file",
              target: "/repo/file.ts",
              mode: "exclusive",
              reasonCode: "write_conflict",
            },
          ],
          run: async () => {
            time += 50
            return {
              subSession: {
                identity: identity("sub_session", "sub:right", "idem:sub:right"),
                subSessionId: "sub:right",
                parentSessionId: "session-parent",
                parentRunId: "run-parent",
                agentId: "agent:researcher",
                agentDisplayName: "Researcher",
                commandRequestId: "command:right",
                status: "completed",
                retryBudgetRemaining: 1,
                promptBundleId: "prompt-bundle:researcher",
              },
              status: "completed",
              replayed: false,
            }
          },
        },
      ],
      {
        now: () => time,
        runId: "run-parent",
        sessionId: "session-parent",
        source: "test",
        appendParentEvent: async () => undefined,
      },
    )

    expect(listLatencyMetrics()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "registry_lookup_latency_ms", runId: "run-task014" }),
        expect.objectContaining({ name: "sub_session_queue_wait_ms", runId: "run-parent" }),
        expect.objectContaining({ name: "first_progress_latency_ms", runId: "run-parent" }),
        expect.objectContaining({ name: "finalization_latency_ms", runId: "run-parent" }),
        expect.objectContaining({ name: "resource_lock_wait_ms", runId: "run-parent" }),
      ]),
    )
  })
})
