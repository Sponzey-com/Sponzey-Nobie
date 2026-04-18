import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, getDb } from "../packages/core/src/db/index.js"
import { exportRetrievalEvidenceTimeline, recordControlEvent } from "../packages/core/src/control-plane/timeline.js"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempConfig(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task007-export-"))
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

describe("task007 retrieval evidence sanitized export", () => {
  it("redacts raw HTML, tokens, local paths, and audits the export", () => {
    recordControlEvent({
      eventType: "web_retrieval.attempt.recorded",
      component: "web_retrieval",
      requestGroupId: "group-task007-export",
      correlationId: "retrieval-session-export",
      severity: "warning",
      summary: "fetch returned <html><body>403 forbidden</body></html>",
      detail: {
        method: "direct_fetch",
        sourceUrl: "https://finance.example/ixic",
        localPath: "/Users/dongwooshin/.nobie/raw/browser.html",
        authorization: "Bearer sk-secret-token-value",
        providerRawResponse: "<!doctype html><html><script>token</script><body>blocked</body></html>",
        verdict: { canAnswer: false, rejectionReason: "candidate_missing", evidenceSufficiency: "insufficient_candidate_missing", conflicts: ["nasdaq_100"] },
      },
    })

    const userExport = exportRetrievalEvidenceTimeline({ requestGroupId: "group-task007-export", audience: "user", format: "json" })
    const developerExport = exportRetrievalEvidenceTimeline({ requestGroupId: "group-task007-export", audience: "developer", format: "markdown" })
    const serialized = JSON.stringify(userExport)
    const auditRows = getDb()
      .prepare<[], { tool_name: string }>("SELECT tool_name FROM audit_logs WHERE source = 'control-plane' ORDER BY timestamp ASC")
      .all()
      .map((row) => row.tool_name)

    expect(serialized).not.toContain("/Users/dongwooshin")
    expect(serialized).not.toContain("sk-secret-token-value")
    expect(serialized).not.toContain("<html")
    expect(serialized).toContain("insufficient_candidate_missing")
    expect(developerExport.content).toContain("Retrieval Evidence Timeline")
    expect(auditRows).toEqual(expect.arrayContaining(["retrieval_evidence_user_export", "retrieval_evidence_developer_export"]))
  })
})
