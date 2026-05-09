import type Database from "better-sqlite3"
import type {
  EnterpriseMetadata,
  EnterpriseMetadataValue,
  EnterpriseTimestamp,
  EnterpriseTopology,
} from "../contracts/enterprise-topology.js"
import { getDb } from "../db/index.js"
import { assertMigrationWriteAllowed } from "../db/migration-safety.js"
import {
  compileTopology,
  type CompiledTopologySnapshot,
} from "./compiler.js"
import {
  type TopologyValidationResult,
  validateTopology,
} from "./validator.js"
import {
  buildTopologyHistoryId,
  buildTopologyValidationSnapshotId,
  buildTopologyVersionId,
  compiledSnapshotMatchesTopologyVersion,
  computeTopologyRegistrySourceHash,
  describeCompiledSnapshotMismatch,
  type TopologyRegistryHistoryEventType,
} from "./versioning.js"
import { repairTopologyForPersistence } from "./repair.js"

export type EnterpriseTopologyRegistryStatus = "draft" | "active" | "inactive" | "archived"

export interface EnterpriseTopologyRegistryRecord {
  topologyId: string
  name: string
  status: EnterpriseTopologyRegistryStatus
  activeVersion?: number
  activeVersionId?: string
  metadata?: EnterpriseMetadata
  createdAt: EnterpriseTimestamp
  updatedAt: EnterpriseTimestamp
  archivedAt?: EnterpriseTimestamp
}

export interface EnterpriseTopologyVersionRecord {
  versionId: string
  topologyId: string
  version: number
  topology: EnterpriseTopology
  sourceHash: string
  validationSnapshotId: string
  compiledSnapshotId?: string
  createdBy?: string
  importSource?: string
  createdAt: EnterpriseTimestamp
}

export interface TopologyValidationSnapshotRecord {
  snapshotId: string
  topologyId: string
  versionId: string
  version: number
  executable: boolean
  validation: TopologyValidationResult
  createdAt: EnterpriseTimestamp
}

export interface CompiledTopologySnapshotRecord {
  snapshotId: string
  topologyId: string
  versionId: string
  version: number
  sourceTopologyVersion: string
  sourceTopologyHash: string
  compilerVersion: string
  snapshot: CompiledTopologySnapshot
  createdAt: EnterpriseTimestamp
}

export interface EnterpriseTopologyHistoryRecord {
  historyId: string
  topologyId: string
  versionId?: string
  eventType: TopologyRegistryHistoryEventType
  fromVersion?: number
  toVersion?: number
  validationSnapshotId?: string
  compiledSnapshotId?: string
  summary: string
  detail: EnterpriseMetadata
  createdAt: EnterpriseTimestamp
}

export interface AppendTopologyVersionInput {
  topology: EnterpriseTopology
  createdBy?: string
  importSource?: string
}

export interface AppendTopologyVersionResult {
  topologyRecord: EnterpriseTopologyRegistryRecord
  version: EnterpriseTopologyVersionRecord
  validationSnapshot: TopologyValidationSnapshotRecord
  compiledSnapshot?: CompiledTopologySnapshotRecord
  history: EnterpriseTopologyHistoryRecord
}

export interface TopologyActivationSuccess {
  ok: true
  topologyRecord: EnterpriseTopologyRegistryRecord
  version: EnterpriseTopologyVersionRecord
  validationSnapshot: TopologyValidationSnapshotRecord
  compiledSnapshot: CompiledTopologySnapshotRecord
  history: EnterpriseTopologyHistoryRecord
}

export interface TopologyActivationBlocked {
  ok: false
  reasonCode:
    | "topology_version_not_found"
    | "topology_validation_snapshot_missing"
    | "topology_validation_blocked"
    | "compiled_snapshot_missing"
    | "compiled_snapshot_source_mismatch"
  topologyId: string
  version: number
  issues: string[]
  history?: EnterpriseTopologyHistoryRecord
}

export type TopologyActivationResult = TopologyActivationSuccess | TopologyActivationBlocked

