import { type AgentConfig, type AgentPromptBundle, type AgentPromptFragment, type AgentPromptFragmentKind, type AgentPromptFragmentStatus, type DataExchangePackage, type StructuredTaskScope, type TeamConfig } from "../contracts/sub-agent-orchestration.js";
import { type LoadedPromptSource } from "../memory/nobie-md.js";
import { type PromptBundleContextMemoryRef } from "../runs/context-preflight.js";
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
    parentRunId?: string;
    parentRequestId?: string;
    auditCorrelationId?: string;
    now?: () => number;
    idProvider?: () => string;
}
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