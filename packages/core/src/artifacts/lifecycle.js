import { existsSync, rmSync, statSync } from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";
import { PATHS } from "../config/index.js";
import { insertArtifactMetadata, listActiveArtifactMetadata, listExpiredArtifactMetadata, markArtifactDeleted, } from "../db/index.js";
export const ARTIFACT_RETENTION_MS = {
    ephemeral: 24 * 60 * 60 * 1000,
    standard: 30 * 24 * 60 * 60 * 1000,
    permanent: null,
};
const PREVIEWABLE_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/svg+xml",
    "application/pdf",
    "text/plain",
    "text/markdown",
    "application/json",
]);
export const CHANNEL_FILE_SIZE_LIMIT_BYTES = {
    webui: 100 * 1024 * 1024,
    telegram: 50 * 1024 * 1024,
    slack: 1024 * 1024 * 1024,
};
export const ARTIFACT_THUMBNAIL_POLICY = {
    webui: "not_generated",
    telegram: "not_generated",
    slack: "not_generated",
};
export const DEFAULT_ARTIFACT_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;
export const DEFAULT_ARTIFACT_STORAGE_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;
export const DEFAULT_ARTIFACT_STORAGE_QUOTA_COUNT = 50_000;
let artifactCleanupTimer = null;
export function getArtifactsRoot() {
    return resolve(PATHS.stateDir, "artifacts");
}
export function isPathInside(parent, child) {
    const root = resolve(parent);
    const candidate = resolve(child);
    return candidate === root || candidate.startsWith(`${root}${sep}`);
}
export function isStateArtifactPath(filePath) {
    return isPathInside(getArtifactsRoot(), filePath);
}
export function guessArtifactMimeType(filePath) {
    switch (extname(filePath).toLowerCase()) {
        case ".png":
            return "image/png";
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".gif":
            return "image/gif";
        case ".webp":
            return "image/webp";
        case ".bmp":
            return "image/bmp";
        case ".svg":
            return "image/svg+xml";
        case ".pdf":
            return "application/pdf";
        case ".txt":
        case ".log":
            return "text/plain";
        case ".md":
            return "text/markdown";
        case ".json":
            return "application/json";
        default:
            return "application/octet-stream";
    }
}
export function isPreviewableMimeType(mimeType) {
    if (!mimeType)
        return false;
    return PREVIEWABLE_MIME_TYPES.has(normalizeMimeType(mimeType));
}
export function computeArtifactExpiresAt(policy = "standard", createdAt = Date.now()) {
    const ttlMs = ARTIFACT_RETENTION_MS[policy];
    return ttlMs == null ? null : createdAt + ttlMs;
}
export function buildArtifactApiUrls(filePath) {
    const root = getArtifactsRoot();
    if (!isPathInside(root, filePath))
        return undefined;
    const encodedPath = relative(root, resolve(filePath))
        .split(sep)
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment))
        .join("/");
    if (!encodedPath)
        return undefined;
    const previewUrl = `/api/artifacts/${encodedPath}`;
    return {
        previewUrl,
        downloadUrl: `${previewUrl}?download=1`,
    };
}
export function buildArtifactAccessDescriptor(input) {
    const filePath = resolve(input.filePath);
    const fileName = basename(filePath);
    const mimeType = input.mimeType ?? guessArtifactMimeType(filePath);
    const sizeBytes = input.sizeBytes ?? safeFileSize(filePath);
    const urls = buildArtifactApiUrls(filePath);
    if (!urls) {
        return {
            ok: false,
            filePath,
            fileName,
            mimeType,
            ...(sizeBytes !== undefined ? { sizeBytes } : {}),
            previewable: false,
            downloadable: false,
            reason: "outside_state_artifacts",
            userMessage: "이 파일은 안전한 artifact 저장소 밖에 있어 WebUI 링크로 노출하지 않습니다.",
        };
    }
    const now = input.now ?? Date.now();
    if (input.expiresAt != null && input.expiresAt <= now) {
        return {
            ok: false,
            filePath,
            fileName,
            mimeType,
            ...(sizeBytes !== undefined ? { sizeBytes } : {}),
            previewable: false,
            downloadable: false,
            reason: "expired",
            userMessage: "이 파일은 보관 기간이 만료되어 다시 생성해야 합니다.",
        };
    }
    const previewable = isPreviewableMimeType(mimeType);
    return {
        ok: true,
        filePath,
        fileName,
        mimeType,
        ...(sizeBytes !== undefined ? { sizeBytes } : {}),
        previewable,
        downloadable: true,
        url: previewable ? urls.previewUrl : urls.downloadUrl,
        previewUrl: urls.previewUrl,
        downloadUrl: urls.downloadUrl,
    };
}
export function recordArtifactMetadata(input) {
    const createdAt = input.createdAt ?? Date.now();
    const retentionPolicy = input.retentionPolicy ?? "standard";
    const filePath = resolve(input.artifactPath);
    const mimeType = input.mimeType ?? guessArtifactMimeType(filePath);
    const sizeBytes = input.sizeBytes ?? safeFileSize(filePath);
    const expiresAt = input.expiresAt === undefined ? computeArtifactExpiresAt(retentionPolicy, createdAt) : input.expiresAt;
    const descriptor = buildArtifactAccessDescriptor({
        filePath,
        mimeType,
        ...(sizeBytes !== undefined ? { sizeBytes } : {}),
        expiresAt,
        now: createdAt,
    });
    return insertArtifactMetadata({
        ...input,
        artifactPath: filePath,
        mimeType,
        ...(sizeBytes !== undefined ? { sizeBytes } : {}),
        retentionPolicy,
        expiresAt,
        metadata: {
            ...(input.metadata ?? {}),
            artifactLifecycle: {
                original: {
                    path: filePath,
                    mimeType,
                    sizeBytes: sizeBytes ?? null,
                },
                preview: descriptor.ok && descriptor.previewable
                    ? {
                        path: filePath,
                        url: descriptor.previewUrl ?? null,
                        mimeType,
                    }
                    : null,
                thumbnail: null,
                delivery: {
                    previewable: descriptor.previewable,
                    downloadable: descriptor.downloadable,
                    url: descriptor.url ?? null,
                    previewUrl: descriptor.previewUrl ?? null,
                    downloadUrl: descriptor.downloadUrl ?? null,
                    fileName: descriptor.fileName,
                },
                retention: {
                    policy: retentionPolicy,
                    expiresAt,
                },
            },
        },
        createdAt,
        updatedAt: input.updatedAt ?? createdAt,
    });
}
export function cleanupExpiredArtifacts(input = {}) {
    const now = input.now ?? Date.now();
    const expired = listExpiredArtifactMetadata(now);
    for (const artifact of expired) {
        if (input.deleteFiles !== false && artifact.artifact_path && isStateArtifactPath(artifact.artifact_path)) {
            try {
                if (existsSync(artifact.artifact_path))
                    rmSync(artifact.artifact_path, { force: true });
            }
            catch {
                // Cleanup is best-effort. Metadata still records expiry so the UI can report it.
            }
        }
        markArtifactDeleted(artifact.id, now);
    }
    return expired;
}
export function planArtifactQuotaCleanup(input) {
    const artifacts = listActiveArtifactMetadata();
    const totalBytes = artifacts.reduce((sum, artifact) => sum + artifactSize(artifact), 0);
    let retainedBytes = totalBytes;
    let retainedCount = artifacts.length;
    const candidates = [];
    if (input.maxBytes === undefined && input.maxCount === undefined) {
        return {
            totalCount: artifacts.length,
            totalBytes,
            retainedCount,
            retainedBytes,
            estimatedBytesToDelete: 0,
            candidates,
        };
    }
    for (const artifact of artifacts) {
        if (!input.includePermanent && artifact.retention_policy === "permanent")
            continue;
        const reasons = [];
        if (input.maxCount !== undefined && retainedCount > input.maxCount)
            reasons.push("max_count");
        if (input.maxBytes !== undefined && retainedBytes > input.maxBytes)
            reasons.push("max_bytes");
        if (reasons.length === 0)
            continue;
        const sizeBytes = artifactSize(artifact);
        candidates.push({ artifact, reasons, sizeBytes });
        retainedCount = Math.max(0, retainedCount - 1);
        retainedBytes = Math.max(0, retainedBytes - sizeBytes);
    }
    return {
        totalCount: artifacts.length,
        totalBytes,
        retainedCount,
        retainedBytes,
        estimatedBytesToDelete: candidates.reduce((sum, candidate) => sum + candidate.sizeBytes, 0),
        candidates,
    };
}
export function cleanupArtifactStorageQuota(input) {
    const plan = planArtifactQuotaCleanup(input);
    const now = input.now ?? Date.now();
    const deleted = [];
    const failures = [];
    for (const candidate of plan.candidates) {
        const artifact = candidate.artifact;
        if (!isStateArtifactPath(artifact.artifact_path)) {
            failures.push({
                artifactId: artifact.id,
                filePath: artifact.artifact_path,
                reason: "outside_state_artifacts",
                message: "Artifact metadata points outside the managed artifact storage.",
            });
            continue;
        }
        if (input.deleteFiles !== false) {
            try {
                if (existsSync(artifact.artifact_path))
                    rmSync(artifact.artifact_path, { force: true });
            }
            catch (error) {
                failures.push({
                    artifactId: artifact.id,
                    filePath: artifact.artifact_path,
                    reason: "delete_failed",
                    message: error instanceof Error ? error.message : String(error),
                });
                continue;
            }
        }
        markArtifactDeleted(artifact.id, now);
        deleted.push(artifact);
    }
    return { plan, deleted, failures };
}
export function runArtifactCleanupCycle(input = {}) {
    const expired = cleanupExpiredArtifacts({
        ...(input.now !== undefined ? { now: input.now } : {}),
        ...(input.deleteFiles !== undefined ? { deleteFiles: input.deleteFiles } : {}),
    });
    const quota = cleanupArtifactStorageQuota({
        maxBytes: input.maxBytes ?? DEFAULT_ARTIFACT_STORAGE_QUOTA_BYTES,
        maxCount: input.maxCount ?? DEFAULT_ARTIFACT_STORAGE_QUOTA_COUNT,
        ...(input.includePermanent !== undefined ? { includePermanent: input.includePermanent } : {}),
        ...(input.now !== undefined ? { now: input.now } : {}),
        ...(input.deleteFiles !== undefined ? { deleteFiles: input.deleteFiles } : {}),
    });
    return { expired, quota };
}
export function startArtifactCleanupScheduler(input = {}) {
    if (artifactCleanupTimer)
        return;
    const intervalMs = Math.max(1_000, input.intervalMs ?? DEFAULT_ARTIFACT_CLEANUP_INTERVAL_MS);
    artifactCleanupTimer = setInterval(() => {
        try {
            runArtifactCleanupCycle(input);
        }
        catch {
            // Artifact cleanup is opportunistic and must not crash the daemon.
        }
    }, intervalMs);
    artifactCleanupTimer.unref?.();
}
export function stopArtifactCleanupScheduler() {
    if (!artifactCleanupTimer)
        return;
    clearInterval(artifactCleanupTimer);
    artifactCleanupTimer = null;
}
export function validateExternalArtifactImport(input) {
    const filePath = resolve(input.filePath);
    const mimeType = normalizeMimeType(input.mimeType ?? guessArtifactMimeType(filePath));
    const allowedRoots = input.allowedRoots.map((root) => resolve(root));
    if (!existsSync(filePath)) {
        return {
            ok: false,
            filePath,
            reason: "missing",
            userMessage: "가져올 파일을 찾을 수 없습니다.",
            mimeType,
        };
    }
    const stat = statSync(filePath);
    if (!stat.isFile()) {
        return {
            ok: false,
            filePath,
            reason: "not_file",
            userMessage: "가져올 대상이 일반 파일이 아닙니다.",
            mimeType,
        };
    }
    if (allowedRoots.length === 0 || !allowedRoots.some((root) => isPathInside(root, filePath))) {
        return {
            ok: false,
            filePath,
            reason: "outside_allowed_roots",
            userMessage: "허용된 경로 밖의 파일은 artifact로 가져올 수 없습니다.",
            mimeType,
            sizeBytes: stat.size,
        };
    }
    if (input.maxBytes !== undefined && stat.size > input.maxBytes) {
        return {
            ok: false,
            filePath,
            reason: "too_large",
            userMessage: "파일이 허용된 artifact 크기 제한을 초과했습니다.",
            mimeType,
            sizeBytes: stat.size,
        };
    }
    if (input.allowedMimeTypes && !isAllowedMimeType(mimeType, input.allowedMimeTypes)) {
        return {
            ok: false,
            filePath,
            reason: "mime_type_not_allowed",
            userMessage: "허용되지 않은 파일 형식입니다.",
            mimeType,
            sizeBytes: stat.size,
        };
    }
    return {
        ok: true,
        filePath,
        fileName: basename(filePath),
        mimeType,
        sizeBytes: stat.size,
        previewable: isPreviewableMimeType(mimeType),
    };
}
function safeFileSize(filePath) {
    try {
        const stat = statSync(filePath);
        return stat.isFile() ? stat.size : undefined;
    }
    catch {
        return undefined;
    }
}
function artifactSize(artifact) {
    return artifact.size_bytes ?? safeFileSize(artifact.artifact_path) ?? 0;
}
function normalizeMimeType(mimeType) {
    return mimeType.split(";")[0]?.trim().toLowerCase() || "application/octet-stream";
}
function isAllowedMimeType(mimeType, allowedMimeTypes) {
    const normalized = normalizeMimeType(mimeType);
    return allowedMimeTypes.some((allowed) => {
        const normalizedAllowed = normalizeMimeType(allowed);
        if (normalizedAllowed.endsWith("/*")) {
            return normalized.startsWith(normalizedAllowed.slice(0, -1));
        }
        return normalized === normalizedAllowed;
    });
}
//# sourceMappingURL=lifecycle.js.map