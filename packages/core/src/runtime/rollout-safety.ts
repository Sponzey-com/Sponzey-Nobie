import { createHash, randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import BetterSqlite3 from "better-sqlite3"
import { existsSync } from "node:fs"
import { PATHS } from "../config/index.js"
import { getDb, insertAuditLog, insertControlEvent, insertDiagnosticEvent } from "../db/index.js"
import type { MigrationLockRow } from "../db/migration-safety.js"

export type FeatureFlagMode = "off" | "shadow" | "dual_write" | "enforced" | "rollback"
export type RolloutEvidenceStatus = "ok" | "warning" | "blocked"

export interface RuntimeFeatureFlag {
  featureKey: string
  mode: FeatureFlagMode
  compatibilityMode: boolean
  updatedAt: number
  updatedBy: string | null
  reason: string | null
  evidence: Record<string, unknown> | null
  source: "default" | "db"
}

export interface FeatureFlagChangeResult {
  featureFlag: RuntimeFeatureFlag
  auditRecorded: boolean
  controlEventId: string | null
}

export interface RolloutEvidenceRecord {
  id: string
  created_at: number
  feature_key: string
  mode: FeatureFlagMode
  stage: string
  status: RolloutEvidenceStatus
  run_id: string | null
  request_group_id: string | null
  summary: string
  detail_json: string | null
}

export interface ShadowCompareRecord {
  id: string
  created_at: number
  feature_key: string
  target_kind: string
  target_id: string | null
  run_id: string | null
  request_group_id: string | null
  old_hash: string
  new_hash: string
  match: number
  summary: string
  detail_json: string | null
}

export interface ShadowCompareResult {
  id: string
  matched: boolean
  oldHash: string
  newHash: string
  diagnosticEventId: string | null
  controlEventId: string | null
}

export interface RolloutSafetySnapshot {
  featureFlags: RuntimeFeatureFlag[]
  migrationLock: {
    active: MigrationLockRow | null
    latest: MigrationLockRow | null
  }
  shadowCompare: {
    total: number
    mismatchCount: number
    recentMismatches: ShadowCompareRecord[]
  }
  evidence: {
    total: number
    warningCount: number
    blockedCount: number
    latest: RolloutEvidenceRecord[]
  }
}

const DEFAULT_FEATURE_FLAGS: RuntimeFeatureFlag[] = [
  defaultFlag("message_ledger", "shadow", "Shadow-write ledger events before enforced recovery decisions."),
  defaultFlag("approval_registry", "dual_write", "Keep old approval flow primary while writing approval registry."),
  defaultFlag("runtime_manifest", "enforced", "Runtime manifest is already attached to new root runs."),
  defaultFlag("context_guard", "enforced", "Context preflight guard is enforced for provider calls."),
  defaultFlag("schedule_identity", "shadow", "Schedule contract identity is compared before full enforcement."),
  defaultFlag("provider_resolver", "enforced", "Single provider resolver is the active runtime path."),
  defaultFlag("memory_retrieval", "shadow", "Memory retrieval candidates are compared before stricter ranking."),
  defaultFlag("delivery_outcome", "shadow", "Delivery outcome comparison stays diagnostic-only during rollout."),
]

function defaultFlag(featureKey: string, mode: FeatureFlagMode, reason: string): RuntimeFeatureFlag {
  return {
    featureKey,
    mode,
    compatibilityMode: mode !== "enforced",
    updatedAt: 0,
    updatedBy: "system-default",
    reason,
    evidence: null,
    source: "default",
  }
}

export function ensureRolloutSafetyTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runtime_feature_flags (
      feature_key TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK(mode IN ('off', 'shadow', 'dual_write', 'enforced', 'rollback')),
      compatibility_mode INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      updated_by TEXT,
      reason TEXT,
      evidence_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_runtime_feature_flags_mode
      ON runtime_feature_flags(mode, updated_at DESC);

    CREATE TABLE IF NOT EXISTS rollout_shadow_compares (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      feature_key TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT,
      run_id TEXT,
      request_group_id TEXT,
      old_hash TEXT NOT NULL,
      new_hash TEXT NOT NULL,
      match INTEGER NOT NULL,
      summary TEXT NOT NULL,
      detail_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_rollout_shadow_compares_feature
      ON rollout_shadow_compares(feature_key, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_rollout_shadow_compares_run
      ON rollout_shadow_compares(run_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_rollout_shadow_compares_request_group
      ON rollout_shadow_compares(request_group_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS rollout_evidence (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      feature_key TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('off', 'shadow', 'dual_write', 'enforced', 'rollback')),
      stage TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ok', 'warning', 'blocked')),
      run_id TEXT,
      request_group_id TEXT,
      summary TEXT NOT NULL,
      detail_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_rollout_evidence_feature
      ON rollout_evidence(feature_key, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_rollout_evidence_status
      ON rollout_evidence(status, created_at DESC);
  `)
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function tableExists(db: Database.Database, tableName: string): boolean {
  return Boolean(db.prepare<[string], { name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(tableName))
}

function mergeFeatureRows(rows: Array<{
  feature_key: string
  mode: FeatureFlagMode
  compatibility_mode: number
  updated_at: number
  updated_by: string | null
  reason: string | null
  evidence_json: string | null
}>): RuntimeFeatureFlag[] {
  const defaults = new Map(DEFAULT_FEATURE_FLAGS.map((flag) => [flag.featureKey, flag]))
  const merged = new Map<string, RuntimeFeatureFlag>(defaults)
  for (const row of rows) {
    merged.set(row.feature_key, {
      featureKey: row.feature_key,
      mode: row.mode,
      compatibilityMode: row.compatibility_mode === 1,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
      reason: row.reason,
      evidence: parseJsonObject(row.evidence_json),
      source: "db",
    })
  }
  return [...merged.values()].sort((a, b) => a.featureKey.localeCompare(b.featureKey))
}

export function listFeatureFlags(db: Database.Database = getDb()): RuntimeFeatureFlag[] {
  ensureRolloutSafetyTables(db)
  const rows = db.prepare<[], {
    feature_key: string
    mode: FeatureFlagMode
    compatibility_mode: number
    updated_at: number
    updated_by: string | null
    reason: string | null
    evidence_json: string | null
  }>(`SELECT * FROM runtime_feature_flags ORDER BY feature_key ASC`).all()
  return mergeFeatureRows(rows)
}

export function getFeatureFlag(featureKey: string, db: Database.Database = getDb()): RuntimeFeatureFlag {
  return listFeatureFlags(db).find((flag) => flag.featureKey === featureKey) ?? defaultFlag(featureKey, "off", "Unknown feature defaults to off.")
}

export function setFeatureFlagMode(input: {
  featureKey: string
  mode: FeatureFlagMode
  compatibilityMode?: boolean
  updatedBy?: string | null
  reason?: string | null
  evidence?: Record<string, unknown> | null
  runId?: string | null
  requestGroupId?: string | null
  now?: number
  db?: Database.Database
}): FeatureFlagChangeResult {
  const db = input.db ?? getDb()
  ensureRolloutSafetyTables(db)
  const now = input.now ?? Date.now()
  const compatibilityMode = input.compatibilityMode ?? input.mode !== "enforced"
  db.prepare(
    `INSERT INTO runtime_feature_flags
     (feature_key, mode, compatibility_mode, updated_at, updated_by, reason, evidence_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(feature_key) DO UPDATE SET
       mode = excluded.mode,
       compatibility_mode = excluded.compatibility_mode,
       updated_at = excluded.updated_at,
       updated_by = excluded.updated_by,
       reason = excluded.reason,
       evidence_json = excluded.evidence_json`,
  ).run(
    input.featureKey,
    input.mode,
    compatibilityMode ? 1 : 0,
    now,
    input.updatedBy ?? null,
    input.reason ?? null,
    input.evidence ? stableStringify(input.evidence) : null,
  )
  insertAuditLog({
    timestamp: now,
    session_id: null,
    run_id: input.runId ?? null,
    request_group_id: input.requestGroupId ?? null,
    channel: null,
    source: "rollout-safety",
    tool_name: "feature_flag_mode_change",
    params: stableStringify({ featureKey: input.featureKey, mode: input.mode, compatibilityMode }),
    output: null,
    result: "success",
    duration_ms: null,
    approval_required: 0,
    approved_by: input.updatedBy ?? null,
  })
  const controlEventId = insertControlEvent({
    createdAt: now,
    eventType: "feature_flag.changed",
    correlationId: input.requestGroupId ?? input.runId ?? input.featureKey,
    runId: input.runId ?? null,
    requestGroupId: input.requestGroupId ?? null,
    component: "rollout-safety",
    severity: input.mode === "rollback" ? "warning" : "info",
    summary: `${input.featureKey} feature flag set to ${input.mode}`,
    detail: { featureKey: input.featureKey, mode: input.mode, compatibilityMode, reason: input.reason ?? null },
  })
  return { featureFlag: getFeatureFlag(input.featureKey, db), auditRecorded: true, controlEventId }
}

export function shouldUseNewPath(flag: RuntimeFeatureFlag): boolean {
  return flag.mode === "enforced"
}

export function shouldShadowWrite(flag: RuntimeFeatureFlag): boolean {
  return flag.mode === "shadow" || flag.mode === "dual_write" || flag.mode === "enforced"
}

export function shouldReadCompatibilityPath(flag: RuntimeFeatureFlag): boolean {
  return flag.mode === "off" || flag.mode === "shadow" || flag.mode === "dual_write" || flag.mode === "rollback" || flag.compatibilityMode
}

export function recordRolloutEvidence(input: {
  featureKey: string
  mode?: FeatureFlagMode
  stage: string
  status?: RolloutEvidenceStatus
  runId?: string | null
  requestGroupId?: string | null
  summary: string
  detail?: Record<string, unknown>
  now?: number
  db?: Database.Database
}): string {
  const db = input.db ?? getDb()
  ensureRolloutSafetyTables(db)
  const id = randomUUID()
  const mode = input.mode ?? getFeatureFlag(input.featureKey, db).mode
  db.prepare(
    `INSERT INTO rollout_evidence
     (id, created_at, feature_key, mode, stage, status, run_id, request_group_id, summary, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.now ?? Date.now(),
    input.featureKey,
    mode,
    input.stage,
    input.status ?? "ok",
    input.runId ?? null,
    input.requestGroupId ?? null,
    input.summary,
    input.detail ? stableStringify(input.detail) : null,
  )
  return id
}

export function recordShadowCompare(input: {
  featureKey: string
  targetKind: string
  targetId?: string | null
  runId?: string | null
  requestGroupId?: string | null
  oldValue: unknown
  newValue: unknown
  summary?: string
  detail?: Record<string, unknown>
  now?: number
  db?: Database.Database
}): ShadowCompareResult {
  const db = input.db ?? getDb()
  ensureRolloutSafetyTables(db)
  const id = randomUUID()
  const oldHash = sha256(stableStringify(input.oldValue))
  const newHash = sha256(stableStringify(input.newValue))
  const matched = oldHash === newHash
  const summary = input.summary ?? (matched ? "Shadow compare matched." : "Shadow compare mismatch recorded for rollout review.")
  db.prepare(
    `INSERT INTO rollout_shadow_compares
     (id, created_at, feature_key, target_kind, target_id, run_id, request_group_id,
      old_hash, new_hash, match, summary, detail_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.now ?? Date.now(),
    input.featureKey,
    input.targetKind,
    input.targetId ?? null,
    input.runId ?? null,
    input.requestGroupId ?? null,
    oldHash,
    newHash,
    matched ? 1 : 0,
    summary,
    stableStringify({ ...(input.detail ?? {}), oldHash, newHash }),
  )
  const controlEventId = insertControlEvent({
    eventType: matched ? "rollout.shadow_compare.matched" : "rollout.shadow_compare.mismatch",
    correlationId: input.requestGroupId ?? input.runId ?? id,
    runId: input.runId ?? null,
    requestGroupId: input.requestGroupId ?? null,
    component: "rollout-safety",
    severity: matched ? "debug" : "warning",
    summary,
    detail: { featureKey: input.featureKey, targetKind: input.targetKind, targetId: input.targetId ?? null, oldHash, newHash },
  })
  const diagnosticEventId = matched ? null : insertDiagnosticEvent({
    kind: "rollout_shadow_mismatch",
    summary,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
    recoveryKey: `rollout:${input.featureKey}:${input.targetKind}`,
    detail: { featureKey: input.featureKey, targetKind: input.targetKind, targetId: input.targetId ?? null, oldHash, newHash },
  })
  if (!matched) {
    recordRolloutEvidence({
      db,
      featureKey: input.featureKey,
      stage: "shadow_compare",
      status: "warning",
      runId: input.runId ?? null,
      requestGroupId: input.requestGroupId ?? null,
      summary,
      detail: { targetKind: input.targetKind, targetId: input.targetId ?? null, oldHash, newHash },
    })
  }
  return { id, matched, oldHash, newHash, diagnosticEventId, controlEventId }
}

function readRows<T>(db: Database.Database, sql: string, fallback: T[]): T[] {
  try {
    return db.prepare<[], T>(sql).all()
  } catch {
    return fallback
  }
}

export function buildRolloutSafetySnapshot(dbPath = PATHS.dbFile): RolloutSafetySnapshot {
  if (!existsSync(dbPath)) {
    return {
      featureFlags: mergeFeatureRows([]),
      migrationLock: { active: null, latest: null },
      shadowCompare: { total: 0, mismatchCount: 0, recentMismatches: [] },
      evidence: { total: 0, warningCount: 0, blockedCount: 0, latest: [] },
    }
  }
  const db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true })
  try {
    const featureRows = tableExists(db, "runtime_feature_flags")
      ? readRows<{
        feature_key: string
        mode: FeatureFlagMode
        compatibility_mode: number
        updated_at: number
        updated_by: string | null
        reason: string | null
        evidence_json: string | null
      }>(db, `SELECT * FROM runtime_feature_flags ORDER BY feature_key ASC`, [])
      : []
    const active = tableExists(db, "migration_locks")
      ? db.prepare<[], MigrationLockRow>(`SELECT * FROM migration_locks WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1`).get() ?? null
      : null
    const latest = tableExists(db, "migration_locks")
      ? db.prepare<[], MigrationLockRow>(`SELECT * FROM migration_locks ORDER BY updated_at DESC LIMIT 1`).get() ?? null
      : null
    const shadowCounts = tableExists(db, "rollout_shadow_compares")
      ? db.prepare<[], { total: number; mismatch_count: number }>(`SELECT COUNT(*) AS total, SUM(CASE WHEN match = 0 THEN 1 ELSE 0 END) AS mismatch_count FROM rollout_shadow_compares`).get()
      : { total: 0, mismatch_count: 0 }
    const recentMismatches = tableExists(db, "rollout_shadow_compares")
      ? readRows<ShadowCompareRecord>(db, `SELECT * FROM rollout_shadow_compares WHERE match = 0 ORDER BY created_at DESC LIMIT 10`, [])
      : []
    const evidenceCounts = tableExists(db, "rollout_evidence")
      ? db.prepare<[], { total: number; warning_count: number; blocked_count: number }>(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'warning' THEN 1 ELSE 0 END) AS warning_count, SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked_count FROM rollout_evidence`).get()
      : { total: 0, warning_count: 0, blocked_count: 0 }
    const latestEvidence = tableExists(db, "rollout_evidence")
      ? readRows<RolloutEvidenceRecord>(db, `SELECT * FROM rollout_evidence ORDER BY created_at DESC LIMIT 10`, [])
      : []
    return {
      featureFlags: mergeFeatureRows(featureRows),
      migrationLock: { active, latest },
      shadowCompare: {
        total: shadowCounts?.total ?? 0,
        mismatchCount: shadowCounts?.mismatch_count ?? 0,
        recentMismatches,
      },
      evidence: {
        total: evidenceCounts?.total ?? 0,
        warningCount: evidenceCounts?.warning_count ?? 0,
        blockedCount: evidenceCounts?.blocked_count ?? 0,
        latest: latestEvidence,
      },
    }
  } catch {
    return {
      featureFlags: mergeFeatureRows([]),
      migrationLock: { active: null, latest: null },
      shadowCompare: { total: 0, mismatchCount: 0, recentMismatches: [] },
      evidence: { total: 0, warningCount: 0, blockedCount: 0, latest: [] },
    }
  } finally {
    db.close()
  }
}
