import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildReleasePerformanceSummary } from "../packages/core/src/release/performance-gate.ts"
import {
  listLatencyMetrics,
  recordLatencyMetric,
  resetLatencyMetrics,
} from "../packages/core/src/observability/latency.js"
import { buildStartPlan } from "../packages/core/src/runs/start-plan.ts"
import {
  SubSessionRunner,
  createTextResultReport,
  runParallelSubSessionGroup,
  type RunSubSessionInput,
  type SubSessionContract,
  type SubSessionRuntimeDependencies,
} from "../packages/core/src/orchestration/sub-session-runner.ts"
import type {
  AgentPromptBundle,
  CommandRequest,
  ExpectedOutputContract,
  MemoryPolicy,
  PermissionProfile,
  ResourceLockContract,
  RuntimeIdentity,
  SkillMcpAllowlist,
  StructuredTaskScope,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import { acknowledgeLiveUpdateMessage } from "../packages/webui/src/api/ws.ts"
import { resolveWebUiLiveUpdateAck } from "../packages/core/src/api/ws/stream.ts"

const startRootRunMock = vi.fn()

vi.mock("../packages/core/src/runs/start.js", () => ({
  startRootRun: (...args: unknown[]) => startRootRunMock(...args),
}))

const { startIngressRun } = await import("../packages/core/src/runs/ingress.ts")

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

function identity(entityType: RuntimeIdentity["entityType"], entityId: string, idempotencyKey = `idem:${entityId}`): RuntimeIdentity {
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

function promptBundle(createdAt: number): AgentPromptBundle {
  return {
    identity: identity("sub_session", "prompt-bundle:researcher", "idem:prompt-bundle:researcher"),
    bundleId: "prompt-bundle:researcher",
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
    taskScope,
    safetyRules: ["Do not deliver sub-session results directly to the user."],
    sourceProvenance: [{ sourceId: "profile:agent:researcher", version: "1" }],
    createdAt,
  }
}

function command(id: string): CommandRequest {
  return {
    identity: identity("sub_session", id, `idem:${id}`),
    commandRequestId: `command:${id}`,
    parentRunId: "run-parent",
    subSessionId: `sub:${id}`,
    targetAgentId: "agent:researcher",
    taskScope,
    contextPackageIds: [],
    expectedOutputs: [expectedOutput],
    retryBudget: 2,
  }
}

function runInput(id: string, createdAt: number): RunSubSessionInput {
  return {
    command: command(id),
    agent: {
      agentId: "agent:researcher",
      displayName: "Researcher",
      nickname: "Res",
    },
    parentSessionId: "session-parent",
    promptBundle: promptBundle(createdAt),
  }
}

function makeRuntimeDependencies(baseTime: number): { dependencies: SubSessionRuntimeDependencies; nowRef: { value: number } } {
  const sessions = new Map<string, SubSessionContract>()
  const nowRef = { value: baseTime }
  const clone = <T>(value: T): T => structuredClone(value)
  const dependencies: SubSessionRuntimeDependencies = {
    now: () => nowRef.value,
    idProvider: () => `id-${++nowRef.value}`,
    loadSubSessionByIdempotencyKey: (idempotencyKey) =>
      clone([...sessions.values()].find((session) => session.identity.idempotencyKey === idempotencyKey)),
    persistSubSession: (subSession) => {
      sessions.set(subSession.subSessionId, clone(subSession))
      return true
    },
    updateSubSession: (subSession) => {
      sessions.set(subSession.subSessionId, clone(subSession))
    },
    appendParentEvent: async () => undefined,
    isParentCancelled: () => false,
  }
  return { dependencies, nowRef }
}

function exclusiveFileLock(lockId: string, target = "/repo/file.ts"): ResourceLockContract {
  return {
    lockId,
    kind: "file",
    target,
    mode: "exclusive",
    reasonCode: "write_conflict",
  }
}

beforeEach(() => {
  resetLatencyMetrics()
  startRootRunMock.mockReset()
  startRootRunMock.mockReturnValue({
    runId: "run-ingress",
    sessionId: "session-ingress",
    status: "started",
    finished: Promise.resolve(undefined),
  })
})

afterEach(() => {
  resetLatencyMetrics()
})

describe("task014 performance slo", () => {
  it("keeps the fast-path measurement harness within task014 latency budgets", async () => {
    const baseTime = Date.parse("2026-04-21T01:00:00.000Z")

    const ingress = startIngressRun({
      runId: "run-ingress",
      message: "현재 상태 보여줘",
      sessionId: "session-ingress",
      source: "webui",
      model: undefined,
    })
    expect(ingress.receipt.text).toBe("요청을 접수했습니다. 분석을 시작합니다.")

    await buildStartPlan({
      message: "작업을 병렬로 나눠줘",
      sessionId: "session-task014",
      runId: "run-task014",
      requestGroupId: "group-task014",
      source: "webui",
    }, {
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
          planId: "plan-task014-slo",
          plannerVersion: "structured-v1",
          mode: "single_nobie",
          delegatedTasks: [],
          directTasks: [],
          parallelGroups: [],
          fallbackStrategy: { reasonCode: "single_nobie_mode", summary: "direct execution" },
          audit: { rationale: [], warnings: [] },
        },
      })),
    })

    const { dependencies, nowRef } = makeRuntimeDependencies(baseTime)
    const runner = new SubSessionRunner(dependencies)
    await runner.runSubSession(runInput("latency", baseTime), async (input, controls) => {
      nowRef.value += 180
      await controls.emitProgress("first progress")
      nowRef.value += 220
      return createTextResultReport({ command: input.command, text: "done" })
    })

    await runParallelSubSessionGroup(
      { groupId: "group-task014-slo", dependencyEdges: [], concurrencyLimit: 2 },
      [
        {
          taskId: "left",
          subSessionId: "sub:left",
          resourceLocks: [exclusiveFileLock("lock:left")],
          run: async () => {
            nowRef.value += 220
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
              status: "completed" as const,
              replayed: false,
            }
          },
        },
        {
          taskId: "right",
          subSessionId: "sub:right",
          resourceLocks: [exclusiveFileLock("lock:right")],
          run: async () => {
            nowRef.value += 80
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
              status: "completed" as const,
              replayed: false,
            }
          },
        },
      ],
      {
        now: () => nowRef.value,
        runId: "run-parent",
        sessionId: "session-parent",
        source: "webui",
        appendParentEvent: async () => undefined,
      },
    )

    const outboundAcks: unknown[] = []
    acknowledgeLiveUpdateMessage({
      type: "run.progress",
      emittedAt: baseTime + 500,
      runId: "run-webui",
      sessionId: "session-webui",
      requestGroupId: "group-webui",
    }, (payload) => outboundAcks.push(payload))
    expect(resolveWebUiLiveUpdateAck(outboundAcks[0] as {
      type: string
      eventType: string
      emittedAt: number
      runId: string
      sessionId: string
      requestGroupId: string
      source: string
    }, () => baseTime + 900)).toBe(true)

    recordLatencyMetric({
      name: "approval_aggregation_latency_ms",
      durationMs: 320,
      createdAt: baseTime + 1_100,
      runId: "run-approval",
      sessionId: "session-approval",
      source: "webui",
    })
    recordLatencyMetric({
      name: "delivery_latency_ms",
      durationMs: 420,
      createdAt: baseTime + 1_200,
      runId: "run-delivery",
      sessionId: "session-delivery",
      source: "webui",
    })

    const summary = buildReleasePerformanceSummary({
      now: new Date(baseTime + 5_000),
      windowMs: 30_000,
      deliveryDedupeCount: 1,
      concurrencyBlockedCount: 1,
    })

    expect(summary.gateStatus).toBe("passed")
    expect(summary.missingRequiredMetrics).toEqual([])
    expect(summary.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: "intake_latency", status: "ok" }),
      expect.objectContaining({ targetId: "registry_lookup_latency", status: "ok" }),
      expect.objectContaining({ targetId: "orchestration_mode_latency", status: "ok" }),
      expect.objectContaining({ targetId: "orchestration_planning_latency", status: "ok" }),
      expect.objectContaining({ targetId: "sub_session_queue_wait", status: "ok" }),
      expect.objectContaining({ targetId: "first_progress_latency", status: "ok" }),
      expect.objectContaining({ targetId: "approval_aggregation_latency", status: "ok" }),
      expect.objectContaining({ targetId: "finalization_latency", status: "ok" }),
      expect.objectContaining({ targetId: "delivery_latency", status: "ok" }),
      expect.objectContaining({ targetId: "webui_live_update_latency", status: "ok" }),
      expect.objectContaining({ targetId: "resource_lock_wait", status: "ok" }),
    ]))
    expect(listLatencyMetrics()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "ingress_ack_latency_ms", runId: "run-ingress", sessionId: "session-ingress" }),
      expect.objectContaining({ name: "registry_lookup_latency_ms", runId: "run-task014", sessionId: "session-task014" }),
      expect.objectContaining({ name: "orchestration_mode_latency_ms", runId: "run-task014", sessionId: "session-task014" }),
      expect.objectContaining({ name: "orchestration_planning_latency_ms", runId: "run-task014", sessionId: "session-task014" }),
      expect.objectContaining({ name: "first_progress_latency_ms", runId: "run-parent", sessionId: "session-parent" }),
      expect.objectContaining({ name: "webui_live_update_latency_ms", runId: "run-webui", sessionId: "session-webui" }),
    ]))
  })
})
