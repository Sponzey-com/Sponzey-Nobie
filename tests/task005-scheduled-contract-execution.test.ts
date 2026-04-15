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
  getScheduleDeliveryReceipt,
  getScheduleRuns,
  insertScheduleRun,
} from "../packages/core/src/db/index.js"
import {
  buildScheduledAgentExecutionBrief,
  executeScheduleContract,
} from "../packages/core/src/scheduler/contract-executor.ts"
import { runScheduleAndWait } from "../packages/core/src/scheduler/index.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task005-schedule-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  reloadConfig()
}

function scheduleContract(overrides: Partial<ScheduleContract> = {}): ScheduleContract {
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
      channel: "agent",
      sessionId: null,
    },
    source: {
      originRunId: "run-task005",
      originRequestGroupId: "group-task005",
    },
    displayName: "TASK005 알림",
    rawText: "매일 오전 9시에 알림이라고 보내줘",
    ...overrides,
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
    `TASK005 ${id}`,
    contract.time.cron ?? "0 9 * * *",
    contract.time.timezone,
    "RAW_PROMPT_SHOULD_NOT_REENTER_AGENT",
    1,
    contract.delivery.channel === "telegram" || contract.delivery.channel === "slack" ? contract.delivery.channel : "agent",
    contract.delivery.sessionId ?? null,
    "internal",
    "run-task005",
    "group-task005",
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

