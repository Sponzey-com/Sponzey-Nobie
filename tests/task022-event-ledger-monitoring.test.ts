import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerOrchestrationEventsRoute } from "../packages/core/src/api/routes/orchestration-events.ts"
import { closeDb, getDb, listControlEvents } from "../packages/core/src/db/index.js"
import {
  listLatencyMetrics,
  resetLatencyMetrics,
} from "../packages/core/src/observability/latency.js"
import {
  type OrchestrationEventInput,
  buildOrchestrationMonitoringSnapshot,
  buildRestartResumeProjection,
  formatOrchestrationEventSse,
  listOrchestrationEventLedger,
  openOrchestrationEventRawPayload,
  recordOrchestrationEvent,
  validateOrchestrationEventInput,
} from "../packages/core/src/orchestration/event-ledger.ts"

const require = createRequire(import.meta.url)
const Fastify = require("../packages/core/node_modules/fastify") as (options: {
  logger: boolean
}) => {
  close(): Promise<void>
  inject(options: { method: string; url: string }): Promise<{
    body: string
    statusCode: number
    json(): Record<string, unknown>
  }>
}

const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function baseEvent(overrides: Partial<OrchestrationEventInput> = {}): OrchestrationEventInput {
  return {
    eventKind: "sub_session_progress_reported",
    runId: "run-task022",
    requestGroupId: "group-task022",
    subSessionId: "sub-task022",
    agentId: "agent-task022",
    correlationId: "corr-task022",
    source: "test",
    summary: "Sub-session progress",
    payload: { progress: "ok" },
    ...overrides,
  }
}

beforeEach(() => {
  closeDb()
  resetLatencyMetrics()
  const stateDir = makeTempDir("nobie-task022-state-")
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  getDb()
})

