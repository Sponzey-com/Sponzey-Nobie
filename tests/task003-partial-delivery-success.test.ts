import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, listMessageLedgerEvents } from "../packages/core/src/db/index.js"
import { recordMessageLedgerEvent } from "../packages/core/src/runs/message-ledger.js"
import {
  protectRunFailureAfterFinalAnswer,
  recordFinalAnswerDelivery,
} from "../packages/core/src/runs/retrieval-finalizer.js"
import type { RetrievalVerificationVerdict } from "../packages/core/src/runs/web-retrieval-verification.js"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempConfig(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task003-partial-"))
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

function makeVerdict(): RetrievalVerificationVerdict {
  return {
    candidateId: "candidate-report",
    canAnswer: true,
    bindingStrength: "strong",
    evidenceSufficiency: "sufficient_approximate",
    rejectionReason: null,
    policy: "latest_approximate",
    sourceEvidenceId: "source-report",
    targetId: "target-report",
    acceptedValue: "25",
    acceptedUnit: "celsius",
    bindingSignals: [{ kind: "location", value: "동천동", weight: 0.45, evidenceField: "target.locationName" }],
    conflicts: [],
    caveats: [],
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

describe("task003 partial delivery success", () => {
  it("keeps the run completed when file delivery fails after final text answer delivery", () => {
    const requestGroupId = "request-partial-success"
    recordFinalAnswerDelivery({ requestGroupId, sessionKey: "session-partial", channel: "telegram", text: "동천동은 현재 25°C입니다.", verdict: makeVerdict() })
    recordMessageLedgerEvent({
      requestGroupId,
      channel: "telegram",
      eventKind: "artifact_delivery_failed",
      deliveryKey: "artifact:telegram:weather.png",
      status: "failed",
      summary: "telegram file delivery failed",
    })

    const protectedResult = protectRunFailureAfterFinalAnswer({ requestGroupId, channel: "telegram", requestedStatus: "failed", requestedSummary: "telegram_send_file failed" })
    const events = listMessageLedgerEvents({ requestGroupId })

    expect(protectedResult.shouldProtectDeliveredAnswer).toBe(true)
    expect(protectedResult.outcome).toBe("partial_success")
    expect(protectedResult.runStatus).toBe("completed")
    expect(events.some((event) => event.event_kind === "delivery_finalized" && event.status === "degraded")).toBe(true)
  })

  it("does not let another channel delivery receipt protect the requested channel", () => {
    const requestGroupId = "request-channel-mismatch"
    recordFinalAnswerDelivery({ requestGroupId, sessionKey: "session-mismatch", channel: "webui", text: "동천동은 현재 25°C입니다.", verdict: makeVerdict() })

    const telegramResult = protectRunFailureAfterFinalAnswer({ requestGroupId, channel: "telegram", requestedStatus: "failed", requestedSummary: "telegram failed" })
    const webuiResult = protectRunFailureAfterFinalAnswer({ requestGroupId, channel: "webui", requestedStatus: "failed", requestedSummary: "fallback failed" })

    expect(telegramResult.shouldProtectDeliveredAnswer).toBe(false)
    expect(telegramResult.reason).toBe("no_final_answer_receipt_for_channel")
    expect(webuiResult.shouldProtectDeliveredAnswer).toBe(true)
    expect(webuiResult.runStatus).toBe("completed")
  })
})
