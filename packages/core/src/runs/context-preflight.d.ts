import type { AIChunk, AIProvider, ChatParams, Message, ToolDefinition } from "../ai/types.js";
import type { AgentPromptBundle, DataExchangePackage, OwnerScope } from "../contracts/sub-agent-orchestration.js";
export type ContextPreflightStatus = "ok" | "needs_pruning" | "needs_compaction" | "blocked_context_overflow";
export interface ContextPreflightBreakdown {
    systemTokens: number;
    messageTokens: number;
    toolTokens: number;
    totalTokens: number;
    providerContextTokens: number;
    hardBudgetTokens: number;
    softBudgetTokens: number;
}
export interface ContextPruningDecision {
    messageIndex: number;
    blockIndex: number;
    blockType: string;
    originalChars: number;
    prunedChars: number;
    strategy: "head_tail_soft_trim" | "placeholder_hard_clear";
}
export interface ContextPreflightResult {
    status: ContextPreflightStatus;
    model: string;
    providerId: string;
    operation: string;
    breakdown: ContextPreflightBreakdown;
    durationMs: number;
    pruningDecisions: ContextPruningDecision[];
    userMessage?: string;
}
export interface ContextPreflightMetadata {
    runId?: string;
    sessionId?: string;
    requestGroupId?: string;
    operation?: string;
}
export interface ContextPreflightPreparedChat extends ContextPreflightResult {
    messages: Message[];
    initialStatus: ContextPreflightStatus;
}
export interface PromptBundleContextMemoryRef {
    owner: OwnerScope;
    visibility: "private" | "coordinator_visible" | "team_visible";
    sourceRef: string;
    content?: string;
    dataExchangeId?: string;
}
export interface PromptBundleContextScopeValidation {
    ok: boolean;
    issueCodes: string[];
    blockedSourceRefs: string[];
}
export declare class ContextPreflightBlockedError extends Error {
    readonly result: ContextPreflightResult;
    constructor(result: ContextPreflightResult);
}
export declare function estimateContextTokens(value: unknown): number;
export declare function estimateMessagesTokens(messages: Message[]): number;
export declare function runContextPreflight(input: {
    provider: AIProvider;
    model: string;
    messages: Message[];
    system?: string;
    tools?: ToolDefinition[];
    metadata?: ContextPreflightMetadata;
    pruningDecisions?: ContextPruningDecision[];
}): ContextPreflightResult;
export declare function pruneMessagesForContext(input: {
    messages: Message[];
}): {
    messages: Message[];
    decisions: ContextPruningDecision[];
};
export declare function prepareChatContext(input: ChatParams & {
    provider: AIProvider;
    metadata?: ContextPreflightMetadata;
}): ContextPreflightPreparedChat;
export declare function chatWithContextPreflight(input: ChatParams & {
    provider: AIProvider;
    metadata?: ContextPreflightMetadata;
}): AsyncGenerator<AIChunk>;
export declare function validateAgentPromptBundleContextScope(input: {
    bundle: Pick<AgentPromptBundle, "agentId" | "agentType" | "memoryPolicy">;
    memoryRefs?: PromptBundleContextMemoryRef[];
    dataExchangePackages?: DataExchangePackage[];
    now?: () => number;
}): PromptBundleContextScopeValidation;
//# sourceMappingURL=context-preflight.d.ts.map