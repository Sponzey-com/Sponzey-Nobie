import { type AIProvider } from "../ai/index.js";
import { type ScheduleContract } from "../contracts/index.js";
export type ScheduleContractComparisonDecision = "same" | "different" | "clarify";
export type ScheduleContractComparisonReasonCode = "same_schedule_identity" | "different_payload" | "different_time" | "different_destination" | "target_ambiguous" | "invalid_candidate_selection" | "invalid_ai_response" | "comparator_timeout" | "no_configured_provider" | "provider_error" | "no_candidates";
export interface ScheduleContractComparisonCandidate {
    id: string;
    contract: ScheduleContract;
    metadata?: {
        name?: string;
        createdAt?: number;
        nextRunAt?: number | null;
    };
}
export interface ScheduleContractComparisonResult {
    decision: ScheduleContractComparisonDecision;
    candidateId?: string;
    reasonCode: ScheduleContractComparisonReasonCode;
    userMessage: string;
}
export declare function buildScheduleContractComparisonSystemPrompt(): string;
export declare function parseScheduleContractComparisonResult(raw: string, allowedCandidateIds: ReadonlySet<string>): ScheduleContractComparisonResult;
export declare function compareScheduleContractsWithAI(params: {
    incoming: ScheduleContract;
    candidates: ScheduleContractComparisonCandidate[];
    model?: string;
    providerId?: string;
    provider?: AIProvider;
    timeoutMs?: number;
}): Promise<ScheduleContractComparisonResult>;
//# sourceMappingURL=comparison.d.ts.map