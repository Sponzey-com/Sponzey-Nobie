export declare const MEMORY_COMPACTION_LAYERS: readonly ["active_raw_window", "pinned_working_set", "compacted_capsule", "searchable_archive", "durable_long_term_review_queue", "capsule_chain_rollup"];
export declare const MEMORY_DETERMINISTIC_CAPSULE_FIELDS: readonly ["constraints", "pendingItems", "artifactRefs", "confirmedFacts", "activeObjectives", "decisions"];
export declare const MEMORY_MODEL_GENERATED_CAPSULE_FIELDS: readonly ["summary", "recoveryHints"];
export declare const MEMORY_APPEND_ONLY_HISTORY_SOURCES: readonly ["messages", "run_events", "result_reports", "exchange_packages", "delivery_receipts"];
export declare const MEMORY_ACTIVE_READ_MODEL_COMPONENTS: readonly ["prompt_injection_window", "latest_capsule_projection", "pinned_working_set_projection", "task_continuity_projection"];
export type MemoryCapsuleOwnerType = "main_agent" | "sub_agent" | "session" | "task";
export type MemoryCapsuleKind = "session_compaction" | "task_compaction" | "lineage_compaction" | "handoff_compaction";
export interface MemoryCapsuleOwnerScope {
    ownerType: MemoryCapsuleOwnerType;
    ownerId: string;
    sessionId?: string;
    requestGroupId?: string;
    lineageId?: string;
    channelKey?: string;
    threadKey?: string;
}
export interface MemoryCapsuleArtifactRef {
    artifactId?: string;
    path?: string;
    receiptId?: string;
    note: string;
}
export interface MemoryCapsule {
    capsuleId: string;
    capsuleVersion: number;
    parentCapsuleId?: string;
    ownerScope: MemoryCapsuleOwnerScope;
    nicknameSnapshot?: string;
    capsuleKind: MemoryCapsuleKind;
    summary: string;
    activeObjectives: string[];
    confirmedFacts: string[];
    decisions: string[];
    constraints: string[];
    pendingItems: string[];
    artifactRefs: MemoryCapsuleArtifactRef[];
    recoveryHints: string[];
    sourceRefs: string[];
    compactedMessageIds: string[];
    sourceTokenEstimate: number;
    resultTokenEstimate: number;
    createdAt: number;
}
export interface MemoryCapsuleDeterministicState {
    activeObjectives?: string[];
    confirmedFacts?: string[];
    decisions?: string[];
    constraints?: string[];
    pendingItems?: string[];
    artifactRefs?: MemoryCapsuleArtifactRef[];
}
export interface MemoryCapsuleValidationOptions {
    expectedOwnerScope?: Partial<MemoryCapsuleOwnerScope>;
    requireSourceRefs?: boolean;
}
export interface MemoryCapsuleValidationResult {
    ok: boolean;
    reasonCodes: string[];
}
export interface CapsuleSessionSnapshotProjection {
    sessionId: string;
    summary: string;
    preservedFacts: string[];
    activeTaskIds: string[];
}
export interface CapsuleTaskContinuityProjection {
    lineageRootRunId: string;
    parentRunId?: string;
    handoffSummary: string;
    lastGoodState: string;
    pendingApprovals: string[];
    pendingDelivery: string[];
    status: string;
}
export declare function normalizeMemoryCapsuleOwnerScope(scope: MemoryCapsuleOwnerScope): MemoryCapsuleOwnerScope;
export declare function normalizeMemoryCapsule(input: MemoryCapsule): MemoryCapsule;
export declare function validateMemoryCapsule(input: MemoryCapsule, options?: MemoryCapsuleValidationOptions): MemoryCapsuleValidationResult;
export declare function applyMemoryCapsuleDeterministicState(input: {
    capsule: MemoryCapsule;
    deterministicState: MemoryCapsuleDeterministicState;
}): MemoryCapsule;
export declare function buildSessionSnapshotProjectionFromMemoryCapsule(input: MemoryCapsule): CapsuleSessionSnapshotProjection | undefined;
export declare function buildTaskContinuityProjectionFromMemoryCapsule(input: MemoryCapsule): CapsuleTaskContinuityProjection | undefined;
//# sourceMappingURL=capsule.d.ts.map