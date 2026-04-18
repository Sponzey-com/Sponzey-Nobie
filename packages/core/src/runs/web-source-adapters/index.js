import { FINANCE_ADAPTER_METADATA } from "./finance.js";
import { WEATHER_ADAPTER_METADATA } from "./weather.js";
import { compareAdapterFixtureParserVersion } from "./types.js";
export * from "./types.js";
export * from "./finance.js";
export * from "./weather.js";
export * from "../web-location-contract.js";
export const DEFAULT_ADAPTER_DEGRADATION_POLICY = {
    parserFailureThreshold: 3,
    parserVersionMismatchThreshold: 1,
};
export function listWebSourceAdapters(input = {}) {
    const degraded = new Set(input.degradedAdapterIds ?? []);
    return [FINANCE_ADAPTER_METADATA, WEATHER_ADAPTER_METADATA].map((adapter) => {
        if (!degraded.has(adapter.adapterId))
            return adapter;
        return {
            ...adapter,
            status: "degraded",
            degradedReason: input.degradedReasons?.[adapter.adapterId] ?? "adapter marked degraded",
        };
    });
}
export function buildWebSourceAdapterRegistrySnapshot(input = {}) {
    const adapters = listWebSourceAdapters(input);
    return {
        adapters,
        activeCount: adapters.filter((adapter) => adapter.status === "active").length,
        degradedCount: adapters.filter((adapter) => adapter.status === "degraded").length,
        degradedReasons: input.degradedReasons ?? {},
    };
}
export function buildWebSourceAdapterDegradationState(input) {
    const policy = { ...DEFAULT_ADAPTER_DEGRADATION_POLICY, ...(input.policy ?? {}) };
    const countsByAdapter = {};
    for (const sample of input.failureSamples) {
        const counts = countsByAdapter[sample.adapterId] ?? { parserFailed: 0, parserVersionMismatch: 0, sourceUnreachable: 0, unknown: 0 };
        if (sample.failureKind === "parser_failed")
            counts.parserFailed += 1;
        else if (sample.failureKind === "parser_version_mismatch")
            counts.parserVersionMismatch += 1;
        else if (sample.failureKind === "source_unreachable")
            counts.sourceUnreachable += 1;
        else
            counts.unknown += 1;
        countsByAdapter[sample.adapterId] = counts;
    }
    const degradedReasons = {};
    for (const [adapterId, counts] of Object.entries(countsByAdapter)) {
        if (counts.parserVersionMismatch >= policy.parserVersionMismatchThreshold)
            degradedReasons[adapterId] = "parser_version_mismatch";
        else if (counts.parserFailed >= policy.parserFailureThreshold)
            degradedReasons[adapterId] = "parser_failure_threshold_exceeded";
    }
    return {
        degradedAdapterIds: Object.keys(degradedReasons).sort(),
        degradedReasons,
        countsByAdapter,
    };
}
export function rankWebSourceAdaptersForTarget(targetKind, input = {}) {
    return listWebSourceAdapters(input)
        .filter((adapter) => adapter.supportedTargetKinds.includes(targetKind))
        .sort((left, right) => {
        const leftPenalty = left.status === "degraded" ? 1 : 0;
        const rightPenalty = right.status === "degraded" ? 1 : 0;
        return leftPenalty - rightPenalty || left.adapterId.localeCompare(right.adapterId);
    });
}
export function checkAdapterFixtureParserVersions(input) {
    return input.map(compareAdapterFixtureParserVersion);
}
//# sourceMappingURL=index.js.map