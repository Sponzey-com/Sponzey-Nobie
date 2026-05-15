import type { AIConnectionConfig } from "../config/types.js";
import type { ExecutorDraft, ExecutorGraphWorkspace } from "./executor-graph.js";
import { type NodeDefinitionRedactionMode } from "./node-definition-redaction.js";
export declare const NODE_DEFINITION_FIELDS: readonly ["name", "description", "expectedOutput", "successCriteria", "capabilityHints", "toolHints", "understandingSummary"];
export type NodeDefinitionField = typeof NODE_DEFINITION_FIELDS[number];
export type NodeDefinitionTriggerField = NodeDefinitionField | "whole_node";
export type NodeDefinitionDialogState = "idle" | "editing_prompt" | "loading" | "showing_alternatives" | "applying" | "error";
export type NodeDefinitionFieldLocks = Record<NodeDefinitionField, boolean>;
export interface NodeDefinitionDraft {
    executorId: string;
    name: string;
    description: string;
    quickChips?: string[];
    expectedOutput: string;
    successCriteria: string[];
    capabilityHints: string[];
    toolHints: string[];
    understandingSummary: string;
    fieldLocks: NodeDefinitionFieldLocks;
    aiSuggestionState?: {
        suggestionRunId?: string;
        selectedAlternativeId?: string;
        appliedFieldNames?: NodeDefinitionField[];
    };
}
export interface NodeContextSummary {
    executorId: string;
    name: string;
    description: string;
    connectionLabel?: string;
    direction: "incoming" | "outgoing";
}
export interface NodeDefinitionGraphContext {
    incomingExecutors: NodeContextSummary[];
    outgoingExecutors: NodeContextSummary[];
    neighborConnectionMeanings: string[];
}
export interface NodeDefinitionSuggestionHistoryItem {
    suggestionRunId?: string;
    userPrompt: string;
    alternativeSummaries: string[];
    selectedAlternativeId?: string;
    rejectedAlternativeIds: string[];
}
export interface NodeDefinitionSuggestionRequest {
    workspaceId: string;
    topologyId: string;
    executorId?: string;
    triggerField: NodeDefinitionTriggerField;
    targetFields: NodeDefinitionField[];
    userPrompt: string;
    quickChips: string[];
    currentDraft: NodeDefinitionDraft;
    fieldLocks: NodeDefinitionFieldLocks;
    graphContext: NodeDefinitionGraphContext;
    redaction: {
        mode: NodeDefinitionRedactionMode;
        redactedFields: string[];
    };
    suggestionHistory: NodeDefinitionSuggestionHistoryItem[];
    modelPreference?: {
        providerId?: string;
        modelId?: string;
    };
}
export interface NodeDefinitionSuggestionWarning {
    code: "redaction_applied" | "locked_field_removed" | "unknown_field_removed" | "internal_term_removed" | "alternative_too_short" | "alternatives_too_similar" | "llm_not_configured" | "llm_response_invalid" | "rate_limited";
    message: string;
}
export interface NodeDefinitionAlternative {
    alternativeId: string;
    title: string;
    summary: string;
    patch: Partial<Omit<NodeDefinitionDraft, "executorId" | "fieldLocks" | "aiSuggestionState">>;
    rationale: string;
    recommendedConnectionMeaning?: string;
    riskNotes: string[];
    confidence: number;
}
export interface NodeDefinitionSuggestionResponse {
    ok: true;
    suggestionRunId: string;
    alternatives: NodeDefinitionAlternative[];
    modelInfo: {
        providerId: string;
        modelId: string;
        isLocal: boolean;
    };
    appliedRedaction: {
        mode: NodeDefinitionRedactionMode;
        redactedFields: string[];
    };
    warnings: NodeDefinitionSuggestionWarning[];
}
export type NodeDefinitionSuggestionErrorCode = "llm_not_configured" | "llm_response_invalid" | "no_target_fields" | "redaction_failed" | "rate_limited";
export interface NodeDefinitionSuggestionErrorResponse {
    ok: false;
    error: NodeDefinitionSuggestionErrorCode;
    message: string;
    warnings: NodeDefinitionSuggestionWarning[];
}
export type NodeDefinitionSuggestionResult = NodeDefinitionSuggestionResponse | NodeDefinitionSuggestionErrorResponse;
export interface ApplyNodeDefinitionAlternativeInput {
    executorId: string;
    alternativeId: string;
    draft: NodeDefinitionDraft;
    patch: NodeDefinitionAlternative["patch"];
    fieldLocks: NodeDefinitionFieldLocks;
}
export interface NodeDefinitionDraftDiffItem {
    field: NodeDefinitionField;
    before: unknown;
    after: unknown;
    locked: boolean;
}
export interface ApplyNodeDefinitionAlternativeResult {
    draft: NodeDefinitionDraft;
    previousDraft: NodeDefinitionDraft;
    diff: NodeDefinitionDraftDiffItem[];
    appliedFields: NodeDefinitionField[];
    ignoredLockedFields: NodeDefinitionField[];
}
export declare const NODE_DEFINITION_ROLE_CHIPS: readonly ["실행자", "분석자", "검토자", "승인자", "문제 해결자", "결과 정리자"];
export declare const NODE_DEFINITION_STYLE_CHIPS: readonly ["빠르게", "꼼꼼하게", "초보자도 이해 가능하게", "결과 중심으로", "협업하기 좋게", "실패 대안까지 포함"];
export declare const NODE_DEFINITION_OUTPUT_CHIPS: readonly ["구현 결과", "검토 의견", "작업 분할", "요약 보고", "테스트 결과", "다음 실행자에게 넘길 내용"];
export declare function normalizeNodeDefinitionQuickChips(values: unknown): string[];
export declare function initialNodeDefinitionQuickChipsFromDraft(draft: Pick<NodeDefinitionDraft, "name" | "description" | "capabilityHints" | "understandingSummary" | "quickChips">): string[];
export declare function defaultNodeDefinitionFieldLocks(overrides?: Partial<NodeDefinitionFieldLocks>): NodeDefinitionFieldLocks;
export declare function fieldLocksForNodeDefinitionTrigger(triggerField: NodeDefinitionTriggerField, userLocks?: Partial<NodeDefinitionFieldLocks>): NodeDefinitionFieldLocks;
export declare function targetFieldsForNodeDefinitionTrigger(triggerField: NodeDefinitionTriggerField, locks: NodeDefinitionFieldLocks): NodeDefinitionField[];
export declare function nodeDefinitionDraftFromExecutor(executor: ExecutorDraft, locks?: Partial<NodeDefinitionFieldLocks>): NodeDefinitionDraft;
export declare function executorFromNodeDefinitionDraft(input: {
    executor: ExecutorDraft;
    draft: NodeDefinitionDraft;
    now?: number | string;
}): ExecutorDraft;
export declare function buildNodeDefinitionGraphContext(input: {
    graph?: ExecutorGraphWorkspace | null;
    executorId?: string;
}): NodeDefinitionGraphContext;
export declare function normalizeNodeDefinitionSuggestionRequest(request: Partial<NodeDefinitionSuggestionRequest>): NodeDefinitionSuggestionRequest;
export declare function buildNodeDefinitionPromptInput(request: NodeDefinitionSuggestionRequest): string;
export declare function applyNodeDefinitionAlternative(input: ApplyNodeDefinitionAlternativeInput): ApplyNodeDefinitionAlternativeResult;
export declare function createNodeDefinitionSuggestion(input: {
    request: Partial<NodeDefinitionSuggestionRequest>;
    modelConfig?: AIConnectionConfig;
    workspaceStrictRedaction?: boolean;
}, dependencies?: {
    generateStructured?: (input: {
        prompt: string;
        request: NodeDefinitionSuggestionRequest;
        modelInfo: NodeDefinitionSuggestionResponse["modelInfo"];
    }) => Promise<unknown> | unknown;
    idProvider?: () => string;
}): Promise<NodeDefinitionSuggestionResult>;
export declare function validateNodeDefinitionSuggestionPayload(input: {
    raw: unknown;
    request: NodeDefinitionSuggestionRequest;
    suggestionRunId: string;
    modelInfo: NodeDefinitionSuggestionResponse["modelInfo"];
    redactedFields?: string[];
    redactionMode?: NodeDefinitionRedactionMode;
}): NodeDefinitionSuggestionResult;
//# sourceMappingURL=node-definition-suggestion.d.ts.map