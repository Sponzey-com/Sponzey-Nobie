import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, getDb, insertSchedule, insertSession, listControlEvents } from "../packages/core/src/db/index.js"
import { beginMigrationLock, checkMigrationWriteGuard, failMigrationLock, verifyMigrationState } from "../packages/core/src/db/migration-safety.js"
import { runDoctor } from "../packages/core/src/diagnostics/doctor.js"
import { buildReleaseManifest } from "../packages/core/src/release/package.js"
import {
  buildRolloutSafetySnapshot,
  getFeatureFlag,
  recordShadowCompare,
  setFeatureFlagMode,
} from "../packages/core/src/runtime/rollout-safety.js"
import { createRootRun } from "../packages/core/src/runs/store.js"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempConfig(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task012-rollout-"))
  tempDirs.push(stateDir)
  const configPath = join(stateDir, "config.json5")
  writeFileSync(configPath, `{
    ai: { connection: { provider: "ollama", endpoint: "http://127.0.0.1:11434", model: "llama3.2" } },
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

describe("task012 migration, feature flag, rollout safety", () => {
  it("blocks write-heavy run and schedule writes while a migration lock is active", () => {
    const db = getDb()
    insertSession({ id: "session-lock", source: "webui", source_id: null, created_at: 1, updated_at: 1, summary: null })
    const lock = beginMigrationLock(db, {
      id: "lock-active-test",
      pendingVersions: [999],
      backupSnapshotId: "snapshot-before-lock",
      lockedBy: "test",
      now: 1_765_000_000_000,
    })

    const guard = checkMigrationWriteGuard(db, "run.create")

    expect(lock.status).toBe("active")
    expect(guard.ok).toBe(false)
    expect(guard.recoveryGuide).toContain("snapshot-before-lock")
    expect(() => createRootRun({ id: "run-blocked", sessionId: "session-lock", prompt: "blocked", source: "webui" })).toThrow(/Migration|migration|쓰기/)
    expect(() => insertSchedule({
      id: "schedule-blocked",
      name: "blocked schedule",
      cron_expression: "* * * * *",
      timezone: "Asia/Seoul",
      prompt: "blocked",
      enabled: 1,
      target_channel: "agent",
      target_session_id: null,
      execution_driver: "internal",
      origin_run_id: null,
      origin_request_group_id: null,
      model: null,
      max_retries: 3,
      timeout_sec: 300,
      created_at: Date.now(),
      updated_at: Date.now(),
    })).toThrow(/Migration|migration|쓰기/)
  })

  it("verifies migration state and exposes lock details through doctor", () => {
    const db = getDb()
    const verify = verifyMigrationState(db)
    beginMigrationLock(db, { id: "lock-doctor-test", pendingVersions: [998], backupSnapshotId: "snapshot-doctor", lockedBy: "test" })

    const report = runDoctor({ mode: "quick", includeEnvironment: false, includeReleasePackage: false })
    const lockCheck = report.checks.find((check) => check.name === "db.migration.lock")

    expect(verify.ok).toBe(true)
    expect(verify.requiredTables.map((table) => table.name)).toEqual(expect.arrayContaining(["migration_locks", "runtime_feature_flags", "rollout_evidence"]))
    expect(lockCheck?.status).toBe("blocked")
    expect(JSON.stringify(lockCheck?.detail)).toContain("snapshot-doctor")

    failMigrationLock(db, { lockId: "lock-doctor-test", error: "verify failed for test", verifyReport: verify })
    const failedReport = runDoctor({ mode: "quick", includeEnvironment: false, includeReleasePackage: false })
    const failedLockCheck = failedReport.checks.find((check) => check.name === "db.migration.lock")
    expect(failedLockCheck?.status).toBe("blocked")
    expect(JSON.stringify(failedLockCheck?.detail)).toContain("verify failed for test")
    expect(JSON.stringify(failedLockCheck?.detail)).toContain("snapshot-doctor")
  })

  it("stores feature flag mode transitions as audit and control evidence", () => {
    const change = setFeatureFlagMode({
      featureKey: "message_ledger",
      mode: "rollback",
      updatedBy: "operator:test",
      reason: "rollback compatibility smoke",
      now: 1_765_000_000_000,
    })
    const flag = getFeatureFlag("message_ledger")
    const audit = getDb().prepare<[], { tool_name: string; result: string }>(
      `SELECT tool_name, result FROM audit_logs WHERE source = 'rollout-safety' ORDER BY timestamp DESC LIMIT 1`,
    ).get()
    const control = listControlEvents({ eventType: "feature_flag.changed", limit: 5 })
    const report = runDoctor({ mode: "quick", includeEnvironment: false, includeReleasePackage: false })

    expect(change.featureFlag.mode).toBe("rollback")
    expect(flag.compatibilityMode).toBe(true)
    expect(audit).toEqual({ tool_name: "feature_flag_mode_change", result: "success" })
    expect(control[0]?.summary).toContain("message_ledger")
    expect(report.checks.find((check) => check.name === "feature.flags")?.status).toBe("warning")
  })

  it("records shadow compare mismatch as diagnostic-only rollout evidence", () => {
    insertSession({ id: "session-shadow", source: "webui", source_id: null, created_at: 1, updated_at: 1, summary: null })
    const run = createRootRun({ id: "run-shadow", sessionId: "session-shadow", requestGroupId: "request-shadow", prompt: "compare", source: "webui" })

    const compare = recordShadowCompare({
      featureKey: "delivery_outcome",
      targetKind: "delivery_outcome",
      targetId: "telegram:text:1",
      runId: run.id,
      requestGroupId: run.requestGroupId,
      oldValue: { delivered: true, receipt: "old" },
      newValue: { delivered: false, receipt: "new" },
      summary: "delivery outcome mismatch",
    })
    const diagnostic = getDb().prepare<[], { kind: string; summary: string }>(
      `SELECT kind, summary FROM diagnostic_events ORDER BY created_at DESC LIMIT 1`,
    ).get()
    const snapshot = buildRolloutSafetySnapshot()
    const report = runDoctor({ mode: "quick", includeEnvironment: false, includeReleasePackage: false })

    expect(compare.matched).toBe(false)
    expect(compare.diagnosticEventId).toEqual(expect.any(String))
    expect(diagnostic?.kind).toBe("rollout_shadow_mismatch")
    expect(snapshot.shadowCompare.mismatchCount).toBeGreaterThanOrEqual(1)
    expect(report.checks.find((check) => check.name === "rollout.evidence")?.status).toBe("warning")
  })

  it("includes feature flags and rollout evidence in runtime and release manifests", () => {
    setFeatureFlagMode({ featureKey: "approval_registry", mode: "dual_write", updatedBy: "operator:test" })
    recordShadowCompare({
      featureKey: "schedule_identity",
      targetKind: "schedule_identity",
      oldValue: { key: "same" },
      newValue: { key: "same" },
      summary: "schedule identity matched",
    })

    const snapshot = buildRolloutSafetySnapshot()
    const release = buildReleaseManifest({ targetPlatforms: [] })

    expect(snapshot.featureFlags.some((flag) => flag.featureKey === "approval_registry" && flag.mode === "dual_write")).toBe(true)
    expect(release.featureFlags.map((flag) => flag.featureKey)).toEqual(expect.arrayContaining(["message_ledger", "approval_registry", "runtime_manifest"]))
    expect(release.pipeline.order).toContain("rollout-shadow-evidence")
    expect(release.cleanInstallChecklist.some((item) => item.id === "feature-flags" && item.required)).toBe(true)
  })
})
