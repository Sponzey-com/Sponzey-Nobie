import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb } from "../packages/core/src/db/index.js"
import {
  finalizeRetrievalCompletion,
  recordFinalAnswerDelivery,
} from "../packages/core/src/runs/retrieval-finalizer.js"
import type { RetrievalVerificationVerdict } from "../packages/core/src/runs/web-retrieval-verification.js"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempConfig(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task003-finalizer-"))
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

function makeVerdict(overrides: Partial<RetrievalVerificationVerdict> = {}): RetrievalVerificationVerdict {
  return {
    candidateId: "candidate-kospi",
    canAnswer: true,
    bindingStrength: "strong",
    evidenceSufficiency: "sufficient_approximate",
    rejectionReason: null,
    policy: "latest_approximate",
    sourceEvidenceId: "source-kospi",
    targetId: "target-kospi",
    acceptedValue: "6226.05",
    acceptedUnit: "point",
    bindingSignals: [{ kind: "symbol", value: "KOSPI", weight: 0.45, evidenceField: "target.symbols" }],
    conflicts: [],
    caveats: ["collection-time approximate value"],
    ...overrides,
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

describe("task003 retrieval completion finalizer", () => {
  it("requires retrieval verdict and final answer delivery receipt before value-found completion", () => {
    const verdict = makeVerdict()

    const withoutReceipt = finalizeRetrievalCompletion({ verdict })
    const receipt = recordFinalAnswerDelivery({
      requestGroupId: "request-finalizer-value",
      sessionKey: "session-finalizer",
      channel: "telegram",
      text: "코스피는 수집 시각 기준 6,226.05 포인트입니다.",
      verdict,
    })
    const completed = finalizeRetrievalCompletion({ verdict, finalAnswerReceipt: receipt })

    expect(withoutReceipt.status).toBe("awaiting_user")
    expect(withoutReceipt.completionSatisfied).toBe(false)
    expect(receipt.delivered).toBe(true)
    expect(completed.status).toBe("completed_approximate_value_found")
    expect(completed.runStatus).toBe("completed")
    expect(completed.shouldRetryRecovery).toBe(false)
  })

  it("does not allow raw assistant text to complete retrieval without a verdict", () => {
    const receipt = recordFinalAnswerDelivery({
      requestGroupId: "request-finalizer-no-verdict",
      sessionKey: "session-finalizer",
      channel: "telegram",
      text: "코스피는 6,226.05입니다.",
      verdict: null,
    })
    const completion = finalizeRetrievalCompletion({ verdict: null, finalAnswerReceipt: receipt })

    expect(receipt.status).toBe("blocked")
    expect(receipt.reason).toBe("retrieval_verdict_required")
    expect(completion.status).toBe("awaiting_user")
    expect(completion.completionSatisfied).toBe(false)
  })

  it("treats limited no-value delivery as constrained completion instead of retry failure", () => {
    const verdict = makeVerdict({
      candidateId: null,
      canAnswer: false,
      bindingStrength: "none",
      evidenceSufficiency: "insufficient_candidate_missing",
      rejectionReason: "candidate_missing",
      sourceEvidenceId: null,
      acceptedValue: null,
      acceptedUnit: null,
      bindingSignals: [],
      caveats: [],
    })
    const receipt = recordFinalAnswerDelivery({
      requestGroupId: "request-finalizer-limited",
      sessionKey: "session-finalizer",
      channel: "telegram",
      text: "확인 가능한 값 후보가 없어 수집 제한 완료로 종료합니다.",
      verdict,
    })
    const completion = finalizeRetrievalCompletion({ verdict, finalAnswerReceipt: receipt })

    expect(receipt.delivered).toBe(true)
    expect(completion.status).toBe("completed_limited_no_value")
    expect(completion.runStatus).toBe("completed")
    expect(completion.shouldRetryRecovery).toBe(false)
  })
})
