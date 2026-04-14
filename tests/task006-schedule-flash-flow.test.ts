import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { closeDb, getDb, insertScheduleRun } from "../packages/core/src/db/index.js"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeMemoryJournalDb } from "../packages/core/src/memory/journal.js"
import {
  buildFlashFeedbackContext,
  getActiveFlashFeedback,
} from "../packages/core/src/memory/flash-feedback.ts"
import { rememberRunInstruction } from "../packages/core/src/runs/start-support.ts"
import { createDefaultScheduleActionDependencies } from "../packages/core/src/runs/action-execution.ts"
import { buildScheduleMemoryContext } from "../packages/core/src/schedules/context.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function useTempState(): void {
  closeDb()
  closeMemoryJournalDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task006-flow-"))
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
  closeMemoryJournalDb()
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

describe("task006 schedule memory and flash-feedback flow", () => {
  it("records active flash-feedback immediately and hides it after TTL", () => {
    rememberRunInstruction({
      runId: "run-feedback",
      sessionId: "session-a",
      requestGroupId: "group-a",
      source: "slack",
      message: "슬랙 요청인데 텔레그램 전송하지 마",
    })

    expect(getActiveFlashFeedback({ sessionId: "session-a" }).map((item) => item.content)).toEqual([
      "슬랙 요청인데 텔레그램 전송하지 마",
    ])
    expect(buildFlashFeedbackContext({ sessionId: "session-a" })).toContain("텔레그램 전송하지 마")
    expect(buildFlashFeedbackContext({ sessionId: "session-b" })).toBe("")

    getDb().prepare("UPDATE flash_feedback SET expires_at = ?").run(Date.now() - 1)
    expect(getActiveFlashFeedback({ sessionId: "session-a" })).toEqual([])
    expect(buildFlashFeedbackContext({ sessionId: "session-a" })).toBe("")
  })

  it("stores recurring schedules as schedule memory and includes recent run history", () => {
    const dependencies = createDefaultScheduleActionDependencies({ scheduleDelayedRun: vi.fn() })
    const created = dependencies.createRecurringSchedule({
      title: "TASK006 예약 점검",
      task: "TASK006_SCHEDULE_MEMORY_PAYLOAD",
      cron: "*/5 * * * *",
      source: "slack",
      sessionId: "slack-session-a",
      originRunId: "run-origin",
      originRequestGroupId: "group-origin",
      model: "gpt-5",
    })

    insertScheduleRun({
      id: "schedule-run-1",
      schedule_id: created.scheduleId,
      started_at: Date.parse("2026-04-13T00:00:00.000Z"),
      finished_at: Date.parse("2026-04-13T00:00:10.000Z"),
      success: 0,
      summary: null,
      error: "TASK006_LAST_FAILURE",
    })

    const context = buildScheduleMemoryContext({ scheduleId: created.scheduleId })

    expect(context).toContain("[예약 작업 기억]")
    expect(context).toContain("TASK006 예약 점검")
    expect(context).toContain("TASK006_SCHEDULE_MEMORY_PAYLOAD")
    expect(context).toContain("*/5 * * * *")
    expect(context).toContain("slack:slack-session-a")
    expect(context).toContain("TASK006_LAST_FAILURE")
  })
})