function insertRun(id: string, scheduleId: string): void {
  insertScheduleRun({
    id,
    schedule_id: scheduleId,
    started_at: Date.parse("2026-04-15T00:00:05.000Z"),
    finished_at: null,
    success: null,
    summary: null,
    error: null,
  })
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

describe("task005 scheduled contract execution", () => {
  it("executes literal messages without calling the AI provider and records a delivery receipt", async () => {
    const contract = scheduleContract({
      delivery: {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        mode: "channel_message",
        channel: "telegram",
        sessionId: "telegram-session-task005",
      },
    })
    insertContractSchedule("schedule-task005-literal", contract)
    insertRun("run-task005-literal", "schedule-task005-literal")
    const schedule = getSchedule("schedule-task005-literal")
    expect(schedule).toBeDefined()

    const runAgentImpl = vi.fn(async function* () {
      yield { type: "done" as const, totalTokens: 0 }
    })
    const deliverTelegramText = vi.fn(async () => undefined)
    const result = await executeScheduleContract({
      schedule: schedule!,
      scheduleRunId: "run-task005-literal",
      trigger: "scheduler tick (due: 2026-04-15T00:00:00.000Z)",
      startedAt: Date.parse("2026-04-15T00:00:05.000Z"),
      dependencies: { runAgentImpl, deliverTelegramText },
    })

    expect(result.handled).toBe(true)
    expect(result.handled && result.result).toMatchObject({
      success: true,
      summary: "알림",
      executionSuccess: true,
      deliverySuccess: true,
    })
    expect(runAgentImpl).not.toHaveBeenCalled()
    expect(deliverTelegramText).toHaveBeenCalledOnce()
    expect(deliverTelegramText).toHaveBeenCalledWith("telegram-session-task005", "알림")

    const dedupeKey = result.handled ? result.result.deliveryDedupeKey : null
    expect(dedupeKey).toBeTruthy()
    expect(getScheduleDeliveryReceipt(dedupeKey!)).toMatchObject({
      schedule_id: "schedule-task005-literal",
      schedule_run_id: "run-task005-literal",
      due_at: "2026-04-15T00:00:00.000Z",
      delivery_status: "delivered",
    })
  })

  it("skips the same dueAt delivery when a delivered receipt already exists", async () => {
    const contract = scheduleContract({
      delivery: {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        mode: "channel_message",
        channel: "telegram",
        sessionId: "telegram-session-task005",
      },
    })
    insertContractSchedule("schedule-task005-dedupe", contract)
    insertRun("run-task005-first", "schedule-task005-dedupe")
    insertRun("run-task005-second", "schedule-task005-dedupe")
    const schedule = getSchedule("schedule-task005-dedupe")!
    const deliverTelegramText = vi.fn(async () => undefined)

    const first = await executeScheduleContract({
      schedule,
      scheduleRunId: "run-task005-first",
      trigger: "scheduler tick (due: 2026-04-15T00:00:00.000Z)",
      startedAt: Date.parse("2026-04-15T00:00:05.000Z"),
      dependencies: { deliverTelegramText },
    })
    expect(first.handled && first.result.success).toBe(true)

    const second = await executeScheduleContract({
      schedule,
      scheduleRunId: "run-task005-second",
      trigger: "scheduler tick (due: 2026-04-15T00:00:00.000Z)",
      startedAt: Date.parse("2026-04-15T00:00:10.000Z"),
      dependencies: { deliverTelegramText },
    })

    expect(deliverTelegramText).toHaveBeenCalledTimes(1)
    expect(second.handled && second.result).toMatchObject({
      success: true,
      deliverySuccess: true,
    })
    expect(second.handled && second.result.summary).toContain("중복")
  })

  it("uses a contract execution brief for agent tasks and does not include raw schedule prompt", async () => {
    const contract = scheduleContract({
      payload: {
        kind: "agent_task",
        taskContract: null,
      },
      rawText: "RAW_SOURCE_TEXT_SHOULD_BE_OMITTED",
    })
    insertContractSchedule("schedule-task005-agent", contract)
    insertRun("run-task005-agent", "schedule-task005-agent")
    const schedule = getSchedule("schedule-task005-agent")!
    const brief = buildScheduledAgentExecutionBrief({
      schedule,
      contract,
      dueAt: "2026-04-15T00:00:00.000Z",
    })
    expect(brief).toContain("Execute the scheduled work")
    expect(brief).toContain("Do not create, update, cancel, deduplicate, or re-register schedules")
    expect(brief).not.toContain("RAW_PROMPT_SHOULD_NOT_REENTER_AGENT")
    expect(brief).not.toContain("RAW_SOURCE_TEXT_SHOULD_BE_OMITTED")

    let capturedUserMessage = ""
    const runAgentImpl = vi.fn(async function* (params) {
      capturedUserMessage = params.userMessage
      yield { type: "text" as const, delta: "실행 완료" }
      yield { type: "done" as const, totalTokens: 0 }
    })
    const result = await executeScheduleContract({
      schedule,
      scheduleRunId: "run-task005-agent",
      trigger: "scheduler tick (due: 2026-04-15T00:00:00.000Z)",
      startedAt: Date.parse("2026-04-15T00:00:05.000Z"),
      dependencies: { runAgentImpl },
    })

    expect(result.handled && result.result).toMatchObject({ success: true, summary: "실행 완료" })
    expect(capturedUserMessage).toContain("[scheduled-execution]")
    expect(capturedUserMessage).not.toContain("RAW_PROMPT_SHOULD_NOT_REENTER_AGENT")
    expect(capturedUserMessage).not.toContain("RAW_SOURCE_TEXT_SHOULD_BE_OMITTED")
  })

  it("runs contract literal schedules through scheduler without writing raw prompt messages", async () => {
    insertContractSchedule("schedule-task005-integration", scheduleContract())

    await runScheduleAndWait("schedule-task005-integration", "manual")

    const [run] = getScheduleRuns("schedule-task005-integration", 1, 0)
    expect(run).toMatchObject({
      schedule_id: "schedule-task005-integration",
      success: 1,
      summary: "알림",
      error: null,
      execution_success: 1,
      delivery_success: 1,
    })

    const messageCount = getDb()
      .prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM messages WHERE content = 'RAW_PROMPT_SHOULD_NOT_REENTER_AGENT'")
      .get()?.n ?? 0
    expect(messageCount).toBe(0)
  })
})
