import { createHash, randomUUID } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import JSON5 from "json5"
import BetterSqlite3 from "better-sqlite3"
import { PATHS } from "./paths.js"
import { MIGRATIONS } from "../db/migrations.js"
import { closeDb, getDb } from "../db/index.js"
import { sanitizeUserFacingError } from "../runs/error-sanitizer.js"
import {
  ensurePromptSourceFiles,
  exportPromptSourcesToFile,
  importPromptSourcesFromFile,
  loadPromptSourceRegistry,
} from "../memory/nobie-md.js"
import { redactUiValue } from "../ui/redaction.js"

export interface MigrationVersionStatus {
  databasePath: string
  exists: boolean
  currentVersion: number
  latestVersion: number
  appliedVersions: number[]
  pendingVersions: number[]
  unknownAppliedVersions: number[]
  upToDate: boolean
}

export interface MigrationDryRunResult {
  status: MigrationVersionStatus
  willApply: Array<{ version: number; transaction: boolean }>
  warnings: string[]
  changesDatabase: false
  userMessage: string
}

export interface DatabaseBackupResult {
  id: string
  kind: "backup" | "export" | "rollback"
  databasePath: string
  backupPath: string
  walPath?: string
  shmPath?: string
  checksum: string
  createdAt: number
}

export interface DatabaseImportResult {
  ok: true
  importedPath: string
  rollbackBackup: DatabaseBackupResult
  status: MigrationVersionStatus
}

export interface ConfigExportResult {
  id: string
  configPath: string
  exportPath: string
  checksum: string
  createdAt: number
  masking: {
    secretsMasked: number
    channelIdsMasked: false
    userIdsMasked: false
    policy: string
  }
}

export interface ConfigurationOperationsSnapshot {
  database: MigrationVersionStatus
  promptSources: {
    workDir: string
    count: number
    versions: Array<{
      sourceId: string
      locale: "ko" | "en"
      version: string
      checksum: string
      path: string
      enabled: boolean
      required: boolean
      usageScope: string
    }>
  }
  config: {
    configPath: string
    exists: boolean
    masked: Record<string, unknown>
    maskingPolicy: ConfigExportResult["masking"]["policy"]
  }
}

function backupRoot(): string {
  return join(PATHS.stateDir, "backups")
}

