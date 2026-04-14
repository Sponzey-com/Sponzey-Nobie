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
export declare const ARTIFACT_RETENTION_MS: Record<ArtifactRetentionPolicy, number | null>;
export declare const CHANNEL_FILE_SIZE_LIMIT_BYTES: Record<"webui" | "telegram" | "slack", number>;
export declare const ARTIFACT_THUMBNAIL_POLICY: Record<"webui" | "telegram" | "slack", "not_generated">;
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
//# sourceMappingURL=lifecycle.d.ts.map