export interface TopologyExportEnvelope {
  topologyRecord: EnterpriseTopologyRegistryRecord
  version: EnterpriseTopologyVersionRecord
  validationSnapshot: TopologyValidationSnapshotRecord
  compiledSnapshot?: CompiledTopologySnapshotRecord
}

export interface EnterpriseTopologyRegistryStore {
  appendTopologyVersion(input: AppendTopologyVersionInput): AppendTopologyVersionResult
  activateTopologyVersion(topologyId: string, version: number): TopologyActivationResult
  rollbackTopologyVersion(topologyId: string, targetVersion: number): TopologyActivationResult
  archiveTopology(topologyId: string): EnterpriseTopologyHistoryRecord | null
  listTopologies(): EnterpriseTopologyRegistryRecord[]
  getTopology(topologyId: string): EnterpriseTopologyRegistryRecord | null
  listVersions(topologyId: string): EnterpriseTopologyVersionRecord[]
  getVersion(topologyId: string, version: number): EnterpriseTopologyVersionRecord | null
  exportTopology(topologyId: string, version?: number): TopologyExportEnvelope | null
  listHistory(topologyId: string): EnterpriseTopologyHistoryRecord[]
}

export interface CreateEnterpriseTopologyRegistryOptions {
  db?: Database.Database
  now?: () => number
}

