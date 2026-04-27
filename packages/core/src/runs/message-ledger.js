import crypto from "node:crypto";
import { recordControlEventFromLedger } from "../control-plane/timeline.js";
import { getDb, getMessageLedgerEventByIdempotencyKey, insertDiagnosticEvent, insertMessageLedgerEvent, listMessageLedgerEvents, } from "../db/index.js";
import { buildWebRetrievalPolicyDecision } from "./web-retrieval-policy.js";
const DEDUPE_TOOL_NAMES = new Set([
    "web_search",
    "web_fetch",
    "screen_capture",
    "telegram_send_file",
    "slack_send_file",
]);
const SECRET_KEY_PATTERN = /(?:api[_-]?key|token|secret|password|credential|authorization|cookie|raw[_-]?(?:body|response))/i;
function resolveRunLedgerContext(runId) {
    if (!runId)
        return undefined;
    return getDb()
        .prepare(`SELECT id AS runId, request_group_id AS requestGroupId, session_id AS sessionKey, source AS channel
       FROM root_runs
       WHERE id = ?
       LIMIT 1`)
        .get(runId);
}
function sanitizeLedgerDetail(value, depth = 0) {
    if (value == null)
        return value;
    if (depth > 8)
        return "[truncated]";
    if (Array.isArray(value))
        return value.slice(0, 50).map((item) => sanitizeLedgerDetail(item, depth + 1));
    if (typeof value !== "object")
        return value;
    const result = {};
    for (const [key, nested] of Object.entries(value)) {
        if (SECRET_KEY_PATTERN.test(key)) {
            result[key] = "[redacted]";
            continue;
        }
        result[key] = sanitizeLedgerDetail(nested, depth + 1);
    }
    return result;
}
export function recordMessageLedgerEvent(input) {
    try {
        const resolved = resolveRunLedgerContext(input.runId ?? input.parentRunId);
        const requestGroupId = input.requestGroupId ?? resolved?.requestGroupId ?? input.runId ?? null;
        const sessionKey = input.sessionKey ?? resolved?.sessionKey ?? null;
        const channel = input.channel ?? resolved?.channel ?? "unknown";
        const threadKey = input.threadKey ?? requestGroupId ?? input.runId ?? sessionKey ?? null;
        const detailSource = {
            ...(input.detail ?? {}),
            ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
            ...(input.subSessionId ? { subSessionId: input.subSessionId } : {}),
            ...(input.agentId ? { agentId: input.agentId } : {}),
            ...(input.teamId ? { teamId: input.teamId } : {}),
            ...(input.deliveryKind ? { deliveryKind: input.deliveryKind } : {}),
        };
        const detail = Object.keys(detailSource).length > 0
            ? sanitizeLedgerDetail(detailSource)
            : undefined;
        const id = insertMessageLedgerEvent({
            runId: input.runId ?? input.parentRunId ?? resolved?.runId ?? null,
            requestGroupId,
            sessionKey,
            threadKey,
            channel,
            eventKind: input.eventKind,
            deliveryKey: input.deliveryKey ?? null,
            idempotencyKey: input.idempotencyKey ?? null,
            status: input.status,
            summary: input.summary,
            ...(detail ? { detail } : {}),
            ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        });
        if (id) {
            recordControlEventFromLedger({
                runId: input.runId ?? input.parentRunId ?? resolved?.runId ?? null,
                requestGroupId,
                sessionKey,
                channel,
                eventKind: input.eventKind,
                deliveryKey: input.deliveryKey ?? null,
                idempotencyKey: input.idempotencyKey ?? null,
                status: input.status,
                summary: input.summary,
                ...(detail ? { detail } : {}),
            });
        }
        return id;
    }
    catch (error) {
        try {
            insertDiagnosticEvent({
                kind: "message_ledger_degraded",
                summary: `message ledger write failed: ${error instanceof Error ? error.message : String(error)}`,
                detail: {
                    eventKind: input.eventKind,
                    runId: input.runId ?? null,
                    requestGroupId: input.requestGroupId ?? null,
                },
            });
        }
        catch {
            // Ledger is diagnostic-only. Never fail the user request because diagnostics failed.
        }
        return null;
    }
}
export function findMessageLedgerEventByIdempotencyKey(idempotencyKey) {
    const key = idempotencyKey?.trim();
    if (!key)
        return undefined;
    return getMessageLedgerEventByIdempotencyKey(key);
}
export function stableStringify(value) {
    if (value === undefined)
        return "null";
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    const entries = Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(",")}}`;
}
export function hashLedgerValue(value) {
    return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}
function normalizeChannelTarget(target) {
    return target?.trim() || "default";
}
export function buildTextDeliveryKey(channel, target, text) {
    return `text:${channel ?? "unknown"}:${normalizeChannelTarget(target)}:${hashLedgerValue(text.trim())}`;
}
export function buildArtifactDeliveryKey(channel, target, artifactPath) {
    return `artifact:${channel ?? "unknown"}:${normalizeChannelTarget(target)}:${hashLedgerValue(artifactPath)}`;
}
function canonicalToolParams(params) {
    const result = {};
    for (const [key, value] of Object.entries(params).sort(([left], [right]) => left.localeCompare(right))) {
        if (key === "allowRepeatReason")
            continue;
        result[key] = value;
    }
    return result;
}
export function isDedupeTargetTool(toolName) {
    return DEDUPE_TOOL_NAMES.has(toolName);
}
export function getAllowRepeatReason(params) {
    const value = params.allowRepeatReason;
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
export function buildToolCallIdempotencyKey(input) {
    const owner = input.requestGroupId ?? input.runId ?? "unknown-run";
    const hash = hashLedgerValue({
        toolName: input.toolName,
        params: canonicalToolParams(input.params),
    });
    return `tool:${owner}:${input.toolName}:${hash}`;
}
export function findDuplicateToolCall(input) {
    const baseKey = buildToolCallIdempotencyKey(input);
    const webRetrievalPolicy = buildWebRetrievalPolicyDecision({
        toolName: input.toolName,
        params: input.params,
    });
    const keys = [
        baseKey,
        ...(webRetrievalPolicy
            ? [
                buildToolCallIdempotencyKey({
                    ...input,
                    params: webRetrievalPolicy.canonicalParams,
                }),
            ]
            : []),
    ];
    for (const key of [...new Set(keys)]) {
        const duplicate = getMessageLedgerEventByIdempotencyKey(`${key}:result`) ??
            getMessageLedgerEventByIdempotencyKey(`${key}:started`);
        if (duplicate)
            return duplicate;
    }
    return undefined;
}
function eventSucceeded(event) {
    return event.status === "sent" || event.status === "delivered" || event.status === "succeeded";
}
export function messageLedgerEventSucceeded(event) {
    return Boolean(event && eventSucceeded(event));
}
function eventFailed(event) {
    return (event.status === "failed" ||
        event.status === "suppressed" ||
        event.event_kind.endsWith("_failed") ||
        event.event_kind === "recovery_stop_generated");
}
export function finalizeDeliveryForRun(params) {
    if (params.requestedStatus !== "failed" &&
        params.requestedStatus !== "cancelled" &&
        params.requestedStatus !== "interrupted") {
        return { shouldProtectDeliveredAnswer: false, outcome: "unchanged" };
    }
    const resolved = resolveRunLedgerContext(params.runId);
    const events = listMessageLedgerEvents({
        ...(resolved?.requestGroupId
            ? { requestGroupId: resolved.requestGroupId }
            : { runId: params.runId }),
        limit: 1000,
    });
    const hasDeliveredAnswer = events.some((event) => event.event_kind === "text_delivered" && eventSucceeded(event));
    if (!hasDeliveredAnswer)
        return { shouldProtectDeliveredAnswer: false, outcome: "unchanged" };
    const hasLaterFailure = events.some(eventFailed);
    const outcome = hasLaterFailure ? "partial_success" : "success";
    const summary = outcome === "partial_success"
        ? "응답은 이미 전달됐고, 후속 전달/복구 실패는 부분 실패로 기록했습니다."
        : "응답 전달이 완료되어 후속 실패가 전체 실패로 덮어써지지 않았습니다.";
    recordMessageLedgerEvent({
        runId: params.runId,
        requestGroupId: resolved?.requestGroupId ?? params.runId,
        sessionKey: resolved?.sessionKey ?? null,
        channel: resolved?.channel ?? null,
        eventKind: "delivery_finalized",
        idempotencyKey: `delivery-finalized:${params.runId}:${params.requestedStatus}:${outcome}`,
        status: outcome === "partial_success" ? "degraded" : "succeeded",
        summary,
        detail: {
            requestedStatus: params.requestedStatus,
            requestedSummary: params.requestedSummary ?? null,
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
//# sourceMappingURL=message-ledger.js.map