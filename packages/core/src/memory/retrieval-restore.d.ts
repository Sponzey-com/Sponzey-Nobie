import type { Message } from "../ai/types.js";
import { type TaskContinuitySnapshot } from "../db/index.js";
import type { MemoryCapsule, MemoryCapsuleOwnerScope } from "./capsule.js";
import { type MemoryChunkSearchResult } from "./search.js";
export declare const MEMORY_CAPSULE_ROLLUP_RECENT_LIMIT = 2;
export declare const MEMORY_CAPSULE_ROLLUP_COUNT_THRESHOLD = 4;
export declare const MEMORY_CAPSULE_ROLLUP_TOKEN_THRESHOLD = 2200;
export declare const MEMORY_PROMPT_TIME_RECALL_LIMIT = 3;
export type MemoryRestorePathCode = "maintenance_restore" | "prompt_time_recall";
export interface MemoryCapsuleRollupResult {
    performed: boolean;
    recentCapsules: MemoryCapsule[];
    rollupCapsule?: MemoryCapsule;
    rollupAuditId?: string;
}
export interface MaintenanceRestoreContext {
    ownerScope: MemoryCapsuleOwnerScope;
    latestCapsule?: MemoryCapsule;
    recentCapsules: MemoryCapsule[];
    rollupCapsule?: MemoryCapsule;
    taskContinuity?: TaskContinuitySnapshot;
    latestInstructionSummary?: string;
    blockedReasonCodes: string[];
}
export interface PromptTimeRecallContext {
    query?: string;
    results: MemoryChunkSearchResult[];
    promptBlock?: string;
    blockedReasonCodes: string[];
    sameSessionResultCount: number;
}
export declare function maybeRollupCapsuleChain(input: {
    ownerScope: MemoryCapsuleOwnerScope;
    recentLimit?: number;
    countThreshold?: number;
    tokenThreshold?: number;
    runId?: string;
    sessionId?: string;
    requestGroupId?: string;
    now?: number;
}): MemoryCapsuleRollupResult;
export declare function buildMaintenanceRestoreContext(input: {
    ownerScope: MemoryCapsuleOwnerScope;
    recentLimit?: number;
    requestGroupId?: string;
}): MaintenanceRestoreContext;
export declare function renderMaintenanceRestorePromptBlock(context: MaintenanceRestoreContext): string | undefined;
export declare function buildPromptTimeRecallContext(input: {
    messages: Message[];
    runId?: string;
    sessionId?: string;
    requestGroupId?: string;
    channelKey?: string;
    threadKey?: string;
    includeArtifact?: boolean;
    includeDiagnostic?: boolean;
    includeFlashFeedback?: boolean;
    explicitQuery?: string;
    limit?: number;
}): Promise<PromptTimeRecallContext>;
export declare function recordMaintenanceRestoreTrace(input: {
    context: MaintenanceRestoreContext;
    runId?: string;
    sessionId?: string;
    requestGroupId?: string;
}): void;
export declare function recordPromptTimeRecallTrace(input: {
    context: PromptTimeRecallContext;
    ownerScope: MemoryCapsuleOwnerScope;
    runId?: string;
    sessionId?: string;
    requestGroupId?: string;
}): void;
//# sourceMappingURL=retrieval-restore.d.ts.map