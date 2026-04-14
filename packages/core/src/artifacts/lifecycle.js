import { existsSync, rmSync, statSync } from "node:fs";
import { basename, extname, relative, resolve, sep } from "node:path";
import { PATHS } from "../config/index.js";
import { insertArtifactMetadata, listExpiredArtifactMetadata, markArtifactDeleted, } from "../db/index.js";
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
    return PREVIEWABLE_MIME_TYPES.has(mimeType.split(";")[0]?.trim().toLowerCase() ?? "");
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
    return insertArtifactMetadata({
        ...input,
        artifactPath: filePath,
        mimeType,
        ...(sizeBytes !== undefined ? { sizeBytes } : {}),
        retentionPolicy,
        expiresAt: input.expiresAt === undefined ? computeArtifactExpiresAt(retentionPolicy, createdAt) : input.expiresAt,
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
function safeFileSize(filePath) {
    try {
        const stat = statSync(filePath);
        return stat.isFile() ? stat.size : undefined;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=lifecycle.js.map