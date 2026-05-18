import { randomUUID } from "node:crypto";
import { getMemoryCapsule, getTaskContinuity, insertDiagnosticEvent, insertMemoryCapsule, insertMemoryCapsuleRollup, insertMemoryCapsuleSource, insertMemoryRecallEvent, listMemoryCapsuleRollups, listMemoryCapsulesForOwner, } from "../db/index.js";
import { normalizeMemoryCapsule } from "./capsule.js";
import { searchMemoryChunks } from "./search.js";
import { buildMemoryInjectionContext } from "./store.js";
export const MEMORY_CAPSULE_ROLLUP_RECENT_LIMIT = 2;
export const MEMORY_CAPSULE_ROLLUP_COUNT_THRESHOLD = 4;
export const MEMORY_CAPSULE_ROLLUP_TOKEN_THRESHOLD = 2_200;
export const MEMORY_PROMPT_TIME_RECALL_LIMIT = 3;
function normalizeString(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function normalizeStringArray(values) {
    const seen = new Set();
    const normalized = [];
    for (const value of values) {
        const next = normalizeString(value);
        if (!next || seen.has(next))
            continue;
        seen.add(next);
        normalized.push(next);
    }
    return normalized;
}
function normalizeArtifactRefs(values) {
    const seen = new Set();
    const normalized = [];
    for (const value of values) {
        const note = normalizeString(value.note);
        if (!note)
            continue;
        const next = { note };
        const artifactId = normalizeString(value.artifactId);
        const path = normalizeString(value.path);
        const receiptId = normalizeString(value.receiptId);
        if (artifactId)
            next.artifactId = artifactId;
        if (path)
            next.path = path;
        if (receiptId)
            next.receiptId = receiptId;
        const key = JSON.stringify(next);
        if (seen.has(key))
            continue;
        seen.add(key);
        normalized.push(next);
    }
    return normalized;
}
function truncateText(value, maxChars) {
    const normalized = value.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (normalized.length <= maxChars)
        return normalized;
    return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
function estimateTokens(value) {
    const normalized = value.trim();
    if (!normalized)
        return 0;
    return Math.max(1, Math.ceil(normalized.length / 4));
}
function renderMessageContent(message) {
    if (typeof message.content === "string")
        return message.content.trim();
    return message.content.map((block) => {
        if (block.type === "text")
            return block.text;
        if (block.type === "tool_use")
            return `[tool_use:${block.name}] ${safeJson(block.input)}`;
        if (block.type === "tool_result") {
            return `[tool_result:${block.tool_use_id}] ${typeof block.content === "string" ? block.content : safeJson(block.content)}`;
        }
        return safeJson(block);
    }).join("\n").trim();
}
function safeJson(value) {
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function extractLatestUserQuery(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (!message || message.role !== "user")
            continue;
        const rendered = truncateText(renderMessageContent(message), 320);
        if (rendered)
            return rendered;
    }
    return undefined;
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
function isRollupCapsule(capsule) {
    return capsule.capsuleKind === "lineage_compaction"
        && capsule.sourceRefs.some((item) => item.startsWith("capsule_rollup:"));
}
function sameOwnerScope(left, right) {
    return left.ownerType === right.ownerType
        && left.ownerId === right.ownerId
        && (left.sessionId ?? null) === (right.sessionId ?? null)
        && (left.requestGroupId ?? null) === (right.requestGroupId ?? null)
        && (left.lineageId ?? null) === (right.lineageId ?? null)
        && (left.channelKey ?? null) === (right.channelKey ?? null)
        && (left.threadKey ?? null) === (right.threadKey ?? null);
}
function renderCapsuleInline(label, capsule, maxSummaryChars) {
    const facts = capsule.confirmedFacts.slice(0, 2).join("; ") || "[]";
    const pending = capsule.pendingItems.slice(0, 3).join("; ") || "[]";
    return [
        `[${label}]`,
        `summary: ${truncateText(capsule.summary, maxSummaryChars)}`,
        `confirmed_facts: ${truncateText(facts, 180)}`,
        `pending_items: ${truncateText(pending, 180)}`,
    ].join("\n");
}
function renderRecentCapsulesSection(capsules) {
    const items = capsules
        .slice(0, MEMORY_CAPSULE_ROLLUP_RECENT_LIMIT)
        .map((capsule) => `- ${capsule.capsuleId}: ${truncateText(capsule.summary, 180)}`);
    return items.length > 0 ? `[recent_capsules]\n${items.join("\n")}` : undefined;
}
function sortCapsuleIds(values) {
    return [...values].sort((left, right) => left.localeCompare(right));
}
function arraysEqual(left, right) {
    if (left.length !== right.length)
        return false;
    return left.every((value, index) => value === right[index]);
}
function buildRollupSummary(sourceCapsules) {
    const summaries = sourceCapsules.map((capsule) => capsule.summary).filter(Boolean);
    return truncateText(summaries.join(" "), 700);
}
function flattenCapsuleValues(capsules, pick, limit) {
    return normalizeStringArray(capsules.flatMap(pick)).slice(0, limit);
}
function buildRollupCapsule(input) {
    const createdAt = input.now ?? Date.now();
    const sourceCapsules = input.sourceCapsules;
    const sourceCapsuleIds = sortCapsuleIds(sourceCapsules.map((capsule) => capsule.capsuleId));
    const latestSource = sourceCapsules[0];
    const summary = buildRollupSummary(sourceCapsules);
    const activeObjectives = flattenCapsuleValues(sourceCapsules, (capsule) => capsule.activeObjectives, 6);
    const confirmedFacts = flattenCapsuleValues(sourceCapsules, (capsule) => capsule.confirmedFacts, 6);
    const decisions = flattenCapsuleValues(sourceCapsules, (capsule) => capsule.decisions, 6);
    const constraints = flattenCapsuleValues(sourceCapsules, (capsule) => capsule.constraints, 6);
    const artifactRefs = normalizeArtifactRefs(sourceCapsules.flatMap((capsule) => capsule.artifactRefs)).slice(0, 6);
    const recoveryHints = flattenCapsuleValues(sourceCapsules, (capsule) => capsule.recoveryHints, 6);
    const compactedMessageIds = normalizeStringArray(sourceCapsules.flatMap((capsule) => capsule.compactedMessageIds)).slice(0, 300);
    const rawTokenEstimate = sourceCapsules.reduce((sum, capsule) => sum + capsule.sourceTokenEstimate, 0);
    const resultTokenEstimate = estimateTokens([
        summary,
        ...activeObjectives,
        ...confirmedFacts,
        ...decisions,
        ...constraints,
        ...artifactRefs.map((item) => item.note),
    ].join("\n"));
    return normalizeMemoryCapsule({
        capsuleId: randomUUID(),
        capsuleVersion: 1,
        ...(latestSource ? { parentCapsuleId: latestSource.capsuleId } : {}),
        ownerScope: input.ownerScope,
        ...(latestSource?.nicknameSnapshot ? { nicknameSnapshot: latestSource.nicknameSnapshot } : {}),
        capsuleKind: "lineage_compaction",
        summary,
        activeObjectives,
        confirmedFacts,
        decisions,
        constraints,
        pendingItems: [],
        artifactRefs,
        recoveryHints,
        sourceRefs: [
            `capsule_rollup:${sourceCapsuleIds.join(",")}`,
            ...sourceCapsuleIds.map((capsuleId) => `capsule:${capsuleId}`),
        ],
        compactedMessageIds,
        sourceTokenEstimate: rawTokenEstimate,
        resultTokenEstimate,
        createdAt,
    });
}
export function maybeRollupCapsuleChain(input) {
    const recentLimit = Math.max(1, Math.floor(input.recentLimit ?? MEMORY_CAPSULE_ROLLUP_RECENT_LIMIT));
    const countThreshold = Math.max(2, Math.floor(input.countThreshold ?? MEMORY_CAPSULE_ROLLUP_COUNT_THRESHOLD));
    const tokenThreshold = Math.max(1, Math.floor(input.tokenThreshold ?? MEMORY_CAPSULE_ROLLUP_TOKEN_THRESHOLD));
    const allCapsules = listMemoryCapsulesForOwner({
        ownerType: input.ownerScope.ownerType,
        ownerId: input.ownerScope.ownerId,
        ...(input.ownerScope.sessionId ? { sessionId: input.ownerScope.sessionId } : {}),
        ...(input.ownerScope.requestGroupId ? { requestGroupId: input.ownerScope.requestGroupId } : {}),
        ...(input.ownerScope.lineageId ? { lineageId: input.ownerScope.lineageId } : {}),
        ...(input.ownerScope.channelKey ? { channelKey: input.ownerScope.channelKey } : {}),
        ...(input.ownerScope.threadKey ? { threadKey: input.ownerScope.threadKey } : {}),
        limit: 64,
    });
    const nonRollupCapsules = allCapsules.filter((capsule) => !isRollupCapsule(capsule));
    const recentCapsules = nonRollupCapsules.slice(0, recentLimit);
    const olderCapsules = nonRollupCapsules.slice(recentLimit);
    const sourceCapsuleCount = olderCapsules.length;
    const sourceTokenEstimate = olderCapsules.reduce((sum, capsule) => sum + Math.max(capsule.resultTokenEstimate, 0), 0);
    if (sourceCapsuleCount < countThreshold && sourceTokenEstimate < tokenThreshold) {
        const latestRollupAudit = listMemoryCapsuleRollups({
            ownerType: input.ownerScope.ownerType,
            ownerId: input.ownerScope.ownerId,
            ...(input.ownerScope.sessionId ? { sessionId: input.ownerScope.sessionId } : {}),
            ...(input.ownerScope.requestGroupId ? { requestGroupId: input.ownerScope.requestGroupId } : {}),
            ...(input.ownerScope.lineageId ? { lineageId: input.ownerScope.lineageId } : {}),
            limit: 1,
        })[0];
        const latestRollupCapsule = latestRollupAudit
            ? getMemoryCapsule(latestRollupAudit.resultRollupCapsuleId)
            : undefined;
        return {
            performed: false,
            recentCapsules,
            ...(latestRollupCapsule ? { rollupCapsule: latestRollupCapsule } : {}),
        };
    }
    if (olderCapsules.length === 0) {
        return { performed: false, recentCapsules };
    }
    const sourceCapsuleIds = sortCapsuleIds(olderCapsules.map((capsule) => capsule.capsuleId));
    const existingRollup = listMemoryCapsuleRollups({
        ownerType: input.ownerScope.ownerType,
        ownerId: input.ownerScope.ownerId,
        ...(input.ownerScope.sessionId ? { sessionId: input.ownerScope.sessionId } : {}),
        ...(input.ownerScope.requestGroupId ? { requestGroupId: input.ownerScope.requestGroupId } : {}),
        ...(input.ownerScope.lineageId ? { lineageId: input.ownerScope.lineageId } : {}),
        limit: 10,
    }).find((entry) => arraysEqual(sortCapsuleIds(entry.sourceCapsuleIds), sourceCapsuleIds));
    if (existingRollup) {
        const rollupCapsule = getMemoryCapsule(existingRollup.resultRollupCapsuleId);
        return {
            performed: false,
            recentCapsules,
            ...(rollupCapsule ? { rollupCapsule } : {}),
        };
    }
    const rollupCapsule = buildRollupCapsule({
        ownerScope: input.ownerScope,
        sourceCapsules: olderCapsules,
        ...(input.now !== undefined ? { now: input.now } : {}),
    });
    insertMemoryCapsule(rollupCapsule, { expectedOwnerScope: input.ownerScope });
    for (const sourceCapsule of olderCapsules) {
        insertMemoryCapsuleSource({
            capsuleId: rollupCapsule.capsuleId,
            sourceKind: "manual",
            sourceId: sourceCapsule.capsuleId,
            ownerType: input.ownerScope.ownerType,
            ownerId: input.ownerScope.ownerId,
            metadata: {
                sourceKind: "capsule_rollup",
                sourceCapsuleId: sourceCapsule.capsuleId,
            },
            createdAt: rollupCapsule.createdAt,
        });
    }
    const rollupAuditId = insertMemoryCapsuleRollup({
        ownerScope: input.ownerScope,
        sourceCapsuleIds,
        sourceCapsuleCount,
        sourceTokenEstimate,
        resultRollupCapsuleId: rollupCapsule.capsuleId,
        recentCapsuleIds: recentCapsules.map((capsule) => capsule.capsuleId),
        preservedPendingItems: normalizeStringArray(nonRollupCapsules.flatMap((capsule) => capsule.pendingItems)),
        reasonCode: sourceCapsuleCount >= countThreshold
            ? "capsule_count_threshold"
            : "capsule_token_threshold",
        createdAt: rollupCapsule.createdAt,
    });
    try {
        insertDiagnosticEvent({
            kind: "memory_capsule_rollup_completed",
            summary: `memory capsule rollup completed for ${input.ownerScope.ownerId}`,
            ...(input.runId ? { runId: input.runId } : {}),
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
            detail: {
                ownerScope: input.ownerScope,
                resultRollupCapsuleId: rollupCapsule.capsuleId,
                sourceCapsuleIds,
                recentCapsuleIds: recentCapsules.map((capsule) => capsule.capsuleId),
                rollupAuditId,
            },
        });
    }
    catch {
        // Rollup diagnostics are best-effort.
    }
    return {
        performed: true,
        recentCapsules,
        rollupCapsule,
        rollupAuditId,
    };
}
export function buildMaintenanceRestoreContext(input) {
    const blockedReasonCodes = [];
    const recentLimit = Math.max(1, Math.floor(input.recentLimit ?? MEMORY_CAPSULE_ROLLUP_RECENT_LIMIT));
    const allCapsules = listMemoryCapsulesForOwner({
        ownerType: input.ownerScope.ownerType,
        ownerId: input.ownerScope.ownerId,
        ...(input.ownerScope.sessionId ? { sessionId: input.ownerScope.sessionId } : {}),
        ...(input.ownerScope.requestGroupId ? { requestGroupId: input.ownerScope.requestGroupId } : {}),
        ...(input.ownerScope.lineageId ? { lineageId: input.ownerScope.lineageId } : {}),
        ...(input.ownerScope.channelKey ? { channelKey: input.ownerScope.channelKey } : {}),
        ...(input.ownerScope.threadKey ? { threadKey: input.ownerScope.threadKey } : {}),
        limit: 32,
    });
    const nonRollupCapsules = allCapsules.filter((capsule) => !isRollupCapsule(capsule));
    const recentCapsules = nonRollupCapsules.slice(0, recentLimit);
    const latestCapsule = recentCapsules[0];
    if (latestCapsule && !sameOwnerScope(latestCapsule.ownerScope, input.ownerScope)) {
        blockedReasonCodes.push("owner_scope_mismatch");
    }
    const latestRollupAudit = listMemoryCapsuleRollups({
        ownerType: input.ownerScope.ownerType,
        ownerId: input.ownerScope.ownerId,
        ...(input.ownerScope.sessionId ? { sessionId: input.ownerScope.sessionId } : {}),
        ...(input.ownerScope.requestGroupId ? { requestGroupId: input.ownerScope.requestGroupId } : {}),
        ...(input.ownerScope.lineageId ? { lineageId: input.ownerScope.lineageId } : {}),
        limit: 1,
    })[0];
    const rollupCapsule = latestRollupAudit
        ? getMemoryCapsule(latestRollupAudit.resultRollupCapsuleId)
        : undefined;
    const continuityKey = normalizeString(input.requestGroupId)
        ?? normalizeString(input.ownerScope.lineageId)
        ?? normalizeString(input.ownerScope.requestGroupId);
    const taskContinuity = continuityKey ? getTaskContinuity(continuityKey) : undefined;
    const latestInstructionSummary = normalizeString(taskContinuity?.latestInstructionSummary)
        ?? normalizeString(taskContinuity?.handoffSummary)
        ?? normalizeString(latestCapsule?.summary);
    return {
        ownerScope: input.ownerScope,
        ...(latestCapsule ? { latestCapsule } : {}),
        recentCapsules,
        ...(rollupCapsule ? { rollupCapsule } : {}),
        ...(taskContinuity ? { taskContinuity } : {}),
        ...(latestInstructionSummary ? { latestInstructionSummary } : {}),
        blockedReasonCodes,
    };
}
export function renderMaintenanceRestorePromptBlock(context) {
    if (!context.latestCapsule && !context.rollupCapsule && !context.taskContinuity)
        return undefined;
    const lines = ["[maintenance_restore]"];
    if (context.latestInstructionSummary) {
        lines.push(`latest_instruction_summary: ${truncateText(context.latestInstructionSummary, 220)}`);
    }
    if (context.taskContinuity?.latestSuccessfulSummary) {
        lines.push(`latest_successful_summary: ${truncateText(context.taskContinuity.latestSuccessfulSummary, 220)}`);
    }
    if (context.taskContinuity?.latestTargetContext) {
        lines.push(`latest_target_context: ${truncateText(context.taskContinuity.latestTargetContext, 220)}`);
    }
    if (context.latestCapsule)
        lines.push(renderCapsuleInline("latest_compacted_capsule", context.latestCapsule, 260));
    const recentSection = renderRecentCapsulesSection(context.recentCapsules.slice(1));
    if (recentSection)
        lines.push(recentSection);
    if (context.rollupCapsule)
        lines.push(renderCapsuleInline("rollup_capsule", context.rollupCapsule, 180));
    return lines.join("\n");
}
function isSameSessionRecall(result, currentSessionId) {
    if (!currentSessionId)
        return false;
    if (!["session", "short-term", "flash-feedback"].includes(result.chunk.scope))
        return false;
    return result.chunk.owner_id === currentSessionId;
}
function matchesChannelThread(result, channelKey, threadKey) {
    const metadata = parseMetadata(result.chunk.document_metadata_json);
    const storedChannelKey = normalizeString(typeof metadata["channelKey"] === "string" ? metadata["channelKey"] : undefined);
    const storedThreadKey = normalizeString(typeof metadata["threadKey"] === "string" ? metadata["threadKey"] : undefined);
    if (channelKey && storedChannelKey && channelKey !== storedChannelKey)
        return false;
    if (threadKey && storedThreadKey && threadKey !== storedThreadKey)
        return false;
    return true;
}
export async function buildPromptTimeRecallContext(input) {
    const limit = Math.max(1, Math.floor(input.limit ?? MEMORY_PROMPT_TIME_RECALL_LIMIT));
    const query = normalizeString(input.explicitQuery) ?? extractLatestUserQuery(input.messages);
    if (!query) {
        return {
            results: [],
            blockedReasonCodes: ["missing_recall_query"],
            sameSessionResultCount: 0,
        };
    }
    const filters = {
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
        ...(input.includeArtifact ? { includeArtifact: true } : {}),
        ...(input.includeDiagnostic ? { includeDiagnostic: true } : {}),
        ...(input.includeFlashFeedback ? { includeFlashFeedback: true } : {}),
    };
    const ftsResults = await searchMemoryChunks(query, limit, "fts", filters);
    const candidateResults = ftsResults.length > 0
        ? ftsResults
        : await searchMemoryChunks(query, limit, "vector", filters);
    const blockedReasonCodes = [];
    const results = candidateResults.filter((result) => {
        const allowed = matchesChannelThread(result, input.channelKey, input.threadKey);
        if (!allowed)
            blockedReasonCodes.push("cross_channel_thread_restore_blocked");
        return allowed;
    });
    const sameSessionResultCount = results.filter((result) => isSameSessionRecall(result, input.sessionId)).length;
    const promptBlockBase = buildMemoryInjectionContext(results, { maxChunks: limit, maxChars: 1_000, maxChunkChars: 280 });
    const promptBlock = promptBlockBase
        ? [
            "[prompt_time_recall]",
            `query: ${truncateText(query, 220)}`,
            `same_session_evidence_only: ${sameSessionResultCount > 0 ? "true" : "false"}`,
            promptBlockBase,
        ].join("\n")
        : undefined;
    return {
        query,
        results,
        ...(promptBlock ? { promptBlock } : {}),
        blockedReasonCodes: normalizeStringArray(blockedReasonCodes),
        sameSessionResultCount,
    };
}
export function recordMaintenanceRestoreTrace(input) {
    const { context } = input;
    try {
        if (context.latestCapsule) {
            insertMemoryRecallEvent({
                ownerScope: context.ownerScope,
                sourceType: "maintenance_restore",
                capsuleId: context.latestCapsule.capsuleId,
                reasonCode: "latest_capsule_restore",
                canUseForFinalAnswer: true,
                sameSession: true,
                ...(input.runId ? { runId: input.runId } : {}),
                ...(input.sessionId ? { sessionId: input.sessionId } : {}),
                ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
                metadata: {
                    capsuleKind: context.latestCapsule.capsuleKind,
                },
            });
        }
        for (const capsule of context.recentCapsules.slice(1)) {
            insertMemoryRecallEvent({
                ownerScope: context.ownerScope,
                sourceType: "recent_capsule",
                capsuleId: capsule.capsuleId,
                reasonCode: "bounded_recent_capsule",
                canUseForFinalAnswer: true,
                sameSession: true,
                ...(input.runId ? { runId: input.runId } : {}),
                ...(input.sessionId ? { sessionId: input.sessionId } : {}),
                ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
                metadata: {
                    capsuleKind: capsule.capsuleKind,
                },
            });
        }
        if (context.rollupCapsule) {
            insertMemoryRecallEvent({
                ownerScope: context.ownerScope,
                sourceType: "rollup_capsule",
                capsuleId: context.rollupCapsule.capsuleId,
                reasonCode: "fallback_rollup_context",
                canUseForFinalAnswer: false,
                sameSession: true,
                ...(input.runId ? { runId: input.runId } : {}),
                ...(input.sessionId ? { sessionId: input.sessionId } : {}),
                ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
                metadata: {
                    capsuleKind: context.rollupCapsule.capsuleKind,
                },
            });
        }
    }
    catch {
        // Recall persistence is best-effort.
    }
    try {
        insertDiagnosticEvent({
            kind: "memory_capsule_restored",
            summary: `maintenance restore used ${context.recentCapsules.length} capsule references`,
            ...(input.runId ? { runId: input.runId } : {}),
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
            detail: {
                restorePath: "maintenance_restore",
                ownerScope: context.ownerScope,
                latestCapsuleId: context.latestCapsule?.capsuleId ?? null,
                recentCapsuleIds: context.recentCapsules.map((capsule) => capsule.capsuleId),
                rollupCapsuleId: context.rollupCapsule?.capsuleId ?? null,
                blockedReasonCodes: context.blockedReasonCodes,
            },
        });
    }
    catch {
        // Restore diagnostics are best-effort.
    }
}
export function recordPromptTimeRecallTrace(input) {
    try {
        for (const result of input.context.results) {
            const sameSession = isSameSessionRecall(result, input.sessionId);
            insertMemoryRecallEvent({
                ownerScope: input.ownerScope,
                sourceType: "prompt_time_recall",
                chunkId: result.chunkId,
                reasonCode: sameSession ? "prompt_time_recall_same_session" : "prompt_time_recall_discovery_only",
                canUseForFinalAnswer: sameSession,
                sameSession,
                ...(input.runId ? { runId: input.runId } : {}),
                ...(input.sessionId ? { sessionId: input.sessionId } : {}),
                ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
                metadata: {
                    query: input.context.query ?? null,
                    scope: result.chunk.scope,
                    source: result.source,
                    score: result.score,
                    documentId: result.chunk.document_id,
                },
            });
        }
    }
    catch {
        // Recall persistence is best-effort.
    }
    try {
        insertDiagnosticEvent({
            kind: "memory_capsule_restored",
            summary: `prompt-time recall used ${input.context.results.length} archive chunks`,
            ...(input.runId ? { runId: input.runId } : {}),
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
            detail: {
                restorePath: "prompt_time_recall",
                query: input.context.query ?? null,
                resultCount: input.context.results.length,
                sameSessionResultCount: input.context.sameSessionResultCount,
                blockedReasonCodes: input.context.blockedReasonCodes,
            },
        });
    }
    catch {
        // Recall diagnostics are best-effort.
    }
}
//# sourceMappingURL=retrieval-restore.js.map