export function aggregateNodeRuntimeResults(input) {
    const strategy = input.strategy ?? "merge_and_validate";
    const rawItems = [];
    const sources = [];
    const issues = [];
    if (input.selfOutputs !== undefined) {
        const sourceId = input.workOrder.to.id;
        sources.push({
            sourceKind: "self",
            sourceId,
            status: input.selfStatus ?? "completed",
            outputCount: input.selfOutputs.length,
            failureCandidate: isFailureCandidateStatus(input.selfStatus ?? "completed"),
            risksOrGaps: [...(input.selfRisksOrGaps ?? [])],
        });
        rawItems.push(...input.selfOutputs.map((output) => buildItem("self", sourceId, output)));
    }
    const childReports = [
        ...(input.childReports ?? []),
        ...(input.childDelegation?.results.flatMap((result) => result.nodeResultReport ? [result.nodeResultReport] : []) ?? []),
    ];
    for (const report of childReports) {
        sources.push({
            sourceKind: "child",
            sourceId: report.nodeId,
            status: report.status,
            outputCount: report.outputs.length,
            failureCandidate: isFailureCandidateStatus(report.status),
            risksOrGaps: [...report.risksOrGaps],
        });
        rawItems.push(...report.outputs.map((output) => buildItem("child", report.nodeId, output)));
    }
    for (const toolResult of input.toolExecution?.results ?? []) {
        const output = {
            outputId: `tool:${toolResult.toolId}`,
            status: toolResult.status === "succeeded" ? "satisfied" : "missing",
            ...(toolResult.output !== undefined ? { value: toolResult.output } : {}),
        };
        sources.push({
            sourceKind: "tool",
            sourceId: toolResult.toolId,
            status: toolResult.failureCandidate ? "failed_candidate" : "completed",
            outputCount: 1,
            failureCandidate: toolResult.failureCandidate,
            risksOrGaps: [
                ...(toolResult.error !== undefined ? [toolResult.error] : []),
                ...(toolResult.failureCandidate ? [toolResult.reasonCode] : []),
            ],
        });
        rawItems.push(buildItem("tool", toolResult.toolId, output));
    }
    for (const source of sources) {
        if (!source.failureCandidate)
            continue;
        issues.push({
            code: "source_failure_candidate",
            reasonCode: "source_failure_candidate",
            severity: "warning",
            message: "A source result is a failure candidate and must be reviewed before final failure.",
            sourceIds: [source.sourceId],
        });
    }
    const expectedChildNodeIds = input.expectedChildNodeIds ?? [];
    const actualChildNodeIds = new Set(sources.filter((source) => source.sourceKind === "child").map((source) => source.sourceId));
    const missingChildNodeIds = expectedChildNodeIds.filter((nodeId) => !actualChildNodeIds.has(nodeId));
    if (missingChildNodeIds.length > 0 && (input.requireAllChildResults === true || strategy === "require_all_child_results")) {
        issues.push({
            code: "child_result_missing",
            reasonCode: "child_result_missing",
            severity: "blocked",
            message: "A required child result is missing.",
            sourceIds: missingChildNodeIds,
        });
    }
    if (strategy === "quorum" && input.quorum !== undefined) {
        const satisfiedSourceCount = new Set(rawItems.filter((item) => item.output.status === "satisfied").map((item) => item.sourceId)).size;
        if (satisfiedSourceCount < input.quorum.requiredSatisfiedSourceCount) {
            issues.push({
                code: "quorum_not_met",
                reasonCode: "quorum_not_met",
                severity: "blocked",
                message: "Aggregation quorum was not met.",
                sourceIds: sources.map((source) => source.sourceId),
            });
        }
    }
    const { outputs, duplicates, conflicts } = mergeOutputs(rawItems, strategy);
    issues.push(...duplicates, ...conflicts);
    return {
        strategy,
        workOrderId: input.workOrder.workOrderId,
        outputs,
        items: rawItems,
        sources,
        issues,
        conflicts,
        duplicates,
        missingChildNodeIds,
        reasonCodes: [
            `aggregation_strategy:${strategy}`,
            ...(duplicates.length > 0 ? ["duplicate_output_removed"] : []),
            ...(conflicts.length > 0 ? ["output_conflict_detected"] : []),
            ...(missingChildNodeIds.length > 0 ? ["child_result_missing"] : []),
        ],
    };
}
function mergeOutputs(items, strategy) {
    const byOutputId = new Map();
    for (const item of items) {
        byOutputId.set(item.output.outputId, [...(byOutputId.get(item.output.outputId) ?? []), item]);
    }
    const outputs = [];
    const duplicates = [];
    const conflicts = [];
    for (const [outputId, groupedItems] of byOutputId.entries()) {
        const seenFingerprints = new Set();
        const uniqueItems = [];
        for (const item of groupedItems) {
            if (seenFingerprints.has(item.fingerprint)) {
                duplicates.push({
                    code: "duplicate_output_removed",
                    reasonCode: "duplicate_output_removed",
                    severity: "info",
                    message: "Duplicate output was removed during aggregation.",
                    outputId,
                    sourceIds: [item.sourceId],
                });
                continue;
            }
            seenFingerprints.add(item.fingerprint);
            uniqueItems.push(item);
        }
        if (uniqueItems.length > 1) {
            conflicts.push({
                code: "output_conflict_detected",
                reasonCode: "output_conflict_detected",
                severity: strategy === "parent_decides" ? "warning" : "needs_revision",
                message: "Multiple sources produced conflicting output for the same output id.",
                outputId,
                sourceIds: uniqueItems.map((item) => item.sourceId),
            });
        }
        const selected = selectOutputForMerge(uniqueItems);
        if (selected !== undefined)
            outputs.push(cloneOutput(selected.output));
    }
    return { outputs, duplicates, conflicts };
}
function selectOutputForMerge(items) {
    return [...items].sort((left, right) => sourcePriority(left.sourceKind) - sourcePriority(right.sourceKind))[0];
}
function sourcePriority(kind) {
    if (kind === "self")
        return 0;
    if (kind === "child")
        return 1;
    return 2;
}
function buildItem(sourceKind, sourceId, output) {
    return {
        sourceKind,
        sourceId,
        output: cloneOutput(output),
        fingerprint: stableStringify({
            outputId: output.outputId,
            status: output.status,
            value: output.value ?? null,
        }),
    };
}
function cloneOutput(output) {
    return {
        outputId: output.outputId,
        status: output.status,
        ...(output.value !== undefined ? { value: structuredClone(output.value) } : {}),
    };
}
function isFailureCandidateStatus(status) {
    return status === "failed_candidate" || status === "permission_limited" || status === "failed";
}
function stableStringify(value) {
    return JSON.stringify(sortJsonValue(value));
}
function sortJsonValue(value) {
    if (Array.isArray(value))
        return value.map(sortJsonValue);
    if (!isRecord(value))
        return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJsonValue(nested)]));
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
//# sourceMappingURL=aggregation.js.map