function timestampId(prefix: string): string {
  return `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

function sqliteTableExists(db: BetterSqlite3.Database, tableName: string): boolean {
  const row = db.prepare<[string], { name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(tableName)
  return Boolean(row)
}

function readMigrationStatusFromDb(db: BetterSqlite3.Database, dbPath: string, exists: boolean): MigrationVersionStatus {
  const latestVersion = MIGRATIONS.reduce((max, migration) => Math.max(max, migration.version), 0)
  const knownVersions = new Set(MIGRATIONS.map((migration) => migration.version))
  const appliedVersions = sqliteTableExists(db, "schema_migrations")
    ? db.prepare<[], { version: number }>("SELECT version FROM schema_migrations ORDER BY version ASC").all().map((row) => row.version)
    : []
  const applied = new Set(appliedVersions)
  const pendingVersions = MIGRATIONS
    .filter((migration) => !applied.has(migration.version))
    .map((migration) => migration.version)
  const unknownAppliedVersions = appliedVersions.filter((version) => !knownVersions.has(version))
  const currentVersion = appliedVersions.reduce((max, version) => Math.max(max, version), 0)

  return {
    databasePath: dbPath,
    exists,
    currentVersion,
    latestVersion,
    appliedVersions,
    pendingVersions,
    unknownAppliedVersions,
    upToDate: pendingVersions.length === 0 && unknownAppliedVersions.length === 0,
  }
}

export function getDatabaseMigrationStatus(dbPath = PATHS.dbFile): MigrationVersionStatus {
  const resolvedPath = resolve(dbPath)
  if (!existsSync(resolvedPath)) {
    const latestVersion = MIGRATIONS.reduce((max, migration) => Math.max(max, migration.version), 0)
    return {
      databasePath: resolvedPath,
      exists: false,
      currentVersion: 0,
      latestVersion,
      appliedVersions: [],
      pendingVersions: MIGRATIONS.map((migration) => migration.version),
      unknownAppliedVersions: [],
      upToDate: false,
    }
  }

  const db = new BetterSqlite3(resolvedPath, { readonly: true, fileMustExist: true })
  try {
    return readMigrationStatusFromDb(db, resolvedPath, true)
  } finally {
    db.close()
  }
}

export function dryRunDatabaseMigrations(dbPath = PATHS.dbFile): MigrationDryRunResult {
  const status = getDatabaseMigrationStatus(dbPath)
  const pending = new Set(status.pendingVersions)
  const willApply = MIGRATIONS
    .filter((migration) => pending.has(migration.version))
    .map((migration) => ({ version: migration.version, transaction: migration.transaction !== false }))
  const warnings: string[] = []
  if (!status.exists) warnings.push("DB 파일이 아직 없습니다. 최초 실행 시 전체 schema가 생성됩니다.")
  if (status.unknownAppliedVersions.length > 0) warnings.push("현재 코드가 알지 못하는 migration version이 적용되어 있습니다.")

  return {
    status,
    willApply,
    warnings,
    changesDatabase: false,
    userMessage: willApply.length === 0
      ? "적용할 DB migration이 없습니다."
      : `${willApply.length}개의 DB migration이 적용 대상입니다. dry-run은 DB를 변경하지 않았습니다.`,
  }
}

function copyOptionalSqliteSidecar(sourceDbPath: string, backupDbPath: string, suffix: "-wal" | "-shm"): string | undefined {
  const sourcePath = `${sourceDbPath}${suffix}`
  if (!existsSync(sourcePath)) return undefined
  const targetPath = `${backupDbPath}${suffix}`
  copyFileSync(sourcePath, targetPath)
  return targetPath
}

export function createDatabaseBackup(kind: DatabaseBackupResult["kind"] = "backup", dbPath = PATHS.dbFile): DatabaseBackupResult {
  const resolvedPath = resolve(dbPath)
  if (!existsSync(resolvedPath)) throw new Error("DB 파일이 없어 backup을 만들 수 없습니다.")
  mkdirSync(join(backupRoot(), "db"), { recursive: true })

  try {
    if (resolvedPath === resolve(PATHS.dbFile)) {
      getDb().pragma("wal_checkpoint(TRUNCATE)")
    }
  } catch {
    // Backup is still useful even when checkpoint is unavailable.
  }

  const createdAt = Date.now()
  const id = timestampId(kind === "export" ? "db-export" : kind === "rollback" ? "db-rollback" : "db-backup")
  const backupPath = join(backupRoot(), "db", `${id}.sqlite3`)
  copyFileSync(resolvedPath, backupPath)
  const walPath = copyOptionalSqliteSidecar(resolvedPath, backupPath, "-wal")
  const shmPath = copyOptionalSqliteSidecar(resolvedPath, backupPath, "-shm")

  return {
    id,
    kind,
    databasePath: resolvedPath,
    backupPath,
    ...(walPath ? { walPath } : {}),
    ...(shmPath ? { shmPath } : {}),
    checksum: sha256File(backupPath),
    createdAt,
  }
}

export function importDatabaseFromBackup(input: { backupPath: string; dbPath?: string }): DatabaseImportResult {
  const targetPath = resolve(input.dbPath ?? PATHS.dbFile)
  const importPath = resolve(input.backupPath)
  if (!existsSync(importPath)) throw new Error("가져올 DB backup 파일을 찾을 수 없습니다.")

  const rollbackBackup = existsSync(targetPath)
    ? createDatabaseBackup("rollback", targetPath)
    : (() => {
        mkdirSync(dirname(targetPath), { recursive: true })
        const id = timestampId("db-empty-rollback")
        const placeholder = join(backupRoot(), "db", `${id}.sqlite3`)
        mkdirSync(dirname(placeholder), { recursive: true })
        writeFileSync(placeholder, "")
        return {
          id,
          kind: "rollback" as const,
          databasePath: targetPath,
          backupPath: placeholder,
          checksum: createHash("sha256").update("").digest("hex"),
          createdAt: Date.now(),
        }
      })()

  closeDb()
  mkdirSync(dirname(targetPath), { recursive: true })
  copyFileSync(importPath, targetPath)

  try {
    getDb()
    return {
      ok: true,
      importedPath: importPath,
      rollbackBackup,
      status: getDatabaseMigrationStatus(targetPath),
    }
  } catch (error) {
    closeDb()
    copyFileSync(rollbackBackup.backupPath, targetPath)
    getDb()
    const sanitized = sanitizeUserFacingError(error instanceof Error ? error.message : String(error))
    throw new Error(`DB import가 실패해 rollback했습니다: ${sanitized.userMessage}`)
  }
}

export function maskSecretsDeep(value: unknown): { value: unknown; maskedCount: number } {
  const redacted = redactUiValue(value, { audience: "export" })
  return { value: redacted.value, maskedCount: redacted.maskedCount }
}

export function exportMaskedConfig(): ConfigExportResult {
  const configPath = resolve(PATHS.configFile)
  if (!existsSync(configPath)) throw new Error("설정 파일이 없어 export할 수 없습니다.")
  const parsed = JSON5.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
  const masked = maskSecretsDeep(parsed)
  const createdAt = Date.now()
  const id = timestampId("config-export")
  const exportPath = join(backupRoot(), "config", `${id}.json`)
  mkdirSync(dirname(exportPath), { recursive: true })
  const payload = {
    kind: "nobie.config.export",
    createdAt,
    masking: {
      secretsMasked: masked.maskedCount,
      channelIdsMasked: false as const,
      userIdsMasked: false as const,
      policy: "Secrets are masked. Channel IDs and user IDs are retained because they are routing identifiers, not authentication secrets.",
    },
    config: masked.value,
  }
  writeFileSync(exportPath, JSON.stringify(payload, null, 2) + "\n", "utf-8")
  return {
    id,
    configPath,
    exportPath,
    checksum: sha256File(exportPath),
    createdAt,
    masking: payload.masking,
  }
}

export function recoverPromptSources(workDir = process.cwd()) {
  return ensurePromptSourceFiles(workDir)
}

export function exportPromptSources(workDir = process.cwd()) {
  return exportPromptSourcesToFile({
    workDir,
    outputPath: join(backupRoot(), "prompts", `${timestampId("prompt-sources-export")}.json`),
  })
}

export function importPromptSources(input: { workDir?: string; exportPath: string; overwrite?: boolean }) {
  return importPromptSourcesFromFile({
    workDir: input.workDir ?? process.cwd(),
    exportPath: input.exportPath,
    overwrite: input.overwrite ?? false,
  })
}

export function buildConfigurationOperationsSnapshot(workDir = process.cwd()): ConfigurationOperationsSnapshot {
  const maskedConfig = existsSync(PATHS.configFile)
    ? maskSecretsDeep(JSON5.parse(readFileSync(PATHS.configFile, "utf-8")) as Record<string, unknown>)
    : { value: {}, maskedCount: 0 }
  const promptSources = loadPromptSourceRegistry(workDir)

  return {
    database: getDatabaseMigrationStatus(),
    promptSources: {
      workDir,
      count: promptSources.length,
      versions: promptSources.map(({ content: _content, ...metadata }) => metadata),
    },
    config: {
      configPath: resolve(PATHS.configFile),
      exists: existsSync(PATHS.configFile),
      masked: maskedConfig.value as Record<string, unknown>,
      maskingPolicy: "Secrets are masked. Channel IDs and user IDs are retained because they are routing identifiers, not authentication secrets.",
    },
  }
}

export function replaceFileAtomically(sourcePath: string, targetPath: string): void {
  const tempPath = `${targetPath}.tmp-${randomUUID()}`
  copyFileSync(sourcePath, tempPath)
  renameSync(tempPath, targetPath)
}
