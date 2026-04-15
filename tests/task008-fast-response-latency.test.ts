import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import {
  CONTRACT_SCHEMA_VERSION,
  buildDeliveryKey,
  buildPayloadHash,
  buildScheduleIdentityKey,
  toCanonicalJson,
  type ScheduleContract,
} from "../packages/core/src/contracts/index.ts"
import {
  closeDb,
  getDb,
  getSchedule,
  insertScheduleRun,
} from "../packages/core/src/db/index.js"
import { createMemoryVectorProvider, runCandidateProviders } from "../packages/core/src/candidates/index.ts"
import {
  buildLatencyEventLabel,
  getFastResponseHealthSnapshot,
  listLatencyMetrics,
  recordLatencyMetric,
  resetLatencyMetrics,
} from "../packages/core/src/observability/latency.js"
import { buildStartPlan } from "../packages/core/src/runs/start-plan.ts"
import { executeScheduleContract } from "../packages/core/src/scheduler/contract-executor.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task008-latency-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  reloadConfig()
}

function scheduleContract(): ScheduleContract {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    kind: "recurring",
    time: {
      cron: "0 9 * * *",
      timezone: "Asia/Seoul",
      missedPolicy: "next_only",
    },
    payload: {
      kind: "literal_message",
      literalText: "알림",
    },
    delivery: {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      mode: "channel_message",
      channel: "telegram",
      sessionId: "telegram-session-task008",
    },
    source: {
      originRunId: "run-task008",
      originRequestGroupId: "group-task008",
    },
    displayName: "TASK008 알림",
  }
}