export function createEnterpriseTopologyRegistry(
  options: CreateEnterpriseTopologyRegistryOptions = {},
): EnterpriseTopologyRegistryStore {
  const db = options.db ?? getDb()
  const now = options.now ?? Date.now

  function appendTopologyVersion(input: AppendTopologyVersionInput): AppendTopologyVersionResult {
    assertMigrationWriteAllowed(db, "enterprise_topology.version.append")
    const timestamp = now()
    const repair = repairTopologyForPersistence(input.topology)
    const topology = repair.topology
    const validation = validateTopology(topology)
    const version = nextVersion(topology.id)
    const versionId = buildTopologyVersionId(topology.id, version)
    const sourceHash = computeTopologyRegistrySourceHash(topology)
    const validationSnapshotId = buildTopologyValidationSnapshotId(topology.id, version, sourceHash)
    const compileResult = validation.executable
      ? compileTopology(topology, {
          sourceTopologyVersion: version,
          compiledAt: timestamp,
        })
      : undefined
    const compiledSnapshot = compileResult?.ok === true ? compileResult.snapshot : undefined
    const compiledSnapshotId = compiledSnapshot?.compiledTopologySnapshotId
    const eventType: TopologyRegistryHistoryEventType =
      input.importSource !== undefined ? "imported" : "version_appended"

    const tx = db.transaction(() => {
      upsertTopologyRecord(topology, timestamp)
      insertVersionRecord({
        versionId,
        topology,
        version,
        sourceHash,
        validationSnapshotId,
        ...(compiledSnapshotId !== undefined ? { compiledSnapshotId } : {}),
        ...(input.createdBy !== undefined ? { createdBy: input.createdBy } : {}),
        ...(input.importSource !== undefined ? { importSource: input.importSource } : {}),
        createdAt: timestamp,
      })
      insertValidationSnapshot({
        snapshotId: validationSnapshotId,
        topologyId: topology.id,
        versionId,
        version,
        validation,
        createdAt: timestamp,
      })
      if (compiledSnapshot !== undefined) {
        insertCompiledSnapshot({
          snapshotId: compiledSnapshot.compiledTopologySnapshotId,
          topologyId: topology.id,
          versionId,
          version,
          snapshot: compiledSnapshot,
          createdAt: timestamp,
        })
      }
      insertHistory({
        historyId: buildTopologyHistoryId(eventType, topology.id, version),
        topologyId: topology.id,
        versionId,
        eventType,
        toVersion: version,
        validationSnapshotId,
        ...(compiledSnapshotId !== undefined ? { compiledSnapshotId } : {}),
        summary: eventType === "imported"
          ? `Imported topology version ${version}.`
          : `Appended topology version ${version}.`,
        detail: {
          sourceHash,
          executable: validation.executable,
          issueCounts: { ...validation.issueCounts },
          ...(repair.issues.length > 0
            ? {
                repairIssues: repair.issues.map((issue) => ({
                  code: issue.code,
                  severity: issue.severity,
                  message: issue.message,
                  topologyId: issue.topologyId,
                  ...(issue.nodeId !== undefined ? { nodeId: issue.nodeId } : {}),
                  ...(issue.relationId !== undefined ? { relationId: issue.relationId } : {}),
                }) as EnterpriseMetadataValue),
              }
            : {}),
          ...(input.importSource !== undefined ? { importSource: input.importSource } : {}),
        },
        createdAt: timestamp,
      })
    })
    tx()

    const topologyRecord = requireTopologyRecord(topology.id)
    const versionRecord = requireVersion(topology.id, version)
    const validationRecord = requireValidationSnapshot(topology.id, version)
    const compiledRecord = compiledSnapshotId !== undefined ? getCompiledSnapshot(topology.id, version) ?? undefined : undefined
    const history = listHistory(topology.id)[0]
    if (history === undefined) throw new Error("topology history event was not stored")
    return {
      topologyRecord,
      version: versionRecord,
      validationSnapshot: validationRecord,
      ...(compiledRecord !== undefined ? { compiledSnapshot: compiledRecord } : {}),
      history,
    }
  }

  function activateTopologyVersion(topologyId: string, version: number): TopologyActivationResult {
    return activateVersion(topologyId, version, "activated")
  }

  function rollbackTopologyVersion(topologyId: string, targetVersion: number): TopologyActivationResult {
    return activateVersion(topologyId, targetVersion, "rolled_back")
  }

  function archiveTopology(topologyId: string): EnterpriseTopologyHistoryRecord | null {
    assertMigrationWriteAllowed(db, "enterprise_topology.archive")
    const current = getTopology(topologyId)
    if (current === null) return null
    const timestamp = now()
    const history = buildHistoryRecord({
      eventType: "archived",
      topologyId,
      summary: "Archived enterprise topology.",
      detail: {
        previousStatus: current.status,
      },
      createdAt: timestamp,
      ...(current.activeVersionId !== undefined ? { versionId: current.activeVersionId } : {}),
      ...(current.activeVersion !== undefined ? { fromVersion: current.activeVersion } : {}),
    })
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE enterprise_topologies
         SET status = 'archived', updated_at = ?, archived_at = ?
         WHERE topology_id = ?`,
      ).run(timestamp, timestamp, topologyId)
      insertHistory(history)
    })
    tx()
    return history
  }

  function activateVersion(
    topologyId: string,
    version: number,
    eventType: "activated" | "rolled_back",
  ): TopologyActivationResult {
    assertMigrationWriteAllowed(db, `enterprise_topology.${eventType}`)
    const versionRecord = getVersion(topologyId, version)
    if (versionRecord === null) {
      return {
        ok: false,
        reasonCode: "topology_version_not_found",
        topologyId,
        version,
        issues: ["topology_version_not_found"],
      }
    }

    const validationSnapshot = getValidationSnapshot(topologyId, version)
    if (validationSnapshot === null) {
      const history = recordBlockedActivation(topologyId, versionRecord, eventType, "topology_validation_snapshot_missing", [
        "topology_validation_snapshot_missing",
      ])
      return {
        ok: false,
        reasonCode: "topology_validation_snapshot_missing",
        topologyId,
        version,
        issues: ["topology_validation_snapshot_missing"],
        history,
      }
    }

    if (!validationSnapshot.executable) {
      const issues = validationSnapshot.validation.issues
        .filter((issue) => issue.severity === "blocked" || issue.severity === "invalid")
        .map((issue) => issue.reasonCode)
      const history = recordBlockedActivation(topologyId, versionRecord, eventType, "topology_validation_blocked", issues)
      return {
        ok: false,
        reasonCode: "topology_validation_blocked",
        topologyId,
        version,
        issues,
        history,
      }
    }

    const compiledSnapshot = getCompiledSnapshot(topologyId, version)
    if (compiledSnapshot === null) {
      const history = recordBlockedActivation(topologyId, versionRecord, eventType, "compiled_snapshot_missing", [
        "compiled_snapshot_missing",
      ])
      return {
        ok: false,
        reasonCode: "compiled_snapshot_missing",
        topologyId,
        version,
        issues: ["compiled_snapshot_missing"],
        history,
      }
    }

    if (!compiledSnapshotMatchesTopologyVersion({
      compiledSnapshot: compiledSnapshot.snapshot,
      topologyId,
      version,
      sourceHash: versionRecord.sourceHash,
    })) {
      const issues = describeCompiledSnapshotMismatch({
        compiledSnapshot: compiledSnapshot.snapshot,
        topologyId,
        version,
        sourceHash: versionRecord.sourceHash,
      })
      const history = recordBlockedActivation(topologyId, versionRecord, eventType, "compiled_snapshot_source_mismatch", issues)
      return {
        ok: false,
        reasonCode: "compiled_snapshot_source_mismatch",
        topologyId,
        version,
        issues,
        history,
      }
    }

    const current = getTopology(topologyId)
    const timestamp = now()
    const history = buildHistoryRecord({
      eventType,
      topologyId,
      versionId: versionRecord.versionId,
      toVersion: version,
      validationSnapshotId: validationSnapshot.snapshotId,
      compiledSnapshotId: compiledSnapshot.snapshotId,
      summary: eventType === "activated"
        ? `Activated topology version ${version}.`
        : `Rolled back topology to version ${version}.`,
      detail: {
        previousActiveVersion: current?.activeVersion ?? null,
        activeVersion: version,
      },
      createdAt: timestamp,
      ...(current?.activeVersion !== undefined ? { fromVersion: current.activeVersion } : {}),
    })
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE enterprise_topologies
         SET status = 'active', active_version = ?, active_version_id = ?, updated_at = ?, archived_at = NULL
         WHERE topology_id = ?`,
      ).run(version, versionRecord.versionId, timestamp, topologyId)
      insertHistory(history)
    })
    tx()

    return {
      ok: true,
      topologyRecord: requireTopologyRecord(topologyId),
      version: versionRecord,
      validationSnapshot,
      compiledSnapshot,
      history,
    }
  }

  function recordBlockedActivation(
    topologyId: string,
    versionRecord: EnterpriseTopologyVersionRecord,
    attemptedEventType: "activated" | "rolled_back",
    reasonCode: string,
    issues: string[],
  ): EnterpriseTopologyHistoryRecord {
    const current = getTopology(topologyId)
    const history = buildHistoryRecord({
      eventType: attemptedEventType === "activated" ? "activation_blocked" : "rollback_blocked",
      topologyId,
      versionId: versionRecord.versionId,
      toVersion: versionRecord.version,
      validationSnapshotId: versionRecord.validationSnapshotId,
      summary: `${attemptedEventType === "activated" ? "Activation" : "Rollback"} blocked: ${reasonCode}.`,
      detail: {
        reasonCode,
        issues,
      },
      createdAt: now(),
      ...(current?.activeVersion !== undefined ? { fromVersion: current.activeVersion } : {}),
      ...(versionRecord.compiledSnapshotId !== undefined ? { compiledSnapshotId: versionRecord.compiledSnapshotId } : {}),
    })
    insertHistory(history)
    return history
  }

  function listTopologies(): EnterpriseTopologyRegistryRecord[] {
    return db.prepare<[], TopologyRow>(
      `SELECT * FROM enterprise_topologies ORDER BY updated_at DESC, topology_id ASC`,
    ).all().map(rowToTopologyRecord)
  }

  function getTopology(topologyId: string): EnterpriseTopologyRegistryRecord | null {
    const row = db.prepare<[string], TopologyRow>(
      `SELECT * FROM enterprise_topologies WHERE topology_id = ?`,
    ).get(topologyId)
    return row ? rowToTopologyRecord(row) : null
  }

  function listVersions(topologyId: string): EnterpriseTopologyVersionRecord[] {
    return db.prepare<[string], VersionRow>(
      `SELECT * FROM enterprise_topology_versions
       WHERE topology_id = ?
       ORDER BY version DESC`,
    ).all(topologyId).map(rowToVersionRecord)
  }

  function getVersion(topologyId: string, version: number): EnterpriseTopologyVersionRecord | null {
    const row = db.prepare<[string, number], VersionRow>(
      `SELECT * FROM enterprise_topology_versions
       WHERE topology_id = ? AND version = ?`,
    ).get(topologyId, version)
    return row ? rowToVersionRecord(row) : null
  }

  function exportTopology(topologyId: string, version?: number): TopologyExportEnvelope | null {
    const topologyRecord = getTopology(topologyId)
    if (topologyRecord === null) return null
    const resolvedVersion = version ?? topologyRecord.activeVersion ?? listVersions(topologyId)[0]?.version
    if (resolvedVersion === undefined) return null
    const versionRecord = getVersion(topologyId, resolvedVersion)
    const validationSnapshot = getValidationSnapshot(topologyId, resolvedVersion)
    if (versionRecord === null || validationSnapshot === null) return null
    const compiledSnapshot = getCompiledSnapshot(topologyId, resolvedVersion) ?? undefined
    return {
      topologyRecord,
      version: versionRecord,
      validationSnapshot,
      ...(compiledSnapshot !== undefined ? { compiledSnapshot } : {}),
    }
  }

  function listHistory(topologyId: string): EnterpriseTopologyHistoryRecord[] {
    return db.prepare<[string], HistoryRow>(
      `SELECT * FROM enterprise_topology_history
       WHERE topology_id = ?
       ORDER BY created_at DESC, history_id DESC`,
    ).all(topologyId).map(rowToHistoryRecord)
  }

  function nextVersion(topologyId: string): number {
    const row = db.prepare<[string], { version: number | null }>(
      `SELECT MAX(version) AS version FROM enterprise_topology_versions WHERE topology_id = ?`,
    ).get(topologyId)
    return (row?.version ?? 0) + 1
  }

  function requireTopologyRecord(topologyId: string): EnterpriseTopologyRegistryRecord {
    const record = getTopology(topologyId)
    if (record === null) throw new Error(`topology record not found: ${topologyId}`)
    return record
  }

  function requireVersion(topologyId: string, version: number): EnterpriseTopologyVersionRecord {
    const record = getVersion(topologyId, version)
    if (record === null) throw new Error(`topology version not found: ${topologyId}@${version}`)
    return record
  }

  function requireValidationSnapshot(topologyId: string, version: number): TopologyValidationSnapshotRecord {
    const record = getValidationSnapshot(topologyId, version)
    if (record === null) throw new Error(`topology validation snapshot not found: ${topologyId}@${version}`)
    return record
  }

  function getValidationSnapshot(topologyId: string, version: number): TopologyValidationSnapshotRecord | null {
    const row = db.prepare<[string, number], ValidationRow>(
      `SELECT * FROM topology_validation_snapshots
       WHERE topology_id = ? AND version = ?`,
    ).get(topologyId, version)
    return row ? rowToValidationRecord(row) : null
  }

  function getCompiledSnapshot(topologyId: string, version: number): CompiledTopologySnapshotRecord | null {
    const row = db.prepare<[string, number], CompiledRow>(
      `SELECT * FROM compiled_topology_snapshots
       WHERE topology_id = ? AND version = ?`,
    ).get(topologyId, version)
    return row ? rowToCompiledRecord(row) : null
  }

  function upsertTopologyRecord(topology: EnterpriseTopology, timestamp: number): void {
    const existing = getTopology(topology.id)
    if (existing === null) {
      db.prepare(
        `INSERT INTO enterprise_topologies
         (topology_id, name, status, active_version, active_version_id, metadata_json, created_at, updated_at, archived_at)
         VALUES (?, ?, 'draft', NULL, NULL, ?, ?, ?, NULL)`,
      ).run(topology.id, topology.name, toJsonOrNull(topology.metadata), timestamp, timestamp)
      return
    }

    db.prepare(
      `UPDATE enterprise_topologies
       SET name = ?, metadata_json = ?, updated_at = ?
       WHERE topology_id = ?`,
    ).run(topology.name, toJsonOrNull(topology.metadata), timestamp, topology.id)
  }

  function insertVersionRecord(input: {
    versionId: string
    topology: EnterpriseTopology
    version: number
    sourceHash: string
    validationSnapshotId: string
    compiledSnapshotId?: string
    createdBy?: string
    importSource?: string
    createdAt: number
  }): void {
    db.prepare(
      `INSERT INTO enterprise_topology_versions
       (version_id, topology_id, version, topology_json, source_hash, validation_snapshot_id,
        compiled_snapshot_id, created_by, import_source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.versionId,
      input.topology.id,
      input.version,
      JSON.stringify(input.topology),
      input.sourceHash,
      input.validationSnapshotId,
      input.compiledSnapshotId ?? null,
      input.createdBy ?? null,
      input.importSource ?? null,
      input.createdAt,
    )
  }

  function insertValidationSnapshot(input: {
    snapshotId: string
    topologyId: string
    versionId: string
    version: number
    validation: TopologyValidationResult
    createdAt: number
  }): void {
    db.prepare(
      `INSERT INTO topology_validation_snapshots
       (snapshot_id, topology_id, version_id, version, executable, issue_counts_json, issues_json, validation_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.snapshotId,
      input.topologyId,
      input.versionId,
      input.version,
      input.validation.executable ? 1 : 0,
      JSON.stringify(input.validation.issueCounts),
      JSON.stringify(input.validation.issues),
      JSON.stringify(input.validation),
      input.createdAt,
    )
  }

  function insertCompiledSnapshot(input: {
    snapshotId: string
    topologyId: string
    versionId: string
    version: number
    snapshot: CompiledTopologySnapshot
    createdAt: number
  }): void {
    db.prepare(
      `INSERT INTO compiled_topology_snapshots
       (snapshot_id, topology_id, version_id, version, source_topology_version,
        source_topology_hash, compiler_version, snapshot_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.snapshotId,
      input.topologyId,
      input.versionId,
      input.version,
      input.snapshot.sourceTopologyVersion,
      input.snapshot.sourceTopologyHash,
      input.snapshot.compilerVersion,
      JSON.stringify(input.snapshot),
      input.createdAt,
    )
  }

  function insertHistory(input: EnterpriseTopologyHistoryRecord): void {
    db.prepare(
      `INSERT INTO enterprise_topology_history
       (history_id, topology_id, version_id, event_type, from_version, to_version,
        validation_snapshot_id, compiled_snapshot_id, summary, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.historyId,
      input.topologyId,
      input.versionId ?? null,
      input.eventType,
      input.fromVersion ?? null,
      input.toVersion ?? null,
      input.validationSnapshotId ?? null,
      input.compiledSnapshotId ?? null,
      input.summary,
      JSON.stringify(input.detail),
      input.createdAt,
    )
  }

  function buildHistoryRecord(input: {
    eventType: TopologyRegistryHistoryEventType
    topologyId: string
    versionId?: string
    fromVersion?: number
    toVersion?: number
    validationSnapshotId?: string
    compiledSnapshotId?: string
    summary: string
    detail: EnterpriseMetadata
    createdAt: EnterpriseTimestamp
  }): EnterpriseTopologyHistoryRecord {
    return {
      historyId: buildTopologyHistoryId(input.eventType, input.topologyId, input.toVersion ?? input.fromVersion ?? null),
      topologyId: input.topologyId,
      eventType: input.eventType,
      summary: input.summary,
      detail: structuredClone(input.detail),
      createdAt: input.createdAt,
      ...(input.versionId !== undefined ? { versionId: input.versionId } : {}),
      ...(input.fromVersion !== undefined ? { fromVersion: input.fromVersion } : {}),
      ...(input.toVersion !== undefined ? { toVersion: input.toVersion } : {}),
      ...(input.validationSnapshotId !== undefined ? { validationSnapshotId: input.validationSnapshotId } : {}),
      ...(input.compiledSnapshotId !== undefined ? { compiledSnapshotId: input.compiledSnapshotId } : {}),
    }
  }

  return {
    appendTopologyVersion,
    activateTopologyVersion,
    rollbackTopologyVersion,
    archiveTopology,
    listTopologies,
    getTopology,
    listVersions,
    getVersion,
    exportTopology,
    listHistory,
  }
}

interface TopologyRow {
  topology_id: string
  name: string
  status: EnterpriseTopologyRegistryStatus
  active_version: number | null
  active_version_id: string | null
  metadata_json: string | null
  created_at: number
  updated_at: number
  archived_at: number | null
}

interface VersionRow {
  version_id: string
  topology_id: string
  version: number
  topology_json: string
  source_hash: string
  validation_snapshot_id: string
  compiled_snapshot_id: string | null
  created_by: string | null
  import_source: string | null
  created_at: number
}

interface ValidationRow {
  snapshot_id: string
  topology_id: string
  version_id: string
  version: number
  executable: number
  validation_json: string
  created_at: number
}

interface CompiledRow {
  snapshot_id: string
  topology_id: string
  version_id: string
  version: number
  source_topology_version: string
  source_topology_hash: string
  compiler_version: string
  snapshot_json: string
  created_at: number
}

interface HistoryRow {
  history_id: string
  topology_id: string
  version_id: string | null
  event_type: TopologyRegistryHistoryEventType
  from_version: number | null
  to_version: number | null
  validation_snapshot_id: string | null
  compiled_snapshot_id: string | null
  summary: string
  detail_json: string
  created_at: number
}

function rowToTopologyRecord(row: TopologyRow): EnterpriseTopologyRegistryRecord {
  return {
    topologyId: row.topology_id,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.active_version !== null ? { activeVersion: row.active_version } : {}),
    ...(row.active_version_id !== null ? { activeVersionId: row.active_version_id } : {}),
    ...(row.metadata_json !== null ? { metadata: parseJson<EnterpriseMetadata>(row.metadata_json) } : {}),
    ...(row.archived_at !== null ? { archivedAt: row.archived_at } : {}),
  }
}

