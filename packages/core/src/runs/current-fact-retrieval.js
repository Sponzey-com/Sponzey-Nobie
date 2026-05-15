function normalizeText(value) {
    return value?.trim().replace(/\s+/g, " ") ?? "";
}
function stableStringify(value) {
    if (value === undefined)
        return "null";
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    const entries = Object.entries(value)
        .filter(([, nested]) => nested !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(",")}}`;
}
function hash(value) {
    let state = 0x811c9dc5;
    const text = stableStringify(value);
    for (let index = 0; index < text.length; index += 1) {
        state ^= text.charCodeAt(index);
        state = Math.imul(state, 0x01000193);
    }
    return (state >>> 0).toString(16).padStart(8, "0");
}
function candidateKey(candidate) {
    return [
        normalizeText(candidate.sourceUrl),
        normalizeText(candidate.sourceDomain),
        normalizeText(candidate.sourceLabel),
        candidate.method,
        candidate.role,
    ].join("|");
}
function sourceIdFor(input) {
    return `source:${hash(input)}`;
}
function sourceAttempted(results, sourceId) {
    return results.some((result) => result.sourceId === sourceId);
}
function hasAnswerableVerdict(result) {
    return result.status === "verified" && result.verdict?.canAnswer === true;
}
function hasConflict(result) {
    return (result.status === "conflict" ||
        result.verdict?.evidenceSufficiency === "insufficient_conflict" ||
        (result.verdict?.conflicts.length ?? 0) > 0);
}
function hasMarketState(result) {
    return (result.status === "market_closed_or_delayed" ||
        result.sourceState === "market_closed" ||
        result.sourceState === "delayed");
}
function sourceRoleFromEvidence(evidence) {
    if (evidence.method === "fast_text_search" || evidence.sourceKind === "search_index")
        return "search_candidate";
    return "verification_source";
}
function sourceLine(source, result) {
    const evidence = result.evidence;
    const label = source?.sourceLabel ?? evidence?.sourceLabel ?? source?.sourceDomain ?? evidence?.sourceDomain ?? result.sourceId;
    const fetchedAt = evidence?.fetchTimestamp ?? result.attemptedAt ?? "unknown_fetch_time";
    const sourceAt = evidence?.sourceTimestamp ?? "source_time_unknown";
    return `${label} / fetched=${fetchedAt} / sourceTime=${sourceAt} / status=${result.status}`;
}
function resultValueLine(source, result) {
    const value = result.verdict?.acceptedValue ?? "value_unavailable";
    const unit = result.verdict?.acceptedUnit ? ` ${result.verdict.acceptedUnit}` : "";
    return `${source?.sourceLabel ?? result.sourceId}: ${value}${unit}`;
}
export function sourceCandidateFromEvidence(evidence, role = sourceRoleFromEvidence(evidence)) {
    return {
        sourceId: sourceIdFor({
            method: evidence.method,
            sourceUrl: evidence.sourceUrl ?? null,
            sourceDomain: evidence.sourceDomain ?? null,
            sourceLabel: evidence.sourceLabel ?? null,
            role,
        }),
        role,
        method: evidence.method,
        sourceUrl: evidence.sourceUrl ?? null,
        sourceDomain: evidence.sourceDomain ?? null,
        sourceLabel: evidence.sourceLabel ?? null,
        sourceKind: evidence.sourceKind,
        reliability: evidence.reliability,
    };
}
export function buildRetrievalVerificationPlan(input) {
    const sources = [];
    const seen = new Set();
    for (const source of input.sources) {
        const candidate = {
            ...source,
            sourceId: source.sourceId ?? sourceIdFor(source),
            sourceUrl: source.sourceUrl ?? null,
            sourceDomain: source.sourceDomain ?? null,
            sourceLabel: source.sourceLabel ?? null,
        };
        const key = candidateKey(candidate);
        if (seen.has(key))
            continue;
        seen.add(key);
        sources.push(candidate);
    }
    return {
        planId: `retrieval-plan:${hash({
            targetId: input.target.targetId,
            freshnessPolicy: input.freshnessPolicy,
            sources: sources.map(candidateKey),
        })}`,
        target: input.target,
        freshnessPolicy: input.freshnessPolicy,
        sources,
        searchIsDiscoveryOnly: true,
        requiredVerifiedSourceCount: input.requiredVerifiedSourceCount ?? 1,
        createdAt: (input.now ?? new Date()).toISOString(),
    };
}
export function chooseNextRetrievalVerificationSource(plan, results) {
    return plan.sources.find((source) => source.role !== "search_candidate" && !sourceAttempted(results, source.sourceId)) ?? null;
}
export function evaluateRetrievalVerificationPlan(input) {
    const sourceById = new Map(input.plan.sources.map((source) => [source.sourceId, source]));
    const isVerificationSource = (result) => sourceById.get(result.sourceId)?.role !== "search_candidate";
    const hasSearchCandidateResult = input.results.some((result) => result.status === "candidate_only" || sourceById.get(result.sourceId)?.role === "search_candidate");
    const confirmedResults = input.results.filter((result) => isVerificationSource(result) && hasAnswerableVerdict(result));
    const conflictResults = input.results.filter((result) => isVerificationSource(result) && hasConflict(result));
    const unverifiedResults = input.results.filter((result) => !isVerificationSource(result) || !hasAnswerableVerdict(result));
    const nextSource = chooseNextRetrievalVerificationSource(input.plan, input.results);
    const exhausted = nextSource === null;
    const marketStateOnly = input.results.length > 0 && input.results.every(hasMarketState);
    const reasonCodes = [];
    if (hasSearchCandidateResult) {
        reasonCodes.push("search_candidate_is_discovery_only");
    }
    if (confirmedResults.length > 0 && conflictResults.length === 0) {
        return {
            kind: "ready_to_answer",
            confirmedResults,
            unverifiedResults,
            conflictResults,
            exhausted,
            reasonCodes: [...reasonCodes, "verified_value_available"],
        };
    }
    if (conflictResults.length > 0 && nextSource) {
        return {
            kind: "continue_verification",
            nextSource,
            confirmedResults,
            unverifiedResults,
            conflictResults,
            exhausted: false,
            reasonCodes: [
                ...reasonCodes,
                "conflict_requires_additional_source",
                "next_verification_source_available",
            ].filter(Boolean),
        };
    }
    if (conflictResults.length > 0) {
        return {
            kind: "explain_conflict",
            confirmedResults,
            unverifiedResults,
            conflictResults,
            exhausted,
            reasonCodes: [...reasonCodes, "verified_sources_conflict"],
        };
    }
    if (marketStateOnly) {
        return {
            kind: "explain_market_state",
            confirmedResults,
            unverifiedResults,
            conflictResults,
            exhausted,
            reasonCodes: [...reasonCodes, "source_reports_market_state"],
        };
    }
    if (nextSource) {
        return {
            kind: "continue_verification",
            nextSource,
            confirmedResults,
            unverifiedResults,
            conflictResults,
            exhausted: false,
            reasonCodes: [
                ...reasonCodes,
                hasSearchCandidateResult ? "search_value_requires_fetch_verification" : "",
                "next_verification_source_available",
            ].filter(Boolean),
        };
    }
    return {
        kind: "unable_after_exhausting_sources",
        confirmedResults,
        unverifiedResults,
        conflictResults,
        exhausted,
        reasonCodes: [...reasonCodes, "all_verification_sources_exhausted"],
    };
}
export function formatCurrentFactVerificationAnswer(input) {
    const sourceById = new Map(input.plan.sources.map((source) => [source.sourceId, source]));
    const confirmed = input.decision.confirmedResults.map((result) => resultValueLine(sourceById.get(result.sourceId), result));
    const unverified = input.decision.unverifiedResults.map((result) => `${sourceById.get(result.sourceId)?.sourceLabel ?? result.sourceId}: ${result.failureReason ?? result.verdict?.rejectionReason ?? result.status}`);
    const sources = input.decision.confirmedResults
        .concat(input.decision.unverifiedResults)
        .map((result) => sourceLine(sourceById.get(result.sourceId), result));
    const issues = [
        ...input.decision.conflictResults.flatMap((result) => result.verdict?.conflicts ?? []),
        ...input.decision.reasonCodes,
    ];
    const text = [
        `상태: ${input.decision.kind}`,
        confirmed.length > 0 ? `확인된 항목:\n${confirmed.map((line) => `- ${line}`).join("\n")}` : "확인된 항목: 없음",
        unverified.length > 0 ? `미확인 항목:\n${unverified.map((line) => `- ${line}`).join("\n")}` : "미확인 항목: 없음",
        sources.length > 0 ? `출처와 기준 시각:\n${sources.map((line) => `- ${line}`).join("\n")}` : "출처와 기준 시각: 없음",
        issues.length > 0 ? `남은 이슈:\n${issues.map((line) => `- ${line}`).join("\n")}` : "남은 이슈: 없음",
    ].join("\n");
    return {
        status: input.decision.kind,
        text,
        confirmed,
        unverified,
        sources,
        issues,
    };
}
function latestTimestamp(values) {
    const timestamps = values
        .map((value) => normalizeText(value))
        .filter(Boolean)
        .sort();
    return timestamps.at(-1);
}
function targetLabel(target) {
    return target.canonicalName ?? target.rawQuery ?? target.targetId;
}
function sourceRefFor(source, result) {
    if (!source && !result?.evidence)
        return null;
    const evidence = result?.evidence;
    const reliability = source?.reliability ?? evidence?.reliability;
    const sourceLabel = source?.sourceLabel ?? evidence?.sourceLabel ?? undefined;
    const sourceUrl = source?.sourceUrl ?? evidence?.sourceUrl ?? undefined;
    const sourceDomain = source?.sourceDomain ?? evidence?.sourceDomain ?? undefined;
    return {
        sourceId: source?.sourceId ?? result?.sourceId ?? "source:unknown",
        ...(sourceLabel ? { sourceLabel } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(sourceDomain ? { sourceDomain } : {}),
        sourceTimestamp: evidence?.sourceTimestamp ?? null,
        fetchTimestamp: evidence?.fetchTimestamp ?? result?.attemptedAt ?? null,
        ...(reliability ? { reliability } : {}),
        ...(source?.role ? { role: source.role } : {}),
        ...(result?.status ? { status: result.status } : {}),
    };
}
function observedValueFor(plan, source, result) {
    const verdict = result.verdict;
    const evidence = result.evidence;
    const sourceLabel = source?.sourceLabel ?? evidence?.sourceLabel ?? undefined;
    const sourceUrl = source?.sourceUrl ?? evidence?.sourceUrl ?? undefined;
    const sourceDomain = source?.sourceDomain ?? evidence?.sourceDomain ?? undefined;
    return {
        valueId: plan.target.targetId,
        label: targetLabel(plan.target),
        ...(verdict?.acceptedValue ? { value: verdict.acceptedValue } : {}),
        ...(verdict?.acceptedUnit ? { unit: verdict.acceptedUnit } : {}),
        confidence: result.status === "verified" && verdict?.canAnswer === true ? "verified" : result.status === "conflict" ? "conflict" : "unverified",
        ...(source?.sourceId ?? result.sourceId ? { sourceId: source?.sourceId ?? result.sourceId } : {}),
        ...(sourceLabel ? { sourceLabel } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(sourceDomain ? { sourceDomain } : {}),
        sourceTimestamp: evidence?.sourceTimestamp ?? null,
        fetchTimestamp: evidence?.fetchTimestamp ?? result.attemptedAt ?? null,
        basisTime: evidence?.sourceTimestamp ?? evidence?.fetchTimestamp ?? result.attemptedAt ?? plan.createdAt,
        conflicts: verdict?.conflicts ?? [],
    };
}
export function buildCurrentFactFinalValidationInput(input) {
    const sourceById = new Map(input.plan.sources.map((source) => [source.sourceId, source]));
    const allResults = [
        ...input.decision.confirmedResults,
        ...input.decision.unverifiedResults,
        ...input.decision.conflictResults,
    ];
    const sourceList = input.plan.sources
        .map((source) => {
        const result = allResults.find((item) => item.sourceId === source.sourceId);
        return sourceRefFor(source, result);
    })
        .filter((source) => Boolean(source));
    const observedValues = input.decision.confirmedResults.map((result) => observedValueFor(input.plan, sourceById.get(result.sourceId), result));
    const missingValues = input.decision.confirmedResults.length === 0
        ? [{
                valueId: input.plan.target.targetId,
                label: targetLabel(input.plan.target),
                reasonCode: input.decision.kind === "continue_verification"
                    ? "required_value_needs_alternative_source"
                    : "required_value_not_confirmed",
            }]
        : [];
    const conflicts = input.decision.conflictResults.flatMap((result) => {
        const source = sourceById.get(result.sourceId);
        const sourceIds = source?.sourceId ? [source.sourceId] : [result.sourceId];
        const verdictConflicts = result.verdict?.conflicts ?? [];
        if (verdictConflicts.length > 0) {
            return verdictConflicts.map((summary) => ({
                valueId: input.plan.target.targetId,
                summary,
                sourceIds,
                selectionBasis: input.decision.exhausted
                    ? "all_verification_sources_exhausted"
                    : "additional_verification_source_required",
            }));
        }
        return [{
                valueId: input.plan.target.targetId,
                summary: result.failureReason ?? "verified_sources_conflict",
                sourceIds,
                selectionBasis: input.decision.exhausted
                    ? "all_verification_sources_exhausted"
                    : "additional_verification_source_required",
            }];
    });
    const basisTime = latestTimestamp([
        input.plan.createdAt,
        ...allResults.flatMap((result) => [
            result.attemptedAt,
            result.evidence?.sourceTimestamp,
            result.evidence?.fetchTimestamp,
        ]),
    ]);
    return {
        mode: "current_fact",
        validationScope: "parent_finalizer",
        requiredValues: [{
                valueId: input.plan.target.targetId,
                label: targetLabel(input.plan.target),
                required: true,
            }],
        observedValues,
        missingValues,
        sourceList,
        sourceTimestamps: sourceList.flatMap((source) => [
            source.sourceTimestamp ?? undefined,
            source.fetchTimestamp ?? undefined,
        ]).filter((value) => Boolean(value)),
        conflicts,
        reasonCodes: input.decision.reasonCodes,
        ...(basisTime ? { basisTime } : {}),
        recoveryAvailable: input.decision.kind === "continue_verification",
        safeAlternativesExhausted: input.decision.exhausted,
    };
}
export function buildFinancialInformationBoundaryNotice(input) {
    const checkedAt = normalizeText(input.checkedAt) || undefined;
    if (input.boundary === "investment_advice") {
        return {
            boundary: input.boundary,
            ...(checkedAt ? { checkedAt } : {}),
            mustIncludeRiskNotice: true,
            notice: [
                "투자 판단에는 손실 위험이 있습니다.",
                checkedAt ? `확인 시각: ${checkedAt}.` : "",
                "이 정보는 확인된 시세와 일반 정보 정리이며, 개인 맞춤 투자 권유로 확정하지 않습니다.",
            ].filter(Boolean).join(" "),
        };
    }
    return {
        boundary: input.boundary,
        ...(checkedAt ? { checkedAt } : {}),
        mustIncludeRiskNotice: false,
        notice: checkedAt
            ? `확인 시각: ${checkedAt}. 시세 사실 확인 또는 일반 금융 정보로만 다룹니다.`
            : "시세 사실 확인 또는 일반 금융 정보로만 다룹니다.",
    };
}
//# sourceMappingURL=current-fact-retrieval.js.map