function insertContractSchedule(id: string, contract: ScheduleContract): void {
  const now = Date.parse("2026-04-15T00:00:00.000Z")
  getDb().prepare(
    `INSERT INTO schedules
     (id, name, cron_expression, timezone, prompt, enabled, target_channel, target_session_id, execution_driver,
      origin_run_id, origin_request_group_id, model, max_retries, timeout_sec,
      contract_json, identity_key, payload_hash, delivery_key, contract_schema_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    `TASK008 ${id}`,
    contract.time.cron ?? "0 9 * * *",
    contract.time.timezone,
    "RAW_PROMPT_SHOULD_NOT_REENTER_AGENT",
    1,
    "telegram",
    contract.delivery.sessionId,
    "internal",
    "run-task008",
    "group-task008",
    null,
    0,
    300,
    toCanonicalJson(contract),
    buildScheduleIdentityKey(contract),
    buildPayloadHash(contract.payload),
    buildDeliveryKey(contract.delivery),
    contract.schemaVersion,
    now,
    now,
  )
}

beforeEach(() => {
  resetLatencyMetrics()
  useTempState()
})

afterEach(() => {
  resetLatencyMetrics()
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

describe("task008 fast response latency", () => {
  it("summarizes recent latency records and marks timeout health", () => {
    const ok = recordLatencyMetric({ name: "ingress_ack_latency_ms", durationMs: 120, createdAt: 1 })
    recordLatencyMetric({ name: "ingress_ack_latency_ms", durationMs: 640, createdAt: 2 })
    recordLatencyMetric({ name: "contract_ai_comparison_latency_ms", durationMs: 2_000, timeout: true, createdAt: 3 })

    expect(buildLatencyEventLabel(ok)).toBe("ingress_ack_latency_ms=120ms")
    const snapshot = getFastResponseHealthSnapshot({ now: 10, windowMs: 20 })

    expect(snapshot.status).toBe("timeout")
    expect(snapshot.recentTimeouts).toHaveLength(1)
    expect(snapshot.metrics.find((metric) => metric.name === "ingress_ack_latency_ms")).toMatchObject({
      count: 2,
      p95Ms: 640,
      timeoutCount: 0,
      status: "ok",
    })
    expect(snapshot.metrics.find((metric) => metric.name === "contract_ai_comparison_latency_ms")).toMatchObject({
      count: 1,
      timeoutCount: 1,
      status: "timeout",
    })
  })

  it("records vector provider timeout as candidate latency without failing search", async () => {
    const vector = createMemoryVectorProvider({
      search: () => new Promise(() => undefined),
    })

    const result = await runCandidateProviders({
      runId: "run-candidate-timeout",
      sessionId: "session-candidate-timeout",
      semanticQuery: "느린 벡터 조회",
    }, [vector], {
      providerTimeoutMs: 5,
    })

    expect(result.candidates).toEqual([])
    expect(result.traces[0]?.timedOut).toBe(true)
    expect(listLatencyMetrics()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "candidate_search_latency_ms",
        runId: "run-candidate-timeout",
        sessionId: "session-candidate-timeout",
        status: "timeout",
      }),
    ]))
  })

  it("returns start-plan latency events for normalizer, candidate search, and contract comparison", async () => {
    const dependencies: Parameters<typeof buildStartPlan>[1] = {
      analyzeRequestEntrySemantics: vi.fn(() => ({
        reuse_conversation_context: false,
        active_queue_cancellation_mode: null,
      })),
      isReusableRequestGroup: vi.fn(() => false),
      listActiveSessionRequestGroups: vi.fn(() => ([{
        id: "run-prev",
        sessionId: "session-plan",
        requestGroupId: "group-prev",
        lineageRootRunId: "group-prev",
        title: "기존 작업",
        prompt: "SECRET_RAW_PROMPT",
        source: "webui",
        status: "running",
        taskProfile: "general_chat",
        contextMode: "full",
        delegationTurnCount: 0,
        maxDelegationTurns: 5,
        currentStepKey: "executing",
        currentStepIndex: 4,
        totalSteps: 9,
        summary: "running",
        canCancel: true,
        createdAt: 1,
        updatedAt: 2,
        steps: [],
        recentEvents: [],
      } as never])),
      compareRequestContinuation: vi.fn(async () => ({
        kind: "new_run",
        decisionSource: "contract_ai",
        reason: "independent request",
      })),
      getRequestGroupDelegationTurnCount: vi.fn(() => 0),
      buildWorkerSessionId: vi.fn(() => undefined),
      normalizeTaskProfile: vi.fn((taskProfile) => taskProfile ?? "general_chat"),
      findLatestWorkerSessionRun: vi.fn(() => undefined),
    }

    const plan = await buildStartPlan({
      message: "새 작업 해줘",
      sessionId: "session-plan",
      runId: "run-plan",
      source: "webui",
    }, dependencies)

    expect(plan.latencyEvents).toEqual(expect.arrayContaining([
      expect.stringMatching(/^normalizer_latency_ms=\d+ms/),
      expect.stringMatching(/^candidate_search_latency_ms=\d+ms provider=active-run-store/),
      expect.stringMatching(/^contract_ai_comparison_latency_ms=\d+ms/),
    ]))
  })

  it("records direct literal schedule execution and delivery latency", async () => {
    const contract = scheduleContract()
    insertContractSchedule("schedule-task008-literal", contract)
    insertScheduleRun({
      id: "run-task008-literal",
      schedule_id: "schedule-task008-literal",
      started_at: Date.parse("2026-04-15T00:00:05.000Z"),
      finished_at: null,
      success: null,
      summary: null,
      error: null,
    })
    const schedule = getSchedule("schedule-task008-literal")
    expect(schedule).toBeDefined()

    const result = await executeScheduleContract({
      schedule: schedule!,
      scheduleRunId: "run-task008-literal",
      trigger: "scheduler tick (due: 2026-04-15T00:00:00.000Z)",
      startedAt: Date.parse("2026-04-15T00:00:05.000Z"),
      dependencies: {
        deliverTelegramText: vi.fn(async () => undefined),
      },
    })

    expect(result.handled && result.result.success).toBe(true)
    expect(listLatencyMetrics()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "delivery_latency_ms",
        runId: "run-task008-literal",
        requestGroupId: "schedule-task008-literal",
        source: "scheduler",
      }),
      expect.objectContaining({
        name: "schedule_tick_direct_execution_latency_ms",
        runId: "run-task008-literal",
        requestGroupId: "schedule-task008-literal",
        source: "scheduler",
      }),
    ]))
  })
})