function rowToVersionRecord(row: VersionRow): EnterpriseTopologyVersionRecord {
  return {
    versionId: row.version_id,
    topologyId: row.topology_id,
    version: row.version,
    topology: parseJson<EnterpriseTopology>(row.topology_json),
    sourceHash: row.source_hash,
    validationSnapshotId: row.validation_snapshot_id,
    createdAt: row.created_at,
    ...(row.compiled_snapshot_id !== null ? { compiledSnapshotId: row.compiled_snapshot_id } : {}),
    ...(row.created_by !== null ? { createdBy: row.created_by } : {}),
    ...(row.import_source !== null ? { importSource: row.import_source } : {}),
  }
}

function rowToValidationRecord(row: ValidationRow): TopologyValidationSnapshotRecord {
  return {
    snapshotId: row.snapshot_id,
    topologyId: row.topology_id,
    versionId: row.version_id,
    version: row.version,
    executable: row.executable === 1,
    validation: parseJson<TopologyValidationResult>(row.validation_json),
    createdAt: row.created_at,
  }
}

function rowToCompiledRecord(row: CompiledRow): CompiledTopologySnapshotRecord {
  return {
    snapshotId: row.snapshot_id,
    topologyId: row.topology_id,
    versionId: row.version_id,
    version: row.version,
    sourceTopologyVersion: row.source_topology_version,
    sourceTopologyHash: row.source_topology_hash,
    compilerVersion: row.compiler_version,
    snapshot: parseJson<CompiledTopologySnapshot>(row.snapshot_json),
    createdAt: row.created_at,
  }
}

function rowToHistoryRecord(row: HistoryRow): EnterpriseTopologyHistoryRecord {
  return {
    historyId: row.history_id,
    topologyId: row.topology_id,
    eventType: row.event_type,
    summary: row.summary,
    detail: parseJson<EnterpriseMetadata>(row.detail_json),
    createdAt: row.created_at,
    ...(row.version_id !== null ? { versionId: row.version_id } : {}),
    ...(row.from_version !== null ? { fromVersion: row.from_version } : {}),
    ...(row.to_version !== null ? { toVersion: row.to_version } : {}),
    ...(row.validation_snapshot_id !== null ? { validationSnapshotId: row.validation_snapshot_id } : {}),
    ...(row.compiled_snapshot_id !== null ? { compiledSnapshotId: row.compiled_snapshot_id } : {}),
  }
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T
}

function toJsonOrNull(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value)
}
