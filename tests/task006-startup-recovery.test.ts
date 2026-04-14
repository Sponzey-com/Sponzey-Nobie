import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  closeDb,
  getDb,
  getTaskContinuity,
  insertSchedule,
  insertScheduleRun,
  insertSession,
  upsertTaskContinuity,
} from "../packages/core/src/db/index.js"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { deliverArtifactOnce, resetArtifactDeliveryDedupeForTest } from "../packages/core/src/runs/delivery.ts"
import { getLastStartupRecoverySummary } from "../packages/core/src/runs/startup-recovery.js"
import { createRootRun, getRootRun, recoverActiveRunsOnStartup, updateRunStatus } from "../packages/core/src/runs/store.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task006-startup-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  reloadConfig()
}

function seedSession(id: string, source = "webui"): void {
  insertSession({
    id,
    source,
    source_id: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    summary: null,
  })
}

beforeEach(() => {
  useTempState()
})

afterEach(() => {
  resetArtifactDeliveryDedupeForTest()
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

describe("task006 startup recovery chaos fixtures", () => {
  it("keeps pending approval as awaiting approval without auto execution", () => {
    seedSession("session-approval")
    createRootRun({
      id: "run-approval",
      sessionId: "session-approval",
      requestGroupId: "group-approval",
      prompt: "메인 화면 캡처",
      source: "webui",
    })
    updateRunStatus("run-approval", "awaiting_approval", "screen_capture 승인 대기", true)

    const recovered = recoverActiveRunsOnStartup()
    const run = getRootRun("run-approval")
    const continuity = getTaskContinuity("group-approval")
    const summary = getLastStartupRecoverySummary()

    expect(recovered.map((item) => item.id)).toContain("run-approval")
    expect(run?.status).toBe("awaiting_approval")
    expect(continuity).toMatchObject({
      lineageRootRunId: "group-approval",
      status: "awaiting_approval",
      pendingApprovals: ["approval:run-approval"],
      pendingDelivery: [],
    })
    expect(summary.awaitingApprovalCount).toBe(1)
    expect(summary.runs[0]).toMatchObject({ recoveryStatus: "awaiting_approval", duplicateRisk: false })
  })

  it("marks running tool state without receipt as interrupted and does not rerun", () => {
    seedSession("session-running")
    createRootRun({
      id: "run-running",
      sessionId: "session-running",
      requestGroupId: "group-running",
      prompt: "파일 삭제 실행",
      source: "webui",
    })
    updateRunStatus("run-running", "running", "도구 실행 중", true)

    const recovered = recoverActiveRunsOnStartup()
    const run = getRootRun("run-running")
    const continuity = getTaskContinuity("group-running")
    const summary = getLastStartupRecoverySummary()

    expect(recovered.map((item) => item.id)).toContain("run-running")
    expect(run?.status).toBe("interrupted")
    expect(run?.canCancel).toBe(false)
    expect(continuity?.status).toBe("interrupted")
    expect(summary.interruptedRunCount).toBe(1)
    expect(summary.runs[0]).toMatchObject({ recoveryStatus: "interrupted", duplicateRisk: true })
  })

  it("keeps completed tool with pending delivery in user-confirmation state", () => {
    seedSession("session-delivery", "slack")
    createRootRun({
      id: "run-delivery",
      sessionId: "session-delivery",
      requestGroupId: "group-delivery",
      prompt: "캡처해서 슬랙으로 보내줘",
      source: "slack",
    })
    updateRunStatus("run-delivery", "running", "파일 전달 대기", true)
    upsertTaskContinuity({
      lineageRootRunId: "group-delivery",
      lastToolReceipt: "screen_capture:/tmp/screen.png",
      pendingDelivery: ["slack:file:/tmp/screen.png"],
      status: "pending_delivery",
    })

    recoverActiveRunsOnStartup()
    const run = getRootRun("run-delivery")
    const continuity = getTaskContinuity("group-delivery")
    const summary = getLastStartupRecoverySummary()

    expect(run?.status).toBe("awaiting_user")
    expect(continuity).toMatchObject({
      status: "pending_delivery",
      pendingDelivery: ["slack:file:/tmp/screen.png"],
      lastToolReceipt: "screen_capture:/tmp/screen.png",
    })
    expect(summary.pendingDeliveryCount).toBe(1)
    expect(summary.runs[0]).toMatchObject({ recoveryStatus: "pending_delivery", duplicateRisk: true })
  })

  it("does not duplicate completed artifact delivery after restart", async () => {
    seedSession("session-delivered", "telegram")
    createRootRun({
      id: "run-delivered",
      sessionId: "session-delivered",
      requestGroupId: "group-delivered",
      prompt: "사진 보내줘",
      source: "telegram",
    })
    upsertTaskContinuity({
      lineageRootRunId: "group-delivered",
      lastDeliveryReceipt: "telegram:/tmp/photo.png",
      pendingDelivery: [],
      status: "delivered",
    })

    recoverActiveRunsOnStartup()
    const deliveryTask = vi.fn(async () => "sent")
    const result = await deliverArtifactOnce({
      runId: "run-delivered",
      channel: "telegram",
      filePath: "/tmp/photo.png",
      task: deliveryTask,
    })

    expect(getRootRun("run-delivered")?.status).toBe("completed")
    expect(result).toBeUndefined()
    expect(deliveryTask).not.toHaveBeenCalled()
    expect(getLastStartupRecoverySummary().deliveredCount).toBe(1)
  })

  it("marks unfinished schedule runs interrupted on startup", () => {
    const now = Date.now()
    insertSchedule({
      id: "schedule-1",
      name: "TASK006 chaos schedule",
      cron_expression: "*/5 * * * *",
      prompt: "상태 보고",
      enabled: 1,
      target_channel: "webui",
      target_session_id: null,
      execution_driver: "internal",
      origin_run_id: null,
      origin_request_group_id: null,
      model: null,
      max_retries: 0,
      timeout_sec: 60,
      created_at: now,
      updated_at: now,
    })
    insertScheduleRun({
      id: "schedule-run-open",
      schedule_id: "schedule-1",
      started_at: now,
      finished_at: null,
      success: null,
      summary: null,
      error: null,
    })

    recoverActiveRunsOnStartup()
    const row = getDb()
      .prepare<[string], { finished_at: number | null; success: number | null; error: string | null }>(
        "SELECT finished_at, success, error FROM schedule_runs WHERE id = ?",
      )
      .get("schedule-run-open")

    expect(row?.finished_at).toBeTypeOf("number")
    expect(row?.success).toBe(0)
    expect(row?.error).toContain("daemon restart")
    expect(getLastStartupRecoverySummary().interruptedScheduleRunCount).toBe(1)
  })

  it("uses artifact delivery lock to avoid concurrent duplicate sends", async () => {
    let resolveDelivery: ((value: string) => void) | undefined
    const deliveryTask = vi.fn(() => new Promise<string>((resolve) => { resolveDelivery = resolve }))

    const first = deliverArtifactOnce({ runId: "run-lock", channel: "slack", filePath: "/tmp/locked.png", task: deliveryTask })
    const second = deliverArtifactOnce({ runId: "run-lock", channel: "slack", filePath: "/tmp/locked.png", task: deliveryTask })

    resolveDelivery?.("sent")

    await expect(first).resolves.toBe("sent")
    await expect(second).resolves.toBeUndefined()
    expect(deliveryTask).toHaveBeenCalledTimes(1)
  })
})
