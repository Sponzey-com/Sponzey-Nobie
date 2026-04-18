import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb } from "../packages/core/src/db/index.js"
import { runDoctor } from "../packages/core/src/diagnostics/doctor.js"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempConfig(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task007-doctor-"))
  tempDirs.push(stateDir)
  const configPath = join(stateDir, "config.json5")
  writeFileSync(configPath, `{
    ai: { connection: { provider: "ollama", endpoint: "http://127.0.0.1:11434", model: "llama3.2" } },
    search: { web: { provider: "duckduckgo", maxResults: 5 } },
    webui: { enabled: true, host: "127.0.0.1", port: 18181, auth: { enabled: false } },
    security: { approvalMode: "off" },
    memory: { searchMode: "fts", sessionRetentionDays: 30 },
    scheduler: { enabled: false, timezone: "Asia/Seoul" }
  }`, "utf-8")
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = configPath
  reloadConfig()
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

describe("task007 doctor web retrieval", () => {
  it("reports provider order, browser fallback, adapter checksum, and recent counters", () => {
    const report = runDoctor({ mode: "quick", includeEnvironment: false, includeReleasePackage: false })
    const check = report.checks.find((item) => item.name === "web.retrieval")
    expect(check).toBeTruthy()
    expect(check?.status).toBe("ok")
    expect(check?.detail).toEqual(expect.objectContaining({
      searchProvider: "duckduckgo",
      activeAdapterCount: expect.any(Number),
      degradedAdapterCount: 0,
      browser: expect.objectContaining({ driver: "selenium-webdriver", fallback: "duckduckgo_lite" }),
      recent: expect.objectContaining({ conflictCount: 0, plannerSchemaFailureCount: 0, failedAttemptCount: 0 }),
    }))
    const serialized = JSON.stringify(check?.detail)
    expect(serialized).toContain("finance")
    expect(serialized).toContain("weather")
    expect(serialized).toContain("checksum")
    expect(serialized).not.toMatch(/sk-|Bearer\s+/u)
  })
})
