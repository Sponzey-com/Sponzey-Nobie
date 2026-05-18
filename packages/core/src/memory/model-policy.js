import { getConfig } from "../config/index.js";
function safeResolveContextTokens(provider, modelId) {
    try {
        const resolved = provider.maxContextTokens(modelId);
        if (!Number.isFinite(resolved) || resolved <= 0)
            return 0;
        return Math.floor(resolved);
    }
    catch {
        return 0;
    }
}
function normalizeModelId(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}
export function resolveMemoryCompactionPolicy(input) {
    const config = getConfig();
    const explicitModelId = normalizeModelId(config.memory.compaction?.modelId);
    const fallbackModelId = normalizeModelId(config.memory.compaction?.fallbackModelId);
    const minContextTokens = Math.max(512, Math.floor(config.memory.compaction?.minContextTokens ?? 3000));
    const selectedModelId = explicitModelId ?? input.executionModelId;
    const selectionSource = explicitModelId
        ? "explicit_override"
        : "execution_model";
    const providerBudgetBlocked = safeResolveContextTokens(input.provider, selectedModelId) > 0
        && safeResolveContextTokens(input.provider, selectedModelId) < minContextTokens;
    const orderedCandidates = [
        { modelId: selectedModelId, source: selectionSource },
    ];
    if (fallbackModelId && fallbackModelId !== selectedModelId) {
        orderedCandidates.push({ modelId: fallbackModelId, source: "fallback_override" });
    }
    if (input.executionModelId !== selectedModelId && input.executionModelId !== fallbackModelId) {
        orderedCandidates.push({ modelId: input.executionModelId, source: "execution_model" });
    }
    return {
        snapshot: {
            executionModelId: input.executionModelId,
            selectedModelId,
            selectionSource,
            ...(fallbackModelId ? { fallbackModelId } : {}),
            minContextTokens,
            providerBudgetBlocked,
        },
        candidates: orderedCandidates.map((candidate) => ({
            ...candidate,
            maxContextTokens: safeResolveContextTokens(input.provider, candidate.modelId),
        })),
    };
}
export function buildDefaultMemoryCompactionAudit(input) {
    return {
        executionModelId: input.executionModelId,
        ...(input.selectedModelId ? { selectedModelId: input.selectedModelId } : {}),
        ...(input.selectionSource ? { selectionSource: input.selectionSource } : {}),
        ...(input.fallbackModelId ? { fallbackModelId: input.fallbackModelId } : {}),
        minContextTokens: input.minContextTokens,
        providerBudgetBlocked: input.providerBudgetBlocked,
        fallbackApplied: input.fallbackApplied === true,
        heuristicFallbackApplied: input.heuristicFallbackApplied === true,
        deterministicStateProtected: true,
        attempts: input.attempts ?? [],
    };
}
//# sourceMappingURL=model-policy.js.map