afterEach(() => {
  closeDb()
  resetLatencyMetrics()
  if (previousStateDir === undefined) Reflect.deleteProperty(process.env, "NOBIE_STATE_DIR")
  else process.env.NOBIE_STATE_DIR = previousStateDir
  if (previousConfig === undefined) Reflect.deleteProperty(process.env, "NOBIE_CONFIG")
  else process.env.NOBIE_CONFIG = previousConfig
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("task022 event ledger and monitoring stream", () => {
  it("validates the standard orchestration event schema with core correlation fields", () => {
    expect(validateOrchestrationEventInput(baseEvent()).ok).toBe(true)
    expect(
      validateOrchestrationEventInput({
        ...baseEvent(),
        eventKind: "unknown_event" as OrchestrationEventInput["eventKind"],
        summary: "",
      }),
    ).toEqual({
      ok: false,
      issueCodes: expect.arrayContaining(["event_kind_invalid", "event_summary_missing"]),
    })
  })

  it("appends durable events, dedupes by key, and replays from a cursor", () => {
    const first = recordOrchestrationEvent(
      baseEvent({
        eventKind: "agent_registered",
        subSessionId: undefined,
        dedupeKey: "agent:registered:agent-task022",
        summary: "Agent registered",
        payload: { apiKey: "sk-task022-secret-value", visible: "safe" },
      }),
    )
    const duplicate = recordOrchestrationEvent(
      baseEvent({
        eventKind: "agent_registered",
        subSessionId: undefined,
        dedupeKey: "agent:registered:agent-task022",
        summary: "Agent registered",
        payload: { apiKey: "sk-task022-secret-value", visible: "safe" },
      }),
    )
    const second = recordOrchestrationEvent(
      baseEvent({
        eventKind: "team_registered",
        teamId: "team-task022",
        subSessionId: undefined,
        dedupeKey: "team:registered:team-task022",
        summary: "Team registered",
      }),
    )

    expect(first?.inserted).toBe(true)
    expect(duplicate?.inserted).toBe(false)
    expect(second?.inserted).toBe(true)
    expect(listOrchestrationEventLedger({ runId: "run-task022" })).toHaveLength(2)
    expect(JSON.stringify(first?.event.payload)).not.toContain("sk-task022-secret-value")
    expect(listOrchestrationEventLedger({ afterCursor: first?.event.cursor })).toEqual([
      expect.objectContaining({ eventKind: "team_registered" }),
    ])
  })

  it("rebuilds monitoring and restart projections from replayed control, lock, budget, model, and review events", () => {
    const eventKinds: OrchestrationEventInput[] = [
      baseEvent({
        eventKind: "orchestration_planned",
        subSessionId: undefined,
        summary: "Plan created",
      }),
      baseEvent({
        eventKind: "team_execution_planned",
        teamId: "team-task022",
        subSessionId: undefined,
        summary: "Team plan created",
      }),
      baseEvent({ eventKind: "command_requested", summary: "Command requested" }),
      baseEvent({ eventKind: "named_handoff_created", summary: "Named handoff created" }),
      baseEvent({
        eventKind: "data_exchange_created",
        exchangeId: "exchange-task022",
        summary: "Exchange created",
      }),
      baseEvent({ eventKind: "sub_session_queued", summary: "Sub-session queued" }),
      baseEvent({ eventKind: "sub_session_started", summary: "Sub-session started" }),
      baseEvent({ eventKind: "sub_session_progress_reported", summary: "Progress reported" }),
      baseEvent({
        eventKind: "capability_called",
        summary: "Capability called",
        payload: { toolName: "web_search" },
      }),
      baseEvent({
        eventKind: "approval_requested",
        approvalId: "approval-task022",
        summary: "Approval requested",
      }),
      baseEvent({
        eventKind: "control_action",
        summary: "Control action requested",
        payload: { action: "steer" },
      }),
      baseEvent({ eventKind: "resource_lock_wait", summary: "Lock wait" }),
      baseEvent({ eventKind: "resource_lock_released", summary: "Lock released" }),
      baseEvent({ eventKind: "resource_lock_timeout", summary: "Lock timeout" }),
      baseEvent({
        eventKind: "budget_blocked",
        summary: "Budget blocked",
        payload: { reasonCode: "cost_budget_exceeded" },
      }),
      baseEvent({
        eventKind: "model_resolved",
        summary: "Model resolved",
        payload: { modelId: "gpt-5.4" },
      }),
      baseEvent({
        eventKind: "model_fallback",
        summary: "Model fallback",
        payload: { modelId: "gpt-5.4-mini", fallbackApplied: true },
      }),
      baseEvent({
        eventKind: "model_budget_blocked",
        summary: "Model budget blocked",
        payload: { reasonCode: "cost_budget_exceeded" },
      }),
      baseEvent({ eventKind: "feedback_requested", summary: "Feedback requested" }),
      baseEvent({ eventKind: "redelegation_requested", summary: "Redelegation requested" }),
      baseEvent({ eventKind: "retry_started", summary: "Retry started" }),
      baseEvent({ eventKind: "result_reported", summary: "Result reported" }),
      baseEvent({ eventKind: "result_reviewed", summary: "Result reviewed" }),
      baseEvent({ eventKind: "sub_session_completed", summary: "Sub-session completed" }),
      baseEvent({
        eventKind: "final_delivery_completed",
        subSessionId: undefined,
        summary: "Final delivery completed",
      }),
      baseEvent({
        eventKind: "named_delivery_attributed",
        subSessionId: undefined,
        summary: "Named delivery attributed",
      }),
      baseEvent({
        eventKind: "learning_recorded",
        subSessionId: undefined,
        summary: "Learning recorded",
      }),
      baseEvent({
        eventKind: "history_restored",
        subSessionId: undefined,
        summary: "History restored",
      }),
    ]
    for (const event of eventKinds) recordOrchestrationEvent(event)
    recordOrchestrationEvent(
      baseEvent({
        eventKind: "sub_session_started",
        subSessionId: "sub-active",
        summary: "Active child started",
      }),
    )

    const snapshot = buildOrchestrationMonitoringSnapshot({ runId: "run-task022" })
    expect(snapshot.summary.total).toBeGreaterThanOrEqual(eventKinds.length)
    expect(snapshot.summary.activeSubSessionCount).toBe(1)
    expect(snapshot.summary.completedSubSessionCount).toBe(1)
    expect(snapshot.summary.budgetBlockedCount).toBe(2)
    expect(snapshot.summary.modelFallbackCount).toBe(1)
    expect(snapshot.subSessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subSessionId: "sub-task022", status: "completed" }),
        expect.objectContaining({ subSessionId: "sub-active", status: "running" }),
      ]),
    )
    expect(snapshot.dataExchanges).toEqual([
      expect.objectContaining({ exchangeId: "exchange-task022" }),
    ])
    expect(snapshot.locks.map((item) => item.eventKind)).toEqual(
      expect.arrayContaining([
        "resource_lock_wait",
        "resource_lock_released",
        "resource_lock_timeout",
      ]),
    )
    expect(buildRestartResumeProjection({ runId: "run-task022" }).activeSubSessionIds).toEqual([
      "sub-active",
    ])
    expect(listLatencyMetrics()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "monitoring_snapshot_latency_ms" })]),
    )
  })

  it("serializes replay events for SSE reconnect and exposes monitoring API projections", async () => {
    const first = recordOrchestrationEvent(
      baseEvent({
        eventKind: "sub_session_queued",
        summary: "Queued for SSE",
      }),
    )
    const second = recordOrchestrationEvent(
      baseEvent({
        eventKind: "sub_session_started",
        summary: "Started after reconnect",
      }),
    )
    if (!first || !second) throw new Error("expected test events to be recorded")
    expect(formatOrchestrationEventSse(second.event)).toContain(`id: ${second.event.cursor}`)

    const app = Fastify({ logger: false })
    registerOrchestrationEventsRoute(app)
    const replay = await app.inject({
      method: "GET",
      url: `/api/orchestration/events?runId=run-task022&after=${first.event.cursor}`,
    })
    expect(replay.statusCode).toBe(200)
    expect(replay.json().events).toEqual([
      expect.objectContaining({ eventKind: "sub_session_started" }),
    ])

    const stream = await app.inject({
      method: "GET",
      url: `/api/orchestration/events/stream?runId=run-task022&after=${first.event.cursor}&once=true`,
    })
    expect(stream.statusCode).toBe(200)
    expect(stream.body).toContain("event: orchestration.event")
    expect(stream.body).toContain("sub_session_started")

    const monitoring = await app.inject({
      method: "GET",
      url: "/api/orchestration/monitoring?runId=run-task022",
    })
    expect(monitoring.statusCode).toBe(200)
    expect(monitoring.json().snapshot.subSessions).toEqual([
      expect.objectContaining({ subSessionId: "sub-task022", status: "running" }),
    ])
    await app.close()
  })

  it("keeps redacted payloads by default and audits admin-only raw payload access", () => {
    const recorded = recordOrchestrationEvent(
      baseEvent({
        eventKind: "data_exchange_created",
        exchangeId: "exchange-raw",
        payloadRawRef: "raw-payload://exchange-raw",
        payload: { rawText: "Bearer secret-token-value", visible: "redacted view" },
        summary: "Data exchange created",
      }),
    )
    if (!recorded) throw new Error("expected raw event to be recorded")
    const event = recorded.event

    const denied = openOrchestrationEventRawPayload({ eventId: event.id, admin: false })
    expect(denied).toEqual(expect.objectContaining({ ok: false, reasonCode: "admin_required" }))
    const allowed = openOrchestrationEventRawPayload({
      eventId: event.id,
      admin: true,
      requester: "tester",
    })
    expect(allowed).toEqual(
      expect.objectContaining({ ok: true, rawRef: "raw-payload://exchange-raw" }),
    )
    expect(listControlEvents({ eventType: "orchestration_event.raw_view.opened" })).toHaveLength(1)
    expect(JSON.stringify(event.payload)).not.toContain("secret-token-value")
  })
})
