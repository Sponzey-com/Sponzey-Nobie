import type Database from "better-sqlite3";
import type { MigrationLockRow } from "../db/migration-safety.js";
export type FeatureFlagMode = "off" | "shadow" | "dual_write" | "enforced" | "rollback";
export type RolloutEvidenceStatus = "ok" | "warning" | "blocked";
export interface RuntimeFeatureFlag {
    featureKey: string;
    mode: FeatureFlagMode;
    compatibilityMode: boolean;
    updatedAt: number;
    updatedBy: string | null;
    reason: string | null;
    evidence: Record<string, unknown> | null;
    source: "default" | "db";
}
export interface FeatureFlagChangeResult {
    featureFlag: RuntimeFeatureFlag;
    auditRecorded: boolean;
    controlEventId: string | null;
}
export interface RolloutEvidenceRecord {
    id: string;
    created_at: number;
    feature_key: string;
    mode: FeatureFlagMode;
    stage: string;
    status: RolloutEvidenceStatus;
    run_id: string | null;
    request_group_id: string | null;
    summary: string;
    detail_json: string | null;
}
export interface ShadowCompareRecord {
    id: string;
    created_at: number;
    feature_key: string;
    target_kind: string;
    target_id: string | null;
    run_id: string | null;
    request_group_id: string | null;
    old_hash: string;
    new_hash: string;
    match: number;
    summary: string;
    detail_json: string | null;
}
export interface ShadowCompareResult {
    id: string;
    matched: boolean;
    oldHash: string;
    newHash: string;
    diagnosticEventId: string | null;
    controlEventId: string | null;
}
export interface RolloutSafetySnapshot {
    featureFlags: RuntimeFeatureFlag[];
    migrationLock: {
        active: MigrationLockRow | null;
        latest: MigrationLockRow | null;
    };
    shadowCompare: {
        total: number;
        mismatchCount: number;
        recentMismatches: ShadowCompareRecord[];
    };
    evidence: {
        total: number;
        warningCount: number;
        blockedCount: number;
        latest: RolloutEvidenceRecord[];
    };
}
export declare function ensureRolloutSafetyTables(db: Database.Database): void;
export declare function listFeatureFlags(db?: Database.Database): RuntimeFeatureFlag[];
export declare function getFeatureFlag(featureKey: string, db?: Database.Database): RuntimeFeatureFlag;
export declare function setFeatureFlagMode(input: {
    featureKey: string;
    mode: FeatureFlagMode;
    compatibilityMode?: boolean;
    updatedBy?: string | null;
    reason?: string | null;
    evidence?: Record<string, unknown> | null;
    runId?: string | null;
    requestGroupId?: string | null;
    now?: number;
    db?: Database.Database;
}): FeatureFlagChangeResult;
export declare function shouldUseNewPath(flag: RuntimeFeatureFlag): boolean;
export declare function shouldShadowWrite(flag: RuntimeFeatureFlag): boolean;
export declare function shouldReadCompatibilityPath(flag: RuntimeFeatureFlag): boolean;
export declare function recordRolloutEvidence(input: {
    featureKey: string;
    mode?: FeatureFlagMode;
    stage: string;
    status?: RolloutEvidenceStatus;
    runId?: string | null;
    requestGroupId?: string | null;
    summary: string;
    detail?: Record<string, unknown>;
    now?: number;
    db?: Database.Database;
}): string;
export declare function recordShadowCompare(input: {
    featureKey: string;
    targetKind: string;
    targetId?: string | null;
    runId?: string | null;
    requestGroupId?: string | null;
    oldValue: unknown;
    newValue: unknown;
    summary?: string;
    detail?: Record<string, unknown>;
    now?: number;
    db?: Database.Database;
}): ShadowCompareResult;
export declare function buildRolloutSafetySnapshot(dbPath?: string): RolloutSafetySnapshot;
//# sourceMappingURL=rollout-safety.d.ts.map