import type Database from "better-sqlite3"

export type MigrationLockStatus = "active" | "released" | "failed"
export type MigrationLockPhase = "preflight" | "backup" | "lock" | "apply" | "verify" | "unlock" | "failed"

export interface MigrationLockRow {
  id: string
  status: MigrationLockStatus
  locked_by: string
  phase: MigrationLockPhase
  started_at: number
  updated_at: number
  released_at: number | null
  backup_snapshot_id: string | null
  pending_versions_json: string | null
  verify_report_json: string | null
  error_message: string | null
  rollback_runbook_ref: string | null
}

export interface MigrationVerificationReport {
  ok: boolean
  schemaVersion: number
  requiredTables: Array<{ name: string; ok: boolean }>
  requiredIndexes: Array<{ name: string; ok: boolean }>
  integrityCheck: string
  missingTables: string[]
  missingIndexes: string[]
}

export interface MigrationWriteGuardResult {
  ok: boolean
  operation: string
  lock: MigrationLockRow | null
  userMessage: string | null
  recoveryGuide: string | null
}

const REQUIRED_TABLES = [
  "schema_migrations",
  "migration_locks",
  "runtime_feature_flags",
  "rollout_shadow_compares",
  "rollout_evidence",
  "root_runs",
  "audit_logs",
]

const REQUIRED_INDEXES = [
  "idx_migration_locks_status",
  "idx_runtime_feature_flags_mode",
  "idx_rollout_shadow_compares_feature",
  "idx_rollout_evidence_feature",
]

export const MIGRATION_ROLLBACK_RUNBOOK_REF = "migration-rollback-runbook"

