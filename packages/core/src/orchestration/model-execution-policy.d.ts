import type { AgentPromptBundle, ModelExecutionSnapshot, ModelProfile } from "../contracts/sub-agent-orchestration.js";
export type ModelAvailabilityStatus = "available" | "degraded" | "unavailable";
export interface ProviderModelCapability {
    providerId: string;
    modelId: string;
    available: boolean;
    contextWindowTokens: number | null;
    maxOutputTokens: number;
    inputCostPer1kTokens: number;
    outputCostPer1kTokens: number;
    supportedEfforts?: string[];
    reasonCodes?: string[];
}
export interface ModelAvailabilityDoctorSnapshot {
    providerId: string;
    modelId: string;
    status: ModelAvailabilityStatus;
    reasonCodes: string[];
    checkedAt?: number;
}
export interface ResolvedModelExecutionPolicy {
    status: "allowed" | "blocked";
    reasonCode: string;
    userMessage: string;
    snapshot?: ModelExecutionSnapshot;
    primaryModel?: ProviderModelCapability;
    activeModel?: ProviderModelCapability;
    diagnostics: string[];
}
export interface ModelExecutionAuditSummary extends ModelExecutionSnapshot {
    status: "completed" | "failed" | "blocked";
    tokenUsage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimated: true;
    };
}
export declare const DEFAULT_MODEL_TIMEOUT_MS = 30000;
export declare const DEFAULT_MODEL_RETRY_COUNT = 0;
export declare const DEFAULT_PROVIDER_MODEL_CAPABILITY_MATRIX: ProviderModelCapability[];
export declare function estimateTokenCount(text: string | undefined): number;
export declare function estimateModelExecutionCost(input: {
    capability: ProviderModelCapability;
    inputTokens: number;
    outputTokens: number;
}): number;
export declare function resolveModelExecutionPolicy(input: {
    agentId: string;
    promptBundle?: AgentPromptBundle;
    modelProfile?: ModelProfile;
    providerMatrix?: ProviderModelCapability[];
    doctor?: ModelAvailabilityDoctorSnapshot | ModelAvailabilityDoctorSnapshot[];
    estimatedInputTokens?: number;
    estimatedOutputTokens?: number;
    forceFallbackReasonCode?: string;
}): ResolvedModelExecutionPolicy;
export declare function resolveFallbackModelExecutionPolicy(input: {
    current: ResolvedModelExecutionPolicy;
    reasonCode: string;
    promptBundle?: AgentPromptBundle;
    providerMatrix?: ProviderModelCapability[];
    doctor?: ModelAvailabilityDoctorSnapshot | ModelAvailabilityDoctorSnapshot[];
}): ResolvedModelExecutionPolicy;
export declare function buildModelExecutionAuditSummary(input: {
    snapshot: ModelExecutionSnapshot;
    status: ModelExecutionAuditSummary["status"];
    attemptCount: number;
    latencyMs: number;
    outputText?: string;
}): ModelExecutionAuditSummary;
export declare function buildModelAvailabilityDoctorSnapshot(input: {
    providerId: string;
    modelId: string;
    status: ModelAvailabilityStatus;
    reasonCodes?: string[];
    checkedAt?: number;
}): ModelAvailabilityDoctorSnapshot;
//# sourceMappingURL=model-execution-policy.d.ts.map