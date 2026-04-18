import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb } from "../packages/core/src/db/index.js"
import {
  createDryRunWebRetrievalLiveSmokeExecutor,
  getDefaultWebRetrievalLiveSmokeScenarios,
  isLiveWebSmokeEnabled,
  runWebRetrievalLiveSmokeScenarios,
} from "../packages/core/src/runs/web-retrieval-smoke.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const previousLive = process.env["NOBIE_LIVE_WEB_SMOKE"]

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task008-live-smoke-"))
  tempDirs.push(stateDir)
  const configPath = join(stateDir, "config.json5")
  writeFileSync(configPath, `{
    ai: { connection: { provider: "ollama", endpoint: "http://127.0.0.1:11434", model: "llama3.2" } },
    webui: { enabled: true, host: "127.0.0.1", port: 18181, auth: { enabled: false } },
    security: { approvalMode: "off" },
    scheduler: { enabled: false, timezone: "Asia/Seoul" }
  }`, "utf-8")
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = configPath
  reloadConfig()
}

beforeEach(() => {
  useTempState()
  delete process.env["NOBIE_LIVE_WEB_SMOKE"]
})

afterEach(() => {
  closeDb()
  if (previousStateDir === undefined) delete process.env["NOBIE_STATE_DIR"]
  else process.env["NOBIE_STATE_DIR"] = previousStateDir
  if (previousConfig === undefined) delete process.env["NOBIE_CONFIG"]
  else process.env["NOBIE_CONFIG"] = previousConfig
  if (previousLive === undefined) delete process.env["NOBIE_LIVE_WEB_SMOKE"]
  else process.env["NOBIE_LIVE_WEB_SMOKE"] = previousLive
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("task008 opt-in live web smoke", () => {
  it("does not run live web smoke unless NOBIE_LIVE_WEB_SMOKE=1", async () => {
    expect(isLiveWebSmokeEnabled()).toBe(false)

    const summary = await runWebRetrievalLiveSmokeScenarios({ mode: "live-run" })

    expect(summary.status).toBe("skipped")
    expect(summary.counts.skipped).toBe(getDefaultWebRetrievalLiveSmokeScenarios().length)
    expect(summary.results.every((result) => result.reason === "live_web_smoke_disabled")).toBe(true)
  })

  it("runs deterministic dry-run scenarios and writes sanitized diagnostic artifact", async () => {
    const summary = await runWebRetrievalLiveSmokeScenarios({
      mode: "dry-run",
      writeArtifact: true,
      executeScenario: createDryRunWebRetrievalLiveSmokeExecutor({
        traceOverrides: {
          nasdaq: {
            finalText: "dry-run sent without Bearer super-secret-token and without /Users/test/raw.html",
            rawError: "Bearer super-secret-token <html>blocked</html> /Users/test/raw.html",
          },
        },
      }),
    })

    expect(summary.status).toBe("passed")
    expect(summary.counts).toEqual({ total: 4, passed: 4, failed: 0, skipped: 0 })
    expect(summary.artifactPath).toBeTruthy()
    expect(summary.artifactPath ? existsSync(summary.artifactPath) : false).toBe(true)
    const artifact = readFileSync(summary.artifactPath!, "utf-8")
    expect(artifact).not.toContain("super-secret-token")
    expect(artifact).not.toContain("/Users/test")
    expect(artifact).not.toContain("<html>")
    expect(artifact).toContain("Bearer ***")
  })
})
