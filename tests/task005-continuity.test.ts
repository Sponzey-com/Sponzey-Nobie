import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  closeDb,
  getTaskContinuity,
  listTaskContinuityForLineages,
  upsertTaskContinuity,
} from "../packages/core/src/db/index.js"
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
})
