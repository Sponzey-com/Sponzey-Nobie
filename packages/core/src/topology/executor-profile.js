export const EXECUTOR_PROFILE_SCHEMA_VERSION = 1;
export const EXECUTOR_PROFILE_METADATA_KEY = "executorProfile";
export function normalizeExecutorProfile(value, fallback) {
    const record = metadataRecord(value);
    const roleName = metadataString(record?.roleName) ?? metadataString(fallback.roleName) ?? "executor";
    const definition = metadataString(record?.definition) ??
        metadataString(fallback.definition) ??
        `${fallback.displayName} executor`;
    const does = firstStringArray(record?.does, fallback.does, [definition]);
    const delegationScope = firstStringArray(record?.delegationScope, fallback.delegationScope, does);
    const expectedOutputs = firstStringArray(record?.expectedOutputs, fallback.expectedOutputs, ["처리 결과"]);
    const handoffStyle = metadataString(record?.handoffStyle) ??
        metadataString(fallback.handoffStyle) ??
        "structured_handoff";
    const declineCriteria = firstStringArray(record?.declineCriteria, fallback.declineCriteria);
    const riskBoundary = firstStringArray(record?.riskBoundary, fallback.riskBoundary);
    return {
        schemaVersion: EXECUTOR_PROFILE_SCHEMA_VERSION,
        executorId: metadataString(record?.executorId) ?? fallback.executorId,
        displayName: metadataString(record?.displayName) ?? fallback.displayName,
        roleName,
        definition,
        does,
        delegationScope,
        expectedOutputs,
        handoffStyle,
        declineCriteria,
        riskBoundary,
    };
}
export function buildExecutorProfileFromNode(node, overrides = {}) {
    const displayName = overrides.displayName ?? node.displayName?.trim() ?? node.name.trim() ?? node.id;
    return normalizeExecutorProfile(executorProfileMetadataValue(node), {
        executorId: overrides.executorId ?? node.id,
        displayName,
        roleName: metadataString(node.metadata?.roleName) ??
            metadataString(node.metadata?.role) ??
            metadataString(node.template?.metadata?.roleName) ??
            metadataString(node.template?.metadata?.role) ??
            node.nodeType,
        definition: node.description?.trim() || node.instruction?.trim() || displayName,
        does: metadataStringArray(node.template?.metadata?.does),
        delegationScope: sortedUniqueStrings([
            ...node.tags,
            ...metadataStringArray(node.metadata?.capabilityHints),
            ...metadataStringArray(node.metadata?.inferredCapabilities),
            ...metadataStringArray(node.template?.metadata?.capabilityHints),
            ...metadataStringArray(node.template?.metadata?.inferredCapabilities),
        ]),
        expectedOutputs: [
            ...metadataStringArray(node.template?.metadata?.expectedOutputs),
            ...metadataStringArray(node.template?.metadata?.outputs),
        ],
        handoffStyle: metadataString(node.template?.metadata?.handoffStyle),
        declineCriteria: [
            ...metadataStringArray(node.metadata?.declineCriteria),
            ...metadataStringArray(node.template?.metadata?.declineCriteria),
        ],
        riskBoundary: [
            ...metadataStringArray(node.metadata?.riskBoundary),
            ...metadataStringArray(node.template?.metadata?.riskBoundary),
        ],
    });
}
function executorGraphMetadataRecord(node) {
    return metadataRecord(node.metadata?.executorGraph);
}
function executorProfileMetadataValue(node) {
    const graphMetadata = executorGraphMetadataRecord(node);
    return (node.metadata?.[EXECUTOR_PROFILE_METADATA_KEY] ??
        node.template?.metadata?.[EXECUTOR_PROFILE_METADATA_KEY] ??
        graphMetadata?.[EXECUTOR_PROFILE_METADATA_KEY]);
}
function firstStringArray(...values) {
    for (const value of values) {
        const strings = metadataStringArray(value);
        if (strings.length > 0)
            return sortedUniqueStrings(strings);
    }
    return [];
}
function metadataString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function metadataStringArray(value) {
    return Array.isArray(value)
        ? value.flatMap((entry) => (typeof entry === "string" && entry.trim() ? [entry.trim()] : []))
        : [];
}
function metadataRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return undefined;
    return value;
}
function sortedUniqueStrings(values) {
    return [...new Set(values.filter((value) => Boolean(value?.trim())))]
        .sort((left, right) => left.localeCompare(right));
}
//# sourceMappingURL=executor-profile.js.map