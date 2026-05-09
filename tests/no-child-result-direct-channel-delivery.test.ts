import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, listMessageLedgerEvents } from "../packages/core/src/db/index.js"
import { completeRunWithAssistantMessage } from "../packages/core/src/runs/finalization.ts"
import { applyLoopDirective } from "../packages/core/src/runs/loop-directive-application.ts"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempConfig(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-no-child-direct-delivery-"))
  tempDirs.push(stateDir)
  const configPath = join(stateDir, "config.json5")
  writeFileSync(configPath, `{
    ai: { connection: { provider: "ollama", endpoint: "http://127.0.0.1:11434", model: "llama3.2" } },
    webui: { enabled: true, host: "127.0.0.1", port: 18181, auth: { enabled: false } },
    security: { approvalMode: "off" },
    memory: { searchMode: "fts", sessionRetentionDays: 30 },
    scheduler: { enabled: false, timezone: "Asia/Seoul" }
  }`, "utf-8")
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = configPath
  reloadConfig()
}

function createFinalizationDependencies() {
  return {
    appendRunEvent: vi.fn(),
    setRunStepStatus: vi.fn(),
    updateRunStatus: vi.fn(),
    rememberRunSuccess: vi.fn(),
    rememberRunFailure: vi.fn(),
    onDeliveryError: vi.fn(),
    deliveryDependencies: {
      now: () => 0,
      createId: () => "message-1",
      insertMessage: vi.fn(),
      emitStart: vi.fn(),
      emitStream: vi.fn(),
      emitEnd: vi.fn(),
      writeReplyLog: vi.fn(),
    },
  }
}

beforeEach(() => {
  useTempConfig()
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

describe("task008 no child result direct channel delivery", () => {
  it("suppresses child complete text and leaves only a parent-aggregation ledger signal", async () => {
    const deps = createFinalizationDependencies()
    const onChunk = vi.fn().mockResolvedValue(undefined)
    const runId = "run-child-direct-delivery"

    await completeRunWithAssistantMessage({
      runId,
      sessionId: "session-child",
      text: "하위 실행자가 만든 답변입니다.",
      source: "telegram",
      onChunk,
      suppressFinalDelivery: true,
      suppressFinalDeliveryReasonCode: "child_result_parent_aggregation_required",
      dependencies: deps,
    })

    expect(onChunk).not.toHaveBeenCalled()
    expect(deps.deliveryDependencies.insertMessage).not.toHaveBeenCalled()
    expect(deps.deliveryDependencies.writeReplyLog).not.toHaveBeenCalled()
    expect(deps.appendRunEvent).toHaveBeenCalledWith(
      runId,
      "child_final_delivery_suppressed:child_result_parent_aggregation_required",
    )
    expect(deps.rememberRunSuccess).toHaveBeenCalledWith(expect.objectContaining({
      runId,
      text: "하위 실행자가 만든 답변입니다.",
    }))

    const ledger = listMessageLedgerEvents({ requestGroupId: runId })
    expect(ledger).toEqual([
      expect.objectContaining({
        event_kind: "final_answer_suppressed",
        status: "suppressed",
        delivery_key: `final-suppressed:${runId}`,
      }),
    ])
    expect(ledger[0]?.detail_json).toContain("child_result_parent_aggregation_required")
    expect(ledger[0]?.detail_json).toContain("parentAggregationRequired")
  })

  it("propagates child suppression through complete loop directives", async () => {
    const finalizationDependencies = createFinalizationDependencies()
    const moduleDependencies = {
      completeRunWithAssistantMessage: vi.fn().mockResolvedValue(undefined),
      markRunCompleted: vi.fn(),
      applyTerminalApplication: vi.fn(),
    }

    const result = await applyLoopDirective({
      runId: "run-child-loop-directive",
      sessionId: "session-child-loop",
      source: "telegram",
      onChunk: undefined,
      directive: { kind: "complete", text: "child final text" },
      finalizationDependencies,
      suppressFinalDelivery: true,
      suppressFinalDeliveryReasonCode: "child_result_parent_aggregation_required",
    }, moduleDependencies)

    expect(result).toBe("break")
    expect(moduleDependencies.completeRunWithAssistantMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-child-loop-directive",
        suppressFinalDelivery: true,
        suppressFinalDeliveryReasonCode: "child_result_parent_aggregation_required",
      }),
    )
  })
})
