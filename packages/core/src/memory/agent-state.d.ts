import type { StructuredTaskScope, SubSessionMemoryBootstrap, SubSessionMemoryOwnerScope } from "../contracts/sub-agent-orchestration.js";
import type { MemoryCapsule } from "./capsule.js";
export declare const ROOT_MAIN_AGENT_ID = "agent:nobie";
export interface AgentMemoryState {
    stateId: string;
    ownerScope: SubSessionMemoryOwnerScope;
    ownerScopeKey: string;
    nicknameSnapshot?: string;
    latestCapsuleId?: string;
    currentRawTokenEstimate: number;
    currentRawMessageCount: number;
    lastCompactionAt?: number;
    compactionBlockReason?: string;
    createdAt: number;
    updatedAt: number;
}
export declare function normalizeSubSessionMemoryOwnerScope(scope: SubSessionMemoryOwnerScope): SubSessionMemoryOwnerScope;
export declare function buildAgentMemoryStateScopeKey(scope: SubSessionMemoryOwnerScope): string;
export declare function buildMainAgentMemoryStateScope(input: {
    sessionId: string;
    requestGroupId?: string;
    lineageId?: string;
    channelKey?: string;
    threadKey?: string;
    agentId?: string;
}): SubSessionMemoryOwnerScope;
export declare function buildSubAgentMemoryStateScope(input: {
    agentId: string;
    sessionId: string;
    requestGroupId?: string;
    lineageId?: string;
    channelKey?: string;
    threadKey?: string;
}): SubSessionMemoryOwnerScope;
export declare function normalizeAgentMemoryState(input: AgentMemoryState): AgentMemoryState;
export declare function buildAgentMemoryStateFromCapsule(input: {
    capsule: MemoryCapsule;
    currentRawTokenEstimate: number;
    currentRawMessageCount: number;
    compactionBlockReason?: string;
    now?: number;
}): AgentMemoryState | undefined;
export declare function buildChildOwnMemoryBootstrap(input: {
    agentId: string;
    nicknameSnapshot?: string;
    sessionId: string;
    requestGroupId: string;
    lineageId: string;
    taskScope: StructuredTaskScope;
    additionalContextRefs: string[];
    sourceProvenanceRefs?: string[];
    latestCapsuleId?: string;
    handoffExchangeId?: string;
    feedbackExchangeId?: string;
    latestSafeContextSummary?: string;
    additionalPinnedItems?: string[];
    channelKey?: string;
    threadKey?: string;
    now?: number;
}): SubSessionMemoryBootstrap;
export declare function buildAgentMemoryStateFromBootstrap(input: {
    bootstrap: SubSessionMemoryBootstrap;
}): AgentMemoryState;
//# sourceMappingURL=agent-state.d.ts.map