import { type AIProvider } from "../ai/index.js";
import { type MemoryCapsuleRollupSnapshot, type MemoryCompactionRunSnapshot, type MemoryRecallEventSnapshot } from "../db/index.js";
import type { AgentMemoryState } from "./agent-state.js";
import type { MemoryCapsule } from "./capsule.js";
export type MemoryInspectorDriftState = "ok" | "warning";
export type MemoryInspectorControlAction = "dry_run_compaction" | "latest_capsule_inspect" | "rollup_inspect" | "safe_restore" | "force_compaction" | "capsule_invalidate";
export interface MemoryInspectorOwnerCard {
    ownerScopeKey: string;
    ownerType: AgentMemoryState["ownerScope"]["ownerType"];
    ownerId: string;
    sessionId: string;
    requestGroupId?: string;
    lineageId?: string;
    channelKey?: string;
    threadKey?: string;
    nicknameSnapshot?: string;
    latestCapsuleId?: string;
    currentRawTokenEstimate: number;
    currentRawMessageCount: number;
    latestCapsuleAgeMs: number | null;
    activeCapsuleChainDepth: number;
    latestRollupAgeMs: number | null;
    lastCompactionReason: string | null;
    pendingPreservationCount: number;
    recallHitCount: number;
    driftWarningState: MemoryInspectorDriftState;
    driftWarningCodes: string[];
    lastCompactionAt: number | null;
    compactionBlockReason: string | null;
}
export interface MemoryInspectorConfiguredPolicy {
    explicitModelId: string | null;
    fallbackModelId: string | null;
    minContextTokens: number;
}
export interface MemoryInspectorCompactPreview {
    sourceMessageCount: number;
    tailMessageCount: number;
    degradedTailMessageCount: number | null;
    droppedRawCount: number;
    headRange: {
        start: number;
        end: number;
        count: number;
    } | null;
    capsuleSummary: string | null;
    preservedPinnedItems: string[];
    reasonCodes: string[];
    validationSummary: string | null;
    modelAudit: Record<string, unknown> | null;
}
export interface MemoryInspectorSummary {
    owners: number;
    warningOwners: number;
    recallEvents: number;
    compactionRuns: number;
    latestCapsuleAt: number | null;
    latestRollupAt: number | null;
    qualityStatus: "healthy" | "degraded";
}
export interface MemoryInspectorSnapshot {
    generatedAt: number;
    filters: {
        ownerType: AgentMemoryState["ownerScope"]["ownerType"] | null;
        ownerId: string | null;
        sessionId: string | null;
        requestGroupId: string | null;
        limit: number;
    };
    configuredPolicy: MemoryInspectorConfiguredPolicy;
    summary: MemoryInspectorSummary;
    ownerCards: MemoryInspectorOwnerCard[];
    selectedOwnerScopeKey: string | null;
    latestCapsule: MemoryCapsule | null;
    latestRollup: MemoryCapsuleRollupSnapshot | null;
    recentCompactionRuns: MemoryCompactionRunSnapshot[];
    recallTrace: MemoryRecallEventSnapshot[];
    compactPreview: MemoryInspectorCompactPreview | null;
    maintenanceRestorePromptBlock: string | null;
    controls: Array<{
        action: MemoryInspectorControlAction;
        enabled: boolean;
        reason: string;
    }>;
}
export interface MemoryInspectorControlResult {
    action: MemoryInspectorControlAction;
    enabled: boolean;
    reason: string;
    compactPreview?: MemoryInspectorCompactPreview | null;
    latestCapsule?: MemoryCapsule | null;
    latestRollup?: MemoryCapsuleRollupSnapshot | null;
    maintenanceRestorePromptBlock?: string | null;
}
export declare function buildMemoryInspectorSnapshot(input?: {
    ownerType?: AgentMemoryState["ownerScope"]["ownerType"];
    ownerId?: string;
    sessionId?: string;
    requestGroupId?: string;
    limit?: number;
    now?: number;
}): MemoryInspectorSnapshot;
export declare function runMemoryInspectorControl(input: {
    action: MemoryInspectorControlAction;
    ownerType?: AgentMemoryState["ownerScope"]["ownerType"];
    ownerId?: string;
    sessionId?: string;
    requestGroupId?: string;
    limit?: number;
    provider?: AIProvider;
    model?: string;
    now?: number;
}): Promise<MemoryInspectorControlResult>;
//# sourceMappingURL=inspector.d.ts.map