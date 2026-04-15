import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { PATHS, reloadConfig } from "../packages/core/src/config/index.js"
import {
  buildBackupTargetInventory,
  buildMigrationPreflightReport,
  createBackupSnapshot,
  runRestoreRehearsal,
  verifyBackupSnapshotManifest,
} from "../packages/core/src/config/backup-rehearsal.ts"
import { closeDb, getDb, insertSession } from "../packages/core/src/db/index.ts"
import { ensurePromptSourceFiles } from "../packages/core/src/memory/nobie-md.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function useTempState(): { stateDir: string; workDir: string } {
  closeDb()
  const stateDir = makeTempDir("nobie-task007-state-")
  const workDir = makeTempDir("nobie-task007-work-")
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = join(stateDir, "config.json5")
  reloadConfig()
  ensurePromptSourceFiles(workDir)
  mkdirSync(dirname(PATHS.configFile), { recursive: true })
  writeFileSync(PATHS.configFile, `{
    ai: { connection: { provider: "openai", model: "gpt-test", auth: { apiKey: "sk-testsecretvalue1234567890" } } },
    telegram: { enabled: true, botToken: "123456:telegramtokenabcdefghijklmnopqrstuvwxyz" }
  }`, "utf-8")
  mkdirSync(join(stateDir, "artifacts"), { recursive: true })
  writeFileSync(join(stateDir, "artifacts", "large.bin"), "artifact-binary", "utf-8")
  return { stateDir, workDir }
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

describe("task007 backup restore rehearsal", () => {
  it("builds a target inventory with checksums, excludes raw secrets and large runtime artifacts", () => {
    const { stateDir, workDir } = useTempState()
    insertSession({ id: "session-backup-inventory", source: "webui", source_id: null, created_at: 1, updated_at: 1, summary: null })

    const inventory = buildBackupTargetInventory({ stateDir, workDir })

    expect(inventory.included.some((target) => target.id === "sqlite:main" && target.checksum)).toBe(true)
    expect(inventory.included.filter((target) => target.kind === "prompt_source").length).toBeGreaterThan(0)
    expect(inventory.excluded).toEqual(expect.arrayContaining([expect.objectContaining({ id: "config", reason: "secret_reentry_required" })]))
    expect(inventory.excluded).toEqual(expect.arrayContaining([expect.objectContaining({ id: "exclude:artifacts", reason: "large_retention_binary" })]))
  })

  it("creates a safe snapshot manifest and restores it into a rehearsal directory", () => {
    const { stateDir, workDir } = useTempState()
    insertSession({ id: "session-before-snapshot", source: "webui", source_id: null, created_at: 1, updated_at: 1, summary: null })

    const snapshotDir = makeTempDir("nobie-task007-snapshot-")
    const restoreDir = makeTempDir("nobie-task007-restore-")
    const manifest = createBackupSnapshot({ stateDir, workDir, snapshotDir, appVersion: "test-version", gitTag: "v-test", gitCommit: "abc123", checkpointSqlite: false, now: 1_765_000_000_000 })
    const manifestPayload = readFileSync(join(snapshotDir, "manifest.json"), "utf-8")

    expect(manifest.kind).toBe("nobie.backup.snapshot")
    expect(manifest.files.some((file) => file.kind === "sqlite_db" && file.relativePath === "state/data.db")).toBe(true)
    expect(manifest.files.some((file) => file.kind === "config")).toBe(false)
    expect(manifestPayload).not.toContain("sk-testsecretvalue")
    expect(manifestPayload).not.toContain("telegramtoken")
    expect(manifest.secretReentryRequired.map((entry) => entry.scope)).toEqual(expect.arrayContaining(["config.ai.connection.auth", "config.telegram.botToken"]))
    expect(verifyBackupSnapshotManifest(manifest)).toMatchObject({ ok: true })

    const rehearsal = runRestoreRehearsal({ manifest, restoreDir, writeReport: true })

    expect(rehearsal.ok).toBe(true)
    expect(rehearsal.checks.map((check) => check.name)).toEqual(["manifest_checksum", "file_copy", "sqlite_integrity", "migration_status", "prompt_source_registry"])
    expect(rehearsal.migrationStatus?.upToDate).toBe(true)
    expect(rehearsal.promptSourceCount).toBeGreaterThan(0)
    expect(rehearsal.reportPath && existsSync(rehearsal.reportPath)).toBe(true)
    expect(existsSync(join(restoreDir, "state", "data.db"))).toBe(true)
    expect(existsSync(join(restoreDir, "prompts", "identity.md"))).toBe(true)
  })

  it("blocks restore rehearsal before copying when a snapshot checksum is invalid", () => {
    const { stateDir, workDir } = useTempState()
    getDb()
    const manifest = createBackupSnapshot({ stateDir, workDir, snapshotDir: makeTempDir("nobie-task007-corrupt-snapshot-"), checkpointSqlite: false })
    writeFileSync(manifest.files[0].snapshotPath, "corrupted", "utf-8")

    const verification = verifyBackupSnapshotManifest(manifest)
    const rehearsal = runRestoreRehearsal({ manifest, restoreDir: makeTempDir("nobie-task007-corrupt-restore-") })

    expect(verification.ok).toBe(false)
    expect(verification.failures[0]).toMatchObject({ reason: "checksum_mismatch" })
    expect(rehearsal.ok).toBe(false)
    expect(rehearsal.restoredFiles).toEqual([])
    expect(rehearsal.checks[0]).toMatchObject({ name: "manifest_checksum", ok: false })
  })

  it("requires a verified backup before migration and links rollback runbook", () => {
    const { stateDir, workDir } = useTempState()
    getDb()
    const noBackup = buildMigrationPreflightReport({ dbPath: PATHS.dbFile, diskFreeBytes: 10, requiredFreeBytes: 20 })
    expect(noBackup).toMatchObject({ ok: false, risk: "blocking" })
    expect(noBackup.checks.find((check) => check.name === "backup_available")).toMatchObject({ ok: false, risk: "blocking" })

    const manifest = createBackupSnapshot({ stateDir, workDir, snapshotDir: makeTempDir("nobie-task007-preflight-snapshot-"), checkpointSqlite: false })
    const report = buildMigrationPreflightReport({ dbPath: PATHS.dbFile, manifest, diskFreeBytes: 1_000_000, requiredFreeBytes: 1, canWrite: true, providerConfigSane: true })

    expect(report.ok).toBe(true)
    expect(report.checks.find((check) => check.name === "snapshot_checksum")).toMatchObject({ ok: true })
    expect(report.dryRun.changesDatabase).toBe(false)
    expect(report.runbook.id).toBe("migration-rollback-runbook")
    expect(report.runbook.retryForbiddenWhen.length).toBeGreaterThan(0)
  })
})
