import { randomUUID } from "node:crypto";
import { reviewSubAgentResult } from "../agent/sub-agent-result-review.js";
import { validateCommandRequest, validateResultReport, } from "../contracts/sub-agent-orchestration.js";
import { recordControlEvent } from "../control-plane/timeline.js";
import { getDb, getRunSubSession, getRunSubSessionByIdempotencyKey, insertRunSubSession, listAgentRelationships, listRunSubSessionsForParentRun, updateRunSubSession, } from "../db/index.js";
import { recordLatencyMetric } from "../observability/latency.js";
import { appendRunEvent, getRootRun } from "../runs/store.js";
import { buildFeedbackLoopPackage, buildRedelegatedSubSessionInput, decideFeedbackLoopContinuation, validateRedelegationTarget, } from "./feedback-loop.js";
import { buildSubSessionContract, canTransitionSubSessionStatus, transitionSubSessionStatus, } from "./sub-session-runner.js";
const ACTIVE_CONTROL_STATUSES = new Set([
    "created",
    "queued",
    "running",
    "waiting_for_input",
    "awaiting_approval",
]);
const TERMINAL_STATUSES = new Set([
    "completed",
    "needs_revision",
    "failed",
    "cancelled",
]);
const SECRET_PATTERNS = [
    [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-***"],
    [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***"],
    [
        /(api[_-]?key|authorization|password|refresh[_-]?token|secret|token)(["'\s:=]+)([^"'\s,}]+)/gi,
        "$1$2***",
    ],
    [/([A-Za-z0-9_-]{12,})\.([A-Za-z0-9_-]{12,})\.([A-Za-z0-9_-]{12,})/g, "***.***.***"],
    [/[A-Za-z0-9가-힣 _-]*private raw memory[A-Za-z0-9가-힣 _-]*/gi, "[private memory redacted]"],
];
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function trimmedString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function boundedLimit(value, fallback = 50) {
    const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return fallback;
    return Math.min(Math.floor(parsed), 200);
}
export function sanitizeSubSessionControlText(value) {
    let result = value;
    for (const [pattern, replacement] of SECRET_PATTERNS) {
        result = result.replace(pattern, replacement);
    }
    return result.length > 4_000 ? `${result.slice(0, 3_990)}...` : result;
}
function sanitizeDetail(value, depth = 0) {
    if (value == null)
        return value;
    if (depth > 6)
        return "[truncated]";
    if (typeof value === "string")
        return sanitizeSubSessionControlText(value);
    if (typeof value !== "object")
        return value;
    if (Array.isArray(value))
        return value.slice(0, 50).map((item) => sanitizeDetail(item, depth + 1));
    const result = {};
    for (const [key, nested] of Object.entries(value)) {
        result[key] = /secret|token|password|credential|authorization|raw/i.test(key)
            ? "***"
            : sanitizeDetail(nested, depth + 1);
    }
    return result;
}
function parseSubSessionRow(row) {
    if (!row)
        return undefined;
    try {
        const parsed = JSON.parse(row.contract_json);
        return parsed && typeof parsed === "object" ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function parseSpawnBody(body) {
    const envelope = isRecord(body) && isRecord(body.input) ? body : { input: body };
    const input = isRecord(envelope.input) ? envelope.input : undefined;
    if (!input)
        return { approvalRequired: false, error: "invalid_spawn_request" };
    const commandValidation = validateCommandRequest(input.command);
    if (!commandValidation.ok)
        return { approvalRequired: false, error: "invalid_command_request" };
    const command = commandValidation.value;
    if (!isRecord(input.agent) ||
        !trimmedString(input.agent.agentId) ||
        !trimmedString(input.agent.displayName)) {
        return { approvalRequired: false, error: "invalid_agent_snapshot" };
    }
    if (!trimmedString(input.parentSessionId))
        return { approvalRequired: false, error: "invalid_parent_session" };
    if (!isRecord(input.promptBundle) || !trimmedString(input.promptBundle.bundleId)) {
        return { approvalRequired: false, error: "invalid_prompt_bundle" };
    }
    return {
        input: input,
        approvalRequired: envelope.approvalRequired === true ||
            envelope.requiresApproval === true ||
            command.contextPackageIds.some((ref) => ref.startsWith("approval:")),
        auditCorrelationId: trimmedString(envelope.auditCorrelationId),
    };
}
function nowMs() {
    return Date.now();
}
function recordSpawnMetric(ack) {
    recordLatencyMetric({
        name: "sub_session_spawn_ack_ms",
        durationMs: ack.ackLatencyMs,
        ...(ack.parentRunId ? { runId: ack.parentRunId } : {}),
        detail: {
            subSessionId: ack.subSessionId ?? null,
            status: ack.status,
            reasonCode: ack.reasonCode,
        },
    });
}
function appendTimeline(parentRunId, label) {
    if (!getRootRun(parentRunId))
        return;
    appendRunEvent(parentRunId, label);
}
function recordSubSessionControlEvent(input) {
    return recordControlEvent({
        eventType: input.eventType,
        component: "subsession.control",
        runId: input.parentRunId,
        correlationId: input.auditCorrelationId ?? input.subSessionId ?? input.parentRunId,
        severity: input.severity ?? "info",
        summary: input.summary,
        detail: {
            action: input.action,
            ...(input.subSessionId ? { subSessionId: input.subSessionId } : {}),
            auditCorrelationId: input.auditCorrelationId ?? null,
            ...(input.detail ? input.detail : {}),
        },
    });
}
function makeAck(input) {
    const completedAt = nowMs();
    const ack = {
        ok: input.status === "accepted" || input.status === "queued",
        status: input.status,
        reasonCode: input.reasonCode,
        ...(input.subSessionId ? { subSessionId: input.subSessionId } : {}),
        ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
        ...(input.replayed !== undefined ? { replayed: input.replayed } : {}),
        ackStartedAt: input.startedAt,
        ackCompletedAt: completedAt,
        ackLatencyMs: Math.max(0, completedAt - input.startedAt),
    };
    recordSpawnMetric(ack);
    return ack;
}
export function spawnSubSessionAck(body) {
    const startedAt = nowMs();
    const parsed = parseSpawnBody(body);
    if (!parsed.input) {
        return makeAck({
            startedAt,
            status: "rejected",
            reasonCode: parsed.error ?? "invalid_spawn_request",
        });
    }
    const input = parsed.input;
    if (parsed.approvalRequired) {
        const ack = makeAck({
            startedAt,
            status: "blocked_by_approval",
            reasonCode: "blocked_by_approval",
            subSessionId: input.command.subSessionId,
            parentRunId: input.command.parentRunId,
        });
        recordSubSessionControlEvent({
            eventType: "subsession.spawn.blocked_by_approval",
            parentRunId: input.command.parentRunId,
            subSessionId: input.command.subSessionId,
            action: "spawn",
            summary: `sub-session spawn blocked by approval: ${input.command.subSessionId}`,
            severity: "warning",
            auditCorrelationId: parsed.auditCorrelationId,
            detail: { ackLatencyMs: ack.ackLatencyMs },
        });
        return ack;
    }
    const existing = parseSubSessionRow(getRunSubSessionByIdempotencyKey(input.command.identity.idempotencyKey));
    if (existing) {
        return makeAck({
            startedAt,
            status: "accepted",
            reasonCode: "idempotent_replay",
            subSessionId: existing.subSessionId,
            parentRunId: existing.parentRunId,
            replayed: true,
        });
    }
    const subSession = buildSubSessionContract(input);
    transitionSubSessionStatus(subSession, "queued", nowMs());
    const inserted = insertRunSubSession(subSession);
    if (!inserted) {
        return makeAck({
            startedAt,
            status: "accepted",
            reasonCode: "idempotent_replay",
            subSessionId: subSession.subSessionId,
            parentRunId: subSession.parentRunId,
            replayed: true,
        });
    }
    appendTimeline(subSession.parentRunId, `sub_session_spawn_queued:${subSession.subSessionId}`);
    const ack = makeAck({
        startedAt,
        status: "queued",
        reasonCode: "spawn_queued",
        subSessionId: subSession.subSessionId,
        parentRunId: subSession.parentRunId,
        replayed: false,
    });
    recordSubSessionControlEvent({
        eventType: "subsession.spawn.queued",
        parentRunId: subSession.parentRunId,
        subSessionId: subSession.subSessionId,
        action: "spawn",
        summary: `sub-session spawn queued: ${subSession.subSessionId}`,
        auditCorrelationId: parsed.auditCorrelationId ?? subSession.identity.auditCorrelationId,
        detail: { ackLatencyMs: ack.ackLatencyMs, idempotencyKey: subSession.identity.idempotencyKey },
    });
    return ack;
}
export function requireSubSessionAccess(subSessionId, expectedParentRunId) {
    const subSession = parseSubSessionRow(getRunSubSession(subSessionId));
    if (!subSession)
        return { ok: false, statusCode: 404, reasonCode: "sub_session_not_found" };
    if (expectedParentRunId && expectedParentRunId !== subSession.parentRunId) {
        return { ok: false, statusCode: 403, reasonCode: "sub_session_parent_run_mismatch" };
    }
    return { ok: true, subSession };
}
export function getSubSessionInfo(subSessionId, expectedParentRunId) {
    const access = requireSubSessionAccess(subSessionId, expectedParentRunId);
    if (!access.ok)
        return access;
    const subSession = access.subSession;
    return {
        ok: true,
        info: {
            subSessionId: subSession.subSessionId,
            parentRunId: subSession.parentRunId,
            parentSessionId: subSession.parentSessionId,
            ...(subSession.parentAgentId ? { parentAgentId: subSession.parentAgentId } : {}),
            ...(subSession.parentAgentDisplayName
                ? { parentAgentDisplayName: subSession.parentAgentDisplayName }
                : {}),
            ...(subSession.parentAgentNickname
                ? { parentAgentNickname: subSession.parentAgentNickname }
                : {}),
            agentId: subSession.agentId,
            agentDisplayName: subSession.agentDisplayName,
            ...(subSession.agentNickname ? { agentNickname: subSession.agentNickname } : {}),
            commandRequestId: subSession.commandRequestId,
            status: subSession.status,
            retryBudgetRemaining: subSession.retryBudgetRemaining,
            promptBundleId: subSession.promptBundleId,
            idempotencyKey: subSession.identity.idempotencyKey,
            ...(subSession.identity.auditCorrelationId
                ? { auditCorrelationId: subSession.identity.auditCorrelationId }
                : {}),
            ...(subSession.startedAt !== undefined ? { startedAt: subSession.startedAt } : {}),
            ...(subSession.finishedAt !== undefined ? { finishedAt: subSession.finishedAt } : {}),
            ...(subSession.promptBundleSnapshot
                ? {
                    promptBundle: {
                        bundleId: subSession.promptBundleSnapshot.bundleId,
                        agentId: subSession.promptBundleSnapshot.agentId,
                        agentType: subSession.promptBundleSnapshot.agentType,
                        ...(subSession.promptBundleSnapshot.cacheKey
                            ? { cacheKey: subSession.promptBundleSnapshot.cacheKey }
                            : {}),
                        ...(subSession.promptBundleSnapshot.promptChecksum
                            ? { promptChecksum: subSession.promptBundleSnapshot.promptChecksum }
                            : {}),
                        ...(subSession.promptBundleSnapshot.profileVersionSnapshot !== undefined
                            ? { profileVersionSnapshot: subSession.promptBundleSnapshot.profileVersionSnapshot }
                            : {}),
                        ...(subSession.promptBundleSnapshot.validation
                            ? { validation: subSession.promptBundleSnapshot.validation }
                            : {}),
                    },
                }
                : {}),
        },
    };
}
function runEventLogs(parentRunId, subSessionId, limit) {
    if (!getRootRun(parentRunId))
        return [];
    return getDb()
        .prepare(`SELECT id, at, label
       FROM run_events
       WHERE run_id = ? AND label LIKE ?
       ORDER BY at DESC, id DESC
       LIMIT ?`)
        .all(parentRunId, `%${subSessionId}%`, limit)
        .map((row) => ({
        id: row.id,
        at: row.at,
        kind: "run_event",
        summary: sanitizeSubSessionControlText(row.label),
    }));
}
function controlEventLogs(parentRunId, subSessionId, limit) {
    return getDb()
        .prepare(`SELECT id, created_at, event_type, summary, detail_json
       FROM control_events
       WHERE run_id = ? AND component = ? AND detail_json LIKE ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`)
        .all(parentRunId, "subsession.control", `%${subSessionId}%`, limit)
        .map((row) => {
        let detail;
        try {
            detail = row.detail_json ? JSON.parse(row.detail_json) : undefined;
        }
        catch {
            detail = row.detail_json;
        }
        return {
            id: row.id,
            at: row.created_at,
            kind: "control_event",
            eventType: row.event_type,
            summary: sanitizeSubSessionControlText(row.summary),
            ...(detail !== undefined ? { detail: sanitizeDetail(detail) } : {}),
        };
    });
}
export function listSubSessionLogs(input) {
    const access = requireSubSessionAccess(input.subSessionId, input.parentRunId);
    if (!access.ok)
        return access;
    const limit = boundedLimit(input.limit);
    const logs = [
        ...runEventLogs(access.subSession.parentRunId, input.subSessionId, limit),
        ...controlEventLogs(access.subSession.parentRunId, input.subSessionId, limit),
    ]
        .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
        .slice(-limit);
    return { ok: true, logs };
}
function controlTextFor(action, body) {
    const record = isRecord(body) ? body : {};
    return (trimmedString(record.message) ??
        trimmedString(record.instruction) ??
        trimmedString(record.summary) ??
        `${action} requested`);
}
function feedbackLoopResult(subSession, action, body, auditCorrelationId) {
    if (subSession.retryBudgetRemaining <= 0) {
        return { ok: false, statusCode: 409, reasonCode: "sub_session_feedback_budget_exhausted" };
    }
    if (subSession.status !== "needs_revision" && subSession.status !== "failed") {
        return { ok: false, statusCode: 409, reasonCode: "sub_session_feedback_state_invalid" };
    }
    const record = isRecord(body) ? body : {};
    const resultReport = parseControlResultReport(record.resultReport, subSession);
    if (!resultReport.ok) {
        return { ok: false, statusCode: 409, reasonCode: resultReport.reasonCode };
    }
    const expectedOutputs = expectedOutputsForSubSession(subSession);
    const previousFailureKeys = stringArray(record.previousFailureKeys);
    const review = reviewSubAgentResult({
        resultReport: resultReport.resultReport,
        expectedOutputs,
        retryBudgetRemaining: subSession.retryBudgetRemaining,
        previousFailureKeys,
        additionalContextRefs: stringArray(record.additionalContextRefs),
        now: nowMs,
    });
    const continuation = decideFeedbackLoopContinuation({
        review,
        retryBudgetRemaining: subSession.retryBudgetRemaining,
        previousFailureKeys,
    });
    if (continuation.action === "limited_success_finalized") {
        const controlEventId = recordSubSessionControlEvent({
            eventType: `subsession.${action}.limited_success_finalized`,
            parentRunId: subSession.parentRunId,
            subSessionId: subSession.subSessionId,
            action,
            summary: `sub-session ${action} ended as limited success: ${subSession.subSessionId}`,
            auditCorrelationId,
            detail: {
                verdict: review.verdict,
                parentIntegrationStatus: review.parentIntegrationStatus,
            },
        });
        appendTimeline(subSession.parentRunId, `sub_session_limited_success_finalized:${subSession.subSessionId}`);
        return {
            ok: true,
            accepted: true,
            action,
            subSessionId: subSession.subSessionId,
            parentRunId: subSession.parentRunId,
            status: subSession.status,
            reasonCode: continuation.reasonCode,
            controlEventId,
        };
    }
    if (continuation.action !== "feedback_request") {
        return { ok: false, statusCode: 409, reasonCode: continuation.reasonCode };
    }
    const targetAgentId = action === "redelegate" ? trimmedString(record.targetAgentId) : subSession.agentId;
    const targetAgentNickname = action === "redelegate" ? trimmedString(record.targetAgentNickname) : subSession.agentNickname;
    const targetAgentDisplayName = trimmedString(record.targetAgentDisplayName) ?? targetAgentNickname ?? targetAgentId;
    const targetAgentPolicy = action === "redelegate" ? "alternative_direct_child" : "same_agent";
    const validation = validateRedelegationTarget({
        policy: targetAgentPolicy,
        currentAgentId: subSession.agentId,
        ...(subSession.parentAgentId ? { parentAgentId: subSession.parentAgentId } : {}),
        ...(targetAgentId ? { targetAgentId } : {}),
        ...(subSession.parentAgentId
            ? { directChildAgentIds: directChildAgentIds(subSession.parentAgentId) }
            : {}),
        permissionAllowed: record.permissionAllowed !== false,
        capabilityAllowed: record.capabilityAllowed !== false,
        modelAvailable: record.modelAvailable !== false,
        resourceLocksAvailable: record.resourceLocksAvailable !== false,
    });
    if (!validation.ok) {
        return {
            ok: false,
            statusCode: 409,
            reasonCode: validation.reasonCodes[0] ?? "redelegation_target_invalid",
        };
    }
    const feedbackPackage = buildFeedbackLoopPackage({
        resultReports: [resultReport.resultReport],
        review,
        expectedOutputs,
        targetAgentPolicy,
        ...(targetAgentId ? { targetAgentId } : {}),
        ...(targetAgentNickname ? { targetAgentNicknameSnapshot: targetAgentNickname } : {}),
        ...(subSession.parentAgentId ? { requestingAgentId: subSession.parentAgentId } : {}),
        ...(subSession.parentAgentNickname
            ? { requestingAgentNicknameSnapshot: subSession.parentAgentNickname }
            : {}),
        parentRunId: subSession.parentRunId,
        parentSessionId: subSession.parentSessionId,
        ...(subSession.identity.parent?.parentRequestId
            ? { parentRequestId: subSession.identity.parent.parentRequestId }
            : {}),
        previousSubSessionIds: [subSession.subSessionId],
        conflictItems: stringArray(record.conflictItems),
        additionalConstraints: uniqueStrings([
            ...stringArray(record.additionalConstraints),
            controlTextFor(action, body),
        ]),
        additionalContextRefs: stringArray(record.additionalContextRefs),
        retryBudgetRemaining: review.feedbackRequest?.retryBudgetRemaining ??
            Math.max(0, subSession.retryBudgetRemaining - 1),
        idProvider: () => trimmedString(record.feedbackRequestId) ?? randomUUID(),
        now: nowMs,
    });
    let redelegatedSubSessionId;
    if (action === "redelegate" && targetAgentId) {
        const requestedRedelegatedSubSessionId = trimmedString(record.redelegatedSubSessionId);
        const redelegatedInput = buildRedelegatedSubSessionInput({
            sourceSubSession: subSession,
            feedbackRequest: feedbackPackage.feedbackRequest,
            targetAgentId,
            ...(targetAgentDisplayName ? { targetAgentDisplayName } : {}),
            ...(targetAgentNickname ? { targetAgentNickname } : {}),
            ...(requestedRedelegatedSubSessionId
                ? { subSessionId: requestedRedelegatedSubSessionId }
                : {}),
        });
        const ack = spawnSubSessionAck({ input: redelegatedInput, auditCorrelationId });
        if (!ack.ok) {
            return { ok: false, statusCode: 409, reasonCode: ack.reasonCode };
        }
        redelegatedSubSessionId = ack.subSessionId;
    }
    const controlEventId = recordSubSessionControlEvent({
        eventType: `subsession.${action}.feedback_request_created`,
        parentRunId: subSession.parentRunId,
        subSessionId: subSession.subSessionId,
        action,
        summary: `sub-session ${action} feedback request created: ${subSession.subSessionId}`,
        auditCorrelationId,
        detail: {
            feedbackRequestId: feedbackPackage.feedbackRequest.feedbackRequestId,
            synthesizedContextExchangeId: feedbackPackage.synthesizedContext.exchangeId,
            targetAgentPolicy,
            targetAgentId: targetAgentId ?? null,
            retryBudgetRemaining: feedbackPackage.feedbackRequest.retryBudgetRemaining,
            normalizedFailureKey: review.normalizedFailureKey ?? null,
            ...(redelegatedSubSessionId ? { redelegatedSubSessionId } : {}),
        },
    });
    appendTimeline(subSession.parentRunId, `sub_session_${action}_feedback_created:${subSession.subSessionId}:${feedbackPackage.feedbackRequest.feedbackRequestId}`);
    return {
        ok: true,
        accepted: true,
        action,
        subSessionId: subSession.subSessionId,
        ...(redelegatedSubSessionId ? { redelegatedSubSessionId } : {}),
        parentRunId: subSession.parentRunId,
        status: subSession.status,
        reasonCode: action === "redelegate" ? "redelegation_queued" : "feedback_request_created",
        controlEventId,
        feedbackRequest: feedbackPackage.feedbackRequest,
        synthesizedContextExchangeId: feedbackPackage.synthesizedContext.exchangeId,
    };
}
function parseControlResultReport(value, subSession) {
    if (!value)
        return { ok: false, reasonCode: "result_report_required_for_feedback_loop" };
    const validation = validateResultReport(value);
    if (!validation.ok)
        return { ok: false, reasonCode: "invalid_result_report" };
    if (validation.value.parentRunId !== subSession.parentRunId) {
        return { ok: false, reasonCode: "result_report_parent_run_mismatch" };
    }
    if (validation.value.subSessionId !== subSession.subSessionId) {
        return { ok: false, reasonCode: "result_report_sub_session_mismatch" };
    }
    return { ok: true, resultReport: validation.value };
}
function expectedOutputsForSubSession(subSession) {
    return subSession.promptBundleSnapshot?.completionCriteria?.length
        ? subSession.promptBundleSnapshot.completionCriteria
        : (subSession.promptBundleSnapshot?.taskScope.expectedOutputs ?? []);
}
function stringArray(value) {
    if (!Array.isArray(value))
        return [];
    return uniqueStrings(value.filter((item) => typeof item === "string"));
}
function uniqueStrings(values) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
function directChildAgentIds(parentAgentId) {
    return listAgentRelationships({ parentAgentId, status: "active" }).map((relationship) => relationship.child_agent_id);
}
export function controlSubSession(input) {
    const access = requireSubSessionAccess(input.subSessionId, input.parentRunId);
    if (!access.ok)
        return access;
    const subSession = access.subSession;
    const record = isRecord(input.body) ? input.body : {};
    const auditCorrelationId = trimmedString(record.auditCorrelationId) ?? subSession.identity.auditCorrelationId;
    if (input.action === "feedback" || input.action === "redelegate") {
        return feedbackLoopResult(subSession, input.action, input.body, auditCorrelationId);
    }
    if (input.action === "retry") {
        if (!TERMINAL_STATUSES.has(subSession.status) ||
            subSession.status === "completed" ||
            subSession.status === "cancelled") {
            return { ok: false, statusCode: 409, reasonCode: "sub_session_retry_state_invalid" };
        }
        if (subSession.retryBudgetRemaining <= 0) {
            return { ok: false, statusCode: 409, reasonCode: "sub_session_retry_budget_exhausted" };
        }
        const controlEventId = recordSubSessionControlEvent({
            eventType: "subsession.retry.validated",
            parentRunId: subSession.parentRunId,
            subSessionId: subSession.subSessionId,
            action: "retry",
            summary: `sub-session retry validated: ${subSession.subSessionId}`,
            auditCorrelationId,
            detail: { retryBudgetRemaining: subSession.retryBudgetRemaining },
        });
        appendTimeline(subSession.parentRunId, `sub_session_retry_validated:${subSession.subSessionId}`);
        return {
            ok: true,
            accepted: true,
            action: "retry",
            subSessionId: subSession.subSessionId,
            parentRunId: subSession.parentRunId,
            status: subSession.status,
            reasonCode: "retry_validated_not_started",
            controlEventId,
        };
    }
    if (input.action === "cancel" || input.action === "kill") {
        if (!ACTIVE_CONTROL_STATUSES.has(subSession.status)) {
            return { ok: false, statusCode: 409, reasonCode: "sub_session_not_active" };
        }
        if (!canTransitionSubSessionStatus(subSession.status, "cancelled")) {
            return { ok: false, statusCode: 409, reasonCode: "sub_session_transition_blocked" };
        }
        transitionSubSessionStatus(subSession, "cancelled", nowMs());
        updateRunSubSession(subSession);
        const controlEventId = recordSubSessionControlEvent({
            eventType: input.action === "kill" ? "subsession.kill.accepted" : "subsession.cancel.accepted",
            parentRunId: subSession.parentRunId,
            subSessionId: subSession.subSessionId,
            action: input.action,
            summary: `sub-session ${input.action} accepted: ${subSession.subSessionId}`,
            severity: input.action === "kill" ? "warning" : "info",
            auditCorrelationId,
            detail: { reason: controlTextFor(input.action, input.body) },
        });
        appendTimeline(subSession.parentRunId, `sub_session_${input.action}_accepted:${subSession.subSessionId}`);
        return {
            ok: true,
            accepted: true,
            action: input.action,
            subSessionId: subSession.subSessionId,
            parentRunId: subSession.parentRunId,
            status: "cancelled",
            reasonCode: `sub_session_${input.action}_accepted`,
            controlEventId,
        };
    }
    if (!ACTIVE_CONTROL_STATUSES.has(subSession.status)) {
        return { ok: false, statusCode: 409, reasonCode: "sub_session_not_active" };
    }
    const controlEventId = recordSubSessionControlEvent({
        eventType: `subsession.${input.action}.accepted`,
        parentRunId: subSession.parentRunId,
        subSessionId: subSession.subSessionId,
        action: input.action,
        summary: `sub-session ${input.action} accepted: ${subSession.subSessionId}`,
        auditCorrelationId,
        detail: {
            text: controlTextFor(input.action, input.body),
            clientControlId: trimmedString(record.clientControlId) ?? randomUUID(),
        },
    });
    appendTimeline(subSession.parentRunId, `sub_session_${input.action}:${subSession.subSessionId}`);
    return {
        ok: true,
        accepted: true,
        action: input.action,
        subSessionId: subSession.subSessionId,
        parentRunId: subSession.parentRunId,
        status: subSession.status,
        reasonCode: `sub_session_${input.action}_accepted`,
        controlEventId,
    };
}
export function killAllSubSessionsForRun(input) {
    const auditCorrelationId = isRecord(input.body)
        ? trimmedString(input.body.auditCorrelationId)
        : undefined;
    const affected = [];
    for (const row of listRunSubSessionsForParentRun(input.parentRunId)) {
        const subSession = parseSubSessionRow(row);
        if (!subSession || !ACTIVE_CONTROL_STATUSES.has(subSession.status))
            continue;
        if (!canTransitionSubSessionStatus(subSession.status, "cancelled"))
            continue;
        transitionSubSessionStatus(subSession, "cancelled", nowMs());
        updateRunSubSession(subSession);
        affected.push(subSession.subSessionId);
    }
    const controlEventId = recordSubSessionControlEvent({
        eventType: "subsession.kill_all.accepted",
        parentRunId: input.parentRunId,
        action: "kill_all",
        summary: `sub-session kill-all accepted: ${affected.length} active child session(s)`,
        severity: affected.length > 0 ? "warning" : "info",
        auditCorrelationId,
        detail: { affectedSubSessionIds: affected },
    });
    if (affected.length > 0) {
        appendTimeline(input.parentRunId, `sub_session_kill_all:${affected.join(",")}`);
    }
    return {
        ok: true,
        accepted: true,
        action: "kill_all",
        parentRunId: input.parentRunId,
        reasonCode: "sub_session_kill_all_accepted",
        controlEventId,
        affectedSubSessionIds: affected,
    };
}
//# sourceMappingURL=sub-session-control.js.map