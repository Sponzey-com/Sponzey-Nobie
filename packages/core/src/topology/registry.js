import { getDb } from "../db/index.js";
import { assertMigrationWriteAllowed } from "../db/migration-safety.js";
import { compileTopology, } from "./compiler.js";
import { validateTopology, } from "./validator.js";
import { buildTopologyHistoryId, buildTopologyValidationSnapshotId, buildTopologyVersionId, compiledSnapshotMatchesTopologyVersion, computeTopologyRegistrySourceHash, describeCompiledSnapshotMismatch, } from "./versioning.js";
import { repairTopologyForPersistence } from "./repair.js";
export function createEnterpriseTopologyRegistry(options = {}) {
    const db = options.db ?? getDb();
    const now = options.now ?? Date.now;
    function appendTopologyVersion(input) {
        assertMigrationWriteAllowed(db, "enterprise_topology.version.append");
        const timestamp = now();
        const repair = repairTopologyForPersistence(input.topology);
        const topology = repair.topology;
        const validation = validateTopology(topology);
        const version = nextVersion(topology.id);
        const versionId = buildTopologyVersionId(topology.id, version);
        const sourceHash = computeTopologyRegistrySourceHash(topology);
        const validationSnapshotId = buildTopologyValidationSnapshotId(topology.id, version, sourceHash);
        const compileResult = validation.executable
            ? compileTopology(topology, {
                sourceTopologyVersion: version,
                compiledAt: timestamp,
            })
            : undefined;
        const compiledSnapshot = compileResult?.ok === true ? compileResult.snapshot : undefined;
        const compiledSnapshotId = compiledSnapshot?.compiledTopologySnapshotId;
        const eventType = input.importSource !== undefined ? "imported" : "version_appended";
        const tx = db.transaction(() => {
            upsertTopologyRecord(topology, timestamp);
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
            });
            insertValidationSnapshot({
                snapshotId: validationSnapshotId,
                topologyId: topology.id,
                versionId,
                version,
                validation,
                createdAt: timestamp,
            });
            if (compiledSnapshot !== undefined) {
                insertCompiledSnapshot({
                    snapshotId: compiledSnapshot.compiledTopologySnapshotId,
                    topologyId: topology.id,
                    versionId,
                    version,
                    snapshot: compiledSnapshot,
                    createdAt: timestamp,
                });
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
                            })),
                        }
                        : {}),
                    ...(input.importSource !== undefined ? { importSource: input.importSource } : {}),
                },
                createdAt: timestamp,
            });
        });
        tx();
        const topologyRecord = requireTopologyRecord(topology.id);
        const versionRecord = requireVersion(topology.id, version);
        const validationRecord = requireValidationSnapshot(topology.id, version);
        const compiledRecord = compiledSnapshotId !== undefined ? getCompiledSnapshot(topology.id, version) ?? undefined : undefined;
        const history = listHistory(topology.id)[0];
        if (history === undefined)
            throw new Error("topology history event was not stored");
        return {
            topologyRecord,
            version: versionRecord,
            validationSnapshot: validationRecord,
            ...(compiledRecord !== undefined ? { compiledSnapshot: compiledRecord } : {}),
            history,
        };
    }
    function activateTopologyVersion(topologyId, version) {
        return activateVersion(topologyId, version, "activated");
    }
    function rollbackTopologyVersion(topologyId, targetVersion) {
        return activateVersion(topologyId, targetVersion, "rolled_back");
    }
    function archiveTopology(topologyId) {
        assertMigrationWriteAllowed(db, "enterprise_topology.archive");
        const current = getTopology(topologyId);
        if (current === null)
            return null;
        const timestamp = now();
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
        });
        const tx = db.transaction(() => {
            db.prepare(`UPDATE enterprise_topologies
         SET status = 'archived', updated_at = ?, archived_at = ?
         WHERE topology_id = ?`).run(timestamp, timestamp, topologyId);
            insertHistory(history);
        });
        tx();
        return history;
    }
    function activateVersion(topologyId, version, eventType) {
        assertMigrationWriteAllowed(db, `enterprise_topology.${eventType}`);
        const versionRecord = getVersion(topologyId, version);
        if (versionRecord === null) {
            return {
                ok: false,
                reasonCode: "topology_version_not_found",
                topologyId,
                version,
                issues: ["topology_version_not_found"],
            };
        }
        const validationSnapshot = getValidationSnapshot(topologyId, version);
        if (validationSnapshot === null) {
            const history = recordBlockedActivation(topologyId, versionRecord, eventType, "topology_validation_snapshot_missing", [
                "topology_validation_snapshot_missing",
            ]);
            return {
                ok: false,
                reasonCode: "topology_validation_snapshot_missing",
                topologyId,
                version,
                issues: ["topology_validation_snapshot_missing"],
                history,
            };
        }
        if (!validationSnapshot.executable) {
            const issues = validationSnapshot.validation.issues
                .filter((issue) => issue.severity === "blocked" || issue.severity === "invalid")
                .map((issue) => issue.reasonCode);
            const history = recordBlockedActivation(topologyId, versionRecord, eventType, "topology_validation_blocked", issues);
            return {
                ok: false,
                reasonCode: "topology_validation_blocked",
                topologyId,
                version,
                issues,
                history,
            };
        }
        const compiledSnapshot = getCompiledSnapshot(topologyId, version);
        if (compiledSnapshot === null) {
            const history = recordBlockedActivation(topologyId, versionRecord, eventType, "compiled_snapshot_missing", [
                "compiled_snapshot_missing",
            ]);
            return {
                ok: false,
                reasonCode: "compiled_snapshot_missing",
                topologyId,
                version,
                issues: ["compiled_snapshot_missing"],
                history,
            };
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
            });
            const history = recordBlockedActivation(topologyId, versionRecord, eventType, "compiled_snapshot_source_mismatch", issues);
            return {
                ok: false,
                reasonCode: "compiled_snapshot_source_mismatch",
                topologyId,
                version,
                issues,
                history,
            };
        }
        const current = getTopology(topologyId);
        const timestamp = now();
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
        });
        const tx = db.transaction(() => {
            db.prepare(`UPDATE enterprise_topologies
         SET status = 'active', active_version = ?, active_version_id = ?, updated_at = ?, archived_at = NULL
         WHERE topology_id = ?`).run(version, versionRecord.versionId, timestamp, topologyId);
            insertHistory(history);
        });
        tx();
        return {
            ok: true,
            topologyRecord: requireTopologyRecord(topologyId),
            version: versionRecord,
            validationSnapshot,
            compiledSnapshot,
            history,
        };
    }
    function recordBlockedActivation(topologyId, versionRecord, attemptedEventType, reasonCode, issues) {
        const current = getTopology(topologyId);
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
        });
        insertHistory(history);
        return history;
    }
    function listTopologies() {
        return db.prepare(`SELECT * FROM enterprise_topologies ORDER BY updated_at DESC, topology_id ASC`).all().map(rowToTopologyRecord);
    }
    function getTopology(topologyId) {
        const row = db.prepare(`SELECT * FROM enterprise_topologies WHERE topology_id = ?`).get(topologyId);
        return row ? rowToTopologyRecord(row) : null;
    }
    function listVersions(topologyId) {
        return db.prepare(`SELECT * FROM enterprise_topology_versions
       WHERE topology_id = ?
       ORDER BY version DESC`).all(topologyId).map(rowToVersionRecord);
    }
    function getVersion(topologyId, version) {
        const row = db.prepare(`SELECT * FROM enterprise_topology_versions
       WHERE topology_id = ? AND version = ?`).get(topologyId, version);
        return row ? rowToVersionRecord(row) : null;
    }
    function exportTopology(topologyId, version) {
        const topologyRecord = getTopology(topologyId);
        if (topologyRecord === null)
            return null;
        const resolvedVersion = version ?? topologyRecord.activeVersion ?? listVersions(topologyId)[0]?.version;
        if (resolvedVersion === undefined)
            return null;
        const versionRecord = getVersion(topologyId, resolvedVersion);
        const validationSnapshot = getValidationSnapshot(topologyId, resolvedVersion);
        if (versionRecord === null || validationSnapshot === null)
            return null;
        const compiledSnapshot = getCompiledSnapshot(topologyId, resolvedVersion) ?? undefined;
        return {
            topologyRecord,
            version: versionRecord,
            validationSnapshot,
            ...(compiledSnapshot !== undefined ? { compiledSnapshot } : {}),
        };
    }
    function listHistory(topologyId) {
        return db.prepare(`SELECT * FROM enterprise_topology_history
       WHERE topology_id = ?
       ORDER BY created_at DESC, history_id DESC`).all(topologyId).map(rowToHistoryRecord);
    }
    function nextVersion(topologyId) {
        const row = db.prepare(`SELECT MAX(version) AS version FROM enterprise_topology_versions WHERE topology_id = ?`).get(topologyId);
        return (row?.version ?? 0) + 1;
    }
    function requireTopologyRecord(topologyId) {
        const record = getTopology(topologyId);
        if (record === null)
            throw new Error(`topology record not found: ${topologyId}`);
        return record;
    }
    function requireVersion(topologyId, version) {
        const record = getVersion(topologyId, version);
        if (record === null)
            throw new Error(`topology version not found: ${topologyId}@${version}`);
        return record;
    }
    function requireValidationSnapshot(topologyId, version) {
        const record = getValidationSnapshot(topologyId, version);
        if (record === null)
            throw new Error(`topology validation snapshot not found: ${topologyId}@${version}`);
        return record;
    }
    function getValidationSnapshot(topologyId, version) {
        const row = db.prepare(`SELECT * FROM topology_validation_snapshots
       WHERE topology_id = ? AND version = ?`).get(topologyId, version);
        return row ? rowToValidationRecord(row) : null;
    }
    function getCompiledSnapshot(topologyId, version) {
        const row = db.prepare(`SELECT * FROM compiled_topology_snapshots
       WHERE topology_id = ? AND version = ?`).get(topologyId, version);
        return row ? rowToCompiledRecord(row) : null;
    }
    function upsertTopologyRecord(topology, timestamp) {
        const existing = getTopology(topology.id);
        if (existing === null) {
            db.prepare(`INSERT INTO enterprise_topologies
         (topology_id, name, status, active_version, active_version_id, metadata_json, created_at, updated_at, archived_at)
         VALUES (?, ?, 'draft', NULL, NULL, ?, ?, ?, NULL)`).run(topology.id, topology.name, toJsonOrNull(topology.metadata), timestamp, timestamp);
            return;
        }
        db.prepare(`UPDATE enterprise_topologies
       SET name = ?, metadata_json = ?, updated_at = ?
       WHERE topology_id = ?`).run(topology.name, toJsonOrNull(topology.metadata), timestamp, topology.id);
    }
    function insertVersionRecord(input) {
        db.prepare(`INSERT INTO enterprise_topology_versions
       (version_id, topology_id, version, topology_json, source_hash, validation_snapshot_id,
        compiled_snapshot_id, created_by, import_source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.versionId, input.topology.id, input.version, JSON.stringify(input.topology), input.sourceHash, input.validationSnapshotId, input.compiledSnapshotId ?? null, input.createdBy ?? null, input.importSource ?? null, input.createdAt);
    }
    function insertValidationSnapshot(input) {
        db.prepare(`INSERT INTO topology_validation_snapshots
       (snapshot_id, topology_id, version_id, version, executable, issue_counts_json, issues_json, validation_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.snapshotId, input.topologyId, input.versionId, input.version, input.validation.executable ? 1 : 0, JSON.stringify(input.validation.issueCounts), JSON.stringify(input.validation.issues), JSON.stringify(input.validation), input.createdAt);
    }
    function insertCompiledSnapshot(input) {
        db.prepare(`INSERT INTO compiled_topology_snapshots
       (snapshot_id, topology_id, version_id, version, source_topology_version,
        source_topology_hash, compiler_version, snapshot_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.snapshotId, input.topologyId, input.versionId, input.version, input.snapshot.sourceTopologyVersion, input.snapshot.sourceTopologyHash, input.snapshot.compilerVersion, JSON.stringify(input.snapshot), input.createdAt);
    }
    function insertHistory(input) {
        db.prepare(`INSERT INTO enterprise_topology_history
       (history_id, topology_id, version_id, event_type, from_version, to_version,
        validation_snapshot_id, compiled_snapshot_id, summary, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(input.historyId, input.topologyId, input.versionId ?? null, input.eventType, input.fromVersion ?? null, input.toVersion ?? null, input.validationSnapshotId ?? null, input.compiledSnapshotId ?? null, input.summary, JSON.stringify(input.detail), input.createdAt);
    }
    function buildHistoryRecord(input) {
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
        };
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
    };
}
function rowToTopologyRecord(row) {
    return {
        topologyId: row.topology_id,
        name: row.name,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ...(row.active_version !== null ? { activeVersion: row.active_version } : {}),
        ...(row.active_version_id !== null ? { activeVersionId: row.active_version_id } : {}),
        ...(row.metadata_json !== null ? { metadata: parseJson(row.metadata_json) } : {}),
        ...(row.archived_at !== null ? { archivedAt: row.archived_at } : {}),
    };
}
function rowToVersionRecord(row) {
    return {
        versionId: row.version_id,
        topologyId: row.topology_id,
        version: row.version,
        topology: parseJson(row.topology_json),
        sourceHash: row.source_hash,
        validationSnapshotId: row.validation_snapshot_id,
        createdAt: row.created_at,
        ...(row.compiled_snapshot_id !== null ? { compiledSnapshotId: row.compiled_snapshot_id } : {}),
        ...(row.created_by !== null ? { createdBy: row.created_by } : {}),
        ...(row.import_source !== null ? { importSource: row.import_source } : {}),
    };
}
function rowToValidationRecord(row) {
    return {
        snapshotId: row.snapshot_id,
        topologyId: row.topology_id,
        versionId: row.version_id,
        version: row.version,
        executable: row.executable === 1,
        validation: parseJson(row.validation_json),
        createdAt: row.created_at,
    };
}
function rowToCompiledRecord(row) {
    return {
        snapshotId: row.snapshot_id,
        topologyId: row.topology_id,
        versionId: row.version_id,
        version: row.version,
        sourceTopologyVersion: row.source_topology_version,
        sourceTopologyHash: row.source_topology_hash,
        compilerVersion: row.compiler_version,
        snapshot: parseJson(row.snapshot_json),
        createdAt: row.created_at,
    };
}
function rowToHistoryRecord(row) {
    return {
        historyId: row.history_id,
        topologyId: row.topology_id,
        eventType: row.event_type,
        summary: row.summary,
        detail: parseJson(row.detail_json),
        createdAt: row.created_at,
        ...(row.version_id !== null ? { versionId: row.version_id } : {}),
        ...(row.from_version !== null ? { fromVersion: row.from_version } : {}),
        ...(row.to_version !== null ? { toVersion: row.to_version } : {}),
        ...(row.validation_snapshot_id !== null ? { validationSnapshotId: row.validation_snapshot_id } : {}),
        ...(row.compiled_snapshot_id !== null ? { compiledSnapshotId: row.compiled_snapshot_id } : {}),
    };
}
function parseJson(value) {
    return JSON.parse(value);
}
function toJsonOrNull(value) {
    return value === undefined ? null : JSON.stringify(value);
}
//# sourceMappingURL=registry.js.map