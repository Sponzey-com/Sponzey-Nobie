import { createRecoveryBudgetUsage } from "./recovery-budget.js";
export function buildResolvedExecutionProfile(params) {
    const executionSemantics = resolveExecutionSemantics(params);
    const structuredRequest = params.structuredRequest
        ?? (params.intentEnvelope ? buildStructuredRequestFromEnvelope(params.intentEnvelope) : undefined)
        ?? buildFallbackStructuredRequest(params.originalRequest?.trim() || params.message);
    const intentEnvelope = repairIntentEnvelope({
        intentEnvelope: params.intentEnvelope,
        structuredRequest,
        executionSemantics,
    });
    return {
        originalRequest: params.originalRequest?.trim() || params.message,
        structuredRequest,
        intentEnvelope,
        executionSemantics,
        requiresFilesystemMutation: executionSemantics.filesystemEffect === "mutate",
        requiresPrivilegedToolExecution: executionSemantics.privilegedOperation === "required",
        wantsDirectArtifactDelivery: executionSemantics.artifactDelivery === "direct",
        approvalRequired: executionSemantics.approvalRequired,
        approvalTool: executionSemantics.approvalTool,
    };
}
export function normalizeDirectArtifactDeliverySemantics(params) {
    const executionSemantics = resolveExecutionSemantics(params);
    if (executionSemantics.artifactDelivery === "direct" &&
        executionSemantics.filesystemEffect === "none" &&
        executionSemantics.privilegedOperation === "none") {
        return {
            ...executionSemantics,
            artifactDelivery: "none",
        };
    }
    return executionSemantics;
}
export function createExecutionLoopRuntimeState(params) {
    const executionProfile = buildResolvedExecutionProfile(params);
    return {
        executionProfile,
        originalUserRequest: executionProfile.originalRequest,
        priorAssistantMessages: [],
        seenFollowupPrompts: new Set(),
        seenCommandFailureRecoveryKeys: new Set(),
        seenExecutionRecoveryKeys: new Set(),
        seenDeliveryRecoveryKeys: new Set(),
        seenAiRecoveryKeys: new Set(),
        recoveryBudgetUsage: createRecoveryBudgetUsage(),
        requiresFilesystemMutation: executionProfile.requiresFilesystemMutation,
        requiresPrivilegedToolExecution: executionProfile.requiresPrivilegedToolExecution,
        pendingToolParams: new Map(),
        filesystemMutationPaths: new Set(),
    };
}
function buildFallbackStructuredRequest(message) {
    const normalized = message.trim();
    const sourceLanguage = /[가-힣]/u.test(normalized)
        ? /[A-Za-z]/.test(normalized) ? "mixed" : "ko"
        : /[A-Za-z]/.test(normalized) ? "en" : "unknown";
    return {
        ...buildDefaultTaskStructuredRequest(),
        source_language: sourceLanguage,
        normalized_english: normalized,
        target: normalized || "Execute the requested work.",
        to: "the current channel",
        context: normalized ? [`Original user request: ${normalized}`] : [],
        complete_condition: ["The requested work is completed and the result is delivered in the current channel."],
    };
}
function buildDefaultTaskExecutionSemantics() {
    return {
        filesystemEffect: "none",
        privilegedOperation: "none",
        artifactDelivery: "none",
        approvalRequired: false,
        approvalTool: "external_action",
    };
}
function buildDefaultTaskStructuredRequest() {
    return {
        source_language: "unknown",
        normalized_english: "",
        target: "",
        to: "",
        context: [],
        complete_condition: [],
    };
}
function buildStructuredRequestFromEnvelope(envelope) {
    return {
        source_language: envelope.source_language,
        normalized_english: envelope.normalized_english,
        target: envelope.target,
        to: envelope.destination,
        context: [...envelope.context],
        complete_condition: [...envelope.complete_condition],
    };
}
function buildFallbackIntentEnvelope(structuredRequest, executionSemantics) {
    return {
        intent_type: "task_intake",
        source_language: structuredRequest.source_language,
        normalized_english: structuredRequest.normalized_english,
        target: structuredRequest.target,
        destination: structuredRequest.to,
        context: [...structuredRequest.context],
        complete_condition: [...structuredRequest.complete_condition],
        schedule_spec: {
            detected: false,
            kind: "none",
            status: "not_applicable",
            schedule_text: "",
        },
        execution_semantics: executionSemantics,
        delivery_mode: executionSemantics.artifactDelivery,
        requires_approval: executionSemantics.approvalRequired,
        approval_tool: executionSemantics.approvalTool,
        preferred_target: "auto",
        needs_tools: executionSemantics.filesystemEffect === "mutate" || executionSemantics.privilegedOperation === "required",
        needs_web: false,
    };
}
function resolveExecutionSemantics(params) {
    void params.message;
    void params.originalRequest;
    void params.structuredRequest;
    void params.intentEnvelope;
    return params.executionSemantics ?? buildDefaultTaskExecutionSemantics();
}
function repairIntentEnvelope(params) {
    if (!params.intentEnvelope) {
        return buildFallbackIntentEnvelope(params.structuredRequest, params.executionSemantics);
    }
    return {
        ...params.intentEnvelope,
        execution_semantics: params.executionSemantics,
        delivery_mode: params.executionSemantics.artifactDelivery,
    };
}
//# sourceMappingURL=execution-profile.js.map