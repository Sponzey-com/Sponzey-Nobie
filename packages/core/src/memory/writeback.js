import { getMemoryWritebackCandidate, insertAuditLog, listMemoryWritebackCandidates, updateMemoryWritebackCandidate, } from "../db/index.js";
import { createHash } from "node:crypto";
import { storeMemoryDocument } from "./store.js";
import { containsPromptInjectionDirective, isUntrustedTag, sourceToTrustTag } from "../security/trust-boundary.js";
const EXPLICIT_MEMORY_PATTERNS = [
    /(?:기억해|기억\s*해|기억해줘|기억\s*해줘|메모해|메모\s*해|저장해|저장\s*해|잊지\s*마)/u,
    /\b(?:remember|memorize|keep in mind|save this|note that|don't forget)\b/i,
];
const FLASH_FEEDBACK_PATTERNS = [
    /(?:하지\s*마|하지마|그러면\s*안|이렇게\s*하지|앞으로|반드시|항상|아니야|틀렸|잘못|왜\s*.*했|그게\s*아니)/u,
    /\b(?:do not|don't|never|always|wrong|incorrect|not that|stop doing|from now on)\b/i,
];
const EPHEMERAL_TOOL_NAMES = new Set([
    "screen_capture",
    "screen_find_text",
    "mouse_move",
    "mouse_click",
    "mouse_action",
    "keyboard_type",
    "keyboard_shortcut",
    "keyboard_action",
    "clipboard_read",
    "window_list",
    "window_focus",
    "yeonjang_camera_list",
    "yeonjang_camera_capture",
    "telegram_send_file",
]);
function normalizedContent(value) {
    return value.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
function buildReviewDedupeKey(params) {
    return createHash("sha256")
        .update([params.scope, params.sourceType, normalizedContent(params.content)].join("\n"))
        .digest("hex");
}
function parseMetadata(value) {
    if (!value)
        return {};
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : {};
    }
    catch {
        return {};
    }
}
function readStringMetadata(metadata, key) {
    const value = metadata[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
function readStringArrayMetadata(metadata, key) {
    const value = metadata[key];
    return Array.isArray(value)
        ? value.filter((item) => typeof item === "string" && item.trim().length > 0)
        : [];
}
function readTrustTagMetadata(metadata) {
    const value = metadata?.["sourceTrust"];
    return typeof value === "string" && [
        "trusted",
        "user_input",
        "channel_input",
        "web_content",
        "file_content",
        "tool_result",
        "mcp_result",
        "yeonjang_result",
        "diagnostic",
    ].includes(value)
        ? value
        : undefined;
}
function resolveWritebackSourceTrust(params) {
    if (params.kind === "tool_result")
        return "tool_result";
    if (params.kind === "failure")
        return "diagnostic";
    if (params.source === "webui" || params.source === "cli" || params.source === "telegram" || params.source === "slack") {
        return sourceToTrustTag(params.source);
    }
    return "trusted";
}
function maskSecrets(value) {
    let masked = false;
    const content = value
        .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, () => {
        masked = true;
        return "[redacted-api-key]";
    })
        .replace(/\b(?:api[_-]?key|token|secret|authorization)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}["']?/giu, (match) => {
        masked = true;
        const key = match.split(/[:=]/u)[0]?.trim() || "secret";
        return `${key}: [redacted]`;
    });
    return { content, masked };
}
function maskLocalPaths(value) {
    let masked = false;
    const content = value
        .replace(/\/Users\/[^/\s)]+\/[^\s)]+/g, () => {
        masked = true;
        return "/Users/<user>/...";
    })
        .replace(/\b[A-Z]:\\Users\\[^\\\s)]+\\[^\s)]+/g, () => {
        masked = true;
        return "C:\\Users\\<user>\\...";
    });
    return { content, masked };
}
function looksLikeRawHtmlError(value) {
    return /<!doctype\s+html|<html[\s>]|<body[\s>]|<head[\s>]/iu.test(value);
}
function looksLikeStackTrace(value) {
    return /(?:^|\n)\s*at\s+[^\n]+\([^\n]+:\d+:\d+\)|(?:^|\n)Traceback \(most recent call last\):|(?:^|\n)\s*File "[^"]+", line \d+/u.test(value);
}
function isDiagnosticSource(sourceType) {
    return /(?:diagnostic|failure|error|exception|stack|trace)/iu.test(sourceType);
}
export function inspectMemoryWritebackSafety(input) {
    const blockReasons = [];
    let masked = false;
    let content = normalizedContent(input.content);
    const secretMasked = maskSecrets(content);
    content = secretMasked.content;
    masked = masked || secretMasked.masked;
    const pathMasked = maskLocalPaths(content);
    content = pathMasked.content;
    masked = masked || pathMasked.masked;
    if (looksLikeRawHtmlError(content))
        blockReasons.push("raw_html_error");
    if (looksLikeStackTrace(content))
        blockReasons.push("stack_trace");
    if (input.scope === "long-term" && isDiagnosticSource(input.sourceType))
        blockReasons.push("diagnostic_source");
    return {
        content,
        blockReasons,
        masked,
        blocked: blockReasons.length > 0,
    };
}
export function prepareMemoryWritebackQueueInput(candidate) {
    const safety = inspectMemoryWritebackSafety(candidate);
    const sourceTrust = readTrustTagMetadata(candidate.metadata);
    const untrustedInjectionBlocked = sourceTrust !== undefined && isUntrustedTag(sourceTrust) && containsPromptInjectionDirective(safety.content);
    const reviewDedupeKey = buildReviewDedupeKey({
        scope: candidate.scope,
        sourceType: candidate.sourceType,
        content: safety.content,
    });
    const previouslyDiscarded = listMemoryWritebackCandidates({ status: "discarded", limit: 500 }).some((row) => {
        const metadata = parseMetadata(row.metadata_json);
        return metadata["reviewDedupeKey"] === reviewDedupeKey
            || (row.scope === candidate.scope && row.source_type === candidate.sourceType && normalizedContent(row.content) === normalizedContent(safety.content));
    });
    const blockReasons = [
        ...safety.blockReasons,
        ...(untrustedInjectionBlocked ? ["untrusted_prompt_injection"] : []),
        ...(previouslyDiscarded ? ["previously_discarded"] : []),
    ];
    const metadata = {
        ...(candidate.metadata ?? {}),
        reviewDedupeKey,
        ...(safety.masked ? { safetyMasked: true } : {}),
        ...(blockReasons.length ? { safetyBlockReasons: blockReasons, reviewBlocked: true } : {}),
        ...(previouslyDiscarded ? { reviewDedupeBlocked: true } : {}),
    };
    return {
        ...candidate,
        content: safety.content,
        metadata,
        ...(blockReasons.length ? { status: "discarded", lastError: `blocked: ${blockReasons.join(", ")}` } : {}),
    };
}
export function isExplicitMemoryRequest(content) {
    const normalized = normalizedContent(content);
    return normalized.length > 0 && EXPLICIT_MEMORY_PATTERNS.some((pattern) => pattern.test(normalized));
}
export function isFlashFeedback(content) {
    const normalized = normalizedContent(content);
    return normalized.length > 0 && FLASH_FEEDBACK_PATTERNS.some((pattern) => pattern.test(normalized));
}
export function stripExplicitMemoryDirective(content) {
    return normalizedContent(content)
        .replace(/^(?:이걸|이거|이 내용|내용을|다음을)?\s*(?:기억해줘|기억\s*해줘|기억해|기억\s*해|메모해|메모\s*해|저장해|저장\s*해)[:：,\s-]*/u, "")
        .replace(/^(?:remember|memorize|keep in mind|save this|note that)[:：,\s-]*/iu, "")
        .trim();
}
export function isEphemeralToolOutput(params) {
    const toolName = params.toolName?.trim();
    if (toolName && EPHEMERAL_TOOL_NAMES.has(toolName))
        return true;
    const content = normalizedContent(params.content);
    return /(?:스크린샷|화면\s*캡처|screen\s*capture|캡처\s*완료|로컬\s*저장:|파일\s*전달\s*완료)/iu.test(content);
}
export function shouldPromoteFlashFeedback(params) {
    const repeatCount = Math.max(0, params.repeatCount ?? 0);
    if (repeatCount >= 2)
        return true;
    const content = normalizedContent(params.content);
    return /(?:항상|앞으로\s*항상|반드시|always|from now on|never)/iu.test(content) && isFlashFeedback(content);
}
export function buildRunWritebackCandidates(params) {
    const content = normalizedContent(params.content);
    if (!content)
        return [];
    const sourceTrust = resolveWritebackSourceTrust(params);
    const commonMetadata = {
        ...(params.metadata ?? {}),
        sourceTrust,
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
        ...(params.requestGroupId ? { requestGroupId: params.requestGroupId } : {}),
        ...(params.runId ? { runId: params.runId } : {}),
        ...(params.source ? { source: params.source } : {}),
        ...(params.toolName ? { toolName: params.toolName } : {}),
    };
    if (params.kind === "instruction") {
        const candidates = [];
        if (params.requestGroupId) {
            candidates.push({
                scope: "task",
                ownerId: params.requestGroupId,
                sourceType: "instruction",
                content,
                metadata: {
                    ...commonMetadata,
                    durableFact: false,
                },
            });
        }
        if (isExplicitMemoryRequest(content)) {
            candidates.push({
                scope: "long-term",
                ownerId: "global",
                sourceType: "durable_fact_candidate",
                content: stripExplicitMemoryDirective(content) || content,
                metadata: {
                    ...commonMetadata,
                    durableFact: true,
                    explicitMemoryRequest: true,
                    confidence: "high",
                    requiresReview: true,
                    approved: false,
                },
            });
        }
        if (isFlashFeedback(content) && params.sessionId) {
            candidates.push({
                scope: "flash-feedback",
                ownerId: params.sessionId,
                sourceType: "flash_feedback",
                content,
                metadata: {
                    ...commonMetadata,
                    ttl: "short",
                    durableFact: false,
                },
            });
        }
        return candidates;
    }
    if (params.kind === "success") {
        if (!params.sessionId || isEphemeralToolOutput(params))
            return [];
        return [{
                scope: "session",
                ownerId: params.sessionId,
                sourceType: "success",
                content,
                metadata: {
                    ...commonMetadata,
                    durableFact: false,
                },
            }];
    }
    if (params.kind === "failure") {
        return [{
                scope: "diagnostic",
                ownerId: params.requestGroupId ?? params.runId ?? params.sessionId ?? "diagnostic",
                sourceType: String(params.metadata?.["title"] ?? "failure"),
                content,
                metadata: {
                    ...commonMetadata,
                    durableFact: false,
                },
            }];
    }
    if (params.kind === "tool_result") {
        if (isEphemeralToolOutput(params))
            return [];
        return params.requestGroupId
            ? [{
                    scope: "task",
                    ownerId: params.requestGroupId,
                    sourceType: "tool_result",
                    content,
                    metadata: commonMetadata,
                }]
            : [];
    }
    if (params.kind === "flash_feedback") {
        const candidates = [];
        if (params.sessionId) {
            candidates.push({
                scope: "flash-feedback",
                ownerId: params.sessionId,
                sourceType: "flash_feedback",
                content,
                metadata: {
                    ...commonMetadata,
                    ttl: "short",
                    durableFact: false,
                },
            });
        }
        if (shouldPromoteFlashFeedback({
            content,
            ...(params.repeatCount !== undefined ? { repeatCount: params.repeatCount } : {}),
        })) {
            candidates.push({
                scope: "long-term",
                ownerId: "global",
                sourceType: "flash_feedback_promotion_candidate",
                content,
                metadata: {
                    ...commonMetadata,
                    durableFact: false,
                    requiresReview: true,
                    approved: false,
                    repeatCount: params.repeatCount ?? 0,
                    repeatExamples: [content],
                },
            });
        }
        return candidates;
    }
    return [];
}
function toReviewItem(row) {
    const metadata = parseMetadata(row.metadata_json);
    const safetyReasons = readStringArrayMetadata(metadata, "safetyBlockReasons");
    const safety = safetyReasons.length
        ? { content: row.content, blockReasons: safetyReasons, masked: metadata["safetyMasked"] === true, blocked: true }
        : inspectMemoryWritebackSafety({ scope: row.scope, sourceType: row.source_type, content: row.content });
    const repeatExamples = readStringArrayMetadata(metadata, "repeatExamples");
    const sourceChannel = readStringMetadata(metadata, "source");
    const sessionId = readStringMetadata(metadata, "sessionId");
    const requestGroupId = readStringMetadata(metadata, "requestGroupId");
    const confidence = readStringMetadata(metadata, "confidence");
    const ttl = readStringMetadata(metadata, "ttl");
    const sourceRunId = row.run_id ?? readStringMetadata(metadata, "runId");
    return {
        id: row.id,
        scope: row.scope,
        ownerId: row.owner_id,
        sourceType: row.source_type,
        ...(sourceRunId ? { sourceRunId } : {}),
        ...(sourceChannel ? { sourceChannel } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(requestGroupId ? { requestGroupId } : {}),
        ...(confidence ? { confidence } : {}),
        ...(ttl ? { ttl } : {}),
        proposedText: safety.content,
        repeatExamples,
        blockReasons: safety.blockReasons,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
export function listMemoryWritebackReviewItems(input = {}) {
    return listMemoryWritebackCandidates(input).map(toReviewItem);
}
function resolveSessionOwner(row, metadata) {
    if (["session", "short-term", "flash-feedback"].includes(row.scope))
        return row.owner_id;
    return readStringMetadata(metadata, "sessionId");
}
function mergeReviewMetadata(params) {
    const reviewDedupeKey = typeof params.metadata["reviewDedupeKey"] === "string"
        ? params.metadata["reviewDedupeKey"]
        : buildReviewDedupeKey({ scope: params.row.scope, sourceType: params.row.source_type, content: params.safety.content });
    return {
        ...params.metadata,
        reviewDedupeKey,
        reviewAction: params.action,
        reviewedAt: Date.now(),
        ...(params.reviewerId ? { reviewerId: params.reviewerId } : {}),
        ...(params.documentId ? { approvedDocumentId: params.documentId } : {}),
        ...(params.edited ? { edited: true } : {}),
        ...(params.safety.masked ? { safetyMasked: true } : {}),
        ...(params.safety.blockReasons.length ? { safetyBlockReasons: params.safety.blockReasons, reviewBlocked: true } : {}),
        sourceQueueId: params.row.id,
        sourceRunId: params.row.run_id,
    };
}
function recordMemoryWritebackReviewAudit(params) {
    const metadata = parseMetadata(params.row.metadata_json);
    try {
        insertAuditLog({
            timestamp: Date.now(),
            session_id: readStringMetadata(metadata, "sessionId") ?? null,
            source: "memory_review",
            tool_name: "memory_writeback_review",
            params: JSON.stringify({
                candidateId: params.row.id,
                action: params.action,
                scope: params.row.scope,
                sourceType: params.row.source_type,
                reviewerId: params.reviewerId ?? null,
            }),
            output: JSON.stringify({
                result: params.result,
                documentId: params.documentId ?? null,
                reason: params.reason ?? null,
            }),
            result: params.result,
            duration_ms: 0,
            approval_required: 0,
            approved_by: params.reviewerId ?? "memory_review",
        });
    }
    catch {
        // Review actions must not fail because audit logging failed.
    }
}
export async function reviewMemoryWritebackCandidate(params) {
    const row = getMemoryWritebackCandidate(params.id);
    if (!row)
        throw new Error("memory writeback candidate not found");
    const metadata = parseMetadata(row.metadata_json);
    const editedContent = normalizedContent(params.editedContent ?? "");
    if (params.action === "approve_edited" && !editedContent) {
        throw new Error("edited content is required for approve_edited");
    }
    const proposedText = editedContent || row.content;
    const safety = inspectMemoryWritebackSafety({ scope: row.scope, sourceType: row.source_type, content: proposedText });
    const shouldBlockLongTerm = safety.blocked || row.scope === "diagnostic" || isDiagnosticSource(row.source_type);
    if (params.action === "discard") {
        const updated = updateMemoryWritebackCandidate({
            id: row.id,
            status: "discarded",
            content: safety.content,
            metadata: mergeReviewMetadata({ row, action: params.action, metadata, safety, reviewerId: params.reviewerId, edited: Boolean(editedContent) }),
            lastError: null,
        }) ?? row;
        recordMemoryWritebackReviewAudit({ row: updated, action: params.action, result: "success", reviewerId: params.reviewerId });
        return { ok: true, candidate: toReviewItem(updated), action: params.action };
    }
    if ((params.action === "approve_long_term" || params.action === "approve_edited") && shouldBlockLongTerm) {
        const reason = safety.blockReasons.length
            ? `blocked: ${safety.blockReasons.join(", ")}`
            : "diagnostic candidates cannot be promoted to long-term memory";
        const updated = updateMemoryWritebackCandidate({
            id: row.id,
            status: "discarded",
            content: safety.content,
            metadata: mergeReviewMetadata({ row, action: params.action, metadata, safety, reviewerId: params.reviewerId, edited: Boolean(editedContent) }),
            lastError: reason,
        }) ?? row;
        recordMemoryWritebackReviewAudit({ row: updated, action: params.action, result: "blocked", reviewerId: params.reviewerId, reason });
        return { ok: false, candidate: toReviewItem(updated), action: params.action, reason };
    }
    const targetScope = params.action === "keep_session" ? "session" : "long-term";
    const ownerId = targetScope === "session" ? resolveSessionOwner(row, metadata) : "global";
    if (!ownerId)
        throw new Error("session owner is required for session-only memory");
    const result = await storeMemoryDocument({
        rawText: safety.content,
        scope: targetScope,
        ownerId,
        sourceType: params.action === "keep_session" ? "session_review_memory" : "reviewed_long_term_memory",
        sourceRef: row.id,
        title: params.action === "keep_session" ? "session memory" : "approved long-term memory",
        metadata: {
            ...metadata,
            approved: params.action !== "keep_session",
            reviewApproved: params.action !== "keep_session",
            requiresReview: false,
            durableFact: params.action !== "keep_session",
            sourceQueueId: row.id,
            sourceRunId: row.run_id,
            sourceType: row.source_type,
            reviewAction: params.action,
            reviewedAt: Date.now(),
            ...(params.reviewerId ? { reviewerId: params.reviewerId } : {}),
            ...(editedContent ? { edited: true } : {}),
            ...(safety.masked ? { safetyMasked: true } : {}),
        },
    });
    const updated = updateMemoryWritebackCandidate({
        id: row.id,
        status: "completed",
        content: safety.content,
        metadata: mergeReviewMetadata({
            row,
            action: params.action,
            metadata,
            safety,
            reviewerId: params.reviewerId,
            documentId: result.documentId,
            edited: Boolean(editedContent),
        }),
        lastError: null,
    }) ?? row;
    recordMemoryWritebackReviewAudit({ row: updated, action: params.action, result: "success", reviewerId: params.reviewerId, documentId: result.documentId });
    return {
        ok: true,
        candidate: toReviewItem(updated),
        documentId: result.documentId,
        action: params.action,
    };
}
//# sourceMappingURL=writeback.js.map