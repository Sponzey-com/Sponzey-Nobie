import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, listMessageLedgerEvents } from "../packages/core/src/db/index.js"
import {
  recordFinalAnswerDelivery,
  recordProgressMessageSent,
} from "../packages/core/src/runs/retrieval-finalizer.js"
import type { RetrievalVerificationVerdict } from "../packages/core/src/runs/web-retrieval-verification.js"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempConfig(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task003-duplicate-"))
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
    candidateId: "candidate-weather",
    canAnswer: true,
    bindingStrength: "strong",
    evidenceSufficiency: "sufficient_approximate",
    rejectionReason: null,
    policy: "latest_approximate",
    sourceEvidenceId: "source-weather",
    targetId: "target-weather",
    acceptedValue: "25",
    acceptedUnit: "celsius",
    bindingSignals: [{ kind: "location", value: "동천동", weight: 0.45, evidenceField: "target.locationName" }],
    conflicts: [],
    caveats: ["collection-time approximate value"],
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

describe("task003 duplicate final answer guard", () => {
  it("separates progress messages from the single final answer ledger entry", () => {
    const requestGroupId = "request-duplicate-final-answer"
    const verdict = makeVerdict()

    recordProgressMessageSent({ requestGroupId, sessionKey: "session-1", channel: "telegram", text: "요청을 접수했습니다. 분석을 시작합니다.", createdAt: 1 })
    recordProgressMessageSent({ requestGroupId, sessionKey: "session-1", channel: "telegram", text: "web_search done", createdAt: 2 })
    const first = recordFinalAnswerDelivery({ requestGroupId, sessionKey: "session-1", channel: "telegram", text: "동천동은 현재 25°C입니다.", verdict, createdAt: 3 })
    const duplicate = recordFinalAnswerDelivery({ requestGroupId, sessionKey: "session-1", channel: "telegram", text: "동천동은 현재 25°C이고 맑습니다.", verdict, createdAt: 4 })
    const events = listMessageLedgerEvents({ requestGroupId })

    expect(first.status).toBe("delivered")
    expect(duplicate.status).toBe("suppressed")
    expect(duplicate.duplicate).toBe(true)
    expect(events.filter((event) => event.event_kind === "progress_message_sent")).toHaveLength(2)
    expect(events.filter((event) => event.event_kind === "final_answer_delivered")).toHaveLength(1)
    expect(events.filter((event) => event.event_kind === "final_answer_suppressed")).toHaveLength(1)
  })

  it("treats same final answer retry as idempotent success without retransmission", () => {
    const requestGroupId = "request-idempotent-final-answer"
    const verdict = makeVerdict()
    const first = recordFinalAnswerDelivery({ requestGroupId, sessionKey: "session-2", channel: "slack", text: "동천동은 현재 25°C입니다.", verdict })
    const retry = recordFinalAnswerDelivery({ requestGroupId, sessionKey: "session-2", channel: "slack", text: "동천동은 현재 25°C입니다.", verdict })
    const events = listMessageLedgerEvents({ requestGroupId })

    expect(first.delivered).toBe(true)
    expect(retry.delivered).toBe(true)
    expect(retry.duplicate).toBe(true)
    expect(retry.idempotencyKey).toBe(first.idempotencyKey)
    expect(events.filter((event) => event.event_kind === "final_answer_delivered")).toHaveLength(1)
  })
})
