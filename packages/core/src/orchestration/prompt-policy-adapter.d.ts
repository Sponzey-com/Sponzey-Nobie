import { type LoadedPromptSource } from "../memory/nobie-md.js";
export declare const AGENT_PROMPT_BUNDLE_SOURCE_IDS: readonly ["definitions", "identity", "user", "soul", "planner", "nobie_execution", "memory_policy", "tool_policy", "recovery_policy", "topology_executor_policy", "completion_policy", "output_policy", "channel"];
export declare const EXECUTION_HARNESS_POLICY_SOURCE_IDS: readonly ["nobie_execution", "tool_policy", "recovery_policy", "topology_executor_policy", "completion_policy"];
export type RuntimePromptSourceId = typeof AGENT_PROMPT_BUNDLE_SOURCE_IDS[number] | typeof EXECUTION_HARNESS_POLICY_SOURCE_IDS[number];
export interface PromptSourceSelectionInput {
    sources: LoadedPromptSource[];
    locale?: "ko" | "en";
    sourceIds?: readonly string[];
}
export interface PromptSourceLoadInput {
    workDir?: string;
    locale?: "ko" | "en";
}
export interface PromptPolicyBlockInput extends PromptSourceSelectionInput {
    title?: string;
}
export declare function selectRuntimePromptSources(input: PromptSourceSelectionInput): LoadedPromptSource[];
export declare function selectAgentPromptBundleSources(input: PromptSourceSelectionInput): LoadedPromptSource[];
export declare function selectExecutionHarnessPolicySources(input: PromptSourceSelectionInput): LoadedPromptSource[];
export declare function loadRuntimePromptPolicySources(input?: PromptSourceLoadInput): LoadedPromptSource[];
export declare function renderPromptPolicySourceBlock(input: PromptPolicyBlockInput): string;
//# sourceMappingURL=prompt-policy-adapter.d.ts.map