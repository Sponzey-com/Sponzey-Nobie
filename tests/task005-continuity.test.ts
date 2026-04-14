import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  closeDb,
  getTaskContinuity,
  insertArtifactReceipt,
  insertSession,
  listTaskContinuityForLineages,
  upsertTaskContinuity,
} from "../packages/core/src/db/index.js"
import { deliverArtifactOnce, resetArtifactDeliveryDedupeForTest } from "../packages/core/src/runs/delivery.ts"
import { createRootRun, getRootRun, recoverActiveRunsOnStartup, updateRunStatus } from "../packages/core/src/runs/store.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task005-continuity-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  reloadConfig()
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

describe("task005 continuity persistence", () => {
  it("preserves omitted pending state and clears it only when explicitly requested", () => {
    upsertTaskContinuity({
      lineageRootRunId: "lineage-1",
      parentRunId: "run-parent",
      handoffSummary: "이전 단계 요약",
      lastGoodState: "screen_capture 승인 요청",
      pendingApprovals: ["approval:screen_capture"],
      pendingDelivery: ["slack:file:/tmp/screen.png"],
      status: "awaiting_approval",
    })

    upsertTaskContinuity({
      lineageRootRunId: "lineage-1",
      lastToolReceipt: "screen_capture:slack:/tmp/screen.png",
      lastDeliveryReceipt: "slack:/tmp/screen.png",
      failedRecoveryKey: "delivery:screen_capture",
      failureKind: "delivery",
      recoveryBudget: "delivery 1/2",
      status: "delivered",
    })

    expect(getTaskContinuity("lineage-1")).toMatchObject({
      lineageRootRunId: "lineage-1",
      parentRunId: "run-parent",
      handoffSummary: "이전 단계 요약",
      lastGoodState: "screen_capture 승인 요청",
      pendingApprovals: ["approval:screen_capture"],
      pendingDelivery: ["slack:file:/tmp/screen.png"],
      lastToolReceipt: "screen_capture:slack:/tmp/screen.png",
      lastDeliveryReceipt: "slack:/tmp/screen.png",
      failedRecoveryKey: "delivery:screen_capture",
      failureKind: "delivery",
      recoveryBudget: "delivery 1/2",
      status: "delivered",
    })

    upsertTaskContinuity({
      lineageRootRunId: "lineage-1",
      pendingApprovals: [],
      pendingDelivery: [],
      status: "completed",
    })

    expect(getTaskContinuity("lineage-1")).toMatchObject({
      pendingApprovals: [],
      pendingDelivery: [],
      status: "completed",
    })
    expect(listTaskContinuityForLineages(["lineage-1", "missing"]).map((item) => item.lineageRootRunId)).toEqual([
      "lineage-1",
    ])
  })

  it("recovers pending approval state after process restart", () => {
    insertSession({
      id: "session-approval",
      source: "webui",
      source_id: null,
      created_at: Date.now(),
      updated_at: Date.now(),
      summary: null,
    })
    createRootRun({
      id: "run-approval",
      sessionId: "session-approval",
      requestGroupId: "group-approval",
      prompt: "화면 캡처",
      source: "webui",
    })
    updateRunStatus("run-approval", "awaiting_approval", "screen_capture 승인 대기", true)

    const recovered = recoverActiveRunsOnStartup()
    const run = getRootRun("run-approval")
    const continuity = getTaskContinuity("group-approval")

    expect(recovered.map((item) => item.id)).toContain("run-approval")
    expect(run?.status).toBe("awaiting_approval")
    expect(continuity).toMatchObject({
      lineageRootRunId: "group-approval",
      status: "awaiting_approval",
      pendingApprovals: ["approval:run-approval"],
      pendingDelivery: [],
    })
  })

  it("marks already delivered runs completed on startup without another artifact send", async () => {
    insertSession({
      id: "session-delivered",
      source: "slack",
      source_id: null,
      created_at: Date.now(),
      updated_at: Date.now(),
      summary: null,
    })
    createRootRun({
      id: "run-delivered",
      sessionId: "session-delivered",
      requestGroupId: "group-delivered",
      prompt: "메인 화면 캡처해서 보여줘",
      source: "slack",
    })
    upsertTaskContinuity({
      lineageRootRunId: "group-delivered",
      lastDeliveryReceipt: "slack:/tmp/screen.png",
      pendingDelivery: [],
      status: "delivered",
    })
    insertArtifactReceipt({
      runId: "run-delivered",
      requestGroupId: "group-delivered",
      channel: "slack",
      artifactPath: "/tmp/screen.png",
      deliveredAt: Date.now(),
    })

    const recovered = recoverActiveRunsOnStartup()
    const deliveryTask = vi.fn(async () => "sent")
    const delivery = await deliverArtifactOnce({
      runId: "run-delivered",
      channel: "slack",
      filePath: "/tmp/screen.png",
      task: deliveryTask,
    })
    const run = getRootRun("run-delivered")
    const continuity = getTaskContinuity("group-delivered")

    expect(recovered.map((item) => item.id)).toContain("run-delivered")
    expect(run?.status).toBe("completed")
    expect(continuity?.status).toBe("delivered")
    expect(delivery).toBeUndefined()
    expect(deliveryTask).not.toHaveBeenCalled()
  })
})
