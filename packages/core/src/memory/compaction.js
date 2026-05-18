import { randomUUID } from "node:crypto";
import { enqueueMemoryWritebackCandidate, getSession, insertMemoryCapsule, insertMemoryCapsuleSource, insertMemoryCompactionRun, listMemoryCapsulesForOwner, projectMemoryCapsuleToCompatibilityStores, upsertAgentMemoryState, upsertSessionSnapshot, } from "../db/index.js";
import { ROOT_MAIN_AGENT_ID, buildAgentMemoryStateFromCapsule, buildMainAgentMemoryStateScope, } from "./agent-state.js";
import { maybeRollupCapsuleChain, } from "./retrieval-restore.js";
import { storeMemoryDocument } from "./store.js";
import { buildDefaultMemoryCompactionAudit, resolveMemoryCompactionPolicy, } from "./model-policy.js";
import { applyMemoryCapsuleDeterministicState, } from "./capsule.js";
export const SESSION_COMPACTION_TOKEN_THRESHOLD = 120_000;
export const SESSION_COMPACTION_MESSAGE_THRESHOLD = 40;
export const ROOT_SESSION_COMPACTION_DEFAULT_TAIL_SIZE = 8;
const DEFAULT_SNAPSHOT_SUMMARY_CHARS = 1_200;
const ROOT_SESSION_SUMMARY_PROMPT = [
    "Return JSON only.",
    "Schema:",
    '{"what_happened":"","current_goal":[],"still_open":[],"confirmed_facts":[],"must_keep_constraints":[],"artifacts_and_receipts":[],"tool_side_effect_boundary":[],"retry_do_not_repeat":[],"handoff_ready_context":[]}',
    "Keep arrays concise and concrete.",
].join("\n");
const ROOT_SESSION_SUMMARY_MAX_TRANSCRIPT_CHARS = 10_000;
const ROOT_SESSION_SUMMARY_MAX_MESSAGE_CHARS = 480;
function normalizeWhitespace(value) {
    return value.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
function normalizeString(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = normalizeWhitespace(value);
    return trimmed.length > 0 ? trimmed : undefined;
}
function normalizeStringArray(values = []) {
    const seen = new Set();
    const normalized = [];
    for (const value of values) {
        const trimmed = normalizeString(value);
        if (!trimmed || seen.has(trimmed))
            continue;
        seen.add(trimmed);
        normalized.push(trimmed);
    }
    return normalized;
}
function normalizeArtifactRefs(values) {
    const normalized = [];
    const seen = new Set();
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
export function estimateContextTokens(value) {
    if (typeof value === "string")
        return Math.max(1, Math.ceil(value.length / 4));
    const text = value.map((message) => renderMessageForTranscript(message)).join("\n");
    return estimateContextTokens(text);
}
export function needsSessionCompaction(messages, totalTokens) {
    return totalTokens > SESSION_COMPACTION_TOKEN_THRESHOLD
        || messages.length > SESSION_COMPACTION_MESSAGE_THRESHOLD;
}
export function truncateSnapshotSummary(summary, maxChars = DEFAULT_SNAPSHOT_SUMMARY_CHARS) {
    const normalized = normalizeWhitespace(summary);
    if (normalized.length <= maxChars)
        return normalized;
    return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}
export function buildSessionCompactionSnapshot(input) {
    const pendingApprovals = input.pendingApprovals?.filter((item) => item.trim()) ?? [];
    const pendingDelivery = input.pendingDelivery?.filter((item) => item.trim()) ?? [];
    const activeTaskIds = new Set();
    if (input.requestGroupId?.trim())
        activeTaskIds.add(input.requestGroupId.trim());
    for (const taskId of input.activeTaskIds ?? []) {
        const trimmed = taskId.trim();
        if (trimmed)
            activeTaskIds.add(trimmed);
    }
    return {
        sessionId: input.sessionId,
        summary: truncateSnapshotSummary(input.summary),
        preservedFacts: [
            ...pendingApprovals.map((item) => `pending_approval:${item}`),
            ...pendingDelivery.map((item) => `pending_delivery:${item}`),
        ],
        activeTaskIds: [...activeTaskIds],
    };
}
export function runSilentMemoryFlushBeforeCompaction(input) {
    const durableFacts = input.durableFacts?.map((item) => item.trim()).filter(Boolean) ?? [];
    const pendingApprovals = input.pendingApprovals?.map((item) => item.trim()).filter(Boolean) ?? [];
    const pendingDelivery = input.pendingDelivery?.map((item) => item.trim()).filter(Boolean) ?? [];
    const lines = [
        input.requestGroupId ? `request_group:${input.requestGroupId}` : "",
        ...durableFacts.map((item) => `fact:${item}`),
        ...pendingApprovals.map((item) => `pending_approval:${item}`),
        ...pendingDelivery.map((item) => `pending_delivery:${item}`),
    ].filter(Boolean);
    if (lines.length === 0)
        return undefined;
    return enqueueMemoryWritebackCandidate({
        scope: "session",
        ownerId: input.sessionId,
        sourceType: "compaction_silent_flush",
        content: lines.join("\n"),
        ...(input.runId ? { runId: input.runId } : {}),
        metadata: {
            sessionId: input.sessionId,
            ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
            pendingApprovalCount: pendingApprovals.length,
            pendingDeliveryCount: pendingDelivery.length,
            durableFactCount: durableFacts.length,
            silent: true,
        },
    });
}
export function persistSessionCompactionMaintenance(input) {
    const flushCandidateId = runSilentMemoryFlushBeforeCompaction(input);
    const snapshot = buildSessionCompactionSnapshot(input);
    const snapshotId = upsertSessionSnapshot({
        sessionId: snapshot.sessionId,
        summary: snapshot.summary,
        preservedFacts: snapshot.preservedFacts,
        activeTaskIds: snapshot.activeTaskIds,
    });
    return {
        snapshotId,
        snapshot,
        ...(flushCandidateId ? { flushCandidateId } : {}),
    };
}
export function hasBalancedToolUsePairs(messages) {
    const pendingToolUseIds = [];
    for (const message of messages) {
        if (!Array.isArray(message.content))
            continue;
        for (const block of message.content) {
            if (block.type === "tool_use")
                pendingToolUseIds.push(block.id);
            if (block.type === "tool_result") {
                const index = pendingToolUseIds.indexOf(block.tool_use_id);
                if (index >= 0)
                    pendingToolUseIds.splice(index, 1);
            }
        }
    }
    return pendingToolUseIds.length === 0;
}
export function buildRootSessionCompactionReasonCodes(input) {
    const reasonCodes = new Set();
    if (input.totalTokens > SESSION_COMPACTION_TOKEN_THRESHOLD)
        reasonCodes.add("token_threshold_exceeded");
    if (input.messages.length > SESSION_COMPACTION_MESSAGE_THRESHOLD)
        reasonCodes.add("message_threshold_exceeded");
    if ((input.pruningDecisionCount ?? 0) > 0)
        reasonCodes.add("large_tool_payload_pruned");
    if ((input.deterministicState?.activeTaskIds.length ?? 0) > 0)
        reasonCodes.add("root_continuity_refresh_needed");
    if ((input.deterministicState?.finalDeliveryBlockReasons.length ?? 0) > 0) {
        reasonCodes.add("blocked_by_pending_finalization");
    }
    if (!hasBalancedToolUsePairs(input.messages))
        reasonCodes.add("blocked_by_unmatched_tool_pair");
    if ((input.deterministicState?.recoveryStates.length ?? 0) > 0) {
        reasonCodes.add("blocked_by_cancellation_or_recovery");
    }
    return [...reasonCodes];
}
export function extractRootSessionDeterministicState(input) {
    const activeTaskIds = new Set();
    const activeObjectives = [];
    const pendingApprovals = [];
    const pendingDelivery = [];
    const explicitTargetSelectors = [];
    const latestArtifactReceipts = [];
    const unresolvedResultReviewItems = [];
    const explicitUserCorrections = [];
    const retryDoNotRepeatBoundary = [];
    const finalDeliveryBlockReasons = [];
    const confirmedFacts = [];
    const mustKeepConstraints = [];
    const decisions = [];
    const recoveryStates = [];
    if (input.requestGroupId?.trim())
        activeTaskIds.add(input.requestGroupId.trim());
    for (const line of extractStructuredMemoryLines(input.messages)) {
        const separatorIndex = line.indexOf(":");
        if (separatorIndex <= 0)
            continue;
        const key = line.slice(0, separatorIndex).trim();
        const rawValue = line.slice(separatorIndex + 1).trim();
        if (!rawValue)
            continue;
        switch (key) {
            case "active_task":
                activeTaskIds.add(rawValue);
                break;
            case "objective":
                activeObjectives.push(rawValue);
                break;
            case "pending_approval":
                pendingApprovals.push(rawValue);
                break;
            case "pending_delivery":
                pendingDelivery.push(rawValue);
                break;
            case "target_selector":
                explicitTargetSelectors.push(rawValue);
                break;
            case "artifact_receipt":
                latestArtifactReceipts.push(rawValue);
                break;
            case "result_review":
                unresolvedResultReviewItems.push(rawValue);
                break;
            case "user_correction":
                explicitUserCorrections.push(rawValue);
                break;
            case "retry_boundary":
                retryDoNotRepeatBoundary.push(rawValue);
                break;
            case "final_delivery_block":
                finalDeliveryBlockReasons.push(rawValue);
                break;
            case "confirmed_fact":
                confirmedFacts.push(rawValue);
                break;
            case "constraint":
                mustKeepConstraints.push(rawValue);
                break;
            case "decision":
                decisions.push(rawValue);
                break;
            case "recovery_state":
                recoveryStates.push(rawValue);
                break;
            default:
                break;
        }
    }
    return {
        activeTaskIds: normalizeStringArray([...activeTaskIds]),
        activeObjectives: normalizeStringArray(activeObjectives),
        pendingApprovals: normalizeStringArray(pendingApprovals),
        pendingDelivery: normalizeStringArray(pendingDelivery),
        explicitTargetSelectors: normalizeStringArray(explicitTargetSelectors),
        latestArtifactReceipts: normalizeStringArray(latestArtifactReceipts),
        unresolvedResultReviewItems: normalizeStringArray(unresolvedResultReviewItems),
        explicitUserCorrections: normalizeStringArray(explicitUserCorrections),
        retryDoNotRepeatBoundary: normalizeStringArray(retryDoNotRepeatBoundary),
        finalDeliveryBlockReasons: normalizeStringArray(finalDeliveryBlockReasons),
        confirmedFacts: normalizeStringArray(confirmedFacts),
        mustKeepConstraints: normalizeStringArray(mustKeepConstraints),
        decisions: normalizeStringArray(decisions),
        recoveryStates: normalizeStringArray(recoveryStates),
    };
}
export function buildRootSessionPinnedWorkingSet(input) {
    const deterministicState = input.deterministicState;
    const pendingItems = normalizeStringArray([
        ...deterministicState.pendingApprovals.map((item) => `pending_approval:${item}`),
        ...deterministicState.pendingDelivery.map((item) => `pending_delivery:${item}`),
        ...deterministicState.unresolvedResultReviewItems.map((item) => `result_review:${item}`),
    ]);
    const constraints = normalizeStringArray([
        ...deterministicState.mustKeepConstraints,
        ...deterministicState.explicitTargetSelectors.map((item) => `target_selector:${item}`),
        ...deterministicState.explicitUserCorrections.map((item) => `user_correction:${item}`),
        ...deterministicState.finalDeliveryBlockReasons.map((item) => `final_delivery_block:${item}`),
    ]);
    const decisions = normalizeStringArray([
        ...deterministicState.decisions,
        ...deterministicState.retryDoNotRepeatBoundary.map((item) => `retry_boundary:${item}`),
    ]);
    const activeObjectives = normalizeStringArray([
        ...deterministicState.activeObjectives,
        ...deterministicState.activeTaskIds.map((item) => `active_task:${item}`),
    ]);
    const artifactRefs = normalizeArtifactRefs(deterministicState.latestArtifactReceipts.map((item) => ({ note: item })));
    const blockedReasonCodes = [];
    if (deterministicState.finalDeliveryBlockReasons.length > 0) {
        blockedReasonCodes.push("blocked_by_pending_finalization");
    }
    if (deterministicState.recoveryStates.length > 0) {
        blockedReasonCodes.push("blocked_by_cancellation_or_recovery");
    }
    return {
        activeObjectives,
        confirmedFacts: deterministicState.confirmedFacts,
        constraints,
        decisions,
        pendingItems,
        artifactRefs,
        blockedReasonCodes,
    };
}
export async function executeRootSessionCompaction(input) {
    const deterministicState = extractRootSessionDeterministicState({
        messages: input.messages,
        ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
    });
    const workingSet = buildRootSessionPinnedWorkingSet({ deterministicState });
    if (workingSet.blockedReasonCodes.length > 0) {
        throw new Error(`root session compaction blocked: ${workingSet.blockedReasonCodes.join(",")}`);
    }
    if (!hasBalancedToolUsePairs(input.messages)) {
        throw new Error("root session compaction blocked: blocked_by_unmatched_tool_pair");
    }
    const sourceRefs = input.messages.map((_, index) => `active_window_message:${index}`);
    const modelSummary = await buildRootSessionStructuredSummary({
        provider: input.provider,
        model: input.model,
        messages: input.messages,
    });
    const capsule = persistRootSessionCompactionCapsule({
        sessionId: input.sessionId,
        sourceRefs,
        sourceTokenEstimate: input.sourceTokenEstimate,
        sourceMessageCount: input.messages.length,
        modelProvider: input.provider.id,
        modelId: input.model,
        triggerReasonCodes: input.triggerReasonCodes,
        structuredSummary: modelSummary.summary,
        pinnedWorkingSet: workingSet,
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
    });
    const archiveDocumentId = await archiveCompactedSessionMessages({
        sessionId: input.sessionId,
        ownerScope: capsule.ownerScope,
        capsuleId: capsule.capsuleId,
        messages: input.messages,
    });
    const rollup = maybeRollupCapsuleChain({
        ownerScope: capsule.ownerScope,
        ...(input.runId ? { runId: input.runId } : {}),
        sessionId: input.sessionId,
        ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
    });
    const rewrite = rewriteRootSessionActiveWindow({
        messages: input.messages,
        capsule,
        pinnedWorkingSet: workingSet,
    });
    return {
        capsuleId: capsule.capsuleId,
        compactionRunId: insertMemoryCompactionRun({
            capsuleId: capsule.capsuleId,
            ownerScope: capsule.ownerScope,
            triggerReasonCodes: input.triggerReasonCodes,
            sourceTokenEstimate: input.sourceTokenEstimate,
            resultTokenEstimate: rewrite.resultTokenEstimate,
            status: "completed",
            modelProvider: input.provider.id,
            modelId: modelSummary.audit.selectedModelId ?? input.model,
            validationSummary: modelSummary.audit.heuristicFallbackApplied
                ? "deterministic_state_precedence_applied:heuristic_summary_fallback"
                : "deterministic_state_precedence_applied",
            metadata: {
                sourceMessageCount: input.messages.length,
                tailMessageCount: rewrite.tailMessageCount,
                degradedTailMessageCount: rewrite.degradedTailMessageCount ?? null,
                archiveDocumentId: archiveDocumentId ?? null,
                rollupCapsuleId: rollup.rollupCapsule?.capsuleId ?? null,
                compactionModelAudit: modelSummary.audit,
            },
        }),
        capsule,
        rewrittenMessages: rewrite.messages,
        triggerReasonCodes: input.triggerReasonCodes,
        tailMessageCount: rewrite.tailMessageCount,
        ...(rewrite.degradedTailMessageCount !== undefined
            ? { degradedTailMessageCount: rewrite.degradedTailMessageCount }
            : {}),
        sourceMessageCount: input.messages.length,
        ...(archiveDocumentId ? { archiveDocumentId } : {}),
        ...(rollup.rollupCapsule ? { rollupCapsuleId: rollup.rollupCapsule.capsuleId } : {}),
    };
}
export function rewriteRootSessionActiveWindow(input) {
    const preferredTailSize = Math.max(0, Math.floor(input.preferredTailSize ?? ROOT_SESSION_COMPACTION_DEFAULT_TAIL_SIZE));
    const tailSize = Math.min(preferredTailSize, input.messages.length);
    const tail = tailSize > 0 ? input.messages.slice(-tailSize) : [];
    const rewrittenMessages = [
        { role: "user", content: renderPinnedWorkingSetPromptBlock(input.pinnedWorkingSet) },
        {
            role: "user",
            content: input.maintenanceRestoreBlock ?? renderCompactedCapsulePromptBlock(input.capsule),
        },
        ...(input.promptTimeRecallBlock
            ? [{ role: "user", content: input.promptTimeRecallBlock }]
            : []),
        ...tail,
    ];
    return {
        messages: rewrittenMessages,
        tailMessageCount: tail.length,
        ...(preferredTailSize < ROOT_SESSION_COMPACTION_DEFAULT_TAIL_SIZE
            ? { degradedTailMessageCount: tail.length }
            : {}),
        resultTokenEstimate: estimateContextTokens(rewrittenMessages),
    };
}
export function rewriteRootSessionRetrievalOnlyWindow(input) {
    const snippets = input.retrievalSnippets ?? buildRetrievalSnippets({
        messages: input.messages,
        ...(input.maxSnippetCount !== undefined ? { maxSnippetCount: input.maxSnippetCount } : {}),
        ...(input.maxSnippetChars !== undefined ? { maxSnippetChars: input.maxSnippetChars } : {}),
    });
    const messages = [
        { role: "user", content: renderPinnedWorkingSetRetrievalOnlyBlock(input.pinnedWorkingSet) },
        { role: "user", content: renderRetrievalOnlyCapsulePromptBlock(input.capsule, snippets) },
    ];
    return {
        messages,
        snippetCount: snippets.length,
        resultTokenEstimate: estimateContextTokens(messages),
    };
}
function persistRootSessionCompactionCapsule(input) {
    const session = getSession(input.sessionId);
    const channelKey = session?.source?.trim() ? session.source : undefined;
    const threadKey = session?.source_id?.trim() ? session.source_id : input.sessionId;
    const ownerScope = buildMainAgentMemoryStateScope({
        sessionId: input.sessionId,
        ...(input.requestGroupId ? { requestGroupId: input.requestGroupId, lineageId: input.requestGroupId } : {}),
        ...(channelKey ? { channelKey } : {}),
        ...(threadKey ? { threadKey } : {}),
        agentId: ROOT_MAIN_AGENT_ID,
    });
    const parentCapsule = listMemoryCapsulesForOwner({
        ownerType: "main_agent",
        ownerId: ROOT_MAIN_AGENT_ID,
        sessionId: input.sessionId,
        ...(input.requestGroupId ? { requestGroupId: input.requestGroupId, lineageId: input.requestGroupId } : {}),
        ...(channelKey ? { channelKey } : {}),
        ...(threadKey ? { threadKey } : {}),
        limit: 1,
    })[0];
    const capsule = {
        capsuleId: randomUUID(),
        capsuleVersion: 1,
        ...(parentCapsule ? { parentCapsuleId: parentCapsule.capsuleId } : {}),
        ownerScope,
        nicknameSnapshot: "노비",
        capsuleKind: "session_compaction",
        summary: buildRootSessionCapsuleSummary(input.structuredSummary),
        activeObjectives: input.structuredSummary.currentGoal,
        confirmedFacts: input.structuredSummary.confirmedFacts,
        decisions: input.structuredSummary.toolSideEffectBoundary,
        constraints: input.structuredSummary.mustKeepConstraints,
        pendingItems: input.structuredSummary.stillOpen,
        artifactRefs: normalizeArtifactRefs(input.structuredSummary.artifactsAndReceipts.map((note) => ({ note }))),
        recoveryHints: input.structuredSummary.handoffReadyContext,
        sourceRefs: normalizeStringArray(input.sourceRefs),
        compactedMessageIds: [],
        sourceTokenEstimate: Math.max(0, Math.floor(input.sourceTokenEstimate)),
        resultTokenEstimate: 0,
        createdAt: Date.now(),
    };
    const deterministicState = buildCapsuleDeterministicState({
        pinnedWorkingSet: input.pinnedWorkingSet,
        structuredSummary: input.structuredSummary,
    });
    const mergedCapsule = applyMemoryCapsuleDeterministicState({
        capsule,
        deterministicState,
    });
    insertMemoryCapsule(mergedCapsule, {
        expectedOwnerScope: ownerScope,
    });
    for (const sourceRef of mergedCapsule.sourceRefs) {
        insertMemoryCapsuleSource({
            capsuleId: mergedCapsule.capsuleId,
            sourceKind: "manual",
            sourceId: sourceRef,
            ownerType: ownerScope.ownerType,
            ownerId: ownerScope.ownerId,
            metadata: {
                modelProvider: input.modelProvider,
                modelId: input.modelId,
                triggerReasonCodes: input.triggerReasonCodes,
                ...(input.runId ? { runId: input.runId } : {}),
            },
        });
    }
    projectMemoryCapsuleToCompatibilityStores(mergedCapsule);
    const state = buildAgentMemoryStateFromCapsule({
        capsule: mergedCapsule,
        currentRawTokenEstimate: input.sourceTokenEstimate,
        currentRawMessageCount: input.sourceMessageCount ?? input.sourceRefs.length,
    });
    if (state)
        upsertAgentMemoryState(state);
    return mergedCapsule;
}
function buildCapsuleDeterministicState(input) {
    return {
        activeObjectives: normalizeStringArray([
            ...input.pinnedWorkingSet.activeObjectives,
            ...input.structuredSummary.currentGoal,
        ]),
        confirmedFacts: normalizeStringArray([
            ...input.pinnedWorkingSet.confirmedFacts,
            ...input.structuredSummary.confirmedFacts,
        ]),
        decisions: normalizeStringArray([
            ...input.pinnedWorkingSet.decisions,
            ...input.structuredSummary.toolSideEffectBoundary,
            ...input.structuredSummary.retryDoNotRepeat.map((item) => `retry_boundary:${item}`),
        ]),
        constraints: normalizeStringArray([
            ...input.pinnedWorkingSet.constraints,
            ...input.structuredSummary.mustKeepConstraints,
        ]),
        pendingItems: normalizeStringArray([
            ...input.pinnedWorkingSet.pendingItems,
            ...input.structuredSummary.stillOpen,
        ]),
        artifactRefs: normalizeArtifactRefs([
            ...input.pinnedWorkingSet.artifactRefs,
            ...input.structuredSummary.artifactsAndReceipts.map((note) => ({ note })),
        ]),
    };
}
async function buildRootSessionStructuredSummary(input) {
    const fallback = buildFallbackRootSessionStructuredSummary(input.messages);
    const transcript = buildRootSessionSummaryTranscript(input.messages);
    const policy = resolveMemoryCompactionPolicy({
        provider: input.provider,
        executionModelId: input.model,
    });
    if (!transcript) {
        return {
            summary: fallback,
            audit: buildDefaultMemoryCompactionAudit({
                executionModelId: input.model,
                selectedModelId: policy.snapshot.selectedModelId,
                selectionSource: policy.snapshot.selectionSource,
                minContextTokens: policy.snapshot.minContextTokens,
                providerBudgetBlocked: policy.snapshot.providerBudgetBlocked,
                heuristicFallbackApplied: true,
                ...(policy.snapshot.fallbackModelId ? { fallbackModelId: policy.snapshot.fallbackModelId } : {}),
            }),
        };
    }
    const attempts = [];
    const seenModelIds = new Set();
    for (const candidate of policy.candidates) {
        if (seenModelIds.has(candidate.modelId)) {
            attempts.push({
                modelId: candidate.modelId,
                source: candidate.source,
                maxContextTokens: candidate.maxContextTokens,
                status: "skipped_duplicate",
            });
            continue;
        }
        seenModelIds.add(candidate.modelId);
        if (candidate.maxContextTokens > 0 && candidate.maxContextTokens < policy.snapshot.minContextTokens) {
            attempts.push({
                modelId: candidate.modelId,
                source: candidate.source,
                maxContextTokens: candidate.maxContextTokens,
                status: "provider_budget_blocked",
            });
            continue;
        }
        let raw = "";
        try {
            for await (const chunk of input.provider.chat({
                model: candidate.modelId,
                messages: [{
                        role: "user",
                        content: `${ROOT_SESSION_SUMMARY_PROMPT}\n\n[conversation]\n${transcript}`,
                    }],
                maxTokens: 500,
            })) {
                if (chunk.type === "text_delta")
                    raw += chunk.delta;
            }
        }
        catch (error) {
            attempts.push({
                modelId: candidate.modelId,
                source: candidate.source,
                maxContextTokens: candidate.maxContextTokens,
                status: "provider_call_failed",
                error: error instanceof Error ? error.message : String(error),
            });
            continue;
        }
        const parsed = parseRootSessionStructuredSummary(raw);
        if (parsed) {
            attempts.push({
                modelId: candidate.modelId,
                source: candidate.source,
                maxContextTokens: candidate.maxContextTokens,
                status: "selected",
            });
            return {
                summary: parsed,
                audit: buildDefaultMemoryCompactionAudit({
                    executionModelId: input.model,
                    selectedModelId: candidate.modelId,
                    selectionSource: candidate.source,
                    minContextTokens: policy.snapshot.minContextTokens,
                    providerBudgetBlocked: policy.snapshot.providerBudgetBlocked,
                    attempts,
                    fallbackApplied: candidate.source === "fallback_override",
                    ...(policy.snapshot.fallbackModelId ? { fallbackModelId: policy.snapshot.fallbackModelId } : {}),
                }),
            };
        }
        attempts.push({
            modelId: candidate.modelId,
            source: candidate.source,
            maxContextTokens: candidate.maxContextTokens,
            status: "invalid_json",
        });
    }
    return {
        summary: fallback,
        audit: buildDefaultMemoryCompactionAudit({
            executionModelId: input.model,
            selectedModelId: policy.snapshot.selectedModelId,
            selectionSource: policy.snapshot.selectionSource,
            minContextTokens: policy.snapshot.minContextTokens,
            providerBudgetBlocked: policy.snapshot.providerBudgetBlocked
                || attempts.some((attempt) => attempt.status === "provider_budget_blocked"),
            attempts,
            heuristicFallbackApplied: true,
            ...(policy.snapshot.fallbackModelId ? { fallbackModelId: policy.snapshot.fallbackModelId } : {}),
        }),
    };
}
function parseRootSessionStructuredSummary(raw) {
    const candidate = extractJsonObject(raw);
    if (!candidate)
        return undefined;
    try {
        const parsed = JSON.parse(candidate);
        return normalizeRootSessionStructuredSummary(parsed);
    }
    catch {
        return undefined;
    }
}
function normalizeRootSessionStructuredSummary(value) {
    return {
        whatHappened: normalizeString(typeof value["what_happened"] === "string" ? value["what_happened"] : "") ?? "",
        currentGoal: normalizeUnknownStringArray(value["current_goal"]),
        stillOpen: normalizeUnknownStringArray(value["still_open"]),
        confirmedFacts: normalizeUnknownStringArray(value["confirmed_facts"]),
        mustKeepConstraints: normalizeUnknownStringArray(value["must_keep_constraints"]),
        artifactsAndReceipts: normalizeUnknownStringArray(value["artifacts_and_receipts"]),
        toolSideEffectBoundary: normalizeUnknownStringArray(value["tool_side_effect_boundary"]),
        retryDoNotRepeat: normalizeUnknownStringArray(value["retry_do_not_repeat"]),
        handoffReadyContext: normalizeUnknownStringArray(value["handoff_ready_context"]),
    };
}
function buildFallbackRootSessionStructuredSummary(messages) {
    const transcript = buildRootSessionSummaryTranscript(messages);
    const lines = transcript.split("\n").filter((line) => line.trim().length > 0);
    const deterministicState = extractRootSessionDeterministicState({ messages });
    return {
        whatHappened: truncateSnapshotSummary(lines.slice(0, 6).join(" "), 320),
        currentGoal: normalizeStringArray([
            ...deterministicState.activeObjectives,
            ...deterministicState.activeTaskIds.map((item) => `active_task:${item}`),
        ]),
        stillOpen: normalizeStringArray([
            ...deterministicState.pendingApprovals.map((item) => `pending_approval:${item}`),
            ...deterministicState.pendingDelivery.map((item) => `pending_delivery:${item}`),
            ...deterministicState.unresolvedResultReviewItems.map((item) => `result_review:${item}`),
        ]),
        confirmedFacts: deterministicState.confirmedFacts,
        mustKeepConstraints: normalizeStringArray([
            ...deterministicState.mustKeepConstraints,
            ...deterministicState.explicitTargetSelectors.map((item) => `target_selector:${item}`),
            ...deterministicState.explicitUserCorrections.map((item) => `user_correction:${item}`),
        ]),
        artifactsAndReceipts: deterministicState.latestArtifactReceipts,
        toolSideEffectBoundary: deterministicState.decisions,
        retryDoNotRepeat: deterministicState.retryDoNotRepeatBoundary,
        handoffReadyContext: normalizeStringArray([
            ...deterministicState.recoveryStates,
            ...deterministicState.finalDeliveryBlockReasons.map((item) => `final_delivery_block:${item}`),
        ]),
    };
}
function buildRootSessionSummaryTranscript(messages) {
    const transcriptLines = [];
    let remainingChars = ROOT_SESSION_SUMMARY_MAX_TRANSCRIPT_CHARS;
    messages.forEach((message, index) => {
        if (remainingChars <= 0)
            return;
        const rendered = renderMessageForTranscript(message);
        if (!rendered)
            return;
        const line = `[${index}:${message.role}] ${rendered.slice(0, ROOT_SESSION_SUMMARY_MAX_MESSAGE_CHARS)}`;
        const clipped = line.slice(0, remainingChars);
        transcriptLines.push(clipped);
        remainingChars -= clipped.length + 1;
    });
    return transcriptLines.join("\n");
}
function renderMessageForTranscript(message) {
    if (typeof message.content === "string")
        return normalizeWhitespace(message.content);
    const lines = message.content.map((block) => {
        if (block.type === "text")
            return block.text;
        if (block.type === "tool_use")
            return `[tool_use:${block.name}] ${safeJsonStringify(block.input)}`;
        if (block.type === "tool_result")
            return `[tool_result:${block.tool_use_id}] ${block.content}`;
        return safeJsonStringify(block);
    });
    return normalizeWhitespace(lines.join("\n"));
}
function extractStructuredMemoryLines(messages) {
    const lines = [];
    for (const message of messages) {
        const text = renderMessageForTranscript(message);
        if (!text)
            continue;
        for (const line of text.split(/\n+/)) {
            const trimmed = line.trim();
            if (trimmed)
                lines.push(trimmed);
        }
    }
    return lines;
}
function renderPinnedWorkingSetPromptBlock(workingSet) {
    return [
        "[pinned_working_set]",
        renderSection("active_objectives", workingSet.activeObjectives),
        renderSection("confirmed_facts", workingSet.confirmedFacts),
        renderSection("constraints", workingSet.constraints),
        renderSection("decisions", workingSet.decisions),
        renderSection("pending_items", workingSet.pendingItems),
        renderSection("artifact_refs", workingSet.artifactRefs.map((item) => item.note)),
    ].filter(Boolean).join("\n");
}
function renderPinnedWorkingSetRetrievalOnlyBlock(workingSet) {
    return [
        "[pinned_working_set_retrieval_only]",
        renderInlineSection("active_objectives", workingSet.activeObjectives, 2, 120),
        renderInlineSection("constraints", workingSet.constraints, 3, 160),
        renderInlineSection("pending_items", workingSet.pendingItems, 3, 160),
    ].filter(Boolean).join("\n");
}
function renderCompactedCapsulePromptBlock(capsule) {
    return [
        "[latest_compacted_capsule]",
        `summary: ${capsule.summary}`,
        renderSection("active_objectives", capsule.activeObjectives),
        renderSection("confirmed_facts", capsule.confirmedFacts),
        renderSection("constraints", capsule.constraints),
        renderSection("pending_items", capsule.pendingItems),
        renderSection("artifact_refs", capsule.artifactRefs.map((item) => item.note)),
        renderSection("recovery_hints", capsule.recoveryHints),
    ].filter(Boolean).join("\n");
}
function renderRetrievalOnlyCapsulePromptBlock(capsule, snippets) {
    return [
        "[retrieval_only_context]",
        `summary: ${truncateSnapshotSummary(capsule.summary, 220)}`,
        renderInlineSection("confirmed_facts", capsule.confirmedFacts, 2, 120),
        renderInlineSection("artifact_refs", capsule.artifactRefs.map((item) => item.note), 2, 100),
        renderSnippetSection("retrieval_snippets", snippets),
    ].filter(Boolean).join("\n");
}
function buildRootSessionCapsuleSummary(summary) {
    const parts = [
        summary.whatHappened,
        summary.currentGoal.length > 0 ? `current_goal: ${summary.currentGoal.join("; ")}` : "",
        summary.stillOpen.length > 0 ? `still_open: ${summary.stillOpen.join("; ")}` : "",
    ].filter(Boolean);
    return truncateSnapshotSummary(parts.join("\n"));
}
function renderSection(label, values) {
    const normalized = normalizeStringArray(values);
    if (normalized.length === 0)
        return `${label}: []`;
    return `${label}:\n${normalized.map((item) => `- ${item}`).join("\n")}`;
}
function renderInlineSection(label, values, maxItems, maxChars) {
    const normalized = normalizeStringArray(values).slice(0, maxItems);
    if (normalized.length === 0)
        return `${label}: []`;
    const joined = truncateSnapshotSummary(normalized.join("; "), maxChars);
    return `${label}: ${joined}`;
}
function renderSnippetSection(label, values) {
    if (values.length === 0)
        return `${label}: []`;
    return `${label}:\n${values.map((item) => `- ${item}`).join("\n")}`;
}
function normalizeUnknownStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return normalizeStringArray(value.filter((item) => typeof item === "string"));
}
function extractJsonObject(value) {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start < 0 || end <= start)
        return undefined;
    return value.slice(start, end + 1);
}
function safeJsonStringify(value) {
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function safeResolveProviderContextTokens(provider, model) {
    try {
        const resolved = provider.maxContextTokens(model);
        if (!Number.isFinite(resolved) || resolved <= 0)
            return 0;
        return Math.floor(resolved);
    }
    catch {
        return 0;
    }
}
function buildRetrievalSnippets(input) {
    const maxSnippetCount = Math.max(1, Math.floor(input.maxSnippetCount ?? 2));
    const maxSnippetChars = Math.max(80, Math.floor(input.maxSnippetChars ?? 120));
    const snippets = [];
    for (let index = input.messages.length - 1; index >= 0; index -= 1) {
        if (snippets.length >= maxSnippetCount)
            break;
        const message = input.messages[index];
        if (!message)
            continue;
        const rendered = renderMessageForTranscript(message);
        if (!rendered)
            continue;
        const clipped = rendered.length > maxSnippetChars
            ? `${rendered.slice(0, Math.max(0, maxSnippetChars - 1)).trimEnd()}…`
            : rendered;
        snippets.unshift(`[${message.role}:${index}] ${clipped}`);
    }
    return snippets;
}
async function archiveCompactedSessionMessages(input) {
    const rawText = input.messages
        .map((message, index) => `[${index}:${message.role}] ${renderMessageForTranscript(message)}`)
        .filter((value) => value.trim().length > 0)
        .join("\n\n");
    if (!rawText.trim())
        return undefined;
    try {
        const stored = await storeMemoryDocument({
            rawText,
            scope: "session",
            ownerId: input.sessionId,
            sourceType: "memory_capsule_archive",
            sourceRef: input.capsuleId,
            title: `capsule_archive:${input.capsuleId}`,
            metadata: {
                capsuleId: input.capsuleId,
                ownerType: input.ownerScope.ownerType,
                ownerId: input.ownerScope.ownerId,
                sessionId: input.ownerScope.sessionId ?? input.sessionId,
                requestGroupId: input.ownerScope.requestGroupId ?? null,
                lineageId: input.ownerScope.lineageId ?? null,
                channelKey: input.ownerScope.channelKey ?? null,
                threadKey: input.ownerScope.threadKey ?? null,
            },
        });
        return stored.documentId;
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=compaction.js.map