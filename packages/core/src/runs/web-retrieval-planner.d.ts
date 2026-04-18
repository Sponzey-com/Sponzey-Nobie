import type { SourceFreshnessPolicy, WebRetrievalMethod } from "./web-retrieval-policy.js";
import { type RetrievalAttempt, type RetrievalSourceMethod, type RetrievalTargetContract } from "./web-retrieval-session.js";
export type WebRetrievalPlannerMethod = Exclude<RetrievalSourceMethod, "ai_assisted_planner">;
export type WebRetrievalPlannerRisk = "low" | "medium" | "high";
export type WebRetrievalPlannerStopReason = "policy_block" | "target_ambiguity" | "no_further_safe_source" | "budget_exhausted" | "provider_unavailable";
export type WebRetrievalPlannerRunStatus = "planned" | "stopped" | "rejected" | "degraded";
export type WebRetrievalPlannerDegradedReason = "provider_unavailable" | "planner_timeout" | "budget_exhausted" | "invalid_response";
export interface WebRetrievalPlannerAction {
    method: WebRetrievalPlannerMethod;
    query?: string;
    url?: string;
    expectedTargetBinding: string;
    reason: string;
    risk: WebRetrievalPlannerRisk;
}
export interface WebRetrievalPlannerOutput {
    nextActions: WebRetrievalPlannerAction[];
    stopReason?: WebRetrievalPlannerStopReason;
}
export interface WebRetrievalPlannerAttemptSummary {
    method: RetrievalSourceMethod;
    status: string;
    query?: string | null;
    url?: string | null;
    sourceDomain?: string | null;
    errorKind?: string | null;
    stopReason?: string | null;
    dedupeKey?: string | null;
}
export interface WebRetrievalPlannerPromptInput {
    originalRequest: string;
    targetContract: RetrievalTargetContract;
    attemptedSources: WebRetrievalPlannerAttemptSummary[];
    failureSummary: string;
    allowedMethods: WebRetrievalPlannerMethod[];
    freshnessPolicy: SourceFreshnessPolicy;
    now?: Date;
}
export interface WebRetrievalPlannerDomainPolicy {
    allowedDomains?: string[];
    blockedDomains?: string[];
}
export interface WebRetrievalPlannerValidationInput {
    rawOutput: unknown;
    targetContract: RetrievalTargetContract;
    freshnessPolicy: SourceFreshnessPolicy;
    allowedMethods: WebRetrievalPlannerMethod[];
    attemptedDedupeKeys?: string[];
    attemptedSources?: WebRetrievalPlannerAttemptSummary[];
    domainPolicy?: WebRetrievalPlannerDomainPolicy;
}
export interface RejectedPlannerAction {
    action: unknown;
    reason: string;
}
export interface WebRetrievalPlannerValidationResult {
    accepted: boolean;
    output: WebRetrievalPlannerOutput | null;
    acceptedActions: WebRetrievalPlannerAction[];
    rejectedActions: RejectedPlannerAction[];
    errors: string[];
    stopReason?: WebRetrievalPlannerStopReason;
}
export interface RunWebRetrievalPlannerInput extends Omit<WebRetrievalPlannerPromptInput, "now"> {
    callPlanner?: (prompt: string, signal: AbortSignal) => Promise<string>;
    plannerCallsUsed?: number;
    maxPlannerCalls?: number;
    timeoutMs?: number;
    remainingHardBudgetMs?: number;
    domainPolicy?: WebRetrievalPlannerDomainPolicy;
    now?: Date;
}
export interface WebRetrievalPlannerRunResult {
    status: WebRetrievalPlannerRunStatus;
    prompt: string | null;
    validation: WebRetrievalPlannerValidationResult | null;
    actions: WebRetrievalPlannerAction[];
    stopReason?: WebRetrievalPlannerStopReason;
    degradedReason?: WebRetrievalPlannerDegradedReason;
    userMessage: string;
}
export declare function buildWebRetrievalPlannerPrompt(input: WebRetrievalPlannerPromptInput): string;
export declare function validateWebRetrievalPlannerOutput(input: WebRetrievalPlannerValidationInput): WebRetrievalPlannerValidationResult;
export declare function attemptsToPlannerSummaries(attempts: RetrievalAttempt[]): WebRetrievalPlannerAttemptSummary[];
export declare function buildPlannerCallIdempotencyKey(input: {
    targetContract: RetrievalTargetContract;
    failureSummary: string;
    attemptedSources: WebRetrievalPlannerAttemptSummary[];
    freshnessPolicy: SourceFreshnessPolicy;
}): string;
export declare function runWebRetrievalPlanner(input: RunWebRetrievalPlannerInput): Promise<WebRetrievalPlannerRunResult>;
export declare function methodToToolName(method: WebRetrievalPlannerMethod): WebRetrievalMethod | "known_source_adapter";
//# sourceMappingURL=web-retrieval-planner.d.ts.map