import type { SourceEvidence } from "./web-retrieval-policy.js";
import type { RetrievalTargetContract } from "./web-retrieval-session.js";
import type { RetrievalEvidenceSufficiency, RetrievalVerificationPolicy, RetrievalVerificationVerdict } from "./web-retrieval-verification.js";
export type EvidenceConflictResolutionStatus = "selected" | "conflict" | "no_answerable_candidate";
export interface EvidenceConflictTolerance {
    absolute: number;
    relative: number;
}
export interface EvidenceConflictPolicy {
    policyVersion: string;
    defaultTolerance: EvidenceConflictTolerance;
    financeIndexTolerance: EvidenceConflictTolerance;
    weatherCurrentTolerance: EvidenceConflictTolerance;
}
export interface EvidenceConflictResolutionInput {
    target: RetrievalTargetContract;
    policy: RetrievalVerificationPolicy;
    verdicts: RetrievalVerificationVerdict[];
    sourceEvidenceById: Record<string, SourceEvidence>;
    adapterPriority?: Record<string, number>;
    conflictPolicy?: Partial<EvidenceConflictPolicy>;
}
export interface EvidenceConflictResolution {
    status: EvidenceConflictResolutionStatus;
    selectedVerdict: RetrievalVerificationVerdict | null;
    answerableCount: number;
    rejectedWeakCount: number;
    conflictingVerdicts: RetrievalVerificationVerdict[];
    conflicts: string[];
    caveats: string[];
    policy: EvidenceConflictPolicy;
}
export declare const DEFAULT_EVIDENCE_CONFLICT_POLICY: EvidenceConflictPolicy;
export declare function resolveEvidenceConflict(input: EvidenceConflictResolutionInput): EvidenceConflictResolution;
export declare function conflictResolutionToVerdict(input: {
    resolution: EvidenceConflictResolution;
    target: RetrievalTargetContract;
    policy: RetrievalVerificationPolicy;
}): RetrievalVerificationVerdict;
export declare function conflictSufficiencyIsBlocking(value: RetrievalEvidenceSufficiency): boolean;
//# sourceMappingURL=web-conflict-resolver.d.ts.map