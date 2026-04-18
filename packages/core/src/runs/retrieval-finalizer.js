import { getMessageLedgerEventByIdempotencyKey, listMessageLedgerEvents } from "../db/index.js";
import { hashLedgerValue, recordMessageLedgerEvent, } from "./message-ledger.js";
function normalizeText(value) {
    return value?.trim().replace(/\s+/g, " ") ?? "";
}
function normalizeChannel(value) {
    return normalizeText(value).toLocaleLowerCase("en-US") || "unknown";
}
function resolveOwner(input) {
    return normalizeText(input.requestGroupId) || normalizeText(input.runId) || "unknown-run";
}
function resolveTarget(input) {
    return normalizeText(input.threadKey) || normalizeText(input.sessionKey) || "default";
}
function eventSucceeded(event) {
    return event.status === "sent" || event.status === "delivered" || event.status === "succeeded";
}
function finalAnswerDelivered(event) {
    return event.event_kind === "final_answer_delivered" && eventSucceeded(event);
}
function containsNumberLike(value) {
    return /[-+]?\d{1,3}(?:,\d{3})*(?:\.\d+)?|[-+]?\d+(?:\.\d+)?/u.test(value);
}
export function buildFinalAnswerIdempotencyKey(input) {
    return `final-answer:${resolveOwner(input)}:${normalizeChannel(input.channel)}:${hashLedgerValue(resolveTarget(input))}`;
}
export function buildFinalAnswerDeliveryKey(input) {
    return `final-answer:${normalizeChannel(input.channel)}:${hashLedgerValue({ target: resolveTarget(input), text: normalizeText(input.text) })}`;
}
export function buildProgressMessageIdempotencyKey(input) {
    return `progress:${resolveOwner(input)}:${normalizeChannel(input.channel)}:${hashLedgerValue({ target: resolveTarget(input), text: normalizeText(input.text), createdAt: input.createdAt ?? null })}`;
}
export function canGenerateFinalAnswerFromVerdict(input) {
    if (!input.verdict)
        return { allowed: false, reason: "retrieval_verdict_required" };
    if (input.verdict.canAnswer)
        return { allowed: true };
    if (containsNumberLike(input.text))
        return { allowed: false, reason: "unverified_numeric_final_answer" };
    return { allowed: true };
}
function recordLedger(input) {
    return recordMessageLedgerEvent(input);
}
export function recordProgressMessageSent(input) {
    const text = normalizeText(input.text);
    if (!text)
        return null;
    return recordLedger({
        runId: input.runId ?? null,
        requestGroupId: input.requestGroupId ?? null,
        sessionKey: input.sessionKey ?? null,
        threadKey: input.threadKey ?? null,
        channel: normalizeChannel(input.channel),
        eventKind: "progress_message_sent",
        idempotencyKey: buildProgressMessageIdempotencyKey(input),
        status: "sent",
        summary: "progress message sent",
        detail: {
            textLength: text.length,
            messageRole: "progress",
        },
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    });
}
export function recordFinalAnswerDelivery(input) {
    const text = normalizeText(input.text);
    const idempotencyKey = buildFinalAnswerIdempotencyKey(input);
    const deliveryKey = buildFinalAnswerDeliveryKey(input);
    const channel = normalizeChannel(input.channel);
    const allowed = canGenerateFinalAnswerFromVerdict({ verdict: input.verdict, text });
    if (!allowed.allowed) {
        const ledgerEventId = recordLedger({
            runId: input.runId ?? null,
            requestGroupId: input.requestGroupId ?? null,
            sessionKey: input.sessionKey ?? null,
            threadKey: input.threadKey ?? null,
            channel,
            eventKind: "final_answer_suppressed",
            deliveryKey,
            idempotencyKey: `final-answer-blocked:${idempotencyKey}:${hashLedgerValue(text)}`,
            status: "suppressed",
            summary: "final answer blocked before delivery",
            detail: {
                reason: allowed.reason ?? "blocked",
                verdict: input.verdict,
                textLength: text.length,
            },
            ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        });
        return {
            status: "blocked",
            delivered: false,
            duplicate: false,
            blocked: true,
            ledgerEventId,
            idempotencyKey,
            deliveryKey,
            channel,
            summary: "final answer blocked before delivery",
            ...(allowed.reason ? { reason: allowed.reason } : {}),
        };
    }
    const existing = getMessageLedgerEventByIdempotencyKey(idempotencyKey);
    if (existing && finalAnswerDelivered(existing)) {
        const ledgerEventId = recordLedger({
            runId: input.runId ?? null,
            requestGroupId: input.requestGroupId ?? null,
            sessionKey: input.sessionKey ?? null,
            threadKey: input.threadKey ?? null,
            channel,
            eventKind: "final_answer_suppressed",
            deliveryKey,
            idempotencyKey: `final-answer-duplicate:${idempotencyKey}:${hashLedgerValue(text)}`,
            status: "suppressed",
            summary: "duplicate final answer suppressed",
            detail: {
                existingLedgerEventId: existing.id,
                textLength: text.length,
            },
            ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        });
        return {
            status: "suppressed",
            delivered: true,
            duplicate: true,
            blocked: false,
            ledgerEventId,
            idempotencyKey,
            deliveryKey,
            channel,
            summary: "duplicate final answer suppressed",
        };
    }
    const ledgerEventId = recordLedger({
        runId: input.runId ?? null,
        requestGroupId: input.requestGroupId ?? null,
        sessionKey: input.sessionKey ?? null,
        threadKey: input.threadKey ?? null,
        channel,
        eventKind: "final_answer_delivered",
        deliveryKey,
        idempotencyKey,
        status: "delivered",
        summary: "final answer delivered",
        detail: {
            textLength: text.length,
            verdict: input.verdict,
            messageRole: "final_answer",
        },
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    });
    return {
        status: "delivered",
        delivered: true,
        duplicate: false,
        blocked: false,
        ledgerEventId,
        idempotencyKey,
        deliveryKey,
        channel,
        summary: "final answer delivered",
    };
}
function completionStatusForVerdict(verdict) {
    if (verdict.canAnswer) {
        return verdict.evidenceSufficiency === "sufficient_approximate" || verdict.evidenceSufficiency === "partial_but_answerable"
            ? "completed_approximate_value_found"
            : "completed_value_found";
    }
    if (verdict.evidenceSufficiency === "insufficient_candidate_missing")
        return "completed_limited_no_value";
    if (verdict.evidenceSufficiency === "blocked")
        return "completed_policy_blocked";
    return "completed_insufficient_evidence";
}
export function finalizeRetrievalCompletion(input) {
    if (!input.verdict) {
        return {
            status: "awaiting_user",
            runStatus: "awaiting_user",
            completionSatisfied: false,
            shouldRetryRecovery: true,
            summary: "retrieval verdict is required before completion",
            reason: "retrieval_verdict_required",
        };
    }
    if (!input.finalAnswerReceipt?.delivered || input.finalAnswerReceipt.blocked) {
        return {
            status: "awaiting_user",
            runStatus: "awaiting_user",
            completionSatisfied: false,
            shouldRetryRecovery: true,
            summary: "final answer delivery receipt is required before completion",
            reason: input.finalAnswerReceipt?.reason ?? "final_answer_delivery_required",
        };
    }
    const status = completionStatusForVerdict(input.verdict);
    return {
        status,
        runStatus: "completed",
        completionSatisfied: true,
        shouldRetryRecovery: false,
        summary: status === "completed_value_found"
            ? "verified value answer delivered"
            : status === "completed_approximate_value_found"
                ? "verified approximate value answer delivered"
                : status === "completed_limited_no_value"
                    ? "limited no-value answer delivered"
                    : status === "completed_policy_blocked"
                        ? "policy-blocked completion delivered"
                        : "insufficient-evidence completion delivered",
        reason: input.verdict.rejectionReason ?? input.verdict.evidenceSufficiency,
    };
}
export function protectRunFailureAfterFinalAnswer(input) {
    if (input.requestedStatus !== "failed" && input.requestedStatus !== "cancelled" && input.requestedStatus !== "interrupted") {
        return { shouldProtectDeliveredAnswer: false, outcome: "unchanged" };
    }
    const channel = normalizeChannel(input.channel);
    const events = listMessageLedgerEvents({
        ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : input.runId ? { runId: input.runId } : {}),
        limit: 1000,
    });
    const deliveredFinalAnswer = events.find((event) => finalAnswerDelivered(event) && normalizeChannel(event.channel) === channel);
    if (!deliveredFinalAnswer) {
        return {
            shouldProtectDeliveredAnswer: false,
            outcome: "unchanged",
            reason: "no_final_answer_receipt_for_channel",
        };
    }
    const hasFailure = events.some((event) => event.status === "failed" || event.event_kind.endsWith("_failed"));
    const outcome = hasFailure ? "partial_success" : "success";
    const summary = outcome === "partial_success"
        ? "최종 답변은 이미 전달됐고, 후속 전달/복구 실패는 부분 실패로 기록했습니다."
        : "최종 답변 전달이 완료되어 후속 실패가 전체 실패로 덮어써지지 않았습니다.";
    recordLedger({
        runId: input.runId ?? null,
        requestGroupId: input.requestGroupId ?? null,
        channel,
        eventKind: "delivery_finalized",
        idempotencyKey: `retrieval-finalized:${resolveOwner(input)}:${channel}:${input.requestedStatus}:${outcome}`,
        status: outcome === "partial_success" ? "degraded" : "succeeded",
        summary,
        detail: {
            requestedStatus: input.requestedStatus,
            requestedSummary: input.requestedSummary ?? null,
            finalAnswerLedgerEventId: deliveredFinalAnswer.id,
            outcome,
        },
    });
    return {
        shouldProtectDeliveredAnswer: true,
        outcome,
        runStatus: "completed",
        summary,
    };
}
//# sourceMappingURL=retrieval-finalizer.js.map