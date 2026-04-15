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
    return resolveExecutionSemantics(params);
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
    const base = params.executionSemantics ?? buildDefaultTaskExecutionSemantics();
    const shouldUseDirectArtifactDelivery = shouldTreatAsDirectArtifactDelivery(params, base);
    if (base.artifactDelivery === "direct" && !shouldUseDirectArtifactDelivery) {
        return {
            ...base,
            artifactDelivery: "none",
        };
    }
    if (base.artifactDelivery === "direct")
        return base;
    if (!shouldUseDirectArtifactDelivery)
        return base;
    return {
        ...base,
        artifactDelivery: "direct",
    };
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
function shouldTreatAsDirectArtifactDelivery(params, executionSemantics) {
    if (executionSemantics.approvalTool === "screen_capture" || executionSemantics.approvalTool === "yeonjang_camera_capture") {
        return true;
    }
    const userFacingRequest = [params.originalRequest, params.structuredRequest?.target, params.intentEnvelope?.target]
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .join("\n");
    const plainTextInformationRequest = looksLikePlainTextInformationRequest(userFacingRequest || params.message);
    const combined = [
        params.message,
        params.originalRequest,
        params.structuredRequest?.target,
        params.structuredRequest?.normalized_english,
        params.intentEnvelope?.target,
        params.intentEnvelope?.normalized_english,
    ]
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .join("\n");
    if (!combined)
        return false;
    const normalized = combined.trim();
    if (!normalized)
        return false;
    const referencesExplicitArtifactFile = /\.(pdf|png|jpe?g|webp|csv|json|txt|docx|xlsx)\b/iu.test(normalized);
    const referencesArtifactImage = /(screen\s*capture|screenshot|screen shot|camera\s*capture|take\s+(?:a\s+)?photo|take\s+(?:a\s+)?picture)/iu.test(normalized)
        || /(화면\s*캡처|스크린\s*캡처|스크린샷|캡쳐|카메라\s*(?:캡처|촬영)|사진\s*촬영)/u.test(combined);
    const referencesArtifactDelivery = (/\b(file|document|attachment|report|image|artifact)\b/iu.test(normalized)
        && /\b(send|deliver|attach|return|export|show)\b/iu.test(normalized)) || (/(?:파일|문서|첨부|보고서|이미지)/u.test(normalized)
        && /(?:보내|전달|첨부|반환|내보내|보여)/u.test(normalized));
    if (referencesExplicitArtifactFile || referencesArtifactImage)
        return true;
    if (plainTextInformationRequest)
        return false;
    return referencesArtifactDelivery;
}
export function looksLikePlainTextInformationRequest(value) {
    const normalized = value.trim();
    if (!normalized)
        return false;
    const asksForInformation = /(?:날씨|기온|온도|습도|바람|강수|뉴스|소식|환율|주가|시세|검색|조회|알려|어때|뭐야|몇|weather|temperature|humidity|wind|forecast|news|exchange rate|stock|price|current|today|now)/iu.test(normalized);
    if (!asksForInformation)
        return false;
    const requestsArtifact = /(?:화면\s*캡처|스크린\s*캡처|스크린샷|캡쳐|카메라\s*(?:캡처|촬영)|사진\s*촬영|파일|문서|첨부|이미지|다운로드|보고서\s*파일|screenshot|screen\s*capture|camera\s*capture|take\s+(?:a\s+)?photo|take\s+(?:a\s+)?picture|file|attachment|image|download)/iu.test(normalized);
    return !requestsArtifact;
}
//# sourceMappingURL=execution-profile.js.map
