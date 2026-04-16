import { type ScheduleContract } from "../contracts/index.js";
import { type DbSchedule } from "../db/index.js";
export type ScheduleCandidateReason = "explicit_id" | "identity_key" | "delivery_time" | "payload_destination" | "semantic_candidate";
export type ScheduleCandidateConfidence = "exact" | "strong" | "weak" | "semantic";
export interface ScheduleCandidate {
    schedule: DbSchedule;
    contract: ScheduleContract | null;
    candidateReason: ScheduleCandidateReason;
    confidenceKind: ScheduleCandidateConfidence;
    requiresComparison: boolean;
    matchedKeys: string[];
}
export interface FindScheduleCandidatesByContractInput {
    contract: ScheduleContract;
    scheduleId?: string | null;
    sessionId?: string | null | undefined | undefined;
    includeDisabled?: boolean;
    limit?: number;
    semanticCandidates?: DbSchedule[];
}
export declare function parseScheduleContractJson(value: string | null | undefined): ScheduleContract | null;
export declare function scheduleContractTimeEquals(a: ScheduleContract, b: ScheduleContract): boolean;
export declare function scheduleContractDestinationEquals(a: ScheduleContract, b: ScheduleContract): boolean;
export declare function findScheduleCandidatesByContract(input: FindScheduleCandidatesByContractInput): ScheduleCandidate[];
//# sourceMappingURL=candidates.d.ts.map