import type { AIProvider } from "../ai/types.js";
export type MemoryCompactionModelSource = "explicit_override" | "fallback_override" | "execution_model";
export type MemoryCompactionModelAttemptStatus = "selected" | "provider_budget_blocked" | "provider_call_failed" | "invalid_json" | "skipped_duplicate";
export interface MemoryCompactionModelAttempt {
    modelId: string;
    source: MemoryCompactionModelSource;
    maxContextTokens: number;
    status: MemoryCompactionModelAttemptStatus;
    error?: string;
}
export interface MemoryCompactionPolicySnapshot {
    executionModelId: string;
    selectedModelId: string;
    selectionSource: MemoryCompactionModelSource;
    fallbackModelId?: string;
    minContextTokens: number;
    providerBudgetBlocked: boolean;
}
export interface MemoryCompactionModelAudit {
    executionModelId: string;
    selectedModelId?: string;
    selectionSource?: MemoryCompactionModelSource;
    fallbackModelId?: string;
    minContextTokens: number;
    providerBudgetBlocked: boolean;
    fallbackApplied: boolean;
    heuristicFallbackApplied: boolean;
    deterministicStateProtected: true;
    attempts: MemoryCompactionModelAttempt[];
}
export interface ResolvedMemoryCompactionPolicy {
    snapshot: MemoryCompactionPolicySnapshot;
    candidates: Array<{
        modelId: string;
        source: MemoryCompactionModelSource;
        maxContextTokens: number;
    }>;
}
export declare function resolveMemoryCompactionPolicy(input: {
    provider: AIProvider;
    executionModelId: string;
}): ResolvedMemoryCompactionPolicy;
export declare function buildDefaultMemoryCompactionAudit(input: {
    executionModelId: string;
    selectedModelId?: string;
    selectionSource?: MemoryCompactionModelSource;
    fallbackModelId?: string;
    minContextTokens: number;
    providerBudgetBlocked: boolean;
    attempts?: MemoryCompactionModelAttempt[];
    fallbackApplied?: boolean;
    heuristicFallbackApplied?: boolean;
}): MemoryCompactionModelAudit;
//# sourceMappingURL=model-policy.d.ts.map