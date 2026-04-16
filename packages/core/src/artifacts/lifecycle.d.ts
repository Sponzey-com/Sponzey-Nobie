import { type ArtifactMetadataInput, type DbArtifactMetadata } from "../db/index.js";
export type ArtifactRetentionPolicy = "ephemeral" | "standard" | "permanent";
export interface ArtifactAccessDescriptor {
    ok: boolean;
    filePath: string;
    fileName: string;
    mimeType: string;
    sizeBytes?: number;
    previewable: boolean;
    downloadable: boolean;
    url?: string;
    previewUrl?: string;
    downloadUrl?: string;
    reason?: string;
    userMessage?: string;
}
export type ArtifactQuotaCleanupReason = "max_bytes" | "max_count";
export interface ArtifactQuotaCleanupCandidate {
    artifact: DbArtifactMetadata;
    reasons: ArtifactQuotaCleanupReason[];
    sizeBytes: number;
}
export interface ArtifactQuotaCleanupPlan {
    totalCount: number;
    totalBytes: number;
    retainedCount: number;
    retainedBytes: number;
    estimatedBytesToDelete: number;
    candidates: ArtifactQuotaCleanupCandidate[];
}
export interface ArtifactQuotaCleanupFailure {
    artifactId: string;
    filePath: string;
    reason: "outside_state_artifacts" | "delete_failed";
    message: string;
}
export interface ArtifactQuotaCleanupResult {
    plan: ArtifactQuotaCleanupPlan;
    deleted: DbArtifactMetadata[];
    failures: ArtifactQuotaCleanupFailure[];
}
export interface ExternalArtifactImportPolicy {
    filePath: string;
    allowedRoots: string[];
    maxBytes?: number;
    allowedMimeTypes?: string[];
    mimeType?: string;
}
export type ExternalArtifactImportValidation = {
    ok: true;
    filePath: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    previewable: boolean;
} | {
    ok: false;
    filePath: string;
    reason: "missing" | "not_file" | "outside_allowed_roots" | "too_large" | "mime_type_not_allowed";
    userMessage: string;
    mimeType?: string;
    sizeBytes?: number;
};
export declare const ARTIFACT_RETENTION_MS: Record<ArtifactRetentionPolicy, number | null>;
export declare const CHANNEL_FILE_SIZE_LIMIT_BYTES: Record<"webui" | "telegram" | "slack", number>;
export declare const ARTIFACT_THUMBNAIL_POLICY: Record<"webui" | "telegram" | "slack", "not_generated">;
export declare const DEFAULT_ARTIFACT_CLEANUP_INTERVAL_MS: number;
export declare const DEFAULT_ARTIFACT_STORAGE_QUOTA_BYTES: number;
export declare const DEFAULT_ARTIFACT_STORAGE_QUOTA_COUNT = 50000;
export declare function getArtifactsRoot(): string;
export declare function isPathInside(parent: string, child: string): boolean;
export declare function isStateArtifactPath(filePath: string): boolean;
export declare function guessArtifactMimeType(filePath: string): string;
export declare function isPreviewableMimeType(mimeType: string | undefined): boolean;
export declare function computeArtifactExpiresAt(policy?: ArtifactRetentionPolicy, createdAt?: number): number | null;
export declare function buildArtifactApiUrls(filePath: string): {
    previewUrl: string;
    downloadUrl: string;
} | undefined;
export declare function buildArtifactAccessDescriptor(input: {
    filePath: string;
    mimeType?: string;
    sizeBytes?: number;
    now?: number;
    expiresAt?: number | null;
}): ArtifactAccessDescriptor;
export declare function recordArtifactMetadata(input: ArtifactMetadataInput): string;
export declare function cleanupExpiredArtifacts(input?: {
    now?: number;
    deleteFiles?: boolean;
}): DbArtifactMetadata[];
export declare function planArtifactQuotaCleanup(input: {
    maxBytes?: number;
    maxCount?: number;
    includePermanent?: boolean;
}): ArtifactQuotaCleanupPlan;
export declare function cleanupArtifactStorageQuota(input: {
    maxBytes?: number;
    maxCount?: number;
    includePermanent?: boolean;
    now?: number;
    deleteFiles?: boolean;
}): ArtifactQuotaCleanupResult;
export declare function runArtifactCleanupCycle(input?: {
    maxBytes?: number;
    maxCount?: number;
    includePermanent?: boolean;
    now?: number;
    deleteFiles?: boolean;
}): {
    expired: DbArtifactMetadata[];
    quota: ArtifactQuotaCleanupResult;
};
export declare function startArtifactCleanupScheduler(input?: {
    intervalMs?: number;
    maxBytes?: number;
    maxCount?: number;
    includePermanent?: boolean;
    deleteFiles?: boolean;
}): void;
export declare function stopArtifactCleanupScheduler(): void;
export declare function validateExternalArtifactImport(input: ExternalArtifactImportPolicy): ExternalArtifactImportValidation;
//# sourceMappingURL=lifecycle.d.ts.map