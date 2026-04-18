import { join } from "node:path";
import { buildWebRetrievalPolicyDecision } from "./web-retrieval-policy.js";
import { buildRetrievalTargetHash, evaluateRetrievalCacheEntry, listPersistentRetrievalCacheEntriesForTarget } from "./web-retrieval-cache.js";
import { resolveWeatherLocationContract } from "./web-location-contract.js";
import { buildFinanceKnownSources, FINANCE_ADAPTER_METADATA, resolveFinanceIndexTarget } from "./web-source-adapters/finance.js";
import { buildWeatherKnownSources, WEATHER_ADAPTER_METADATA } from "./web-source-adapters/weather.js";
import { loadWebRetrievalFixturesFromDir, runWebRetrievalFixtureRegression } from "./web-retrieval-smoke.js";
const TOOL_EVENT_KINDS = new Set(["tool_started", "tool_done", "tool_failed", "tool_skipped"]);
const WEB_TOOL_NAMES = new Set(["web_search", "web_fetch"]);
const SENSITIVE_KEY_PATTERN = /api[_-]?key|authorization|bearer|cookie|credential|password|refresh[_-]?token|secret|token|raw[_-]?(?:body|output|response)|provider[_-]?raw|html|body|response/i;
const SECRET_TEXT_PATTERNS = [
    [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***"],
    [/xox[abprs]-[A-Za-z0-9-]{8,}/gi, "xox*-***"],
    [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-***"],
    [/\b\d{6,}:[A-Za-z0-9_-]{8,}\b/g, "***:***"],
];
const LOCAL_PATH_PATTERN = /(?:\/Users\/[^\s"')]+|\/tmp\/[^\s"')]+|[A-Za-z]:\\[^\s"']+)/g;
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function parseJson(raw) {
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return raw;
    }
}
function asString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}
function asNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function asBoolean(value) {
    return typeof value === "boolean" ? value : null;
}
function detailRecord(value) {
    return isRecord(value) ? value : null;
}
function nestedRecord(value, key) {
    const record = detailRecord(value);
    return record ? detailRecord(record[key]) : null;
}
function stringField(record, key) {
    return asString(record?.[key]);
}
function boolField(record, key) {
    return asBoolean(record?.[key]);
}
function stringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}
function sanitizeText(value) {
    let next = value;
    let redacted = false;
    for (const [pattern, replacement] of SECRET_TEXT_PATTERNS) {
        const replaced = next.replace(pattern, replacement);
        if (replaced !== next)
            redacted = true;
        next = replaced;
    }
    const pathReplaced = next.replace(LOCAL_PATH_PATTERN, "[local path hidden]");
    if (pathReplaced !== next)
        redacted = true;
    next = pathReplaced;
    if (/(<!doctype\s+html|<html\b|<head\b|<body\b|<script\b)/i.test(next)) {
        return { value: "[html content hidden]", redacted: true };
    }
    if (next.length > 2_000)
        return { value: `${next.slice(0, 1_990)}...`, redacted: true };
    return { value: next, redacted };
}
function sanitizeInspectorValue(value, depth = 0) {
    if (value == null)
        return { value, redacted: false };
    if (depth > 8)
        return { value: "[truncated]", redacted: true };
    if (typeof value === "string")
        return sanitizeText(value);
    if (typeof value !== "object")
        return { value, redacted: false };
    if (Array.isArray(value)) {
        let redacted = false;
        const sanitized = value.slice(0, 100).map((item) => {
            const nested = sanitizeInspectorValue(item, depth + 1);
            redacted = redacted || nested.redacted;
            return nested.value;
        });
        if (value.length > 100)
            redacted = true;
        return { value: sanitized, redacted };
    }
    let redacted = false;
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
            out[key] = "[redacted]";
            redacted = true;
            continue;
        }
        const sanitized = sanitizeInspectorValue(nested, depth + 1);
        out[key] = sanitized.value;
        redacted = redacted || sanitized.redacted;
    }
    return { value: out, redacted };
}
function ledgerEnvelope(event) {
    if (!TOOL_EVENT_KINDS.has(event.event_kind) && !event.event_kind.startsWith("approval_"))
        return null;
    return {
        id: event.id,
        source: "ledger",
        eventKind: event.event_kind,
        status: event.status,
        summary: event.summary,
        at: event.created_at,
        runId: event.run_id,
        requestGroupId: event.request_group_id,
        sessionKey: event.session_key,
        detail: parseJson(event.detail_json),
    };
}
function controlEnvelope(event) {
    if (!event.eventType.startsWith("tool.") && !event.eventType.startsWith("approval."))
        return null;
    return {
        id: event.id,
        source: "control",
        eventKind: event.eventType,
        status: event.severity,
        summary: event.summary,
        at: event.at,
        runId: event.runId,
        requestGroupId: event.requestGroupId,
        sessionKey: event.sessionKey,
        detail: event.detail,
    };
}
function toolNameFromEnvelope(event) {
    const detail = detailRecord(event.detail);
    const direct = stringField(detail, "toolName") ?? stringField(detail, "tool") ?? stringField(detail, "name");
    if (direct)
        return direct;
    const fromSummary = event.summary.match(/^([A-Za-z0-9_-]+)\s+/)?.[1];
    if (fromSummary && fromSummary.includes("_"))
        return fromSummary;
    return null;
}
function extractParams(detail) {
    const record = detailRecord(detail);
    if (!record)
        return null;
    return record.params ?? record.parameters ?? record.arguments ?? record.input ?? null;
}
function extractOutput(detail) {
    const record = detailRecord(detail);
    if (!record)
        return null;
    return record.output ?? record.result ?? record.response ?? record.error ?? record.summary ?? null;
}
function eventStatus(event) {
    if (event.eventKind === "tool_failed" || event.eventKind === "tool.failed" || event.status === "failed" || event.status === "error")
        return "failed";
    if (event.eventKind === "tool_skipped" || event.eventKind === "tool.skipped" || event.status === "skipped")
        return "skipped";
    if (event.eventKind === "tool_done" || event.eventKind === "tool.completed" || event.status === "succeeded")
        return "succeeded";
    if (event.eventKind === "tool_started" || event.eventKind === "tool.dispatched" || event.status === "started")
        return "started";
    return "unknown";
}
function contextKey(input) {
    return input.requestGroupId ?? input.runId ?? input.sessionKey ?? "global";
}
function groupKeyForToolEvent(event, toolName) {
    const detail = detailRecord(event.detail);
    const callId = stringField(detail, "toolCallId") ?? stringField(detail, "callId") ?? stringField(detail, "idempotencyKey");
    return [contextKey(event), toolName, callId ?? "default"].join(":");
}
function approvalStateFor(events, context, toolName) {
    const relevant = events.filter((event) => {
        if (!event.eventKind.startsWith("approval"))
            return false;
        if (contextKey(event) !== context)
            return false;
        const eventTool = toolNameFromEnvelope(event);
        return eventTool == null || eventTool === toolName;
    });
    if (relevant.some((event) => /denied|deny|rejected|cancel/i.test(JSON.stringify(event.detail))))
        return "denied";
    if (relevant.some((event) => /approved|approve|allow|accepted/i.test(JSON.stringify(event.detail)) || event.eventKind === "approval_received"))
        return "approved";
    if (relevant.some((event) => event.eventKind.includes("requested")))
        return "requested";
    return "not_required";
}
function maxRetryCount(events) {
    let max = 0;
    for (const event of events) {
        const detail = detailRecord(event.detail);
        const explicit = asNumber(detail?.retryCount ?? detail?.retry_count ?? detail?.attemptIndex);
        if (explicit != null)
            max = Math.max(max, explicit);
    }
    const starts = events.filter((event) => event.eventKind === "tool_started" || event.eventKind === "tool.dispatched").length;
    return Math.max(max, Math.max(0, starts - 1));
}
function worseToolStatus(left, right) {
    const rank = { unknown: 0, started: 1, succeeded: 2, skipped: 3, failed: 4 };
    return rank[right] > rank[left] ? right : left;
}
export function buildAdminToolCallsInspector(input) {
    const envelopes = [
        ...input.ledgerEvents.map(ledgerEnvelope).filter((event) => event !== null),
        ...input.timeline.events.map(controlEnvelope).filter((event) => event !== null),
    ].sort((left, right) => left.at - right.at);
    const toolGroups = new Map();
    for (const envelope of envelopes) {
        const toolName = toolNameFromEnvelope(envelope);
        if (!toolName || envelope.eventKind.startsWith("approval"))
            continue;
        const key = groupKeyForToolEvent(envelope, toolName);
        const group = toolGroups.get(key) ?? { toolName, events: [] };
        group.events.push(envelope);
        toolGroups.set(key, group);
    }
    const calls = [...toolGroups.entries()].map(([id, group]) => {
        const ordered = [...group.events].sort((left, right) => left.at - right.at);
        const context = contextKey(ordered[0] ?? { runId: null, requestGroupId: null, sessionKey: null });
        let status = "unknown";
        for (const event of ordered)
            status = worseToolStatus(status, eventStatus(event));
        const paramsSource = ordered.map((event) => extractParams(event.detail)).find((value) => value !== null) ?? null;
        const outputSource = [...ordered].reverse().map((event) => extractOutput(event.detail)).find((value) => value !== null) ?? null;
        const params = sanitizeInspectorValue(paramsSource);
        const output = sanitizeInspectorValue(outputSource);
        const durationFromDetail = ordered.map((event) => asNumber(detailRecord(event.detail)?.durationMs)).find((value) => value !== null) ?? null;
        const startedAt = ordered[0]?.at ?? null;
        const finishedAt = ordered.at(-1)?.at ?? null;
        const durationMs = durationFromDetail ?? (startedAt != null && finishedAt != null && finishedAt !== startedAt ? Math.max(0, finishedAt - startedAt) : null);
        const latest = ordered.at(-1);
        return {
            id,
            toolName: group.toolName,
            status,
            approvalState: approvalStateFor(envelopes, context, group.toolName),
            runId: ordered.find((event) => event.runId)?.runId ?? null,
            requestGroupId: ordered.find((event) => event.requestGroupId)?.requestGroupId ?? null,
            sessionKey: ordered.find((event) => event.sessionKey)?.sessionKey ?? null,
            startedAt,
            finishedAt,
            durationMs,
            retryCount: maxRetryCount(ordered),
            eventCount: ordered.length,
            paramsRedacted: params.value,
            outputRedacted: output.value,
            redactionApplied: params.redacted || output.redacted,
            resultSummary: latest?.summary ?? null,
            lifecycle: ordered.map((event) => ({ at: event.at, source: event.source, eventKind: event.eventKind, status: event.status, summary: event.summary })),
        };
    }).sort((left, right) => (right.finishedAt ?? 0) - (left.finishedAt ?? 0));
    const limited = input.limit ? calls.slice(0, input.limit) : calls;
    return {
        summary: {
            total: limited.length,
            failed: limited.filter((call) => call.status === "failed").length,
            waitingApproval: limited.filter((call) => call.approvalState === "requested").length,
            redacted: limited.filter((call) => call.redactionApplied).length,
        },
        calls: limited,
    };
}
function evidenceFromDetail(detail) {
    const evidence = nestedRecord(detail, "sourceEvidence") ?? detailRecord(detail);
    const method = stringField(evidence, "method");
    const fetchTimestamp = stringField(evidence, "fetchTimestamp");
    if (!method || !fetchTimestamp)
        return null;
    const adapterStatus = stringField(evidence, "adapterStatus");
    const sourceEvidence = {
        method: method,
        sourceKind: (stringField(evidence, "sourceKind") ?? "unknown"),
        reliability: (stringField(evidence, "reliability") ?? "unknown"),
        sourceUrl: stringField(evidence, "sourceUrl"),
        sourceDomain: stringField(evidence, "sourceDomain"),
        sourceLabel: stringField(evidence, "sourceLabel"),
        sourceTimestamp: stringField(evidence, "sourceTimestamp"),
        fetchTimestamp,
        freshnessPolicy: (stringField(evidence, "freshnessPolicy") ?? "latest_approximate"),
        adapterId: stringField(evidence, "adapterId"),
        adapterVersion: stringField(evidence, "adapterVersion"),
        parserVersion: stringField(evidence, "parserVersion"),
    };
    if (adapterStatus === "active" || adapterStatus === "degraded")
        sourceEvidence.adapterStatus = adapterStatus;
    return sourceEvidence;
}
function policyFromTool(toolName, params) {
    const paramsRecord = detailRecord(params);
    if (!paramsRecord)
        return null;
    const decision = buildWebRetrievalPolicyDecision({ toolName, params: paramsRecord });
    return decision?.applies ? decision : null;
}
function queryVariantFromParams(params) {
    const record = detailRecord(params);
    if (!record)
        return [];
    return [record.query, record.q, record.url, record.sourceUrl]
        .map(asString)
        .filter((value) => value !== null);
}
function uniqueStrings(values) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        const normalized = value.trim();
        if (!normalized || seen.has(normalized))
            continue;
        seen.add(normalized);
        out.push(normalized);
    }
    return out;
}
function knownTargetFromQuery(query) {
    if (!query?.trim())
        return { target: null, sources: [], adapters: [] };
    const finance = resolveFinanceIndexTarget(query);
    if (finance) {
        return {
            target: finance.targetContract,
            sources: buildFinanceKnownSources(finance.key),
            adapters: [adapterView(FINANCE_ADAPTER_METADATA)],
        };
    }
    const weather = resolveWeatherLocationContract(query);
    if (weather) {
        return {
            target: weather.targetContract,
            sources: buildWeatherKnownSources(weather.contract),
            adapters: [adapterView(WEATHER_ADAPTER_METADATA)],
        };
    }
    return { target: null, sources: [], adapters: [] };
}
function adapterView(metadata) {
    return {
        adapterId: metadata.adapterId,
        adapterVersion: metadata.adapterVersion,
        parserVersion: metadata.parserVersion,
        checksum: metadata.checksum,
        status: metadata.status,
        ...(metadata.degradedReason !== undefined ? { degradedReason: metadata.degradedReason } : {}),
    };
}
function cacheViewForTarget(target) {
    if (!target)
        return { status: "not_loaded", entryCount: 0, entries: [] };
    try {
        const entries = listPersistentRetrievalCacheEntriesForTarget({
            targetHash: buildRetrievalTargetHash(target),
            freshnessPolicy: "latest_approximate",
            limit: 5,
        });
        const evaluated = entries.map((entry) => {
            const evaluation = evaluateRetrievalCacheEntry({ entry, userRequestedLatest: true });
            return {
                status: evaluation.status,
                canUseForFinalAnswer: evaluation.canUseForFinalAnswer,
                canUseAsDiscoveryHint: evaluation.canUseAsDiscoveryHint,
                cacheAgeMs: evaluation.cacheAgeMs,
                reason: evaluation.reason,
                value: evaluation.entry?.value ?? null,
                unit: evaluation.entry?.unit ?? null,
                sourceDomain: evaluation.entry?.sourceEvidence.sourceDomain ?? null,
            };
        });
        return { status: evaluated[0]?.status ?? "miss", entryCount: evaluated.length, entries: evaluated };
    }
    catch {
        return { status: "not_loaded", entryCount: 0, entries: [] };
    }
}
function verificationFromEvents(events) {
    const verificationEvent = [...events].reverse().find((event) => event.eventType.includes("verification") || event.eventType.includes("verdict") || nestedRecord(event.detail, "verdict") || boolField(detailRecord(event.detail), "canAnswer") !== null);
    const detail = detailRecord(verificationEvent?.detail);
    const verdict = nestedRecord(verificationEvent?.detail, "verdict") ?? detail;
    return {
        canAnswer: boolField(verdict, "canAnswer"),
        evidenceSufficiency: stringField(verdict, "evidenceSufficiency") ?? stringField(verdict, "sufficiency"),
        acceptedValue: stringField(verdict, "acceptedValue"),
        rejectionReason: stringField(verdict, "rejectionReason"),
        mustAvoidGuessing: boolField(detail, "mustAvoidGuessing"),
        policy: stringField(verdict, "policy") ?? stringField(detail, "policy") ?? "latest_approximate",
        completionStrict: true,
        semanticComparisonAllowed: false,
        verificationMode: "contract_fields",
    };
}
function candidateExtractionFromEvents(events) {
    const candidateEvents = events.filter((event) => event.eventType.includes("candidate"));
    let candidateCount = 0;
    for (const event of candidateEvents) {
        const detail = detailRecord(event.detail);
        const explicit = asNumber(detail?.candidateCount);
        if (explicit != null)
            candidateCount += explicit;
        else if (Array.isArray(detail?.candidates))
            candidateCount += detail.candidates.length;
    }
    return {
        eventCount: candidateEvents.length,
        candidateCount,
        lastSummary: candidateEvents.at(-1)?.summary ?? null,
    };
}
function conflictResolverFromEvents(events) {
    const event = [...events].reverse().find((item) => item.eventType.includes("conflict") || stringArray(nestedRecord(item.detail, "verdict")?.conflicts).length > 0);
    const detail = detailRecord(event?.detail);
    const verdict = nestedRecord(event?.detail, "verdict");
    return {
        status: stringField(detail, "conflictStatus") ?? stringField(detail, "status"),
        conflicts: stringArray(verdict?.conflicts ?? detail?.conflicts),
    };
}
function degradedReasons(toolCalls, events) {
    const reasons = [];
    for (const call of toolCalls) {
        if (call.status === "failed")
            reasons.push(`${call.toolName}:failed`);
        if (call.status === "skipped")
            reasons.push(`${call.toolName}:skipped`);
    }
    for (const event of events) {
        if (event.severity === "error")
            reasons.push(`${event.eventType}:error`);
        if (event.severity === "warning")
            reasons.push(`${event.eventType}:warning`);
        const evidence = evidenceFromDetail(event.detail);
        if (evidence?.adapterStatus === "degraded")
            reasons.push(`${evidence.adapterId ?? "adapter"}:degraded`);
        const detail = detailRecord(event.detail);
        const status = stringField(detail, "status");
        if (status && status !== "ready" && status !== "succeeded" && status !== "ok")
            reasons.push(`${event.eventType}:${status}`);
    }
    return uniqueStrings(reasons);
}
function attemptViewFromToolCall(call) {
    if (!WEB_TOOL_NAMES.has(call.toolName))
        return null;
    const params = call.paramsRedacted;
    const policy = policyFromTool(call.toolName, params);
    const canonical = policy?.canonicalParams ?? {};
    return {
        id: call.id,
        toolName: call.toolName,
        status: call.status,
        method: policy?.method ?? (call.toolName === "web_search" ? "fast_text_search" : "direct_fetch"),
        sourceKind: policy?.sourceKind ?? "unknown",
        reliability: policy?.reliability ?? "unknown",
        freshnessPolicy: policy?.freshnessPolicy ?? "latest_approximate",
        sourceUrl: asString(canonical.url ?? canonical.sourceUrl) ?? queryVariantFromParams(params).find((item) => /^https?:\/\//i.test(item)) ?? null,
        sourceDomain: asString(canonical.sourceDomain) ?? null,
        fetchTimestamp: policy?.fetchTimestamp ?? null,
        sourceTimestamp: null,
        durationMs: call.durationMs,
        retryCount: call.retryCount,
    };
}
function sourceAttemptFromEvent(event) {
    const evidence = evidenceFromDetail(event.detail);
    if (!evidence)
        return null;
    return {
        id: event.id,
        toolName: stringField(detailRecord(event.detail), "toolName") ?? evidence.method,
        status: event.severity === "error" ? "failed" : "succeeded",
        method: evidence.method,
        sourceKind: evidence.sourceKind,
        reliability: evidence.reliability,
        freshnessPolicy: evidence.freshnessPolicy ?? "latest_approximate",
        sourceUrl: evidence.sourceUrl ?? null,
        sourceDomain: evidence.sourceDomain ?? null,
        fetchTimestamp: evidence.fetchTimestamp,
        sourceTimestamp: evidence.sourceTimestamp ?? null,
        durationMs: asNumber(detailRecord(event.detail)?.durationMs),
        retryCount: asNumber(detailRecord(event.detail)?.retryCount) ?? 0,
    };
}
export function buildAdminWebRetrievalLab(input) {
    const toolCalls = buildAdminToolCallsInspector(input).calls;
    const webToolCalls = toolCalls.filter((call) => WEB_TOOL_NAMES.has(call.toolName));
    const retrievalEvents = input.timeline.events.filter((event) => event.component === "web_retrieval" || event.eventType.startsWith("web_retrieval.") || event.eventType.includes("verification") || event.eventType.includes("candidate"));
    const knownTarget = knownTargetFromQuery(input.query);
    const eventsByContext = new Map();
    for (const event of retrievalEvents) {
        const key = contextKey(event);
        const group = eventsByContext.get(key) ?? [];
        group.push(event);
        eventsByContext.set(key, group);
    }
    for (const call of webToolCalls) {
        const key = contextKey(call);
        if (!eventsByContext.has(key))
            eventsByContext.set(key, []);
    }
    if (eventsByContext.size === 0)
        eventsByContext.set("global", []);
    const sessions = [...eventsByContext.entries()].map(([key, events]) => {
        const calls = webToolCalls.filter((call) => contextKey(call) === key || key === "global");
        const queryVariants = uniqueStrings([
            ...(input.query ? [input.query] : []),
            ...calls.flatMap((call) => queryVariantFromParams(call.paramsRedacted)),
            ...knownTarget.sources.map((source) => source.url),
        ]);
        const attempts = [
            ...calls.map(attemptViewFromToolCall).filter((attempt) => attempt !== null),
            ...events.map(sourceAttemptFromEvent).filter((attempt) => attempt !== null),
        ];
        const reasons = degradedReasons(calls, events);
        const verification = verificationFromEvents(events);
        return {
            id: key,
            requestGroupId: events.find((event) => event.requestGroupId)?.requestGroupId ?? calls.find((call) => call.requestGroupId)?.requestGroupId ?? null,
            runId: events.find((event) => event.runId)?.runId ?? calls.find((call) => call.runId)?.runId ?? null,
            sessionKey: events.find((event) => event.sessionKey)?.sessionKey ?? calls.find((call) => call.sessionKey)?.sessionKey ?? null,
            target: knownTarget.target,
            sourceLadder: knownTarget.sources,
            queryVariants,
            fetchAttempts: attempts,
            candidateExtraction: candidateExtractionFromEvents(events),
            verification,
            conflictResolver: conflictResolverFromEvents(events),
            cache: cacheViewForTarget(knownTarget.target),
            adapterMetadata: knownTarget.adapters,
            degradedState: { degraded: reasons.length > 0, reasons },
            policySeparation: {
                discovery: "loose_search",
                completion: "strict_contract_fields",
                semanticComparisonAllowed: false,
            },
        };
    }).slice(0, input.limit ?? 50);
    return {
        summary: {
            sessions: sessions.length,
            attempts: sessions.reduce((sum, session) => sum + session.fetchAttempts.length, 0),
            degraded: sessions.filter((session) => session.degradedState.degraded).length,
            answerable: sessions.filter((session) => session.verification.canAnswer === true).length,
        },
        sessions,
    };
}
export function buildAdminToolRetrievalLab(input) {
    return {
        toolCalls: buildAdminToolCallsInspector(input),
        webRetrieval: buildAdminWebRetrievalLab(input),
    };
}
export function runAdminWebRetrievalFixtureReplay(input = {}) {
    const fixtureDir = input.fixtureDir ?? join(process.cwd(), "tests", "fixtures", "web-retrieval");
    const fixtureIds = new Set((input.fixtureIds ?? []).map((id) => id.trim()).filter(Boolean));
    const fixtures = loadWebRetrievalFixturesFromDir(fixtureDir).filter((fixture) => fixtureIds.size === 0 || fixtureIds.has(fixture.id));
    const now = input.now ?? new Date();
    const summary = runWebRetrievalFixtureRegression(fixtures, { startedAt: now, finishedAt: now });
    return {
        ok: true,
        generatedAt: now.getTime(),
        networkUsed: false,
        semanticComparisonAllowed: false,
        verificationMode: "contract_fields",
        fixtureCount: fixtures.length,
        summary: {
            kind: summary.kind,
            policyVersion: summary.policyVersion,
            status: summary.status,
            counts: summary.counts,
        },
        results: summary.results.map((result) => ({
            fixtureId: result.fixtureId,
            title: result.title,
            status: result.status,
            attempts: result.attempts,
            candidateCount: result.candidateCount,
            canAnswer: result.verdict.canAnswer,
            acceptedValue: result.verdict.acceptedValue,
            evidenceSufficiency: result.verdict.evidenceSufficiency,
            failures: result.failures,
        })),
    };
}
//# sourceMappingURL=admin-tool-lab.js.map