import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, getDb, insertSession } from "../packages/core/src/db/index.js"
import { buildRuntimeManifest } from "../packages/core/src/runtime/manifest.js"
import { runDoctor, writeDoctorReportArtifact } from "../packages/core/src/diagnostics/doctor.js"
import { createRootRun } from "../packages/core/src/runs/store.js"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempConfig(configBody: string): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task001-doctor-"))
  tempDirs.push(stateDir)
  const configPath = join(stateDir, "config.json5")
  writeFileSync(configPath, configBody, "utf-8")
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = configPath
  reloadConfig()
}

beforeEach(() => {
  useTempConfig(`{
    ai: {
      connection: {
        provider: "openai",
        model: "gpt-5.4-mini",
        endpoint: "https://api.openai.example/v1",
        auth: {
          mode: "api_key",
          apiKey: "sk-test-secret-value-1234567890"
        }
      }
    },
    webui: {
      enabled: true,
      host: "0.0.0.0",
      port: 18888,
      auth: { enabled: false }
    },
    telegram: {
      enabled: true,
      botToken: "123456789:telegram-secret-token",
      allowedUserIds: [42120565],
      allowedGroupIds: []
    },
    slack: {
      enabled: true,
      botToken: "xoxb-secret-token-1234567890",
      appToken: "xapp-secret-token-1234567890",
      allowedUserIds: ["U123"],
      allowedChannelIds: ["C123"]
    },
    memory: {
      searchMode: "hybrid",
      sessionRetentionDays: 30,
      embedding: {
        provider: "ollama",
        model: "nomic-embed-text"
      }
    },
    scheduler: {
      enabled: true,
      timezone: "Asia/Seoul"
    }
  }`)
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

describe("task001 runtime manifest and doctor", () => {
  it("builds a runtime manifest without leaking configured secrets", () => {
    const manifest = buildRuntimeManifest({
      now: new Date("2026-04-16T00:00:00.000Z"),
      includeEnvironment: false,
      includeReleasePackage: false,
    })
    const serialized = JSON.stringify(manifest)

    expect(manifest.kind).toBe("nobie.runtime.manifest")
    expect(manifest.id).toHaveLength(24)
    expect(manifest.provider).toMatchObject({
      provider: "openai",
      model: "gpt-5.4-mini",
      credentialConfigured: true,
      embeddingConfigured: true,
    })
    expect(manifest.database.latestVersion).toBeGreaterThan(0)
    expect(manifest.promptSources.count).toBeGreaterThan(0)
    expect(serialized).not.toContain("sk-test-secret")
    expect(serialized).not.toContain("telegram-secret-token")
    expect(serialized).not.toContain("xoxb-secret-token")
  })

  it("runs required doctor checks and writes a sanitized report artifact", () => {
    const report = runDoctor({
      mode: "quick",
      now: new Date("2026-04-16T00:00:00.000Z"),
      includeEnvironment: false,
      includeReleasePackage: false,
    })
    const names = report.checks.map((check) => check.name)
    const artifactPath = writeDoctorReportArtifact(report)
    const serialized = JSON.stringify(report)

    expect(names).toEqual(expect.arrayContaining([
      "runtime.manifest",
      "provider.chat",
      "provider.embedding",
      "gateway.exposure",
      "credential.redaction",
      "channel.telegram",
      "channel.slack",
      "channel.webui",
      "yeonjang.mqtt",
      "yeonjang.protocol",
      "db.migration",
      "prompt.registry",
      "memory.fts",
      "memory.vector",
      "queue.backpressure",
      "artifact.storage",
      "schedule.queue",
      "release.package",
    ]))
    expect(report.checks.find((check) => check.name === "gateway.exposure")?.status).toBe("blocked")
    expect(report.checks.find((check) => check.name === "credential.redaction")?.status).toBe("ok")
    expect(report.summary.blocked).toBeGreaterThanOrEqual(1)
    expect(existsSync(artifactPath)).toBe(true)
    expect(serialized).not.toContain("sk-test-secret")
    expect(serialized).not.toContain("telegram-secret-token")
    expect(serialized).not.toContain("xoxb-secret-token")
  })

  it("connects newly created runs to the active runtime manifest id", () => {
    insertSession({
      id: "session-manifest",
      source: "webui",
      source_id: null,
      created_at: Date.now(),
      updated_at: Date.now(),
      summary: null,
    })
    const manifestAfterDb = buildRuntimeManifest({ includeEnvironment: false, includeReleasePackage: false })

    const run = createRootRun({
      id: "run-manifest",
      sessionId: "session-manifest",
      prompt: "manifest id 확인",
      source: "webui",
    })

    const row = getDb().prepare<[], { runtime_manifest_id: string | null }>("SELECT runtime_manifest_id FROM root_runs WHERE id = 'run-manifest'").get()
    expect(manifestAfterDb.id).toMatch(/^[a-f0-9]{24}$/)
    expect(row).toEqual({ runtime_manifest_id: expect.any(String) })
    expect(row?.runtime_manifest_id).toMatch(/^[a-f0-9]{24}$/)
    expect(run.runtimeManifestId).toBe(row?.runtime_manifest_id)
  })
})
