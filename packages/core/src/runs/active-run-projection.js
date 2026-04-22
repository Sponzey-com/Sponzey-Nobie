import { CONTRACT_SCHEMA_VERSION, buildDeliveryProjection, buildToolTargetProjection, stableContractHash, validateDeliveryContract, validateIntentContract, validateToolTargetContract, } from "../contracts/index.js";
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function textOrUndefined(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function readContractRecord(snapshot, keys) {
    if (!snapshot)
        return undefined;
    for (const key of keys) {
        const value = snapshot[key];
        if (value !== undefined)
            return value;
    }
    return undefined;
}
function readApprovalId(snapshot) {
    return textOrUndefined(readContractRecord(snapshot, ["approvalId", "approval_id", "pendingApprovalId"]));
}
function readPersistedIntentContract(snapshot) {
    const value = readContractRecord(snapshot, ["intentContract", "intent_contract"]);
    const validation = validateIntentContract(value);
    return validation.ok ? validation.value : undefined;
}
function readPersistedTargetContract(snapshot) {
    const value = readContractRecord(snapshot, ["targetContract", "target_contract"]);
    const validation = validateToolTargetContract(value);
    return validation.ok ? validation.value : undefined;
}
function readPersistedDeliveryContract(snapshot) {
    const value = readContractRecord(snapshot, ["deliveryContract", "delivery_contract"]);
    const validation = validateDeliveryContract(value);
    return validation.ok ? validation.value : undefined;
}
function inferTargetKind(run) {
    const target = `${run.targetId ?? ""} ${run.targetLabel ?? ""}`.toLowerCase();
    if (/display|screen|monitor|화면|모니터/.test(target))
        return "display";
    if (/camera|카메라/.test(target))
        return "camera";
    if (/file|path|파일|폴더/.test(target))
        return "file";
    if (/extension|yeonjang|연장/.test(target))
        return "extension";
    return "unknown";
}
function deliveryChannelFromRunSource(source) {
    switch (source) {
        case "telegram":
            return "telegram";
        case "slack":
            return "slack";
        case "webui":
            return "webui";
        case "cli":
            return "local";
        default:
            return "current_session";
    }
}
export function buildDerivedTargetContract(run) {
    const targetId = textOrUndefined(run.targetId);
    const displayName = textOrUndefined(run.targetLabel);
    return {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        kind: targetId ? inferTargetKind(run) : "unknown",
        ...(targetId ? { id: targetId } : {}),
        selector: null,
        ...(displayName ? { displayName } : {}),
    };
}
export function buildDeliveryContractForRun(run) {
    return {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        mode: "reply",
        channel: deliveryChannelFromRunSource(run.source),
        sessionId: run.sessionId,
    };
}
export function buildIncomingIntentContract(params) {
    const target = buildDerivedTargetContract({
        ...(params.targetId ? { targetId: params.targetId } : {}),
        ...(params.targetLabel ? { targetLabel: params.targetLabel } : {}),
    });
    const delivery = buildDeliveryContractForRun({
        source: params.source ?? "webui",
        sessionId: params.sessionId,
    });
    return {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        intentType: params.intentType ?? "question",
        actionType: params.actionType ?? "answer",
        target,
        delivery,
        constraints: [],
        requiresApproval: false,
    };
}
function buildDerivedIntentContract(run, target, delivery) {
    return {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        intentType: "question",
        actionType: "answer",
        target,
        delivery,
        constraints: [],
        requiresApproval: false,
        displayName: run.title,
    };
}
export function buildIntentComparisonProjection(intent) {
    return {
        schemaVersion: intent.schemaVersion,
        intentType: intent.intentType,
        actionType: intent.actionType,
        target: buildToolTargetProjection(intent.target),
        delivery: buildDeliveryProjection(intent.delivery),
        constraints: intent.constraints,
        requiresApproval: intent.requiresApproval,
        impossibility: intent.impossibility
            ? {
                reasonCode: intent.impossibility.reasonCode,
            }
            : undefined,
    };
}
export function buildActiveRunProjection(run) {
    const persistedIntent = readPersistedIntentContract(run.promptSourceSnapshot);
    const persistedTarget = persistedIntent?.target ?? readPersistedTargetContract(run.promptSourceSnapshot);
    const persistedDelivery = persistedIntent?.delivery ?? readPersistedDeliveryContract(run.promptSourceSnapshot);
    const targetContract = persistedTarget ?? buildDerivedTargetContract(run);
    const deliveryContract = persistedDelivery ?? buildDeliveryContractForRun(run);
    const intentContract = persistedIntent ?? buildDerivedIntentContract(run, targetContract, deliveryContract);
    const legacy = !persistedIntent && !persistedTarget && !persistedDelivery;
    const comparisonProjection = buildIntentComparisonProjection(intentContract);
    const approvalId = readApprovalId(run.promptSourceSnapshot);
    return {
        runId: run.id,
        requestGroupId: run.requestGroupId,
        lineageRootRunId: run.lineageRootRunId,
        ...(approvalId ? { approvalId } : {}),
        status: run.status,
        source: run.source,
        displayName: run.title || run.targetLabel || run.id,
        ...(run.orchestrationMode ? { orchestrationMode: run.orchestrationMode } : {}),
        ...(run.agentDisplayName ? { agentDisplayName: run.agentDisplayName } : {}),
        ...(run.agentNickname ? { agentNickname: run.agentNickname } : {}),
        ...(run.subSessionIds?.length ? { subSessionIds: [...run.subSessionIds] } : {}),
        ...(run.subSessionsSnapshot?.length
            ? {
                subSessions: run.subSessionsSnapshot.map((subSession) => ({
                    subSessionId: subSession.subSessionId,
                    parentRunId: subSession.parentRunId,
                    agentId: subSession.agentId,
                    agentDisplayName: subSession.agentDisplayName,
                    ...(subSession.agentNickname ? { agentNickname: subSession.agentNickname } : {}),
                    status: subSession.status,
                    retryBudgetRemaining: subSession.retryBudgetRemaining,
                })),
            }
            : {}),
        updatedAt: run.updatedAt,
        legacy,
        ...(legacy ? { legacyReason: "missing_persisted_contract" } : {}),
        intentContract,
        targetContract,
        deliveryContract,
        comparisonProjection,
        comparisonHash: stableContractHash(comparisonProjection, "active-run"),
    };
}
export function buildActiveRunProjections(runs) {
    return runs.map(buildActiveRunProjection);
}
export function resolveExplicitActiveRunTarget(params) {
    const runId = textOrUndefined(params.runId);
    if (runId) {
        const target = params.candidates.find((candidate) => candidate.runId === runId);
        if (target)
            return { kind: "runId", target, decisionSource: "explicit_id" };
    }
    const requestGroupId = textOrUndefined(params.requestGroupId);
    if (requestGroupId) {
        const target = params.candidates.find((candidate) => candidate.requestGroupId === requestGroupId);
        if (target)
            return { kind: "requestGroupId", target, decisionSource: "explicit_id" };
    }
    const approvalId = textOrUndefined(params.approvalId);
    if (approvalId) {
        const target = params.candidates.find((candidate) => candidate.approvalId === approvalId);
        if (target)
            return { kind: "approvalId", target, decisionSource: "explicit_id" };
    }
    return undefined;
}
export function serializeActiveRunCandidateForComparison(candidate) {
    return {
        runId: candidate.runId,
        requestGroupId: candidate.requestGroupId,
        lineageRootRunId: candidate.lineageRootRunId,
        approvalId: candidate.approvalId,
        status: candidate.status,
        source: candidate.source,
        orchestrationMode: candidate.orchestrationMode,
        subSessionIds: candidate.subSessionIds,
        subSessions: candidate.subSessions?.map((subSession) => ({
            subSessionId: subSession.subSessionId,
            parentRunId: subSession.parentRunId,
            agentId: subSession.agentId,
            status: subSession.status,
            retryBudgetRemaining: subSession.retryBudgetRemaining,
        })),
        legacy: candidate.legacy,
        comparisonHash: candidate.comparisonHash,
        contract: candidate.comparisonProjection,
    };
}
export function hasPersistedComparableContract(candidate) {
    return !candidate.legacy && isRecord(candidate.comparisonProjection);
}
//# sourceMappingURL=active-run-projection.js.map