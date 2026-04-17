import type Database from "better-sqlite3";
export type MigrationLockStatus = "active" | "released" | "failed";
export type MigrationLockPhase = "preflight" | "backup" | "lock" | "apply" | "verify" | "unlock" | "failed";
export interface MigrationLockRow {
    id: string;
    status: MigrationLockStatus;
    locked_by: string;
    phase: MigrationLockPhase;
    started_at: number;
    updated_at: number;
    released_at: number | null;
    backup_snapshot_id: string | null;
    pending_versions_json: string | null;
    verify_report_json: string | null;
    error_message: string | null;
    rollback_runbook_ref: string | null;
}
export interface MigrationVerificationReport {
    ok: boolean;
    schemaVersion: number;
    requiredTables: Array<{
        name: string;
        ok: boolean;
    }>;
    requiredIndexes: Array<{
        name: string;
        ok: boolean;
    }>;
    integrityCheck: string;
    missingTables: string[];
    missingIndexes: string[];
}
export interface MigrationWriteGuardResult {
    ok: boolean;
    operation: string;
    lock: MigrationLockRow | null;
    userMessage: string | null;
    recoveryGuide: string | null;
}
export declare const MIGRATION_ROLLBACK_RUNBOOK_REF = "migration-rollback-runbook";
export declare function ensureMigrationSafetyTables(db: Database.Database): void;
export declare function getActiveMigrationLock(db: Database.Database): MigrationLockRow | null;
export declare function getLatestMigrationLock(db: Database.Database): MigrationLockRow | null;
export declare function beginMigrationLock(db: Database.Database, input: {
    id: string;
    pendingVersions: number[];
    lockedBy?: string;
    backupSnapshotId?: string | null;
    now?: number;
}): MigrationLockRow;
export declare function updateMigrationLockPhase(db: Database.Database, lockId: string, phase: MigrationLockPhase, now?: number): void;
export declare function releaseMigrationLock(db: Database.Database, input: {
    lockId: string;
    verifyReport: MigrationVerificationReport;
    now?: number;
}): void;
export declare function failMigrationLock(db: Database.Database, input: {
    lockId: string;
    error: string;
    verifyReport?: MigrationVerificationReport | null;
    now?: number;
}): void;
export declare function verifyMigrationState(db: Database.Database): MigrationVerificationReport;
export declare function checkMigrationWriteGuard(db: Database.Database, operation: string): MigrationWriteGuardResult;
export declare function assertMigrationWriteAllowed(db: Database.Database, operation: string): void;
//# sourceMappingURL=migration-safety.d.ts.map