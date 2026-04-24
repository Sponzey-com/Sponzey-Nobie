import { listAgentDataExchangesForRecipient, listAgentDataExchangesForSource, listMessageLedgerEvents, listOrchestrationEvents, listRunSubSessionsForParentRun, } from "../db/index.js";
import { redactUiValue } from "../ui/redaction.js";
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
const FINALIZER_EVENT_PRECEDENCE = {
    not_started: 0,
    generated: 1,
    suppressed: 2,
    failed: 3,
    delivered: 4,
};
const PRIVATE_MEMORY_PATTERN = /[^\n.]*private raw memory[^\n.]*/giu;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseJsonRecord(value) {
    if (!value)
        return {};
    try {
        const parsed = JSON.parse(value);
        return isRecord(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
function parseJsonArray(value) {
    if (!value)
        return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
function redactedRecord(value) {
    return redactUiValue(value, { audience: "advanced" }).value;
}
function redactedText(value, fallback = "") {
    const raw = typeof value === "string" ? value : fallback;
    const redacted = redactUiValue(raw, { audience: "advanced" }).value.replace(PRIVATE_MEMORY_PATTERN, "[private memory redacted]");
    return redacted.length > 600 ? `${redacted.slice(0, 597)}...` : redacted;
}
function stringValue(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function numberValue(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function booleanValue(value) {
    return typeof value === "boolean" ? value : undefined;
}
function stringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .map((item) => (typeof item === "string" ? redactedText(item) : undefined))
        .filter((item) => Boolean(item));
}
function recordArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter(isRecord);
}
function safeCount(value) {
    const explicit = numberValue(value);
    if (explicit !== undefined)
        return Math.max(0, Math.floor(explicit));
    if (Array.isArray(value))
        return value.length;
    return undefined;
}
function subSessionIdFromDetail(detail) {
    return stringValue(detail.subSessionId) ?? stringValue(detail.sub_session_id);
}
function agentIdFromDetail(detail) {
    return stringValue(detail.agentId) ?? stringValue(detail.agent_id);
}
function exchangeIdFromDetail(detail) {
    return stringValue(detail.exchangeId) ?? stringValue(detail.exchange_id);
}
function approvalIdFromDetail(detail) {
    return stringValue(detail.approvalId) ?? stringValue(detail.approval_id);
}
function parseSubSessionContract(row) {
    const parsed = parseJsonRecord(row.contract_json);
    return stringValue(parsed.subSessionId) ? parsed : undefined;
}
function fallbackSubSessionContract(row) {
    return {
        identity: {
            schemaVersion: 1,
            entityType: "sub_session",
            entityId: row.sub_session_id,
            owner: { ownerType: "sub_agent", ownerId: row.agent_id },
            idempotencyKey: row.idempotency_key,
            ...(row.audit_id ? { auditCorrelationId: row.audit_id } : {}),
            parent: {
                parentRunId: row.parent_run_id,
                ...(row.parent_request_id ? { parentRequestId: row.parent_request_id } : {}),
                ...(row.parent_sub_session_id ? { parentSubSessionId: row.parent_sub_session_id } : {}),
            },
        },
        subSessionId: row.sub_session_id,
        parentSessionId: row.parent_session_id,
        parentRunId: row.parent_run_id,
        agentId: row.agent_id,
        agentDisplayName: row.agent_display_name,
        ...(row.agent_nickname ? { agentNickname: row.agent_nickname } : {}),
        commandRequestId: row.command_request_id,
        status: row.status,
        retryBudgetRemaining: row.retry_budget_remaining,
        promptBundleId: row.prompt_bundle_id,
        ...(row.started_at ? { startedAt: row.started_at } : {}),
        ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    };
}
function contractFromRow(row) {
    return parseSubSessionContract(row) ?? fallbackSubSessionContract(row);
}
function expectedOutputProjection(output) {
    return {
        outputId: redactedText(output.outputId),
        kind: output.kind,
        required: output.required,
        description: redactedText(output.description),
        acceptanceReasonCodes: output.acceptance.reasonCodes.map((code) => redactedText(code)),
    };
}
function expectedOutputsFor(contract) {
    const fromTaskScope = contract.promptBundleSnapshot?.taskScope.expectedOutputs ?? [];
    const fromCompletionCriteria = contract.promptBundleSnapshot?.completionCriteria ?? [];
    const source = fromTaskScope.length > 0 ? fromTaskScope : fromCompletionCriteria;
    return source.map(expectedOutputProjection);
}
function commandSummaryFor(contract) {
    const taskScope = contract.promptBundleSnapshot?.taskScope;
    return redactedText(taskScope?.goal, `${contract.agentNickname ?? contract.agentDisplayName} ${contract.commandRequestId}`);
}
function modelProjectionFrom(value) {
    const record = isRecord(value) ? value : undefined;
    if (!record)
        return undefined;
    const nestedSnapshot = isRecord(record.snapshot) ? record.snapshot : undefined;
    const source = nestedSnapshot ?? record;
    const providerId = stringValue(source.providerId);
    const modelId = stringValue(source.modelId);
    if (!providerId || !modelId)
        return undefined;
    const fallbackFromModelId = stringValue(source.fallbackFromModelId);
    const fallbackReasonCode = stringValue(source.fallbackReasonCode);
    const effort = stringValue(source.effort);
    const attemptCount = numberValue(source.attemptCount);
    const latencyMs = numberValue(source.latencyMs);
    const status = stringValue(source.status);
    return {
        providerId: redactedText(providerId),
        modelId: redactedText(modelId),
        fallbackApplied: booleanValue(source.fallbackApplied) ?? false,
        ...(fallbackFromModelId ? { fallbackFromModelId: redactedText(fallbackFromModelId) } : {}),
        ...(fallbackReasonCode ? { fallbackReasonCode: redactedText(fallbackReasonCode) } : {}),
        ...(effort ? { effort: redactedText(effort) } : {}),
        retryCount: numberValue(source.retryCount) ?? 0,
        ...(attemptCount !== undefined ? { attemptCount } : {}),
        estimatedInputTokens: numberValue(source.estimatedInputTokens) ?? 0,
        estimatedOutputTokens: numberValue(source.estimatedOutputTokens) ?? 0,
        estimatedCost: numberValue(source.estimatedCost) ?? 0,
        ...(latencyMs !== undefined ? { latencyMs } : {}),
        ...(status ? { status: redactedText(status) } : {}),
    };
}
function modelFor(contract, ledgerEvents) {
    const fromLedger = [...ledgerEvents].reverse().find((event) => {
        const detail = parseJsonRecord(event.detail_json);
        return (subSessionIdFromDetail(detail) === contract.subSessionId && isRecord(detail.modelExecution));
    });
    const ledgerDetail = fromLedger ? parseJsonRecord(fromLedger.detail_json) : undefined;
    return (modelProjectionFrom(ledgerDetail?.modelExecution) ??
        modelProjectionFrom(contract.modelExecutionSnapshot));
}
function allowedControlActionsFor(status, retryBudgetRemaining) {
    if (ACTIVE_CONTROL_STATUSES.has(status)) {
        return [
            { action: "send", reasonCode: "sub_session_active_control_allowed" },
            { action: "steer", reasonCode: "sub_session_active_control_allowed" },
            { action: "cancel", reasonCode: "sub_session_active_control_allowed" },
            { action: "kill", reasonCode: "sub_session_active_control_allowed" },
        ];
    }
    if (TERMINAL_STATUSES.has(status) &&
        status !== "completed" &&
        status !== "cancelled" &&
        retryBudgetRemaining > 0) {
        return [
            { action: "retry", reasonCode: "sub_session_retry_state_allowed" },
            { action: "feedback", reasonCode: "sub_session_feedback_state_allowed" },
            { action: "redelegate", reasonCode: "sub_session_feedback_state_allowed" },
        ];
    }
    return [];
}
function progressFor(subSessionId, ledgerEvents, orchestrationEvents) {
    const items = [];
    for (const event of ledgerEvents) {
        if (event.event_kind !== "sub_session_progress_summarized")
            continue;
        const detail = parseJsonRecord(event.detail_json);
        for (const item of recordArray(detail.items)) {
            if (subSessionIdFromDetail(item) !== subSessionId)
                continue;
            items.push({
                eventId: `${event.id}:${items.length}`,
                at: numberValue(item.at) ?? event.created_at,
                status: redactedText(item.status, event.status),
                summary: redactedText(item.summary, event.summary),
            });
        }
    }
    for (const event of orchestrationEvents) {
        if (event.sub_session_id !== subSessionId ||
            event.event_kind !== "sub_session_progress_reported") {
            continue;
        }
        items.push({
            eventId: event.id,
            at: event.emitted_at || event.created_at,
            status: redactedText(event.severity),
            summary: redactedText(event.summary),
        });
    }
    return items
        .sort((left, right) => left.at - right.at || left.eventId.localeCompare(right.eventId))
        .slice(-20);
}
function resultFor(subSessionId, ledgerEvents, orchestrationEvents) {
    const resultEvent = [...orchestrationEvents].reverse().find((event) => {
        if (event.event_kind !== "result_reported")
            return false;
        return event.sub_session_id === subSessionId;
    });
    const ledgerEvent = [...ledgerEvents].reverse().find((event) => {
        if (event.event_kind !== "sub_session_completed" &&
            event.event_kind !== "sub_session_failed" &&
            event.event_kind !== "sub_session_result_suppressed") {
            return false;
        }
        return subSessionIdFromDetail(parseJsonRecord(event.detail_json)) === subSessionId;
    });
    if (!resultEvent && !ledgerEvent)
        return undefined;
    const payload = resultEvent
        ? redactedRecord(parseJsonRecord(resultEvent.payload_redacted_json))
        : {};
    const ledgerDetail = ledgerEvent ? redactedRecord(parseJsonRecord(ledgerEvent.detail_json)) : {};
    const risksOrGaps = [
        ...stringArray(payload.risksOrGaps),
        ...stringArray(ledgerDetail.risksOrGaps),
    ];
    const resultReportId = stringValue(payload.resultReportId) ??
        stringValue(ledgerDetail.resultReportId) ??
        stringValue(payload.result_report_id);
    const impossibleReason = isRecord(payload.impossibleReason)
        ? payload.impossibleReason
        : isRecord(ledgerDetail.impossibleReason)
            ? ledgerDetail.impossibleReason
            : undefined;
    const status = stringValue(payload.status);
    const outputCount = safeCount(payload.outputCount ?? payload.outputs ?? ledgerDetail.outputCount);
    const artifactCount = safeCount(payload.artifactCount ?? payload.artifacts ?? ledgerDetail.artifactCount);
    const riskOrGapCount = safeCount(payload.riskOrGapCount ?? payload.risksOrGaps ?? ledgerDetail.riskOrGapCount);
    const impossibleReasonKind = stringValue(impossibleReason?.kind);
    return {
        ...(resultReportId ? { resultReportId: redactedText(resultReportId) } : {}),
        ...(status ? { status: redactedText(status) } : {}),
        ...(outputCount !== undefined ? { outputCount } : {}),
        ...(artifactCount !== undefined ? { artifactCount } : {}),
        ...(riskOrGapCount !== undefined ? { riskOrGapCount } : {}),
        risksOrGaps,
        ...(ledgerEvent?.summary ? { summary: redactedText(ledgerEvent.summary) } : {}),
        ...(impossibleReasonKind ? { impossibleReasonKind: redactedText(impossibleReasonKind) } : {}),
    };
}
function reviewFor(subSessionId, orchestrationEvents) {
    const event = [...orchestrationEvents]
        .reverse()
        .find((item) => item.event_kind === "result_reviewed" && item.sub_session_id === subSessionId);
    if (!event)
        return undefined;
    const payload = redactedRecord(parseJsonRecord(event.payload_redacted_json));
    const resultReportId = stringValue(payload.resultReportId);
    const status = stringValue(payload.status);
    const verdict = stringValue(payload.verdict);
    const parentIntegrationStatus = stringValue(payload.parentIntegrationStatus);
    const accepted = booleanValue(payload.accepted);
    const normalizedFailureKey = stringValue(payload.normalizedFailureKey);
    return {
        ...(resultReportId ? { resultReportId: redactedText(resultReportId) } : {}),
        ...(status ? { status: redactedText(status) } : {}),
        ...(verdict ? { verdict: redactedText(verdict) } : {}),
        ...(parentIntegrationStatus
            ? { parentIntegrationStatus: redactedText(parentIntegrationStatus) }
            : {}),
        ...(accepted !== undefined ? { accepted } : {}),
        issueCodes: stringArray(payload.issueCodes),
        ...(normalizedFailureKey ? { normalizedFailureKey: redactedText(normalizedFailureKey) } : {}),
        risksOrGaps: stringArray(payload.risksOrGaps),
    };
}
function feedbackFor(subSessionId, orchestrationEvents, runEvents) {
    const event = [...orchestrationEvents]
        .reverse()
        .find((item) => item.sub_session_id === subSessionId &&
        (item.event_kind === "feedback_requested" || item.event_kind === "redelegation_requested"));
    if (event) {
        const payload = redactedRecord(parseJsonRecord(event.payload_redacted_json));
        const feedbackRequestId = stringValue(payload.feedbackRequestId);
        const targetAgentId = stringValue(payload.targetAgentId);
        const targetAgentNickname = stringValue(payload.targetAgentNicknameSnapshot);
        const reasonCode = stringValue(payload.reasonCode);
        const missingItemCount = safeCount(payload.missingItems);
        const requiredChangeCount = safeCount(payload.requiredChanges);
        return {
            status: event.event_kind === "redelegation_requested" ? "redelegation_requested" : "requested",
            ...(feedbackRequestId ? { feedbackRequestId: redactedText(feedbackRequestId) } : {}),
            ...(targetAgentId ? { targetAgentId: redactedText(targetAgentId) } : {}),
            ...(targetAgentNickname ? { targetAgentNickname: redactedText(targetAgentNickname) } : {}),
            ...(reasonCode ? { reasonCode: redactedText(reasonCode) } : {}),
            ...(missingItemCount !== undefined ? { missingItemCount } : {}),
            ...(requiredChangeCount !== undefined ? { requiredChangeCount } : {}),
        };
    }
    const parentEvent = [...runEvents]
        .reverse()
        .find((item) => item.label.startsWith(`sub_session_feedback_requested:${subSessionId}:`));
    if (parentEvent) {
        return {
            status: "requested",
            reasonCode: redactedText(parentEvent.label.split(":").at(2), "unknown"),
        };
    }
    return { status: "none" };
}
function approvalStatusFrom(value) {
    const status = stringValue(value);
    if (!status)
        return "required";
    if (status === "approved" ||
        status === "approved_once" ||
        status === "approved_run" ||
        status === "consumed") {
        return "approved";
    }
    if (status === "denied" || status === "expired" || status === "superseded")
        return "denied";
    if (status === "requested" || status === "pending")
        return "pending";
    return "required";
}
function collectApprovals(orchestrationEvents, ledgerEvents) {
    const byId = new Map();
    const setApproval = (approval) => {
        const previous = byId.get(approval.approvalId);
        if (!previous || previous.at <= approval.at)
            byId.set(approval.approvalId, approval);
    };
    for (const event of orchestrationEvents) {
        if (!event.event_kind.startsWith("approval_"))
            continue;
        const payload = redactedRecord(parseJsonRecord(event.payload_redacted_json));
        const approvals = recordArray(payload.approvals);
        if (approvals.length > 0) {
            for (const item of approvals) {
                const approvalId = stringValue(item.approvalId) ?? event.approval_id;
                if (!approvalId)
                    continue;
                setApproval({
                    approvalId: redactedText(approvalId),
                    status: approvalStatusFrom(item.status),
                    ...(stringValue(item.subSessionId)
                        ? { subSessionId: redactedText(item.subSessionId) }
                        : {}),
                    ...(stringValue(item.agentId) ? { agentId: redactedText(item.agentId) } : {}),
                    summary: redactedText(item.summary, event.summary),
                    at: event.emitted_at || event.created_at,
                });
            }
            continue;
        }
        const approvalId = event.approval_id ?? stringValue(payload.approvalId);
        if (approvalId) {
            setApproval({
                approvalId: redactedText(approvalId),
                status: approvalStatusFrom(payload.status),
                ...(event.sub_session_id ? { subSessionId: redactedText(event.sub_session_id) } : {}),
                ...(event.agent_id ? { agentId: redactedText(event.agent_id) } : {}),
                summary: redactedText(event.summary),
                at: event.emitted_at || event.created_at,
            });
        }
    }
    for (const event of ledgerEvents) {
        if (event.event_kind !== "approval_aggregated" && event.event_kind !== "approval_requested") {
            continue;
        }
        const detail = redactedRecord(parseJsonRecord(event.detail_json));
        for (const item of recordArray(detail.approvals)) {
            const approvalId = stringValue(item.approvalId);
            if (!approvalId)
                continue;
            setApproval({
                approvalId: redactedText(approvalId),
                status: approvalStatusFrom(item.status),
                ...(stringValue(item.subSessionId)
                    ? { subSessionId: redactedText(item.subSessionId) }
                    : {}),
                ...(stringValue(item.agentId) ? { agentId: redactedText(item.agentId) } : {}),
                summary: redactedText(item.summary, event.summary),
                at: event.created_at,
            });
        }
    }
    return [...byId.values()].sort((left, right) => left.at - right.at);
}
function approvalStateForSubSession(subSession, approvals, plan) {
    const related = approvals.filter((item) => item.subSessionId === subSession.subSessionId ||
        item.agentId === subSession.agentId ||
        item.summary.includes(subSession.subSessionId));
    const latest = related.at(-1);
    if (latest)
        return latest.status;
    if (subSession.status === "awaiting_approval")
        return "pending";
    const planRequiresApproval = plan?.approvalRequirements.some((requirement) => requirement.agentId === subSession.agentId);
    return planRequiresApproval ? "required" : "not_required";
}
function dataExchangeProjection(row) {
    return {
        exchangeId: redactedText(row.exchange_id),
        sourceOwnerId: redactedText(row.source_owner_id),
        ...(row.source_nickname_snapshot
            ? { sourceNickname: redactedText(row.source_nickname_snapshot) }
            : {}),
        recipientOwnerId: redactedText(row.recipient_owner_id),
        ...(row.recipient_nickname_snapshot
            ? { recipientNickname: redactedText(row.recipient_nickname_snapshot) }
            : {}),
        purpose: redactedText(row.purpose),
        allowedUse: row.allowed_use,
        retentionPolicy: row.retention_policy,
        redactionState: row.redaction_state,
        provenanceCount: parseJsonArray(row.provenance_refs_json).length,
        createdAt: row.created_at,
        ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    };
}
function collectDataExchanges(subSessions, now) {
    const byId = new Map();
    for (const subSession of subSessions) {
        const owner = { ownerType: "sub_agent", ownerId: subSession.agentId };
        for (const row of listAgentDataExchangesForSource(owner, {
            includeExpired: true,
            limit: 100,
            now,
        })) {
            byId.set(row.exchange_id, row);
        }
        for (const row of listAgentDataExchangesForRecipient(owner, {
            includeExpired: true,
            limit: 100,
            now,
        })) {
            byId.set(row.exchange_id, row);
        }
    }
    return [...byId.values()]
        .sort((left, right) => left.created_at - right.created_at || left.exchange_id.localeCompare(right.exchange_id))
        .map(dataExchangeProjection);
}
function planProjection(plan) {
    const directTasks = plan?.directNobieTasks ?? [];
    const delegatedTasks = plan?.delegatedTasks ?? [];
    const taskSummaries = [...directTasks, ...delegatedTasks].slice(0, 12).map((task) => ({
        taskId: redactedText(task.taskId),
        executionKind: redactedText(task.executionKind),
        goal: redactedText(task.scope.goal),
        ...(task.assignedAgentId ? { assignedAgentId: redactedText(task.assignedAgentId) } : {}),
        ...(task.assignedTeamId ? { assignedTeamId: redactedText(task.assignedTeamId) } : {}),
        reasonCodes: task.scope.reasonCodes.map((code) => redactedText(code)),
    }));
    return {
        ...(plan?.planId ? { planId: redactedText(plan.planId) } : {}),
        ...(plan?.parentRequestId ? { parentRequestId: redactedText(plan.parentRequestId) } : {}),
        ...(plan?.createdAt !== undefined ? { createdAt: plan.createdAt } : {}),
        ...(plan?.plannerMetadata?.status
            ? { plannerStatus: redactedText(plan.plannerMetadata.status) }
            : {}),
        directTaskCount: directTasks.length,
        delegatedTaskCount: delegatedTasks.length,
        approvalRequirementCount: plan?.approvalRequirements.length ?? 0,
        resourceLockCount: plan?.resourceLocks.length ?? 0,
        parallelGroupCount: plan?.parallelGroups.length ?? 0,
        ...(plan?.fallbackStrategy.mode
            ? { fallbackMode: redactedText(plan.fallbackStrategy.mode) }
            : {}),
        ...(plan?.fallbackStrategy.reasonCode
            ? { fallbackReasonCode: redactedText(plan.fallbackStrategy.reasonCode) }
            : {}),
        taskSummaries,
    };
}
function timelineFromRunEvent(event) {
    return {
        id: event.id,
        at: event.at,
        source: "run_event",
        kind: "run_event",
        summary: redactedText(event.label),
        ...(event.label.includes("sub_session_")
            ? { subSessionId: redactedText(event.label.split(":").at(1), "") }
            : {}),
    };
}
function timelineFromOrchestrationEvent(event) {
    return {
        id: event.id,
        at: event.emitted_at || event.created_at,
        source: "orchestration",
        kind: redactedText(event.event_kind),
        severity: event.severity,
        summary: redactedText(event.summary),
        ...(event.sub_session_id ? { subSessionId: redactedText(event.sub_session_id) } : {}),
        ...(event.agent_id ? { agentId: redactedText(event.agent_id) } : {}),
        ...(event.exchange_id ? { exchangeId: redactedText(event.exchange_id) } : {}),
        ...(event.approval_id ? { approvalId: redactedText(event.approval_id) } : {}),
    };
}
function timelineFromLedgerEvent(event) {
    const detail = redactedRecord(parseJsonRecord(event.detail_json));
    return {
        id: event.id,
        at: event.created_at,
        source: "message_ledger",
        kind: redactedText(event.event_kind),
        status: event.status,
        summary: redactedText(event.summary),
        ...(subSessionIdFromDetail(detail)
            ? { subSessionId: redactedText(subSessionIdFromDetail(detail)) }
            : {}),
        ...(agentIdFromDetail(detail) ? { agentId: redactedText(agentIdFromDetail(detail)) } : {}),
        ...(exchangeIdFromDetail(detail)
            ? { exchangeId: redactedText(exchangeIdFromDetail(detail)) }
            : {}),
        ...(approvalIdFromDetail(detail)
            ? { approvalId: redactedText(approvalIdFromDetail(detail)) }
            : {}),
    };
}
function mergeEventsById(events) {
    return [...new Map(events.map((event) => [event.id, event])).values()];
}
function collectTimeline(run, orchestrationEvents, ledgerEvents, limit) {
    return [
        ...run.recentEvents.map(timelineFromRunEvent),
        ...orchestrationEvents.map(timelineFromOrchestrationEvent),
        ...ledgerEvents.map(timelineFromLedgerEvent),
    ]
        .sort((left, right) => left.at - right.at || left.id.localeCompare(right.id))
        .slice(-limit);
}
function finalizerFromLedger(ledgerEvents) {
    let finalizer = {
        parentOwnedFinalAnswer: true,
        status: "not_started",
    };
    for (const event of ledgerEvents) {
        const status = event.event_kind === "final_answer_delivered"
            ? "delivered"
            : event.event_kind === "final_answer_generated"
                ? "generated"
                : event.event_kind === "final_answer_suppressed"
                    ? "suppressed"
                    : event.event_kind === "text_delivery_failed"
                        ? "failed"
                        : undefined;
        if (!status)
            continue;
        if (FINALIZER_EVENT_PRECEDENCE[status] < FINALIZER_EVENT_PRECEDENCE[finalizer.status])
            continue;
        finalizer = {
            parentOwnedFinalAnswer: true,
            status,
            ...(event.delivery_key ? { deliveryKey: redactedText(event.delivery_key) } : {}),
            ...(event.idempotency_key ? { idempotencyKey: redactedText(event.idempotency_key) } : {}),
            summary: redactedText(event.summary),
            at: event.created_at,
        };
    }
    return finalizer;
}
function collectSubSessions(run, contracts, ledgerEvents, orchestrationEvents, approvals) {
    const tree = subSessionTreeMetadata(contracts);
    return contracts.map((contract) => {
        const result = resultFor(contract.subSessionId, ledgerEvents, orchestrationEvents);
        const review = reviewFor(contract.subSessionId, orchestrationEvents);
        const model = modelFor(contract, ledgerEvents);
        const metadata = tree.get(contract.subSessionId);
        return {
            subSessionId: redactedText(contract.subSessionId),
            parentRunId: redactedText(contract.parentRunId),
            ...(contract.identity.parent?.parentSubSessionId
                ? { parentSubSessionId: redactedText(contract.identity.parent.parentSubSessionId) }
                : {}),
            childSubSessionIds: (metadata?.childSubSessionIds ?? []).map((id) => redactedText(id)),
            depth: metadata?.depth ?? 1,
            resultAggregationStage: contract.identity.parent?.parentSubSessionId
                ? "parent_sub_agent_review"
                : "nobie_finalization",
            ...(metadata?.resultReturnTargetAgentId
                ? { resultReturnTargetAgentId: redactedText(metadata.resultReturnTargetAgentId) }
                : {}),
            ...(contract.identity.parent?.parentSubSessionId
                ? {
                    resultReturnTargetSubSessionId: redactedText(contract.identity.parent.parentSubSessionId),
                }
                : {}),
            agentId: redactedText(contract.agentId),
            agentDisplayName: redactedText(contract.agentDisplayName),
            ...(contract.agentNickname ? { agentNickname: redactedText(contract.agentNickname) } : {}),
            status: contract.status,
            commandSummary: commandSummaryFor(contract),
            expectedOutputs: expectedOutputsFor(contract),
            retryBudgetRemaining: contract.retryBudgetRemaining,
            promptBundleId: redactedText(contract.promptBundleId),
            ...(contract.startedAt !== undefined ? { startedAt: contract.startedAt } : {}),
            ...(contract.finishedAt !== undefined ? { finishedAt: contract.finishedAt } : {}),
            progress: progressFor(contract.subSessionId, ledgerEvents, orchestrationEvents),
            ...(result ? { result } : {}),
            ...(review ? { review } : {}),
            feedback: feedbackFor(contract.subSessionId, orchestrationEvents, run.recentEvents),
            approvalState: approvalStateForSubSession(contract, approvals, run.orchestrationPlanSnapshot),
            ...(model ? { model } : {}),
            allowedControlActions: allowedControlActionsFor(contract.status, contract.retryBudgetRemaining),
        };
    });
}
function subSessionTreeMetadata(contracts) {
    const byId = new Map(contracts.map((contract) => [contract.subSessionId, contract]));
    const childrenByParent = new Map();
    for (const contract of contracts) {
        const parentSubSessionId = contract.identity.parent?.parentSubSessionId;
        if (!parentSubSessionId)
            continue;
        const children = childrenByParent.get(parentSubSessionId) ?? [];
        children.push(contract.subSessionId);
        childrenByParent.set(parentSubSessionId, children);
    }
    const depthCache = new Map();
    const depthFor = (contract, seen = new Set()) => {
        const cached = depthCache.get(contract.subSessionId);
        if (cached !== undefined)
            return cached;
        if (seen.has(contract.subSessionId))
            return 1;
        const parentSubSessionId = contract.identity.parent?.parentSubSessionId;
        const parent = parentSubSessionId ? byId.get(parentSubSessionId) : undefined;
        const depth = parent ? depthFor(parent, new Set([...seen, contract.subSessionId])) + 1 : 1;
        depthCache.set(contract.subSessionId, depth);
        return depth;
    };
    const result = new Map();
    for (const contract of contracts) {
        const parentSubSessionId = contract.identity.parent?.parentSubSessionId;
        const parent = parentSubSessionId ? byId.get(parentSubSessionId) : undefined;
        result.set(contract.subSessionId, {
            depth: depthFor(contract),
            childSubSessionIds: [...(childrenByParent.get(contract.subSessionId) ?? [])].sort((a, b) => a.localeCompare(b)),
            resultReturnTargetAgentId: parent?.agentId ?? contract.parentAgentId ?? "agent:nobie",
        });
    }
    return result;
}
function subSessionContractsFor(run) {
    const rows = listRunSubSessionsForParentRun(run.id);
    const contracts = rows.map(contractFromRow);
    if (contracts.length === 0 && run.subSessionsSnapshot?.length) {
        contracts.push(...run.subSessionsSnapshot);
    }
    return contracts;
}
function collectOrchestrationEvents(run, limit) {
    const byId = new Map();
    for (const event of listOrchestrationEvents({ runId: run.id, limit }))
        byId.set(event.id, event);
    if (run.requestGroupId && run.requestGroupId !== run.id) {
        for (const event of listOrchestrationEvents({ requestGroupId: run.requestGroupId, limit })) {
            byId.set(event.id, event);
        }
    }
    return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
}
function collectLedgerEvents(run, limit) {
    return mergeEventsById([
        ...listMessageLedgerEvents({ runId: run.id, limit }),
        ...(run.requestGroupId && run.requestGroupId !== run.id
            ? listMessageLedgerEvents({ requestGroupId: run.requestGroupId, limit })
            : []),
    ]).sort((left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id));
}
export function buildRunRuntimeInspectorProjection(run, options = {}) {
    const now = options.now ?? Date.now();
    const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 120)));
    const orchestrationEvents = collectOrchestrationEvents(run, Math.max(limit, 500));
    const ledgerEvents = collectLedgerEvents(run, Math.max(limit, 500));
    const approvals = collectApprovals(orchestrationEvents, ledgerEvents);
    const subSessionContracts = subSessionContractsFor(run);
    const subSessions = collectSubSessions(run, subSessionContracts, ledgerEvents, orchestrationEvents, approvals);
    return {
        schemaVersion: 1,
        runId: redactedText(run.id),
        requestGroupId: redactedText(run.requestGroupId || run.id),
        generatedAt: now,
        orchestrationMode: run.orchestrationMode ?? "single_nobie",
        plan: planProjection(run.orchestrationPlanSnapshot),
        subSessions,
        dataExchanges: collectDataExchanges(subSessionContracts, now),
        approvals,
        timeline: collectTimeline(run, orchestrationEvents, ledgerEvents, limit),
        finalizer: finalizerFromLedger(ledgerEvents),
        redaction: {
            payloadsRedacted: true,
            rawPayloadVisible: false,
        },
    };
}
//# sourceMappingURL=runtime-inspector-projection.js.map