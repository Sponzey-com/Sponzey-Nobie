import { findChannelMessageRef, getDb, } from "../db/index.js";
export function resolveChannelContinuation(input) {
    void input.lookupWindowMs;
    const candidates = [];
    const explicitRunId = input.runId ?? input.envelope.continuationContext?.runId;
    const explicitTaskId = input.taskId ?? input.envelope.continuationContext?.taskId;
    const explicitDeliveryId = input.deliveryId ?? input.envelope.continuationContext?.parentDeliveryId;
    if (explicitRunId)
        pushCandidate(candidates, candidateFromRunId(explicitRunId, "explicit_run_id"));
    if (explicitTaskId)
        pushCandidate(candidates, candidateFromRunId(explicitTaskId, "explicit_task_id"));
    if (explicitDeliveryId) {
        for (const candidate of candidatesFromDeliveryId(explicitDeliveryId))
            pushCandidate(candidates, candidate);
    }
    const roomId = input.envelope.room?.id;
    if (roomId) {
        const exactIncomingRef = findChannelMessageRef({
            source: input.envelope.provider,
            externalChatId: roomId,
            externalMessageId: input.envelope.messageId,
            ...(input.envelope.threadId ? { externalThreadId: input.envelope.threadId } : {}),
        });
        pushCandidate(candidates, candidateFromMessageRef(exactIncomingRef, "message_ref_exact", "exact"));
        if (exactIncomingRef)
            return finalizeContinuationResult(candidates);
        const parentMessageId = input.envelope.replyToMessageId
            ?? (input.envelope.continuationContext?.source === "thread"
                ? undefined
                : input.envelope.continuationContext?.parentMessageId);
        if (parentMessageId) {
            const parentRef = findChannelMessageRef({
                source: input.envelope.provider,
                externalChatId: roomId,
                externalMessageId: parentMessageId,
                ...(input.envelope.threadId ? { externalThreadId: input.envelope.threadId } : {}),
            });
            pushCandidate(candidates, candidateFromMessageRef(parentRef, "message_ref_parent", "exact"));
            if (parentRef)
                return finalizeContinuationResult(candidates);
        }
    }
    return finalizeContinuationResult(candidates);
}
export function buildContinuationConfirmationPrompt(candidates) {
    const count = candidates.length;
    return `Found ${count} possible previous Nobie contexts. Please choose which task to continue before this message is attached.`;
}
function finalizeContinuationResult(candidates) {
    const unique = uniqueCandidates(candidates);
    if (unique.length === 0) {
        return {
            status: "not_found",
            candidates: [],
            confirmationRequired: false,
            reasonCode: "no_candidates",
        };
    }
    const exact = unique.filter((candidate) => candidate.confidence === "exact");
    const selectedPool = exact.length > 0 ? exact : unique;
    const groupedByRequest = new Map();
    for (const candidate of selectedPool) {
        const key = candidate.requestGroupId || candidate.runId;
        const existing = groupedByRequest.get(key);
        if (existing)
            existing.push(candidate);
        else
            groupedByRequest.set(key, [candidate]);
    }
    if (groupedByRequest.size === 1) {
        const selected = [...groupedByRequest.values()][0]
            .sort((left, right) => rankCandidate(right) - rankCandidate(left) || right.createdAt - left.createdAt)[0];
        return {
            status: "resolved",
            candidates: unique,
            selected,
            confirmationRequired: false,
            reasonCode: selected.source.startsWith("explicit")
                ? "explicit_match"
                : "message_match",
        };
    }
    return {
        status: "ambiguous",
        candidates: unique,
        confirmationRequired: true,
        confirmationPrompt: buildContinuationConfirmationPrompt(unique),
        reasonCode: "ambiguous_candidates",
    };
}
function candidateFromRunId(runId, source) {
    const normalized = runId.trim();
    if (!normalized)
        return null;
    const row = getDb()
        .prepare(`SELECT id, request_group_id, session_id, created_at
       FROM root_runs
       WHERE id = ? OR request_group_id = ?
       ORDER BY updated_at DESC
       LIMIT 1`)
        .get(normalized, normalized);
    if (!row)
        return null;
    return {
        source,
        runId: row.id,
        requestGroupId: row.request_group_id ?? row.id,
        ...(row.session_id ? { sessionId: row.session_id } : {}),
        confidence: "exact",
        createdAt: row.created_at ?? Date.now(),
    };
}
function candidatesFromDeliveryId(deliveryId) {
    const normalized = deliveryId.trim();
    if (!normalized)
        return [];
    const rows = getDb()
        .prepare(`SELECT *
       FROM message_ledger
       WHERE delivery_key = ? OR id = ?
       ORDER BY created_at DESC
       LIMIT 20`)
        .all(normalized, normalized);
    return rows
        .map((event) => candidateFromLedgerEvent(event, "delivery_id"))
        .filter((candidate) => candidate !== null);
}
function candidateFromLedgerEvent(event, source) {
    if (!event.run_id && !event.request_group_id)
        return null;
    const runId = event.run_id ?? event.request_group_id;
    if (!runId)
        return null;
    return {
        source,
        runId,
        requestGroupId: event.request_group_id ?? runId,
        ...(event.session_key ? { sessionId: event.session_key } : {}),
        ...(event.delivery_key ? { deliveryKey: event.delivery_key } : {}),
        confidence: "exact",
        createdAt: event.created_at,
    };
}
function candidateFromMessageRef(ref, source, confidence) {
    if (!ref)
        return null;
    return {
        source,
        runId: ref.root_run_id,
        requestGroupId: ref.request_group_id,
        sessionId: ref.session_id,
        messageRef: ref,
        externalChatId: ref.external_chat_id,
        externalThreadId: ref.external_thread_id,
        externalMessageId: ref.external_message_id,
        confidence,
        createdAt: ref.created_at,
    };
}
function pushCandidate(candidates, candidate) {
    if (!candidate)
        return;
    candidates.push(candidate);
}
function uniqueCandidates(candidates) {
    const byKey = new Map();
    for (const candidate of candidates) {
        const key = [
            candidate.runId,
            candidate.requestGroupId,
            candidate.externalMessageId ?? "",
            candidate.deliveryKey ?? "",
        ].join(":");
        const existing = byKey.get(key);
        if (!existing || rankCandidate(candidate) > rankCandidate(existing) || candidate.createdAt > existing.createdAt) {
            byKey.set(key, candidate);
        }
    }
    return [...byKey.values()].sort((left, right) => rankCandidate(right) - rankCandidate(left) || right.createdAt - left.createdAt);
}
function rankCandidate(candidate) {
    switch (candidate.confidence) {
        case "exact":
            return 4;
        case "high":
            return 3;
        case "medium":
            return 2;
        case "low":
            return 1;
    }
}
//# sourceMappingURL=continuation.js.map