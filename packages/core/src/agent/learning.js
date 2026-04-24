import { randomUUID } from "node:crypto";
import { CONTRACT_SCHEMA_VERSION } from "../contracts/index.js";
import { getAgentConfig, getTeamConfig, insertLearningEvent, insertProfileHistoryVersion, insertProfileRestoreEvent, listLearningEventsByApprovalState, listLearningEvents, listProfileHistoryVersions, listProfileRestoreEvents, updateLearningEventApprovalState, upsertAgentConfig, upsertTeamConfig, } from "../db/index.js";
import { storeOwnerScopedMemory } from "../memory/isolation.js";
import { recordOrchestrationEvent } from "../orchestration/event-ledger.js";
function sameOwner(a, b) {
    return a.ownerType === b.ownerType && a.ownerId === b.ownerId;
}
function clampConfidence(value) {
    if (!Number.isFinite(value))
        return 0;
    return Math.max(0, Math.min(1, value));
}
function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
}
function normalizedKeys(value) {
    const result = new Set();
    const visit = (item) => {
        if (!item || typeof item !== "object")
            return;
        if (Array.isArray(item)) {
            for (const child of item)
                visit(child);
            return;
        }
        for (const [key, child] of Object.entries(item)) {
            result.add(key.trim().toLowerCase());
            visit(child);
        }
    };
    visit(value);
    return result;
}
function containsPermissionOrCapabilityExpansion(input) {
    const sensitiveKeys = new Set([
        "capabilitypolicy",
        "capabilitybinding",
        "agentcapabilitybinding",
        "capabilitycatalog",
        "permissionprofile",
        "skillmcpallowlist",
        "catalogid",
        "bindingid",
        "skillbinding",
        "mcpserverbinding",
        "enabledskillids",
        "enabledmcpserverids",
        "enabledtoolnames",
        "secretscopeid",
        "secretscopes",
        "secretaccess",
        "allowexternalnetwork",
        "allowfilesystemwrite",
        "allowshellexecution",
        "allowscreencontrol",
        "allowedpaths",
        "riskceiling",
        "approvalrequiredfrom",
    ]);
    const afterKeys = normalizedKeys(input.after);
    if ([...afterKeys].some((key) => sensitiveKeys.has(key)))
        return true;
    const beforeRisk = typeof input.before["riskCeiling"] === "string" ? input.before["riskCeiling"] : undefined;
    const afterRisk = typeof input.after["riskCeiling"] === "string" ? input.after["riskCeiling"] : undefined;
    if (beforeRisk && afterRisk && beforeRisk !== afterRisk)
        return true;
    return false;
}
function lockedFieldConflict(input) {
    const locked = new Set((input.lockedFields ?? []).map((item) => item.trim()).filter(Boolean));
    if (locked.size === 0)
        return false;
    const afterKeys = normalizedKeys(input.after);
    return [...locked].some((field) => afterKeys.has(field.toLowerCase()) || hasOwn(input.after, field));
}
function hasEvidenceRefs(evidenceRefs) {
    return (evidenceRefs ?? []).some((ref) => ref.trim().length > 0);
}
function redactString(value) {
    let changed = false;
    const next = value
        .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, () => {
        changed = true;
        return "[redacted-api-key]";
    })
        .replace(/\b(?:api[_-]?key|token|secret|authorization)\b\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{12,}["']?/giu, (match) => {
        changed = true;
        const key = match.split(/[:=]/u)[0]?.trim() || "secret";
        return `${key}: [redacted]`;
    })
        .replace(/\/Users\/[^/\s)]+\/[^\s)]+/g, () => {
        changed = true;
        return "/Users/<user>/...";
    });
    return { value: next, changed };
}
function sanitizeJsonValue(value) {
    if (typeof value === "string")
        return redactString(value).value;
    if (Array.isArray(value))
        return value.map((item) => sanitizeJsonValue(item) ?? null);
    if (value && typeof value === "object") {
        const out = {};
        for (const [key, item] of Object.entries(value)) {
            if (/^(secret|token|apiKey|authorization)$/iu.test(key)) {
                out[key] = "[redacted]";
                continue;
            }
            const next = sanitizeJsonValue(item);
            if (next !== undefined)
                out[key] = next;
        }
        return out;
    }
    return value;
}
function sanitizeJsonObject(value) {
    const sanitized = sanitizeJsonValue(value);
    return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
        ? sanitized
        : {};
}
function sanitizeSummary(value) {
    return redactString(value).value.trim();
}
function parseJsonObject(value) {
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
function parseStringArray(value) {
    if (!value)
        return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter((item) => typeof item === "string")
            : [];
    }
    catch {
        return [];
    }
}
function buildIdentity(input) {
    return {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        entityType: input.entityType,
        entityId: input.entityId,
        owner: input.owner,
        idempotencyKey: input.idempotencyKey,
        ...(input.auditCorrelationId ? { auditCorrelationId: input.auditCorrelationId } : {}),
        parent: {
            ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
            ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
            ...(input.parentSubSessionId ? { parentSubSessionId: input.parentSubSessionId } : {}),
            ...(input.parentRequestId ? { parentRequestId: input.parentRequestId } : {}),
        },
    };
}
function nextHistoryVersion(targetEntityType, targetEntityId) {
    const versions = listProfileHistoryVersions(targetEntityType, targetEntityId);
    return versions.reduce((max, row) => Math.max(max, row.version), 0) + 1;
}
function learningRisk(input) {
    if (input.risk)
        return input.risk;
    if (containsPermissionOrCapabilityExpansion(input))
        return "high";
    if (input.learningTarget === "memory")
        return "low";
    return "medium";
}
export function evaluateLearningPolicy(input) {
    const confidence = clampConfidence(input.confidence);
    const risk = learningRisk(input);
    const issues = [];
    const crossAgent = !sameOwner(input.actorOwner, input.targetOwner);
    const permissionExpansion = containsPermissionOrCapabilityExpansion(input);
    const lockedConflict = lockedFieldConflict(input);
    if (crossAgent) {
        return {
            approvalState: "rejected",
            reasonCode: "rejected_cross_agent_write",
            autoApply: false,
            requiresReview: false,
            blocked: true,
            confidence,
            risk,
            issues: ["cross_agent_learning_write_blocked"],
        };
    }
    if (confidence < 0.6) {
        return {
            approvalState: "rejected",
            reasonCode: "rejected_low_confidence",
            autoApply: false,
            requiresReview: false,
            blocked: true,
            confidence,
            risk,
            issues: ["confidence_below_0_60"],
        };
    }
    if (permissionExpansion) {
        return {
            approvalState: "pending_review",
            reasonCode: "pending_permission_or_capability_expansion",
            autoApply: false,
            requiresReview: true,
            blocked: false,
            confidence,
            risk: "high",
            issues: ["permission_or_capability_expansion_requires_review"],
        };
    }
    if (lockedConflict) {
        return {
            approvalState: "pending_review",
            reasonCode: "pending_locked_setting_conflict",
            autoApply: false,
            requiresReview: true,
            blocked: false,
            confidence,
            risk,
            issues: ["locked_setting_conflict"],
        };
    }
    if (!hasEvidenceRefs(input.evidenceRefs)) {
        return {
            approvalState: "pending_review",
            reasonCode: "pending_missing_evidence",
            autoApply: false,
            requiresReview: true,
            blocked: false,
            confidence,
            risk,
            issues: ["evidence_refs_required_for_auto_apply"],
        };
    }
    if (confidence < 0.85) {
        return {
            approvalState: "pending_review",
            reasonCode: "pending_medium_confidence",
            autoApply: false,
            requiresReview: true,
            blocked: false,
            confidence,
            risk,
            issues: ["confidence_between_0_60_and_0_85"],
        };
    }
    if (input.learningTarget !== "memory" || risk !== "low") {
        return {
            approvalState: "pending_review",
            reasonCode: "pending_non_memory_target",
            autoApply: false,
            requiresReview: true,
            blocked: false,
            confidence,
            risk,
            issues: ["only_low_risk_self_memory_can_auto_apply"],
        };
    }
    return {
        approvalState: "auto_applied",
        reasonCode: "auto_apply_self_memory_high_confidence",
        autoApply: true,
        requiresReview: false,
        blocked: false,
        confidence,
        risk,
        issues,
    };
}
export function buildHistoryVersion(input) {
    const createdAt = input.now?.() ?? Date.now();
    const historyVersionId = input.historyVersionId ?? `history:${randomUUID()}`;
    return {
        identity: buildIdentity({
            entityType: "data_exchange",
            entityId: historyVersionId,
            owner: input.owner,
            idempotencyKey: input.idempotencyKey ?? `history:${historyVersionId}`,
            ...(input.auditCorrelationId ? { auditCorrelationId: input.auditCorrelationId } : {}),
            ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
            ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
            ...(input.parentSubSessionId ? { parentSubSessionId: input.parentSubSessionId } : {}),
            ...(input.parentRequestId ? { parentRequestId: input.parentRequestId } : {}),
        }),
        historyVersionId,
        targetEntityType: input.targetEntityType,
        targetEntityId: input.targetEntityId,
        version: nextHistoryVersion(input.targetEntityType, input.targetEntityId),
        before: sanitizeJsonObject(input.before),
        after: sanitizeJsonObject(input.after),
        reasonCode: input.reasonCode,
        createdAt,
    };
}
export function recordHistoryVersion(input, options = {}) {
    return insertProfileHistoryVersion(input, options);
}
function emitLearningRecorded(input) {
    if (!input.inserted)
        return;
    recordOrchestrationEvent({
        eventKind: "learning_recorded",
        runId: input.event.sourceRunId ?? input.event.identity.parent?.parentRunId ?? null,
        requestGroupId: input.event.identity.parent?.parentRequestId ?? null,
        subSessionId: input.event.sourceSubSessionId ?? input.event.identity.parent?.parentSubSessionId ?? null,
        agentId: input.event.agentId,
        correlationId: input.event.identity.auditCorrelationId ?? input.event.learningEventId,
        dedupeKey: `learning_recorded:${input.event.learningEventId}:${input.event.approvalState}`,
        source: "learning-event-service",
        severity: input.policy.blocked ? "warning" : "info",
        summary: `Learning recorded for ${input.event.agentId}: ${input.event.learningTarget}`,
        payload: {
            learningEventId: input.event.learningEventId,
            agentId: input.event.agentId,
            agentType: input.event.agentType,
            learningTarget: input.event.learningTarget,
            evidenceRefs: input.event.evidenceRefs,
            confidence: input.event.confidence,
            approvalState: input.event.approvalState,
            policyReasonCode: input.event.policyReasonCode,
            autoApply: input.policy.autoApply,
            requiresReview: input.policy.requiresReview,
            blocked: input.policy.blocked,
            ...(input.history
                ? {
                    historyVersionId: input.history.historyVersionId,
                    historyVersion: input.history.version,
                    targetEntityType: input.history.targetEntityType,
                    targetEntityId: input.history.targetEntityId,
                }
                : {}),
        },
        producerTask: "task028",
        createdAt: input.createdAt,
        emittedAt: input.createdAt,
    });
}
function emitHistoryRestored(input) {
    if (!input.inserted)
        return;
    recordOrchestrationEvent({
        eventKind: "history_restored",
        runId: input.event.identity.parent?.parentRunId ?? null,
        requestGroupId: input.event.identity.parent?.parentRequestId ?? null,
        subSessionId: input.event.identity.parent?.parentSubSessionId ?? null,
        agentId: input.event.targetEntityType === "agent" || input.event.targetEntityType === "memory"
            ? input.event.targetEntityId
            : null,
        teamId: input.event.targetEntityType === "team" ? input.event.targetEntityId : null,
        correlationId: input.event.identity.auditCorrelationId ?? input.event.restoreEventId,
        dedupeKey: `history_restored:${input.event.restoreEventId}`,
        source: "learning-event-service",
        severity: input.ok ? "info" : "warning",
        summary: `History restore ${input.event.dryRun ? "dry-run" : "event"} for ${input.event.targetEntityType}:${input.event.targetEntityId}`,
        payload: {
            restoreEventId: input.event.restoreEventId,
            targetEntityType: input.event.targetEntityType,
            targetEntityId: input.event.targetEntityId,
            restoredHistoryVersionId: input.event.restoredHistoryVersionId,
            dryRun: input.event.dryRun,
            applied: input.applied,
            ok: input.ok,
            effectSummary: input.event.effectSummary,
            conflictCodes: input.conflictCodes,
        },
        producerTask: "task028",
        createdAt: input.createdAt,
        emittedAt: input.createdAt,
    });
}
export async function recordLearningEvent(input) {
    const policy = evaluateLearningPolicy(input);
    const createdAt = input.now?.() ?? Date.now();
    const learningEventId = input.learningEventId ?? `learning:${randomUUID()}`;
    const event = {
        identity: buildIdentity({
            entityType: "data_exchange",
            entityId: learningEventId,
            owner: input.targetOwner,
            idempotencyKey: input.idempotencyKey ?? `learning:${learningEventId}`,
            ...(input.auditCorrelationId ? { auditCorrelationId: input.auditCorrelationId } : {}),
            ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
            ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
            ...(input.parentSubSessionId ? { parentSubSessionId: input.parentSubSessionId } : {}),
            ...(input.parentRequestId ? { parentRequestId: input.parentRequestId } : {}),
        }),
        learningEventId,
        agentId: input.agentId,
        agentType: input.agentType,
        ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
        ...(input.sourceSessionId ? { sourceSessionId: input.sourceSessionId } : {}),
        ...(input.sourceSubSessionId ? { sourceSubSessionId: input.sourceSubSessionId } : {}),
        learningTarget: input.learningTarget,
        before: sanitizeJsonObject(input.before),
        after: sanitizeJsonObject(input.after),
        beforeSummary: sanitizeSummary(input.beforeSummary),
        afterSummary: sanitizeSummary(input.afterSummary),
        evidenceRefs: input.evidenceRefs.filter((ref) => ref.trim().length > 0),
        confidence: policy.confidence,
        approvalState: policy.approvalState,
        policyReasonCode: policy.reasonCode,
    };
    const inserted = insertLearningEvent(event, {
        ...(input.auditCorrelationId ? { auditId: input.auditCorrelationId } : {}),
        now: createdAt,
    });
    let history;
    let memoryDocumentId;
    if (inserted && policy.autoApply) {
        history = buildHistoryVersion({
            targetEntityType: "memory",
            targetEntityId: input.targetOwner.ownerId,
            before: input.before,
            after: input.after,
            reasonCode: policy.reasonCode,
            owner: input.targetOwner,
            historyVersionId: `history:${learningEventId}`,
            idempotencyKey: `history:${learningEventId}`,
            ...(input.auditCorrelationId ? { auditCorrelationId: input.auditCorrelationId } : {}),
            ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
            ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
            ...(input.parentSubSessionId ? { parentSubSessionId: input.parentSubSessionId } : {}),
            ...(input.parentRequestId ? { parentRequestId: input.parentRequestId } : {}),
            now: () => createdAt,
        });
        recordHistoryVersion(history, {
            ...(input.auditCorrelationId ? { auditId: input.auditCorrelationId } : {}),
        });
        const stored = await storeOwnerScopedMemory({
            owner: input.targetOwner,
            visibility: "private",
            retentionPolicy: "long_term",
            rawText: event.afterSummary,
            sourceType: "learning_event",
            sourceRef: event.learningEventId,
            title: `learning:${event.learningTarget}`,
            historyVersion: history.version,
            metadata: {
                learningEventId,
                confidence: policy.confidence,
                approvalState: policy.approvalState,
                reasonCode: policy.reasonCode,
                evidenceRefs: event.evidenceRefs,
            },
        });
        memoryDocumentId = stored.documentId;
    }
    emitLearningRecorded({
        event,
        policy,
        inserted,
        createdAt,
        ...(history ? { history } : {}),
    });
    return {
        event,
        policy,
        inserted,
        ...(history ? { history } : {}),
        ...(memoryDocumentId ? { memoryDocumentId } : {}),
    };
}
export function dbLearningEventToContract(row) {
    const parsed = parseJsonObject(row.contract_json);
    const parsedAfter = parsed["after"];
    const hasAfter = parsedAfter && typeof parsedAfter === "object" && !Array.isArray(parsedAfter);
    const parsedBefore = parsed["before"];
    return {
        identity: parsed["identity"],
        learningEventId: row.learning_event_id,
        agentId: row.agent_id,
        ...(typeof parsed["agentType"] === "string"
            ? { agentType: parsed["agentType"] }
            : {}),
        ...(typeof parsed["sourceRunId"] === "string" ? { sourceRunId: parsed["sourceRunId"] } : {}),
        ...(typeof parsed["sourceSessionId"] === "string"
            ? { sourceSessionId: parsed["sourceSessionId"] }
            : {}),
        ...(typeof parsed["sourceSubSessionId"] === "string"
            ? { sourceSubSessionId: parsed["sourceSubSessionId"] }
            : {}),
        learningTarget: row.learning_target,
        ...(hasAfter
            ? {
                before: parsedBefore && typeof parsedBefore === "object" && !Array.isArray(parsedBefore)
                    ? parsedBefore
                    : {},
                after: parsedAfter,
            }
            : {}),
        beforeSummary: row.before_summary,
        afterSummary: row.after_summary,
        evidenceRefs: parseStringArray(row.evidence_refs_json),
        confidence: row.confidence,
        approvalState: row.approval_state,
        ...(typeof parsed["policyReasonCode"] === "string"
            ? { policyReasonCode: parsed["policyReasonCode"] }
            : {}),
    };
}
function targetEntityTypeForLearningTarget(target) {
    if (target === "team_profile")
        return "team";
    if (target === "memory")
        return "memory";
    return "agent";
}
export async function approveLearningEvent(input) {
    const event = listAgentLearningEvents(input.agentId).find((item) => item.learningEventId === input.learningEventId);
    if (!event) {
        return { ok: false, reasonCode: "learning_event_not_found", historyInserted: false };
    }
    if (event.approvalState !== "pending_review") {
        return { ok: false, reasonCode: "learning_event_not_pending", event, historyInserted: false };
    }
    if (!event.before || !event.after) {
        return { ok: false, reasonCode: "learning_event_missing_diff", event, historyInserted: false };
    }
    const createdAt = input.now?.() ?? Date.now();
    const targetEntityType = targetEntityTypeForLearningTarget(event.learningTarget);
    const targetEntityId = event.identity.owner.ownerId;
    const history = buildHistoryVersion({
        targetEntityType,
        targetEntityId,
        before: event.before,
        after: event.after,
        reasonCode: event.policyReasonCode ?? "approved_learning_event",
        owner: input.owner,
        historyVersionId: `history:${event.learningEventId}:approved`,
        idempotencyKey: `history:${event.learningEventId}:approved`,
        ...(input.auditCorrelationId ? { auditCorrelationId: input.auditCorrelationId } : {}),
        now: () => createdAt,
    });
    const historyInserted = recordHistoryVersion(history, {
        ...(input.auditCorrelationId ? { auditId: input.auditCorrelationId } : {}),
    });
    updateLearningEventApprovalState(event.learningEventId, "applied_by_user", {
        ...(input.auditCorrelationId ? { auditId: input.auditCorrelationId } : {}),
        now: createdAt,
    });
    let memoryDocumentId;
    if (historyInserted && event.learningTarget === "memory") {
        const stored = await storeOwnerScopedMemory({
            owner: event.identity.owner,
            visibility: "private",
            retentionPolicy: "long_term",
            rawText: event.afterSummary,
            sourceType: "learning_event_review",
            sourceRef: event.learningEventId,
            title: `learning:${event.learningTarget}:approved`,
            historyVersion: history.version,
            metadata: {
                learningEventId: event.learningEventId,
                confidence: event.confidence,
                approvalState: "applied_by_user",
                evidenceRefs: event.evidenceRefs,
            },
        });
        memoryDocumentId = stored.documentId;
    }
    return {
        ok: true,
        reasonCode: "approved",
        event: { ...event, approvalState: "applied_by_user" },
        history,
        historyInserted,
        ...(memoryDocumentId ? { memoryDocumentId } : {}),
    };
}
export function dbHistoryVersionToContract(row) {
    return {
        identity: {
            schemaVersion: row.schema_version,
            entityType: "data_exchange",
            entityId: row.history_version_id,
            owner: { ownerType: "system", ownerId: row.target_entity_id },
            idempotencyKey: row.idempotency_key,
            ...(row.audit_id ? { auditCorrelationId: row.audit_id } : {}),
        },
        historyVersionId: row.history_version_id,
        targetEntityType: row.target_entity_type,
        targetEntityId: row.target_entity_id,
        version: row.version,
        before: parseJsonObject(row.before_json),
        after: parseJsonObject(row.after_json),
        reasonCode: row.reason_code,
        createdAt: row.created_at,
    };
}
export function dbRestoreEventToContract(row) {
    return {
        identity: {
            schemaVersion: row.schema_version,
            entityType: "data_exchange",
            entityId: row.restore_event_id,
            owner: { ownerType: "system", ownerId: row.target_entity_id },
            idempotencyKey: row.idempotency_key,
            ...(row.audit_id ? { auditCorrelationId: row.audit_id } : {}),
        },
        restoreEventId: row.restore_event_id,
        targetEntityType: row.target_entity_type,
        targetEntityId: row.target_entity_id,
        restoredHistoryVersionId: row.restored_history_version_id,
        dryRun: row.dry_run === 1,
        effectSummary: parseStringArray(row.effect_summary_json),
        createdAt: row.created_at,
    };
}
function currentPayloadFor(targetEntityType, targetEntityId) {
    if (targetEntityType === "agent") {
        const row = getAgentConfig(targetEntityId);
        return row ? parseJsonObject(row.config_json) : undefined;
    }
    if (targetEntityType === "team") {
        const row = getTeamConfig(targetEntityId);
        return row ? parseJsonObject(row.config_json) : undefined;
    }
    return undefined;
}
function findHistoryVersion(targetEntityType, targetEntityId, historyVersionId) {
    return listProfileHistoryVersions(targetEntityType, targetEntityId)
        .map(dbHistoryVersionToContract)
        .find((history) => history.historyVersionId === historyVersionId);
}
function changedKeys(before, after) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys]
        .filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
        .sort();
}
export function dryRunRestoreHistoryVersion(input) {
    const history = findHistoryVersion(input.targetEntityType, input.targetEntityId, input.restoredHistoryVersionId);
    if (!history) {
        return {
            ok: false,
            targetEntityType: input.targetEntityType,
            targetEntityId: input.targetEntityId,
            restoredHistoryVersionId: input.restoredHistoryVersionId,
            restorePayload: {},
            effectSummary: ["history version not found"],
            conflictCodes: ["history_version_not_found"],
        };
    }
    const currentPayload = currentPayloadFor(input.targetEntityType, input.targetEntityId);
    const restorePayload = history.before;
    const keys = changedKeys(currentPayload ?? history.after, restorePayload);
    const conflictCodes = [];
    if (currentPayload && JSON.stringify(currentPayload) !== JSON.stringify(history.after)) {
        conflictCodes.push("current_state_differs_from_history_after");
    }
    return {
        ok: true,
        targetEntityType: input.targetEntityType,
        targetEntityId: input.targetEntityId,
        restoredHistoryVersionId: input.restoredHistoryVersionId,
        restorePayload,
        ...(currentPayload ? { currentPayload } : {}),
        effectSummary: keys.length > 0
            ? keys.map((key) => `restore ${input.targetEntityType}:${input.targetEntityId} field ${key}`)
            : [`restore ${input.targetEntityType}:${input.targetEntityId} has no visible field diff`],
        conflictCodes,
    };
}
function applyRestorePayload(input, payload, now) {
    if (!input.apply || input.dryRun)
        return false;
    if (input.targetEntityType === "agent") {
        const config = payload;
        if (!config ||
            typeof config !== "object" ||
            !("agentId" in config) ||
            config.agentId !== input.targetEntityId)
            return false;
        upsertAgentConfig({ ...config, updatedAt: now }, {
            source: "system",
            auditId: input.auditCorrelationId ?? null,
            idempotencyKey: `restore:${input.restoredHistoryVersionId}:${now}`,
            now,
        });
        return true;
    }
    if (input.targetEntityType === "team") {
        const config = payload;
        if (!config ||
            typeof config !== "object" ||
            !("teamId" in config) ||
            config.teamId !== input.targetEntityId)
            return false;
        upsertTeamConfig({ ...config, updatedAt: now }, {
            source: "system",
            auditId: input.auditCorrelationId ?? null,
            idempotencyKey: `restore:${input.restoredHistoryVersionId}:${now}`,
            now,
        });
        return true;
    }
    return false;
}
export function restoreHistoryVersion(input) {
    const createdAt = input.now?.() ?? Date.now();
    const dryRun = dryRunRestoreHistoryVersion(input);
    const restoreEventId = input.restoreEventId ?? `restore:${randomUUID()}`;
    const event = {
        identity: buildIdentity({
            entityType: "data_exchange",
            entityId: restoreEventId,
            owner: input.owner,
            idempotencyKey: input.idempotencyKey ?? `restore:${restoreEventId}`,
            ...(input.auditCorrelationId ? { auditCorrelationId: input.auditCorrelationId } : {}),
            ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
            ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
            ...(input.parentSubSessionId ? { parentSubSessionId: input.parentSubSessionId } : {}),
            ...(input.parentRequestId ? { parentRequestId: input.parentRequestId } : {}),
        }),
        restoreEventId,
        targetEntityType: input.targetEntityType,
        targetEntityId: input.targetEntityId,
        restoredHistoryVersionId: input.restoredHistoryVersionId,
        dryRun: input.dryRun,
        effectSummary: dryRun.effectSummary,
        createdAt,
    };
    const inserted = insertProfileRestoreEvent(event, {
        ...(input.auditCorrelationId ? { auditId: input.auditCorrelationId } : {}),
    });
    const applied = dryRun.ok ? applyRestorePayload(input, dryRun.restorePayload, createdAt) : false;
    emitHistoryRestored({
        event,
        inserted,
        applied,
        ok: dryRun.ok,
        conflictCodes: dryRun.conflictCodes,
        createdAt,
    });
    return {
        ...dryRun,
        event,
        inserted,
        applied,
    };
}
export function listAgentLearningEvents(agentId) {
    return listLearningEvents(agentId).map(dbLearningEventToContract);
}
export function listLearningReviewQueue(query = {}) {
    return listLearningEventsByApprovalState("pending_review", query).map(dbLearningEventToContract);
}
export function listHistoryVersions(targetEntityType, targetEntityId) {
    return listProfileHistoryVersions(targetEntityType, targetEntityId).map(dbHistoryVersionToContract);
}
export function listRestoreEvents(targetEntityType, targetEntityId) {
    return listProfileRestoreEvents(targetEntityType, targetEntityId).map(dbRestoreEventToContract);
}
//# sourceMappingURL=learning.js.map