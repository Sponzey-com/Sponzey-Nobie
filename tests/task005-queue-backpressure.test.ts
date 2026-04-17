import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, listQueueBackpressureEvents } from "../packages/core/src/db/index.js"
import { runDoctor } from "../packages/core/src/diagnostics/doctor.ts"
import { listAuditEvents } from "../packages/core/src/api/routes/audit.ts"
import {
  QueueBackpressureError,
  buildBackpressureUserMessage,
  buildQueueBackpressureSnapshot,
  enqueueBackpressureTask,
  recordRetryBudgetAttempt,
  resetQueueBackpressureState,
} from "../packages/core/src/runs/queue-backpressure.ts"
import { deliverChunk } from "../packages/core/src/runs/delivery.ts"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempConfig(): void {
  closeDb()
  resetQueueBackpressureState()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task005-queue-"))
  tempDirs.push(stateDir)
  const configPath = join(stateDir, "config.json5")
  writeFileSync(configPath, `{
    ai: { connection: { provider: "ollama", model: "llama3.2", endpoint: "http://127.0.0.1:11434" } },
    webui: { enabled: true, host: "127.0.0.1", port: 0, auth: { enabled: false } },
    security: { approvalMode: "off" }
  }`, "utf-8")
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = configPath
  reloadConfig()
}

beforeEach(() => {
  useTempConfig()
})

afterEach(() => {
  resetQueueBackpressureState()
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

describe("task005 queue backpressure", () => {
  it("keeps fast receipt isolated from a blocked browser queue", async () => {
    let releaseBrowser!: () => void
    const browser = enqueueBackpressureTask({
      queueName: "web_browser",
      runId: "run-browser",
      recoveryKey: "browser:timeout",
      budget: { timeoutMs: 5_000 },
      task: () => new Promise<string>((resolve) => {
        releaseBrowser = () => resolve("browser done")
      }),
    })

    const receipt = await enqueueBackpressureTask({
      queueName: "fast_receipt",
      runId: "run-receipt",
      task: async () => "receipt sent",
    })

    expect(receipt).toBe("receipt sent")
    expect(buildQueueBackpressureSnapshot().find((queue) => queue.queueName === "web_browser")).toMatchObject({ running: 1 })
    releaseBrowser()
    await expect(browser).resolves.toBe("browser done")
  })

  it("rejects queue overflow without turning it into a user-facing failure loop", async () => {
    let releaseFirst!: () => void
    const first = enqueueBackpressureTask({
      queueName: "web_browser",
      budget: { concurrency: 1, maxPending: 1, timeoutMs: 5_000 },
      recoveryKey: "browser:overflow",
      task: () => new Promise<string>((resolve) => {
        releaseFirst = () => resolve("first")
      }),
    })
    const second = enqueueBackpressureTask({
      queueName: "web_browser",
      budget: { concurrency: 1, maxPending: 1, timeoutMs: 5_000 },
      recoveryKey: "browser:overflow",
      task: async () => "second",
    })

    await expect(enqueueBackpressureTask({
      queueName: "web_browser",
      budget: { concurrency: 1, maxPending: 1, timeoutMs: 5_000 },
      recoveryKey: "browser:overflow",
      task: async () => "third",
    })).rejects.toMatchObject({ code: "queue_full", queueName: "web_browser" })

    const rejected = listQueueBackpressureEvents({ eventKind: "rejected", queueName: "web_browser" })
    expect(rejected[0]).toMatchObject({ action_taken: "queue_full", recovery_key: "browser:overflow" })
    releaseFirst()
    await expect(first).resolves.toBe("first")
    await expect(second).resolves.toBe("second")
  })

  it("stops retry storms with a dead-letter event and audit timeline entry", () => {
    const first = recordRetryBudgetAttempt({ queueName: "delivery", recoveryKey: "telegram:send:403", runId: "run-delivery", budget: { retryCount: 2 } })
    const second = recordRetryBudgetAttempt({ queueName: "delivery", recoveryKey: "telegram:send:403", runId: "run-delivery", budget: { retryCount: 2 } })
    const third = recordRetryBudgetAttempt({ queueName: "delivery", recoveryKey: "telegram:send:403", runId: "run-delivery", budget: { retryCount: 2 } })

    expect(first).toMatchObject({ allowed: true, retryCount: 1, retryBudgetRemaining: 1 })
    expect(second).toMatchObject({ allowed: true, retryCount: 2, retryBudgetRemaining: 0 })
    expect(third).toMatchObject({ allowed: false, actionTaken: "dead_letter" })
    expect(third.userMessage).toContain("자동 재시도를 중단")

    const deadLetters = listQueueBackpressureEvents({ eventKind: "dead_letter", queueName: "delivery" })
    expect(deadLetters[0]).toMatchObject({ recovery_key: "telegram:send:403", action_taken: "stop_auto_retry" })
    const audit = listAuditEvents({ kind: "queue_backpressure", limit: "10" })
    expect(audit.items.some((item) => item.errorCode === "dead_letter" && item.toolName === "delivery")).toBe(true)
  })

  it("routes channel chunk failures through the delivery retry budget", async () => {
    const errors: string[] = []
    for (let index = 0; index < 4; index += 1) {
      await deliverChunk({
        onChunk: async () => {
          throw new Error("telegram send failed 403")
        },
        chunk: { type: "text", delta: "hello" },
        runId: "run-delivery-chunk",
        onError: (message) => errors.push(message),
      })
    }

    expect(errors).toHaveLength(4)
    expect(errors.at(-1)).toContain("자동 재시도를 중단")
    expect(listQueueBackpressureEvents({ eventKind: "retry_scheduled", queueName: "delivery" })).toHaveLength(3)
    expect(listQueueBackpressureEvents({ eventKind: "dead_letter", queueName: "delivery" })[0]).toMatchObject({
      recovery_key: "chunk:run-delivery-chunk:text",
      action_taken: "stop_auto_retry",
    })
  })

  it("surfaces backpressure status through doctor and user messages", () => {
    recordRetryBudgetAttempt({ queueName: "tool_execution", recoveryKey: "yeonjang:mqtt:disconnect", budget: { retryCount: 0 } })

    const report = runDoctor({ mode: "quick", includeEnvironment: false, includeReleasePackage: false })
    const queueCheck = report.checks.find((check) => check.name === "queue.backpressure")
    expect(queueCheck?.status).toBe("blocked")
    expect(buildBackpressureUserMessage("waiting", "web_browser")).toContain("실패가 아니라")
    expect(buildBackpressureUserMessage("recovering", "delivery")).toContain("복구 중")
    expect(buildBackpressureUserMessage("retry_stopped", "tool_execution")).toContain("명시적으로 다시 시도")
  })
})

void QueueBackpressureError