export function ensureMigrationSafetyTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_locks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL CHECK(status IN ('active', 'released', 'failed')),
      locked_by TEXT NOT NULL,
      phase TEXT NOT NULL CHECK(phase IN ('preflight', 'backup', 'lock', 'apply', 'verify', 'unlock', 'failed')),
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      released_at INTEGER,
      backup_snapshot_id TEXT,
      pending_versions_json TEXT,
      verify_report_json TEXT,
      error_message TEXT,
      rollback_runbook_ref TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_migration_locks_status
      ON migration_locks(status, updated_at DESC);
  `)
}

export function getActiveMigrationLock(db: Database.Database): MigrationLockRow | null {
  ensureMigrationSafetyTables(db)
  return db.prepare<[], MigrationLockRow>(
    `SELECT * FROM migration_locks
     WHERE status = 'active'
     ORDER BY updated_at DESC
     LIMIT 1`,
  ).get() ?? null
}

export function getLatestMigrationLock(db: Database.Database): MigrationLockRow | null {
  ensureMigrationSafetyTables(db)
  return db.prepare<[], MigrationLockRow>(
    `SELECT * FROM migration_locks
     ORDER BY updated_at DESC
     LIMIT 1`,
  ).get() ?? null
}

export function beginMigrationLock(db: Database.Database, input: {
  id: string
  pendingVersions: number[]
  lockedBy?: string
  backupSnapshotId?: string | null
  now?: number
}): MigrationLockRow {
  ensureMigrationSafetyTables(db)
  const existing = getActiveMigrationLock(db)
  if (existing) return existing

  const now = input.now ?? Date.now()
  db.prepare(
    `INSERT INTO migration_locks
     (id, status, locked_by, phase, started_at, updated_at, released_at,
      backup_snapshot_id, pending_versions_json, verify_report_json, error_message, rollback_runbook_ref)
     VALUES (?, 'active', ?, 'lock', ?, ?, NULL, ?, ?, NULL, NULL, ?)`,
  ).run(
    input.id,
    input.lockedBy ?? `pid:${process.pid}`,
    now,
    now,
    input.backupSnapshotId ?? null,
    JSON.stringify(input.pendingVersions),
    MIGRATION_ROLLBACK_RUNBOOK_REF,
  )
  return getActiveMigrationLock(db)!
}

export function updateMigrationLockPhase(db: Database.Database, lockId: string, phase: MigrationLockPhase, now = Date.now()): void {
  ensureMigrationSafetyTables(db)
  db.prepare(`UPDATE migration_locks SET phase = ?, updated_at = ? WHERE id = ? AND status = 'active'`).run(phase, now, lockId)
}

export function releaseMigrationLock(db: Database.Database, input: {
  lockId: string
  verifyReport: MigrationVerificationReport
  now?: number
}): void {
  ensureMigrationSafetyTables(db)
  const now = input.now ?? Date.now()
  db.prepare(
    `UPDATE migration_locks
     SET status = 'released', phase = 'unlock', updated_at = ?, released_at = ?, verify_report_json = ?
     WHERE id = ?`,
  ).run(now, now, JSON.stringify(input.verifyReport), input.lockId)
}

export function failMigrationLock(db: Database.Database, input: {
  lockId: string
  error: string
  verifyReport?: MigrationVerificationReport | null
  now?: number
}): void {
  ensureMigrationSafetyTables(db)
  const now = input.now ?? Date.now()
  db.prepare(
    `UPDATE migration_locks
     SET status = 'failed', phase = 'failed', updated_at = ?, error_message = ?, verify_report_json = ?
     WHERE id = ?`,
  ).run(now, input.error, input.verifyReport ? JSON.stringify(input.verifyReport) : null, input.lockId)
}

function objectExists(db: Database.Database, type: "table" | "index", name: string): boolean {
  const row = db.prepare<[string, string], { name: string }>(
    `SELECT name FROM sqlite_master WHERE type = ? AND name = ?`,
  ).get(type, name)
  return Boolean(row)
}

function latestSchemaVersion(db: Database.Database): number {
  if (!objectExists(db, "table", "schema_migrations")) return 0
  return db.prepare<[], { version: number | null }>(`SELECT MAX(version) AS version FROM schema_migrations`).get()?.version ?? 0
}

export function verifyMigrationState(db: Database.Database): MigrationVerificationReport {
  ensureMigrationSafetyTables(db)
  const requiredTables = REQUIRED_TABLES.map((name) => ({ name, ok: objectExists(db, "table", name) }))
  const requiredIndexes = REQUIRED_INDEXES.map((name) => ({ name, ok: objectExists(db, "index", name) }))
  const integrityRow = db.prepare<[], { integrity_check: string }>(`PRAGMA integrity_check`).get()
  const integrityCheck = integrityRow?.integrity_check ?? "unknown"
  const missingTables = requiredTables.filter((item) => !item.ok).map((item) => item.name)
  const missingIndexes = requiredIndexes.filter((item) => !item.ok).map((item) => item.name)
  return {
    ok: missingTables.length === 0 && missingIndexes.length === 0 && integrityCheck === "ok",
    schemaVersion: latestSchemaVersion(db),
    requiredTables,
    requiredIndexes,
    integrityCheck,
    missingTables,
    missingIndexes,
  }
}

export function checkMigrationWriteGuard(db: Database.Database, operation: string): MigrationWriteGuardResult {
  const lock = getActiveMigrationLock(db)
  if (!lock) {
    return { ok: true, operation, lock: null, userMessage: null, recoveryGuide: null }
  }
  return {
    ok: false,
    operation,
    lock,
    userMessage: "DB migration 또는 복구 lock이 남아 있어 쓰기 작업을 시작하지 않았습니다.",
    recoveryGuide: `doctor report에서 migration lock ${lock.id}와 backup snapshot ${lock.backup_snapshot_id ?? "없음"}을 확인한 뒤 ${lock.rollback_runbook_ref ?? MIGRATION_ROLLBACK_RUNBOOK_REF} 절차로 복구하세요.`,
  }
}

export function assertMigrationWriteAllowed(db: Database.Database, operation: string): void {
  const guard = checkMigrationWriteGuard(db, operation)
  if (!guard.ok) {
    const error = new Error(`${guard.userMessage} (${operation})`)
    ;(error as Error & { code?: string; lockId?: string | undefined }).code = "MIGRATION_LOCK_ACTIVE"
    ;(error as Error & { code?: string; lockId?: string | undefined }).lockId = guard.lock?.id
    throw error
  }
}
