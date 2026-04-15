import { type PromptSourceMetadata } from "../memory/nobie-md.js";
import { type MigrationVersionStatus } from "./operations.js";
export type BackupTargetKind = "config" | "prompt_source" | "sqlite_db" | "sqlite_sidecar" | "vector_db" | "setup_state" | "logical_sqlite_table" | "excluded_path";
export type BackupTargetReason = "required" | "optional_missing" | "secret_reentry_required" | "large_retention_binary" | "cache_or_build_output" | "transient_runtime" | "logical_coverage";
export interface BackupInventoryTarget {
    id: string;
    kind: BackupTargetKind;
    sourcePath: string;
    relativePath: string;
    include: boolean;
    required: boolean;
    reason: BackupTargetReason;
    sizeBytes?: number;
    checksum?: string;
}
export interface BackupTargetInventory {
    stateDir: string;
    workDir: string;
    configPath: string;
    dbPath: string;
    memoryDbPath: string;
    targets: BackupInventoryTarget[];
    included: BackupInventoryTarget[];
    excluded: BackupInventoryTarget[];
    promptSources: PromptSourceMetadata[];
}
export interface BackupSnapshotFile {
    id: string;
    kind: BackupTargetKind;
    sourcePath: string;
    relativePath: string;
    snapshotPath: string;
    sizeBytes: number;
    checksum: string;
}
export interface BackupSnapshotManifest {
    kind: "nobie.backup.snapshot";
    version: 1;
    id: string;
    createdAt: number;
    snapshotDir: string;
    appVersion: string;
    gitTag?: string;
    gitCommit?: string;
    schemaVersion: number;
    latestSchemaVersion: number;
    files: BackupSnapshotFile[];
    excluded: BackupInventoryTarget[];
    promptSources: PromptSourceMetadata[];
    logicalCoverage: string[];
    secretReentryRequired: Array<{
        scope: string;
        reason: string;
    }>;
    checksum: string;
}
export interface SnapshotVerificationResult {
    ok: boolean;
    checked: number;
    failures: Array<{
        relativePath: string;
        reason: "missing" | "checksum_mismatch";
    }>;
}
export type RestoreRehearsalCheckName = "manifest_checksum" | "file_copy" | "sqlite_integrity" | "migration_status" | "prompt_source_registry";
export interface RestoreRehearsalCheck {
    name: RestoreRehearsalCheckName;
    ok: boolean;
    message: string;
}
export interface RestoreRehearsalReport {
    ok: boolean;
    snapshotId: string;
    restoredDir: string;
    checks: RestoreRehearsalCheck[];
    restoredFiles: string[];
    migrationStatus?: MigrationVersionStatus;
    promptSourceCount: number;
    reportPath?: string;
}
export type MigrationPreflightRisk = "low" | "medium" | "high" | "blocking";
export type MigrationPreflightCheckName = "backup_available" | "snapshot_checksum" | "schema_version" | "disk_space" | "db_lock" | "wal_state" | "permission" | "provider_config_sanity";
export interface MigrationPreflightCheck {
    name: MigrationPreflightCheckName;
    ok: boolean;
    risk: MigrationPreflightRisk;
    message: string;
}
export interface MigrationPreflightReport {
    ok: boolean;
    risk: MigrationPreflightRisk;
    dbPath: string;
    latestSchemaVersion: number;
    currentSchemaVersion: number;
    pendingVersions: number[];
    checks: MigrationPreflightCheck[];
    dryRun: {
        changesDatabase: false;
        willApply: Array<{
            version: number;
            transaction: boolean;
        }>;
    };
    runbook: MigrationRollbackRunbook;
}
export interface MigrationRollbackRunbook {
    id: "migration-rollback-runbook";
    title: string;
    retryForbiddenWhen: string[];
    steps: string[];
    restoreTargets: string[];
}
export interface BackupSnapshotOptions {
    stateDir?: string;
    workDir?: string;
    configPath?: string;
    dbPath?: string;
    memoryDbPath?: string;
    snapshotDir?: string;
    appVersion?: string;
    gitTag?: string;
    gitCommit?: string;
    now?: number;
    checkpointSqlite?: boolean;
}
export interface RestoreRehearsalOptions {
    manifest: BackupSnapshotManifest;
    restoreDir: string;
    writeReport?: boolean;
}
export interface MigrationPreflightOptions {
    dbPath?: string;
    manifest?: BackupSnapshotManifest;
    diskFreeBytes?: number;
    requiredFreeBytes?: number;
    dbLocked?: boolean;
    canWrite?: boolean;
    providerConfigSane?: boolean;
}
export declare const MIGRATION_ROLLBACK_RUNBOOK: MigrationRollbackRunbook;
export declare function buildBackupTargetInventory(options?: BackupSnapshotOptions): BackupTargetInventory;
export declare function createBackupSnapshot(options?: BackupSnapshotOptions): BackupSnapshotManifest;
export declare function verifyBackupSnapshotManifest(manifest: BackupSnapshotManifest): SnapshotVerificationResult;
export declare function runRestoreRehearsal(options: RestoreRehearsalOptions): RestoreRehearsalReport;
export declare function buildMigrationPreflightReport(options?: MigrationPreflightOptions): MigrationPreflightReport;
export declare function formatInventoryPathForDisplay(path: string, baseDir: string): string;
