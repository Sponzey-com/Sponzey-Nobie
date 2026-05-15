import { loadPromptSourceRegistry, } from "../memory/nobie-md.js";
export const AGENT_PROMPT_BUNDLE_SOURCE_IDS = [
    "definitions",
    "identity",
    "user",
    "soul",
    "planner",
    "nobie_execution",
    "memory_policy",
    "tool_policy",
    "recovery_policy",
    "topology_executor_policy",
    "completion_policy",
    "output_policy",
    "channel",
];
export const EXECUTION_HARNESS_POLICY_SOURCE_IDS = [
    "nobie_execution",
    "tool_policy",
    "recovery_policy",
    "topology_executor_policy",
    "completion_policy",
];
export function selectRuntimePromptSources(input) {
    const locale = input.locale ?? "en";
    const sourceIds = new Set(input.sourceIds ?? AGENT_PROMPT_BUNDLE_SOURCE_IDS);
    return input.sources
        .filter((source) => source.locale === locale)
        .filter((source) => source.usageScope === "runtime")
        .filter((source) => source.enabled)
        .filter((source) => sourceIds.has(source.sourceId))
        .sort((a, b) => a.priority - b.priority || a.sourceId.localeCompare(b.sourceId));
}
export function selectAgentPromptBundleSources(input) {
    return selectRuntimePromptSources({
        ...input,
        sourceIds: input.sourceIds ?? AGENT_PROMPT_BUNDLE_SOURCE_IDS,
    });
}
export function selectExecutionHarnessPolicySources(input) {
    return selectRuntimePromptSources({
        ...input,
        sourceIds: input.sourceIds ?? EXECUTION_HARNESS_POLICY_SOURCE_IDS,
    });
}
export function loadRuntimePromptPolicySources(input = {}) {
    try {
        return loadPromptSourceRegistry(input.workDir ?? process.cwd());
    }
    catch {
        return [];
    }
}
export function renderPromptPolicySourceBlock(input) {
    const selected = selectRuntimePromptSources(input);
    if (selected.length === 0) {
        return [
            input.title ?? "[Runtime Prompt Policy Sources]",
            "status: unavailable",
            "reason: no enabled runtime prompt policy sources were loaded",
        ].join("\n");
    }
    return [
        input.title ?? "[Runtime Prompt Policy Sources]",
        ...selected.flatMap((source) => [
            "",
            `## ${source.sourceId}`,
            `sourceId: ${source.sourceId}`,
            `locale: ${source.locale}`,
            `usageScope: ${source.usageScope}`,
            `path: ${source.path}`,
            `checksum: ${source.checksum}`,
            "",
            source.content.trim(),
        ]),
    ].join("\n");
}
//# sourceMappingURL=prompt-policy-adapter.js.map