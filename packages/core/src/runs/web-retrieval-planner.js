import crypto from "node:crypto";
import { buildRetrievalDedupeKey } from "./web-retrieval-session.js";
const ALLOWED_METHODS = new Set(["official_api", "direct_fetch", "fast_text_search", "browser_search", "known_source_adapter"]);
const STOP_REASONS = new Set(["policy_block", "target_ambiguity", "no_further_safe_source", "budget_exhausted", "provider_unavailable"]);
const RISKS = new Set(["low", "medium", "high"]);
const TOP_LEVEL_KEYS = new Set(["nextActions", "stopReason"]);
const ACTION_KEYS = new Set(["method", "query", "url", "expectedTargetBinding", "reason", "risk"]);
const BLOCKED_SCHEMES = new Set(["file:", "data:", "javascript:"]);
const GENERATED_VALUE_PATTERN = /(?:[$₩€¥]\s*)?\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+\.\d+|\d+\s*(?:°C|℃|%|포인트|points?|pts?|pt|원|달러|USD|KRW)/iu;
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
    return crypto.createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 24);
}
function normalizeWhitespace(value) {
    return value?.trim().replace(/\s+/g, " ") ?? "";
}
function normalizeForContract(value) {
    return normalizeWhitespace(value)
        .normalize("NFKC")
        .toLocaleLowerCase("ko-KR")
        .replace(/[^\p{L}\p{N}]+/gu, "");
}
function asObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    return value;
}
function parseJsonObject(raw) {
    if (typeof raw !== "string")
        return { object: asObject(raw), error: asObject(raw) ? null : "planner_output_must_be_object_or_json_string" };
    const trimmed = raw.trim();
    if (!trimmed)
        return { object: null, error: "planner_output_empty" };
    if (/^```/u.test(trimmed))
        return { object: null, error: "planner_output_must_not_use_markdown_code_fence" };
    try {
        const parsed = JSON.parse(trimmed);
        return { object: asObject(parsed), error: asObject(parsed) ? null : "planner_output_must_be_json_object" };
    }
    catch {
        return { object: null, error: "planner_output_json_parse_failed" };
    }
}
function plannerMethods(input) {
    const methods = [];
    for (const method of input) {
        if (ALLOWED_METHODS.has(method) && !methods.includes(method))
            methods.push(method);
    }
    return methods;
}
function attemptedSummaries(attempts) {
    return attempts.map((attempt) => ({
        method: attempt.method,
        status: attempt.status,
        ...(attempt.query ? { query: normalizeWhitespace(attempt.query) } : {}),
        ...(attempt.url ? { url: normalizeWhitespace(attempt.url) } : {}),
        ...(attempt.sourceDomain ? { sourceDomain: normalizeWhitespace(attempt.sourceDomain).toLocaleLowerCase("en-US") } : {}),
        ...(attempt.errorKind ? { errorKind: normalizeWhitespace(attempt.errorKind) } : {}),
        ...(attempt.stopReason ? { stopReason: normalizeWhitespace(attempt.stopReason) } : {}),
        ...(attempt.dedupeKey ? { dedupeKey: normalizeWhitespace(attempt.dedupeKey) } : {}),
    }));
}
function labelsForTarget(target) {
    const labels = [
        ...(target.symbols ?? []),
        target.canonicalName ?? "",
        target.locationName ?? "",
    ].map((label) => normalizeWhitespace(label)).filter(Boolean);
    if (labels.length === 0 && target.rawQuery)
        labels.push(normalizeWhitespace(target.rawQuery));
    return labels;
}
function targetBindingMatches(action, target) {
    const labels = labelsForTarget(target);
    if (labels.length === 0)
        return true;
    const bindingText = [action.expectedTargetBinding, action.query ?? "", action.url ?? ""].join(" ");
    const normalizedBinding = normalizeForContract(bindingText);
    return labels.some((label) => {
        const normalizedLabel = normalizeForContract(label);
        return normalizedLabel.length > 0 && normalizedBinding.includes(normalizedLabel);
    });
}
function canonicalActionUrl(rawUrl) {
    const url = normalizeWhitespace(rawUrl);
    if (!url)
        return { href: null, domain: null, scheme: null };
    try {
        const parsed = new URL(url);
        parsed.hash = "";
        parsed.hostname = parsed.hostname.toLowerCase();
        return { href: parsed.toString(), domain: parsed.hostname, scheme: parsed.protocol };
    }
    catch {
        return { href: null, domain: null, scheme: null };
    }
}
function domainMatches(domain, policyDomain) {
    const normalizedDomain = domain.toLocaleLowerCase("en-US");
    const normalizedPolicy = policyDomain.trim().replace(/^\*\./u, "").toLocaleLowerCase("en-US");
    return normalizedDomain === normalizedPolicy || normalizedDomain.endsWith(`.${normalizedPolicy}`);
}
function checkDomainPolicy(domain, policy) {
    if (!domain || !policy)
        return null;
    if (policy.blockedDomains?.some((blocked) => domainMatches(domain, blocked)))
        return "blocked_domain";
    if (policy.allowedDomains && policy.allowedDomains.length > 0 && !policy.allowedDomains.some((allowed) => domainMatches(domain, allowed)))
        return "domain_not_allowed";
    return null;
}
function dedupeKeysFromAttempts(input) {
    const keys = new Set(input.attemptedDedupeKeys ?? []);
    for (const attempt of input.attemptedSources ?? []) {
        if (attempt.dedupeKey)
            keys.add(attempt.dedupeKey);
        if (attempt.method !== "ai_assisted_planner") {
            keys.add(buildRetrievalDedupeKey({
                method: attempt.method,
                freshnessPolicy: input.freshnessPolicy,
                query: attempt.query ?? null,
                sourceUrl: attempt.url ?? null,
                sourceDomain: attempt.sourceDomain ?? null,
            }));
        }
    }
    return keys;
}
function dedupeKeyForAction(action, freshnessPolicy) {
    return buildRetrievalDedupeKey({
        method: action.method,
        freshnessPolicy,
        query: action.query ?? null,
        sourceUrl: action.url ?? null,
    });
}
function validateAction(rawAction, input, attemptedKeys) {
    const actionObject = asObject(rawAction);
    if (!actionObject)
        return { action: null, reason: "planner_action_must_be_object" };
    for (const key of Object.keys(actionObject)) {
        if (!ACTION_KEYS.has(key))
            return { action: null, reason: `planner_action_unknown_field:${key}` };
    }
    const method = actionObject["method"];
    const expectedTargetBinding = actionObject["expectedTargetBinding"];
    const reason = actionObject["reason"];
    const risk = actionObject["risk"];
    const query = typeof actionObject["query"] === "string" ? normalizeWhitespace(actionObject["query"]) : undefined;
    const url = typeof actionObject["url"] === "string" ? normalizeWhitespace(actionObject["url"]) : undefined;
    if (!ALLOWED_METHODS.has(method))
        return { action: null, reason: "planner_method_not_allowed_by_schema" };
    if (!input.allowedMethods.includes(method))
        return { action: null, reason: "planner_method_not_allowed_by_policy" };
    if (typeof expectedTargetBinding !== "string" || !expectedTargetBinding.trim())
        return { action: null, reason: "expected_target_binding_required" };
    if (typeof reason !== "string" || !reason.trim())
        return { action: null, reason: "planner_reason_required" };
    if (!RISKS.has(risk))
        return { action: null, reason: "planner_risk_invalid" };
    if (GENERATED_VALUE_PATTERN.test(expectedTargetBinding) || GENERATED_VALUE_PATTERN.test(reason))
        return { action: null, reason: "planner_must_not_generate_values" };
    const action = {
        method: method,
        expectedTargetBinding: normalizeWhitespace(expectedTargetBinding),
        reason: normalizeWhitespace(reason),
        risk: risk,
        ...(query ? { query } : {}),
        ...(url ? { url } : {}),
    };
    if (action.method === "fast_text_search" && !action.query)
        return { action: null, reason: "search_query_required" };
    if ((action.method === "direct_fetch" || action.method === "browser_search" || action.method === "official_api") && !action.url)
        return { action: null, reason: "url_required_for_method" };
    if (action.url) {
        const canonical = canonicalActionUrl(action.url);
        if (!canonical.href || !canonical.scheme)
            return { action: null, reason: "planner_url_invalid" };
        if (BLOCKED_SCHEMES.has(canonical.scheme) || (canonical.scheme !== "http:" && canonical.scheme !== "https:"))
            return { action: null, reason: "planner_url_scheme_blocked" };
        const domainPolicyReason = checkDomainPolicy(canonical.domain, input.domainPolicy);
        if (domainPolicyReason)
            return { action: null, reason: domainPolicyReason };
        action.url = canonical.href;
    }
    if (!targetBindingMatches(action, input.targetContract))
        return { action: null, reason: "target_binding_mismatch" };
    if (attemptedKeys.has(dedupeKeyForAction(action, input.freshnessPolicy)))
        return { action: null, reason: "duplicate_planner_action" };
    return { action, reason: null };
}
export function buildWebRetrievalPlannerPrompt(input) {
    const payload = {
        originalRequest: input.originalRequest,
        targetContract: input.targetContract,
        attemptedSources: attemptedSummaries(input.attemptedSources),
        failureSummary: input.failureSummary,
        allowedMethods: plannerMethods(input.allowedMethods),
        freshnessPolicy: input.freshnessPolicy,
        now: (input.now ?? new Date()).toISOString(),
    };
    return [
        "You are the memoryless Web Retrieval Recovery Planner.",
        "Do not use long-term memory, prior conversation history, unrelated run results, or model knowledge to answer values.",
        "Do not generate current values, prices, weather numbers, index values, ranges, or conclusions.",
        "Do not change the target contract. Propose only next retrieval actions that keep the same target.",
        "Return JSON only with top-level nextActions and optional stopReason.",
        "Each nextActions item may contain only method, query, url, expectedTargetBinding, reason, risk.",
        "Input:",
        stableStringify(payload),
    ].join("\n");
}
export function validateWebRetrievalPlannerOutput(input) {
    const errors = [];
    const rejectedActions = [];
    const { object, error } = parseJsonObject(input.rawOutput);
    if (error || !object) {
        return { accepted: false, output: null, acceptedActions: [], rejectedActions, errors: [error ?? "planner_output_invalid"] };
    }
    for (const key of Object.keys(object)) {
        if (!TOP_LEVEL_KEYS.has(key))
            errors.push(`planner_output_unknown_field:${key}`);
    }
    const stopReasonRaw = object["stopReason"];
    const stopReason = typeof stopReasonRaw === "string" && STOP_REASONS.has(stopReasonRaw)
        ? stopReasonRaw
        : undefined;
    if (stopReasonRaw !== undefined && !stopReason)
        errors.push("planner_stop_reason_invalid");
    const nextActionsRaw = object["nextActions"];
    if (nextActionsRaw !== undefined && !Array.isArray(nextActionsRaw))
        errors.push("planner_next_actions_must_be_array");
    const attemptedKeys = dedupeKeysFromAttempts(input);
    const acceptedActions = [];
    if (Array.isArray(nextActionsRaw)) {
        for (const rawAction of nextActionsRaw) {
            const validated = validateAction(rawAction, input, attemptedKeys);
            if (validated.action) {
                acceptedActions.push(validated.action);
                attemptedKeys.add(dedupeKeyForAction(validated.action, input.freshnessPolicy));
            }
            else {
                rejectedActions.push({ action: rawAction, reason: validated.reason ?? "planner_action_rejected" });
            }
        }
    }
    if (errors.length > 0)
        return { accepted: false, output: null, acceptedActions, rejectedActions, errors, ...(stopReason ? { stopReason } : {}) };
    if (acceptedActions.length === 0 && !stopReason)
        errors.push("planner_output_requires_action_or_stop_reason");
    if (errors.length > 0)
        return { accepted: false, output: null, acceptedActions, rejectedActions, errors };
    const output = {
        nextActions: acceptedActions,
        ...(stopReason ? { stopReason } : {}),
    };
    return { accepted: true, output, acceptedActions, rejectedActions, errors: [], ...(stopReason ? { stopReason } : {}) };
}
export function attemptsToPlannerSummaries(attempts) {
    return attempts.map((attempt) => ({
        method: attempt.method,
        status: attempt.status,
        url: attempt.sourceUrl ?? null,
        sourceDomain: attempt.sourceDomain ?? null,
        errorKind: attempt.errorKind ?? null,
        stopReason: attempt.stopReason ?? null,
        dedupeKey: attempt.dedupeKey,
    }));
}
export function buildPlannerCallIdempotencyKey(input) {
    return `web-retrieval-planner:${hash({
        targetId: input.targetContract.targetId,
        failureSummary: normalizeWhitespace(input.failureSummary),
        attemptedSources: attemptedSummaries(input.attemptedSources),
        freshnessPolicy: input.freshnessPolicy,
    })}`;
}
async function callWithTimeout(input) {
    const controller = new AbortController();
    let timeout = null;
    try {
        return await Promise.race([
            input.callPlanner(input.prompt, controller.signal),
            new Promise((_, reject) => {
                timeout = setTimeout(() => {
                    controller.abort();
                    reject(new Error("planner_timeout"));
                }, input.timeoutMs);
            }),
        ]);
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
export async function runWebRetrievalPlanner(input) {
    const maxPlannerCalls = input.maxPlannerCalls ?? 2;
    const plannerCallsUsed = input.plannerCallsUsed ?? 0;
    const timeoutMs = Math.min(input.timeoutMs ?? 3_000, Math.max(1, input.remainingHardBudgetMs ?? input.timeoutMs ?? 3_000));
    const prompt = buildWebRetrievalPlannerPrompt({
        originalRequest: input.originalRequest,
        targetContract: input.targetContract,
        attemptedSources: input.attemptedSources,
        failureSummary: input.failureSummary,
        allowedMethods: input.allowedMethods,
        freshnessPolicy: input.freshnessPolicy,
        ...(input.now ? { now: input.now } : {}),
    });
    if (plannerCallsUsed >= maxPlannerCalls) {
        return {
            status: "degraded",
            prompt,
            validation: null,
            actions: [],
            stopReason: "budget_exhausted",
            degradedReason: "budget_exhausted",
            userMessage: "검색 보조 플래너 예산을 모두 사용해 deterministic 검색 경로만 계속 사용합니다.",
        };
    }
    if (!input.callPlanner) {
        return {
            status: "degraded",
            prompt,
            validation: null,
            actions: [],
            stopReason: "provider_unavailable",
            degradedReason: "provider_unavailable",
            userMessage: "검색 보조 플래너를 사용할 수 없어 deterministic 검색 경로만 계속 사용합니다.",
        };
    }
    let rawOutput;
    try {
        rawOutput = await callWithTimeout({ callPlanner: input.callPlanner, prompt, timeoutMs });
    }
    catch (error) {
        const degradedReason = error instanceof Error && error.message === "planner_timeout" ? "planner_timeout" : "provider_unavailable";
        return {
            status: "degraded",
            prompt,
            validation: null,
            actions: [],
            degradedReason,
            userMessage: degradedReason === "planner_timeout"
                ? "검색 보조 플래너가 제한 시간 안에 응답하지 않아 deterministic 검색 경로만 계속 사용합니다."
                : "검색 보조 플래너 호출이 실패해 deterministic 검색 경로만 계속 사용합니다.",
        };
    }
    const validation = validateWebRetrievalPlannerOutput({
        rawOutput,
        targetContract: input.targetContract,
        freshnessPolicy: input.freshnessPolicy,
        allowedMethods: plannerMethods(input.allowedMethods),
        attemptedSources: input.attemptedSources,
        ...(input.domainPolicy ? { domainPolicy: input.domainPolicy } : {}),
    });
    if (!validation.accepted) {
        return {
            status: "rejected",
            prompt,
            validation,
            actions: [],
            degradedReason: "invalid_response",
            userMessage: "검색 보조 플래너 응답이 스키마 또는 정책 검증을 통과하지 못해 실행하지 않았습니다.",
        };
    }
    if (validation.acceptedActions.length === 0) {
        return {
            status: "stopped",
            prompt,
            validation,
            actions: [],
            ...(validation.stopReason ? { stopReason: validation.stopReason } : {}),
            userMessage: "검색 보조 플래너가 더 진행할 안전한 검색 방법이 없다고 판단했습니다.",
        };
    }
    return {
        status: "planned",
        prompt,
        validation,
        actions: validation.acceptedActions,
        userMessage: "검색 보조 플래너가 다음 검색 방법 후보를 제안했습니다.",
    };
}
export function methodToToolName(method) {
    return method;
}
//# sourceMappingURL=web-retrieval-planner.js.map