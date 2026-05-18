import type { CommandRequest, OwnerScope, ResultReport, SubSessionFeedbackCapsulePayload, SubSessionHandoffCapsulePayload } from "../contracts/sub-agent-orchestration.js";
import type { MemoryCapsule } from "./capsule.js";
export declare function buildSubSessionHandoffCapsulePayload(input: {
    command: CommandRequest;
    parentSessionId: string;
    latestCapsule?: MemoryCapsule;
}): SubSessionHandoffCapsulePayload;
export declare function buildSubSessionHandoffPinnedItems(payload: SubSessionHandoffCapsulePayload): string[];
export declare function buildSubSessionFeedbackCapsulePayload(input: {
    resultReports: ResultReport[];
    requiredChanges: string[];
    additionalConstraints: string[];
    conflictItems: string[];
    sourceResultReportIds: string[];
    expectedOutputRevision: string[];
    reasonCode: string;
}): SubSessionFeedbackCapsulePayload;
export declare function buildSubSessionFeedbackPinnedItems(payload: SubSessionFeedbackCapsulePayload): string[];
export interface LatestInstructionPrecedenceInput {
    currentInstruction?: string;
    latestInstructionSummary?: string;
    continuityLastGoodState?: string;
    continuityHandoffSummary?: string;
}
export interface LatestInstructionPrecedenceResolution {
    selectedSummary?: string;
    selectedSource: "current_instruction" | "latest_instruction_summary" | "continuity_last_good_state" | "continuity_handoff_summary" | "none";
    staleContinuityIgnored: boolean;
}
export declare function resolveLatestInstructionPrecedence(input: LatestInstructionPrecedenceInput): LatestInstructionPrecedenceResolution;
export declare function buildTaskContinuityTargetContext(input: {
    targetId?: string;
    targetLabel?: string;
    workerRuntimeKind?: string;
    source?: string;
    owner?: OwnerScope;
}): string | undefined;
//# sourceMappingURL=flow-capsules.d.ts.map