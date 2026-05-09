import { type AgentConfig, type AgentPromptBundle, type AgentPromptFragment, type AgentPromptFragmentKind, type AgentPromptFragmentStatus, type DataExchangePackage, type StructuredTaskScope, type TeamConfig } from "../contracts/sub-agent-orchestration.js";
import { type LoadedPromptSource } from "../memory/nobie-md.js";
import { type PromptBundleContextMemoryRef } from "../runs/context-preflight.js";
import type { ExecutorProfile } from "./registry.js";
export declare const AGENT_PROMPT_BUNDLE_VERSION = "agent-prompt-bundle-v1";
export interface ImportedPromptFragmentInput {
    fragmentId?: string;
    kind: AgentPromptFragmentKind;
    title: string;
    content: string;
    sourceId: string;
    version?: string;
    status?: AgentPromptFragmentStatus;
    autoActivate?: boolean;
    reviewApproved?: boolean;
}
export interface AgentPromptBundleBuildInput {
    agent: AgentConfig;
    taskScope: StructuredTaskScope;
    teams?: TeamConfig[];
    workDir?: string;
    locale?: "ko" | "en";
    promptSources?: LoadedPromptSource[];
    importedFragments?: ImportedPromptFragmentInput[];
    memoryRefs?: PromptBundleContextMemoryRef[];
    dataExchangePackages?: DataExchangePackage[];
    executorProfileProjection?: ExecutorProfilePromptProjection;
    parentRunId?: string;
    parentRequestId?: string;
    auditCorrelationId?: string;
    now?: () => number;
    idProvider?: () => string;
}
export interface ExecutorProfilePromptConnection {
    fromExecutorId: string;
    toExecutorId: string;
    relation?: string;
}
export interface ExecutorProfilePromptItem extends ExecutorProfile {
    connectedNextExecutorIds: string[];
}
export interface ExecutorProfilePromptProjection {
    currentExecutorId: string;
    graphSource?: string;
    selectableExecutors: ExecutorProfilePromptItem[];
    diagnosticExecutors?: ExecutorProfilePromptItem[];
    connections?: ExecutorProfilePromptConnection[];
}
export type PromptContextIsolationMode = "root" | "explicit_continuation" | "handoff";
export type PromptContextBlockId = "latest_user_message" | "channel_metadata" | "execution_graph" | "request_group_context" | "parent_work_order" | "required_outputs" | "verification_notes" | "return_to_parent_contract";
export interface PromptContextBlockInclusion {
    blockId: PromptContextBlockId;
    included: boolean;
    reason: string;
}
export interface PromptContextBlockPlan {
    mode: PromptContextIsolationMode;
    includedContextBlocks: PromptContextBlockInclusion[];
}
export declare function buildPromptContextBlockPlan(input: {
    mode: PromptContextIsolationMode;
    hasLatestUserMessage?: boolean;
    hasChannelMetadata?: boolean;
    hasExecutionGraph?: boolean;
    hasRequestGroupContext?: boolean;
    hasParentWorkOrder?: boolean;
    hasRequiredOutputs?: boolean;
    hasVerificationNotes?: boolean;
    hasReturnToParentContract?: boolean;
}): PromptContextBlockPlan;
export declare function buildExecutorProfilePromptProjection(input: {
    currentExecutorId: string;
    executorProfiles: ExecutorProfile[];
    connections: ExecutorProfilePromptConnection[];
}): ExecutorProfilePromptProjection;
export interface AgentPromptBundleBuildResult {
    bundle: AgentPromptBundle;
    blockedFragments: AgentPromptFragment[];
    inactiveFragments: AgentPromptFragment[];
    issueCodes: string[];
    cacheKey: string;
    promptChecksum: string;
    renderedPrompt: string;
}
export interface PromptBundleCacheEntry {
    cacheKey: string;
    bundle: AgentPromptBundle;
    createdAt: number;
    promptChecksum?: string;
}
export interface PromptBundleCacheStats {
    size: number;
    hits: number;
    misses: number;
}
export declare function buildAgentPromptBundle(input: AgentPromptBundleBuildInput): AgentPromptBundleBuildResult;
export declare function buildAgentPromptBundleCacheKey(input: {
    agent: AgentConfig;
    taskScope: StructuredTaskScope;
    teams?: TeamConfig[];
    sourceProvenance?: AgentPromptBundle["sourceProvenance"];
    fragments?: AgentPromptFragment[];
}): string;
export declare function renderAgentPromptBundleText(input: {
    agent: AgentConfig;
    fragments: AgentPromptFragment[];
    safetyRules?: string[];
    validation?: AgentPromptBundle["validation"];
}): string;
export declare function redactPromptSecrets(value: string): string;
export declare class PromptBundleCache {
    private readonly entries;
    private hits;
    private misses;
    get(cacheKey: string): AgentPromptBundle | undefined;
    set(result: AgentPromptBundleBuildResult): AgentPromptBundle;
    getOrBuild(input: AgentPromptBundleBuildInput): AgentPromptBundleBuildResult;
    invalidate(cacheKey?: string): void;
    stats(): PromptBundleCacheStats;
}
export declare function createPromptBundleCache(): PromptBundleCache;
//# sourceMappingURL=prompt-bundle.d.ts.map
