import { randomUUID } from "node:crypto";
import { CONTRACT_SCHEMA_VERSION } from "../contracts/index.js";
import { createDataExchangePackage, persistDataExchangePackage } from "../memory/isolation.js";
import { buildSubSessionFeedbackCycleDirective, } from "../runs/review-cycle-pass.js";
export function decideFeedbackLoopContinuation(input) {
    if (input.review.verdict === "limited_success" ||
        input.review.parentIntegrationStatus === "limited_parent_integration") {
        return {
            action: "limited_success_finalized",
            reasonCode: "limited_success_parent_integration",
        };
    }
    const normalizedFailureKey = input.review.normalizedFailureKey;
    if (normalizedFailureKey && (input.previousFailureKeys ?? []).includes(normalizedFailureKey)) {
        return {
            action: "blocked_repeated_failure",
            reasonCode: "same_sub_agent_result_review_failure_repeated",
            normalizedFailureKey,
        };
    }
    if (input.retryBudgetRemaining <= 0 || input.review.retryBudgetRemaining <= 0) {
        return {
            action: "blocked_retry_budget_exhausted",
            reasonCode: "sub_agent_result_review_retry_budget_exhausted",
            ...(normalizedFailureKey ? { normalizedFailureKey } : {}),
        };
    }
    if (!input.review.canRetry && !input.review.feedbackRequest) {
        return {
            action: "blocked_review_not_retryable",
            reasonCode: input.review.manualActionReason ?? "sub_agent_result_review_not_retryable",
            ...(normalizedFailureKey ? { normalizedFailureKey } : {}),
        };
    }
    return {
        action: "feedback_request",
        reasonCode: normalizedFailureKey ?? "sub_agent_result_review_feedback_required",
        ...(normalizedFailureKey ? { normalizedFailureKey } : {}),
    };
}
export function validateRedelegationTarget(input) {
    const reasonCodes = [];
    if (input.policy !== "alternative_direct_child") {
        return { ok: true, reasonCodes };
    }
    if (!input.targetAgentId)
        reasonCodes.push("redelegation_target_required");
    if (input.targetAgentId && input.targetAgentId === input.currentAgentId) {
        reasonCodes.push("redelegation_target_same_as_current_child");
    }
    if (!input.parentAgentId) {
        reasonCodes.push("redelegation_parent_agent_required");
    }
    else if (input.targetAgentId &&
        input.directChildAgentIds &&
        !input.directChildAgentIds.includes(input.targetAgentId)) {
        reasonCodes.push("redelegation_target_not_direct_child");
    }
    if (input.permissionAllowed === false)
        reasonCodes.push("redelegation_permission_blocked");
    if (input.capabilityAllowed === false)
        reasonCodes.push("redelegation_capability_blocked");
    if (input.modelAvailable === false)
        reasonCodes.push("redelegation_model_unavailable");
    if (input.resourceLocksAvailable === false)
        reasonCodes.push("redelegation_resource_lock_blocked");
    return {
        ok: reasonCodes.length === 0,
        reasonCodes,
    };
}
export function buildFeedbackLoopPackage(input) {
    const [primary] = input.resultReports;
    if (!primary) {
        throw new Error("feedback loop requires at least one source ResultReport");
    }
    const now = input.now?.() ?? Date.now();
    const idProvider = input.idProvider ?? (() => randomUUID());
    const feedbackRequestId = idProvider();
    const sourceResultReportIds = unique(input.resultReports.map((report) => report.resultReportId));
    const previousSubSessionIds = unique(input.previousSubSessionIds ?? input.resultReports.map((report) => report.subSessionId));
    const carryForwardOutputs = collectCarryForwardOutputs(input.resultReports);
    const missingItems = unique(input.review.missingItems);
    const requiredChanges = unique(input.review.requiredChanges);
    const conflictItems = unique(input.conflictItems ?? []);
    const additionalConstraints = unique(input.additionalConstraints ?? []);
    const parentRunId = input.parentRunId ?? primary.parentRunId;
    const sourceOwner = ownerForAgent(input.requestingAgentId) ?? primary.identity.owner;
    const targetAgentId = input.targetAgentId ??
        (primary.identity.owner.ownerType === "sub_agent" ? primary.identity.owner.ownerId : undefined);
    const recipientOwner = ownerForAgent(targetAgentId) ?? primary.identity.owner;
    const reasonCode = input.review.normalizedFailureKey ?? "sub_agent_result_review_feedback_required";
    const exchangeId = `exchange:feedback:${feedbackRequestId}`;
    const additionalContextRefs = unique([...(input.additionalContextRefs ?? []), exchangeId]);
    const retryBudgetRemaining = Math.max(0, input.retryBudgetRemaining ??
        input.review.feedbackRequest?.retryBudgetRemaining ??
        Math.max(0, input.review.retryBudgetRemaining - 1));
    const synthesizedContext = createDataExchangePackage({
        sourceOwner,
        recipientOwner,
        ...(input.requestingAgentNicknameSnapshot
            ? { sourceNicknameSnapshot: input.requestingAgentNicknameSnapshot }
            : {}),
        ...(input.targetAgentNicknameSnapshot
            ? { recipientNicknameSnapshot: input.targetAgentNicknameSnapshot }
            : {}),
        purpose: "Structured feedback context for sub-session revision.",
        allowedUse: "temporary_context",
        retentionPolicy: "session_only",
        redactionState: "not_sensitive",
        provenanceRefs: sourceResultReportIds,
        parentRunId,
        ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
        ...(primary.subSessionId ? { parentSubSessionId: primary.subSessionId } : {}),
        ...(input.parentRequestId ? { parentRequestId: input.parentRequestId } : {}),
        ...(primary.identity.auditCorrelationId
            ? { auditCorrelationId: primary.identity.auditCorrelationId }
            : {}),
        exchangeId,
        idempotencyKey: `feedback-context:${parentRunId}:${feedbackRequestId}`,
        now: () => now,
        payload: {
            kind: "sub_session_feedback_context",
            parentRunId,
            sourceResultReportIds,
            previousSubSessionIds,
            carryForwardOutputs,
            missingItems,
            conflictItems,
            requiredChanges,
            additionalConstraints,
            expectedRevisionOutputIds: input.expectedOutputs.map((output) => output.outputId),
            review: {
                verdict: input.review.verdict,
                parentIntegrationStatus: input.review.parentIntegrationStatus,
                normalizedFailureKey: input.review.normalizedFailureKey ?? null,
                issueCodes: input.review.issues.map((issue) => issue.code),
                risksOrGaps: input.review.risksOrGaps,
                impossibleReason: impossibleReasonPayload(input.review.impossibleReason),
            },
        },
    });
    if (input.persistSynthesizedContext !== false) {
        ;
        (input.persistDataExchange ?? persistDataExchangePackage)(synthesizedContext, {
            auditId: primary.identity.auditCorrelationId ?? null,
            now,
        });
    }
    const identity = {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        entityType: "sub_session",
        entityId: feedbackRequestId,
        owner: sourceOwner,
        idempotencyKey: `feedback:${parentRunId}:${previousSubSessionIds.join("+")}:${reasonCode}:${feedbackRequestId}`,
        ...(primary.identity.auditCorrelationId
            ? { auditCorrelationId: primary.identity.auditCorrelationId }
            : {}),
        parent: {
            ...primary.identity.parent,
            parentRunId,
            ...(input.parentSessionId ? { parentSessionId: input.parentSessionId } : {}),
            parentSubSessionId: primary.subSessionId,
        },
    };
    const feedbackRequest = {
        identity,
        feedbackRequestId,
        parentRunId,
        subSessionId: primary.subSessionId,
        sourceResultReportIds,
        previousSubSessionIds,
        targetAgentPolicy: input.targetAgentPolicy,
        ...(targetAgentId ? { targetAgentId } : {}),
        ...(input.targetAgentNicknameSnapshot
            ? { targetAgentNicknameSnapshot: input.targetAgentNicknameSnapshot }
            : {}),
        ...(input.requestingAgentNicknameSnapshot
            ? { requestingAgentNicknameSnapshot: input.requestingAgentNicknameSnapshot }
            : {}),
        synthesizedContextExchangeId: synthesizedContext.exchangeId,
        carryForwardOutputs,
        missingItems,
        conflictItems,
        requiredChanges,
        additionalConstraints,
        additionalContextRefs,
        expectedRevisionOutputs: input.expectedOutputs,
        retryBudgetRemaining,
        reasonCode,
        createdAt: now,
    };
    return {
        feedbackRequest,
        synthesizedContext,
        directive: buildSubSessionFeedbackCycleDirective(feedbackRequest),
    };
}
export function buildRedelegatedSubSessionInput(input) {
    const idProvider = input.idProvider ?? (() => randomUUID());
    const source = input.sourceSubSession;
    const basePrompt = source.promptBundleSnapshot;
    const subSessionId = input.subSessionId ?? `sub:redelegated:${source.subSessionId}:${idProvider()}`;
    const commandRequestId = input.commandRequestId ?? `command:${subSessionId}`;
    const expectedOutputs = input.feedbackRequest.expectedRevisionOutputs;
    const taskScope = {
        ...(basePrompt?.taskScope ?? {
            goal: "Revise delegated sub-session result.",
            intentType: "review",
            actionType: "sub_agent_feedback_revision",
            constraints: [],
            expectedOutputs,
            reasonCodes: [],
        }),
        constraints: unique([
            ...(basePrompt?.taskScope.constraints ?? []),
            ...input.feedbackRequest.requiredChanges,
            ...input.feedbackRequest.additionalConstraints,
        ]),
        expectedOutputs,
        reasonCodes: unique([
            ...(basePrompt?.taskScope.reasonCodes ?? []),
            input.feedbackRequest.reasonCode,
            "feedback_redelegation",
        ]),
    };
    const command = {
        identity: {
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            entityType: "sub_session",
            entityId: subSessionId,
            owner: { ownerType: "sub_agent", ownerId: input.targetAgentId },
            idempotencyKey: `redelegate:${input.feedbackRequest.feedbackRequestId}:${input.targetAgentId}`,
            ...(source.identity.auditCorrelationId
                ? { auditCorrelationId: source.identity.auditCorrelationId }
                : {}),
            parent: {
                ...source.identity.parent,
                parentRunId: source.parentRunId,
                parentSessionId: source.parentSessionId,
                parentSubSessionId: source.subSessionId,
            },
        },
        commandRequestId,
        parentRunId: source.parentRunId,
        subSessionId,
        targetAgentId: input.targetAgentId,
        ...(input.targetAgentNickname ? { targetNicknameSnapshot: input.targetAgentNickname } : {}),
        taskScope,
        contextPackageIds: unique([
            ...input.feedbackRequest.additionalContextRefs,
            ...(input.feedbackRequest.synthesizedContextExchangeId
                ? [input.feedbackRequest.synthesizedContextExchangeId]
                : []),
        ]),
        expectedOutputs,
        retryBudget: input.feedbackRequest.retryBudgetRemaining,
    };
    const promptBundle = buildRedelegatedPromptBundle({
        source,
        targetAgentId: input.targetAgentId,
        feedbackRequest: input.feedbackRequest,
        taskScope,
        ...(basePrompt ? { basePrompt } : {}),
        ...(input.targetAgentDisplayName
            ? { targetAgentDisplayName: input.targetAgentDisplayName }
            : {}),
        ...(input.targetAgentNickname ? { targetAgentNickname: input.targetAgentNickname } : {}),
    });
    return {
        command,
        parentAgent: {
            agentId: source.parentAgentId ?? "agent:nobie",
            ...(source.parentAgentDisplayName
                ? { displayName: source.parentAgentDisplayName }
                : {
                    displayName: source.parentAgentId ?? "Nobie",
                }),
            ...(source.parentAgentNickname ? { nickname: source.parentAgentNickname } : {}),
        },
        agent: {
            agentId: input.targetAgentId,
            displayName: input.targetAgentDisplayName ?? input.targetAgentId,
            ...(input.targetAgentNickname ? { nickname: input.targetAgentNickname } : {}),
        },
        parentSessionId: source.parentSessionId,
        promptBundle,
    };
}
function buildRedelegatedPromptBundle(input) {
    const base = input.basePrompt;
    const owner = { ownerType: "sub_agent", ownerId: input.targetAgentId };
    const fallback = {
        identity: input.source.identity,
        bundleId: `prompt-bundle:${input.targetAgentId}:${input.feedbackRequest.feedbackRequestId}`,
        agentId: input.targetAgentId,
        agentType: "sub_agent",
        role: "feedback revision worker",
        displayNameSnapshot: input.targetAgentDisplayName ?? input.targetAgentId,
        personalitySnapshot: "Precise",
        teamContext: [],
        memoryPolicy: {
            owner,
            visibility: "private",
            readScopes: [owner],
            writeScope: owner,
            retentionPolicy: "short_term",
            writebackReviewRequired: true,
        },
        capabilityPolicy: {
            permissionProfile: {
                profileId: "profile:feedback-redelegation",
                riskCeiling: "moderate",
                approvalRequiredFrom: "dangerous",
                allowExternalNetwork: false,
                allowFilesystemWrite: false,
                allowShellExecution: false,
                allowScreenControl: false,
                allowedPaths: [],
            },
            skillMcpAllowlist: {
                enabledSkillIds: [],
                enabledMcpServerIds: [],
                enabledToolNames: [],
                disabledToolNames: [],
            },
            rateLimit: { maxConcurrentCalls: 1 },
        },
        taskScope: input.taskScope,
        safetyRules: [],
        sourceProvenance: [],
        createdAt: input.feedbackRequest.createdAt ?? Date.now(),
    };
    const memoryPolicy = base?.memoryPolicy
        ? {
            ...base.memoryPolicy,
            owner,
            readScopes: [owner],
            writeScope: owner,
        }
        : {
            owner,
            visibility: "private",
            readScopes: [owner],
            writeScope: owner,
            retentionPolicy: "short_term",
            writebackReviewRequired: true,
        };
    return {
        ...(base ?? fallback),
        identity: {
            ...(base?.identity ?? input.source.identity),
            entityType: "capability",
            entityId: `prompt-bundle:${input.targetAgentId}:${input.feedbackRequest.feedbackRequestId}`,
            owner,
        },
        bundleId: `prompt-bundle:${input.targetAgentId}:${input.feedbackRequest.feedbackRequestId}`,
        agentId: input.targetAgentId,
        displayNameSnapshot: input.targetAgentDisplayName ?? input.targetAgentId,
        ...(input.targetAgentNickname ? { nicknameSnapshot: input.targetAgentNickname } : {}),
        memoryPolicy,
        taskScope: input.taskScope,
        completionCriteria: input.feedbackRequest.expectedRevisionOutputs,
        sourceProvenance: [
            ...(base?.sourceProvenance ?? []),
            {
                sourceId: input.feedbackRequest.feedbackRequestId,
                version: "feedback",
            },
        ],
        createdAt: input.feedbackRequest.createdAt ?? base?.createdAt ?? Date.now(),
    };
}
function collectCarryForwardOutputs(resultReports) {
    const byOutputId = new Map();
    for (const report of resultReports) {
        for (const output of report.outputs) {
            if (output.status === "missing")
                continue;
            const next = {
                outputId: output.outputId,
                status: output.status === "partial" ? "partial" : "satisfied",
                ...(output.value !== undefined ? { value: output.value } : {}),
            };
            const current = byOutputId.get(output.outputId);
            if (!current || current.status === "partial" || next.status === "satisfied") {
                byOutputId.set(output.outputId, next);
            }
        }
    }
    return [...byOutputId.values()].sort((left, right) => left.outputId.localeCompare(right.outputId));
}
function ownerForAgent(agentId) {
    if (!agentId)
        return undefined;
    return {
        ownerType: agentId === "agent:nobie" ? "nobie" : "sub_agent",
        ownerId: agentId,
    };
}
function impossibleReasonPayload(value) {
    if (!value)
        return null;
    return {
        kind: value.kind,
        reasonCode: value.reasonCode,
        detail: value.detail,
    };
}
function unique(values) {
    return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
//# sourceMappingURL=feedback-loop.js.map