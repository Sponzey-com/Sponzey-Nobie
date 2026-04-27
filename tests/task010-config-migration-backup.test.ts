import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PATHS, reloadConfig } from "../packages/core/src/config/index.js"
import {
  createDatabaseBackup,
  dryRunDatabaseMigrations,
  exportMaskedConfig,
  exportPromptSources,
  getDatabaseMigrationStatus,
  importDatabaseFromBackup,
  importPromptSources,
  maskSecretsDeep,
  recoverPromptSources,
} from "../packages/core/src/config/operations.ts"
import { closeDb, getDb, getSession, insertSession } from "../packages/core/src/db/index.ts"
import { MIGRATIONS } from "../packages/core/src/db/migrations.ts"
import { ensurePromptSourceFiles, loadPromptSourceRegistry } from "../packages/core/src/memory/nobie-md.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function useTempState(prefix = "nobie-task010-state-"): string {
  closeDb()
  const stateDir = makeTempDir(prefix)
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = join(stateDir, "config.json5")
  reloadConfig()
  return stateDir
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

describe("task010 configuration, migration, backup", () => {
  it("reports migration version and dry-runs without changing an old DB fixture", () => {
    getDb()
    getDb().prepare("DELETE FROM schema_migrations WHERE version > ?").run(1)
    const before = getDb().prepare("SELECT version FROM schema_migrations ORDER BY version").all()
    const dryRun = dryRunDatabaseMigrations(PATHS.dbFile)
    const after = getDb().prepare("SELECT version FROM schema_migrations ORDER BY version").all()

    expect(dryRun.changesDatabase).toBe(false)
    expect(dryRun.status.currentVersion).toBe(1)
    expect(dryRun.status.latestVersion).toBe(MIGRATIONS[MIGRATIONS.length - 1].version)
    expect(dryRun.willApply[0].version).toBe(2)
    expect(after).toEqual(before)
  })

  it("backs up, exports, imports, and rolls DB state back to the selected backup", () => {
    insertSession({
      id: "session-before-backup",
      source: "webui",
      source_id: null,
      created_at: 1,
      updated_at: 1,
      summary: null,
    })

    const backup = createDatabaseBackup("backup")
    const exported = createDatabaseBackup("export")
    expect(existsSync(backup.backupPath)).toBe(true)
    expect(existsSync(exported.backupPath)).toBe(true)

    insertSession({
      id: "session-after-backup",
      source: "webui",
      source_id: null,
      created_at: 2,
      updated_at: 2,
      summary: null,
    })
    expect(getSession("session-after-backup")?.id).toBe("session-after-backup")

    const imported = importDatabaseFromBackup({ backupPath: backup.backupPath })
    expect(imported.status.upToDate).toBe(true)
    expect(existsSync(imported.rollbackBackup.backupPath)).toBe(true)
    expect(getSession("session-before-backup")?.id).toBe("session-before-backup")
    expect(getSession("session-after-backup")).toBeUndefined()
  })

  it("masks secrets in config exports while preserving channel/user routing ids", () => {
    mkdirSync(PATHS.stateDir, { recursive: true })
    writeFileSync(PATHS.configFile, `{
      ai: { connection: { provider: "openai", model: "gpt-test", auth: { apiKey: "sk-testsecretvalue1234567890" } } },
      telegram: { enabled: true, botToken: "123456:telegramtokenabcdefghijklmnopqrstuvwxyz", allowedUserIds: [42120565] },
      slack: { enabled: true, appToken: "xapp-verylongslackapptoken-1234567890", allowedChannelIds: ["C12345"] },
      mqtt: { username: "nobie", password: "mqttpassword1234567890" }
    }`, "utf-8")

    const masked = maskSecretsDeep({ token: "123456:telegramtokenabcdefghijklmnopqrstuvwxyz", channelId: "C12345" })
    expect(masked.value).toEqual({ token: "***MASKED***", channelId: "C12345" })

    const exported = exportMaskedConfig()
    const payload = readFileSync(exported.exportPath, "utf-8")
    expect(payload).not.toContain("sk-testsecretvalue")
    expect(payload).not.toContain("telegramtoken")
    expect(payload).not.toContain("mqttpassword")
    expect(payload).toContain("42120565")
    expect(payload).toContain("C12345")
    expect(exported.masking.secretsMasked).toBeGreaterThanOrEqual(3)
  })

  it("exports/imports prompt sources and recovers missing defaults without overwriting edits", () => {
    const sourceRoot = makeTempDir("nobie-task010-prompts-source-")
    const targetRoot = makeTempDir("nobie-task010-prompts-target-")
    ensurePromptSourceFiles(sourceRoot)
    ensurePromptSourceFiles(targetRoot)

    const editedUserPrompt = join(sourceRoot, "prompts", "user.md")
    writeFileSync(editedUserPrompt, "# User\n\n- Preferred name: custom-edit\n", "utf-8")
    const missingPrompt = join(sourceRoot, "prompts", "identity.md")
    unlinkSync(missingPrompt)

    const recovery = recoverPromptSources(sourceRoot)
    expect(recovery.created).toContain("identity.md")
    expect(readFileSync(editedUserPrompt, "utf-8")).toContain("custom-edit")

    const exported = exportPromptSources(sourceRoot)
    expect(existsSync(exported.exportPath)).toBe(true)

    rmSync(join(targetRoot, "prompts", "channel.md"), { force: true })
    const imported = importPromptSources({ workDir: targetRoot, exportPath: exported.exportPath, overwrite: false })
    expect(imported.imported).toContain("channel:en")
    expect(imported.skipped).toContain("user:en")
    expect(loadPromptSourceRegistry(targetRoot).some((source) => source.sourceId === "channel" && source.locale === "en")).toBe(true)
  })

  it("reports the current migrated DB as up to date", () => {
    getDb()
    const status = getDatabaseMigrationStatus()
    expect(status.upToDate).toBe(true)
    expect(status.currentVersion).toBe(status.latestVersion)
  })
})
