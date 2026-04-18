import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { PATHS } from "../config/index.js";
import { recordArtifactMetadata } from "../artifacts/lifecycle.js";
import { insertDiagnosticEvent } from "../db/index.js";
import { WEB_RETRIEVAL_POLICY_VERSION } from "./web-retrieval-policy.js";
import { createRetrievalSessionController, createRetrievalTargetContract, } from "./web-retrieval-session.js";
import { extractRetrievedValueCandidates, verifyRetrievedValueCandidates, } from "./web-retrieval-verification.js";
import { buildWebSourceAdapterRegistrySnapshot } from "./web-source-adapters/index.js";
import { DEFAULT_EVIDENCE_CONFLICT_POLICY } from "./web-conflict-resolver.js";
import { DEFAULT_RETRIEVAL_CACHE_TTL_POLICY } from "./web-retrieval-cache.js";
export const WEB_RETRIEVAL_FIXTURE_SCHEMA_VERSION = 1;
const SENSITIVE_TEXT_PATTERNS = [
    [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer ***"],
    [/xox[abpr]-[A-Za-z0-9-]+/gi, "xox*-***"],
    [/\bsk-[A-Za-z0-9_-]{12,}\b/g, "sk-***"],
    [/(api[_-]?key|authorization|password|refresh[_-]?token|secret|token)(["'\s:=]+)([^"'\s,}]+)/gi, "$1$2***"],
];
const LOCAL_PATH_PATTERN = /(?:\/Users\/[^\s"')]+|\/tmp\/[^\s"')]+|[A-Za-z]:\\[^\s"']+)/g;
function nowIso(now = new Date()) {
    return now.toISOString();
}
function hashValue(value) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}
function sanitizeText(value) {
    let text = value;
    for (const [pattern, replacement] of SENSITIVE_TEXT_PATTERNS)
        text = text.replace(pattern, replacement);
    text = text.replace(LOCAL_PATH_PATTERN, "[local path hidden]");
    if (/(<!doctype\s+html|<html\b|<script\b|<body\b)/i.test(text))
        return "[html content hidden]";
    return text.length > 1_000 ? `${text.slice(0, 990)}...` : text;
}
function sanitizeValue(value) {
    if (typeof value === "string")
        return sanitizeText(value);
    if (Array.isArray(value))
        return value.map((item) => sanitizeValue(item));
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [
            key,
            /token|secret|authorization|cookie|api[_-]?key|password|credential|raw/i.test(key) ? "***" : sanitizeValue(item),
        ]));
    }
    return value;
}
function asSourceEvidence(source, freshnessPolicy) {
    const fetchTimestamp = source.fetchTimestamp ?? "2026-04-17T00:00:00.000Z";
    return {
        method: source.method === "known_source_adapter" || source.method === "ai_assisted_planner" ? "direct_fetch" : source.method,
        sourceKind: source.sourceKind,
        reliability: source.reliability,
        sourceUrl: source.sourceUrl ?? null,
        sourceDomain: source.sourceDomain ?? null,
        sourceLabel: source.sourceLabel ?? source.sourceDomain ?? source.id,
        sourceTimestamp: source.sourceTimestamp ?? null,
        fetchTimestamp,
        freshnessPolicy,
    };
}
export function loadWebRetrievalFixturesFromDir(dir) {
    if (!existsSync(dir))
        return [];
    return readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => JSON.parse(readFileSync(join(dir, entry.name), "utf-8")));
}
export function runWebRetrievalFixtureRegression(fixtures, input = {}) {
    const startedAt = nowIso(input.startedAt ?? new Date());
    const results = fixtures.map(runSingleFixture);
    const counts = {
        total: results.length,
        passed: results.filter((result) => result.status === "passed").length,
        failed: results.filter((result) => result.status === "failed").length,
        skipped: results.filter((result) => result.status === "skipped").length,
    };
    const status = counts.failed > 0 ? "failed" : counts.passed > 0 ? "passed" : "skipped";
    return {
        kind: "web_retrieval.fixture_regression",
        policyVersion: WEB_RETRIEVAL_POLICY_VERSION,
        startedAt,
        finishedAt: nowIso(input.finishedAt ?? new Date()),
        status,
        counts,
        results,
    };
}
function runSingleFixture(fixture) {
    const failures = [];
    if (fixture.schemaVersion !== WEB_RETRIEVAL_FIXTURE_SCHEMA_VERSION)
        failures.push("fixture_schema_version_mismatch");
    const target = createRetrievalTargetContract(fixture.target);
    const controller = createRetrievalSessionController({
        targetContract: target,
        freshnessPolicy: fixture.freshnessPolicy,
        plannerAvailable: false,
        plannerUnavailableReason: "fixture_regression_offline",
        recordControlEvents: false,
    });
    const sourceEvidenceById = {};
    const candidates = [];
    for (const source of fixture.sources) {
        controller.recordAttempt({
            method: source.method,
            status: source.status ?? "succeeded",
            toolName: source.toolName ?? source.method,
            sourceUrl: source.sourceUrl ?? null,
            sourceDomain: source.sourceDomain ?? null,
            errorKind: source.errorKind ?? null,
            stopReason: source.stopReason ?? null,
            detail: { fixtureSourceId: source.id },
        });
        const evidence = asSourceEvidence(source, fixture.freshnessPolicy);
        sourceEvidenceById[source.id] = evidence;
        if ((source.status ?? "succeeded") === "failed")
            continue;
        const extracted = extractRetrievedValueCandidates({
            sourceEvidenceId: source.id,
            sourceEvidence: evidence,
            target,
            content: source.content ?? "",
            inputKind: source.inputKind,
            ...(source.hints ? { hints: source.hints } : {}),
        });
        candidates.push(...extracted);
    }
    const verdict = verifyRetrievedValueCandidates({
        candidates,
        target,
        sourceEvidenceById,
        policy: fixture.freshnessPolicy,
    });
    const readiness = controller.limitedCompletionReadiness();
    const attempts = controller.snapshot().attempts.filter((attempt) => attempt.status !== "skipped").length;
    if (verdict.canAnswer !== fixture.expected.canAnswer)
        failures.push(`can_answer_mismatch:${verdict.canAnswer}`);
    if ((fixture.expected.acceptedValue ?? null) !== null && verdict.acceptedValue !== fixture.expected.acceptedValue) {
        failures.push(`accepted_value_mismatch:${verdict.acceptedValue ?? "null"}`);
    }
    if (verdict.evidenceSufficiency !== fixture.expected.evidenceSufficiency)
        failures.push(`evidence_sufficiency_mismatch:${verdict.evidenceSufficiency}`);
    if (fixture.expected.minAttempts !== undefined && attempts < fixture.expected.minAttempts)
        failures.push(`minimum_attempts_not_met:${attempts}`);
    if (fixture.expected.limitedCompletionOk !== undefined && readiness.ok !== fixture.expected.limitedCompletionOk)
        failures.push(`limited_completion_mismatch:${readiness.ok}`);
    if (!verdict.canAnswer && !readiness.ok)
        failures.push(`early_stop_before_minimum_ladder:${readiness.reasons.join("|")}`);
    const status = failures.length > 0 ? "failed" : "passed";
    return {
        fixtureId: fixture.id,
        title: fixture.title,
        status,
        failures,
        attempts,
        candidateCount: candidates.length,
        verdict: sanitizeValue(verdict),
        sanitizedSummary: sanitizeText(`${fixture.id}: ${status}; verdict=${verdict.evidenceSufficiency}; value=${verdict.acceptedValue ?? "none"}`),
    };
}
export function getDefaultWebRetrievalLiveSmokeScenarios() {
    return [
        liveScenario("kospi", "KOSPI latest approximate", "지금 코스피 지수 얼마야", { kind: "finance_index", rawQuery: "지금 코스피 지수", canonicalName: "KOSPI", symbols: ["KOSPI"], market: "KRX", locale: "ko-KR" }),
        liveScenario("kosdaq", "KOSDAQ latest approximate", "지금 코스닥 지수 알려줘", { kind: "finance_index", rawQuery: "지금 코스닥 지수", canonicalName: "KOSDAQ", symbols: ["KOSDAQ"], market: "KRX", locale: "ko-KR" }),
        liveScenario("nasdaq", "NASDAQ Composite latest approximate", "지금 나스닥 지수 얼마야", { kind: "finance_index", rawQuery: "지금 나스닥 지수", canonicalName: "NASDAQ Composite", symbols: ["IXIC", "NASDAQ Composite"], market: "NASDAQ", locale: "ko-KR" }),
        liveScenario("weather", "Current weather latest approximate", "지금 동천동 날씨 어때", { kind: "weather_current", rawQuery: "지금 동천동 날씨", canonicalName: "동천동 현재 날씨", locationName: "동천동", locale: "ko-KR" }),
    ];
}
function liveScenario(id, title, request, target) {
    return {
        id,
        title,
        request,
        target,
        freshnessPolicy: "latest_approximate",
        minimumMethods: ["fast_text_search", "direct_fetch"],
        expectsAnswerOrLimitedCompletion: true,
    };
}
export function isLiveWebSmokeEnabled(env = process.env) {
    return env["NOBIE_LIVE_WEB_SMOKE"] === "1";
}
export function createDryRunWebRetrievalLiveSmokeExecutor(input = {}) {
    return async (scenario) => {
        const trace = {
            attemptedMethods: ["fast_text_search", "direct_fetch"],
            sourceDomains: scenario.id === "weather" ? ["weather.example"] : ["finance.example"],
            answerProduced: true,
            verdict: {
                canAnswer: true,
                evidenceSufficiency: "sufficient_approximate",
                acceptedValue: scenario.id === "weather" ? "18" : "3000.12",
                rejectionReason: null,
                caveats: ["dry-run synthetic latest approximate"],
            },
            limitedCompletionOk: true,
            finalText: `${scenario.title} dry-run passed`,
        };
        return { ...trace, ...(input.traceOverrides?.[scenario.id] ?? {}) };
    };
}
export async function runWebRetrievalLiveSmokeScenarios(input = {}) {
    const mode = input.mode ?? "dry-run";
    const scenarios = input.scenarios ?? getDefaultWebRetrievalLiveSmokeScenarios();
    const startedAt = nowIso(input.now ?? new Date());
    const smokeId = `web-smoke:${hashValue({ startedAt, mode, scenarios: scenarios.map((scenario) => scenario.id) })}`;
    const liveEnabled = isLiveWebSmokeEnabled(input.env ?? process.env);
    const executeScenario = input.executeScenario ?? (mode === "dry-run" ? createDryRunWebRetrievalLiveSmokeExecutor() : null);
    const results = [];
    for (const scenario of scenarios) {
        const scenarioStartedAt = nowIso();
        if (mode === "live-run" && !liveEnabled) {
            results.push({
                scenario,
                status: "skipped",
                failures: [],
                reason: "live_web_smoke_disabled",
                trace: { attemptedMethods: [], answerProduced: false, skipped: true, skipReason: "live_web_smoke_disabled" },
                startedAt: scenarioStartedAt,
                finishedAt: nowIso(),
            });
            continue;
        }
        if (!executeScenario) {
            results.push({
                scenario,
                status: "failed",
                failures: ["live_executor_missing"],
                reason: "live_executor_missing",
                startedAt: scenarioStartedAt,
                finishedAt: nowIso(),
            });
            continue;
        }
        try {
            const trace = sanitizeValue(await executeScenario(scenario));
            const failures = validateWebRetrievalLiveSmokeTrace(scenario, trace);
            results.push({
                scenario,
                status: failures.length > 0 ? "failed" : "passed",
                failures,
                ...(failures[0] ? { reason: failures[0] } : {}),
                trace,
                startedAt: scenarioStartedAt,
                finishedAt: nowIso(),
            });
        }
        catch (error) {
            results.push({
                scenario,
                status: "failed",
                failures: ["scenario_execution_failed"],
                reason: sanitizeText(error instanceof Error ? error.message : String(error)),
                startedAt: scenarioStartedAt,
                finishedAt: nowIso(),
            });
        }
    }
    const counts = {
        total: results.length,
        passed: results.filter((result) => result.status === "passed").length,
        failed: results.filter((result) => result.status === "failed").length,
        skipped: results.filter((result) => result.status === "skipped").length,
    };
    const status = counts.failed > 0 ? "failed" : counts.passed > 0 ? "passed" : "skipped";
    const summary = {
        kind: "web_retrieval.live_smoke",
        mode,
        smokeId,
        policyVersion: WEB_RETRIEVAL_POLICY_VERSION,
        startedAt,
        finishedAt: nowIso(),
        status,
        counts,
        results,
    };
    if (input.writeArtifact)
        return writeWebRetrievalSmokeArtifact(summary);
    return summary;
}
export function validateWebRetrievalLiveSmokeTrace(scenario, trace) {
    if (trace.skipped)
        return [];
    const failures = [];
    const attempted = new Set(trace.attemptedMethods);
    for (const method of scenario.minimumMethods) {
        if (!attempted.has(method))
            failures.push(`minimum_method_missing:${method}`);
    }
    if (scenario.expectsAnswerOrLimitedCompletion && !trace.answerProduced && !trace.limitedCompletionOk)
        failures.push("answer_or_limited_completion_missing");
    if (trace.answerProduced && !trace.verdict?.canAnswer)
        failures.push("answer_without_answerable_verdict");
    const serialized = JSON.stringify(trace);
    if (/(<!doctype\s+html|<html\b|<script\b|Bearer\s+(?!\*\*\*)|\bsk-[A-Za-z0-9_-]{12,}|\/Users\/|\/tmp\/)/i.test(serialized))
        failures.push("unsanitized_trace_payload");
    return failures;
}
export function writeWebRetrievalSmokeArtifact(summary) {
    const root = join(PATHS.stateDir, "artifacts", "web-retrieval-smoke");
    mkdirSync(root, { recursive: true });
    const artifactPath = join(root, `${summary.smokeId.replace(/[^A-Za-z0-9_.-]/g, "-")}.json`);
    const sanitized = sanitizeValue(summary);
    writeFileSync(artifactPath, JSON.stringify(sanitized, null, 2) + "\n", "utf-8");
    let artifactId = null;
    let diagnosticEventId = null;
    try {
        artifactId = recordArtifactMetadata({
            artifactPath,
            mimeType: "application/json",
            sourceRunId: null,
            requestGroupId: null,
            ownerChannel: "web_retrieval_smoke",
            channelTarget: null,
            retentionPolicy: "standard",
            metadata: { kind: summary.kind, mode: summary.mode, status: summary.status, policyVersion: summary.policyVersion },
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });
    }
    catch {
        artifactId = null;
    }
    try {
        diagnosticEventId = insertDiagnosticEvent({
            kind: "web_retrieval_live_smoke",
            summary: `web retrieval ${summary.mode} ${summary.status}: passed=${summary.counts.passed}, failed=${summary.counts.failed}, skipped=${summary.counts.skipped}`,
            detail: { artifactPath, artifactId, smokeId: summary.smokeId, policyVersion: summary.policyVersion },
        });
    }
    catch {
        diagnosticEventId = null;
    }
    return { ...sanitized, artifactPath, diagnosticEventId };
}
export function buildWebRetrievalReleaseGateSummary(input = {}) {
    const sourceAdapters = input.sourceAdapters ?? buildWebSourceAdapterRegistrySnapshot();
    const blockingFailures = [];
    const warnings = [];
    const fixtureRegression = input.fixtureRegression ?? null;
    const liveSmoke = input.liveSmoke ?? null;
    if (!fixtureRegression)
        warnings.push("fixture_regression_not_run");
    else if (fixtureRegression.status === "failed") {
        for (const result of fixtureRegression.results.filter((item) => item.status === "failed")) {
            blockingFailures.push(`fixture_failed:${result.fixtureId}:${result.failures.join("|")}`);
        }
    }
    else if (fixtureRegression.status === "skipped")
        warnings.push("fixture_regression_skipped");
    if (!liveSmoke)
        warnings.push("live_smoke_not_run");
    else if (liveSmoke.status === "failed") {
        const failures = liveSmoke.results.flatMap((result) => result.failures.map((failure) => `live_smoke_failed:${result.scenario.id}:${failure}`));
        if (input.requireLiveSmokePass)
            blockingFailures.push(...failures);
        else
            warnings.push(...failures);
    }
    else if (liveSmoke.status === "skipped")
        warnings.push("live_smoke_skipped");
    if (sourceAdapters.activeCount === 0)
        blockingFailures.push("no_active_web_source_adapter");
    if (sourceAdapters.degradedCount > 0)
        warnings.push("degraded_web_source_adapter");
    return {
        kind: "web_retrieval.release_gate",
        policyVersion: WEB_RETRIEVAL_POLICY_VERSION,
        sourceAdapters,
        conflictPolicy: DEFAULT_EVIDENCE_CONFLICT_POLICY,
        cachePolicy: DEFAULT_RETRIEVAL_CACHE_TTL_POLICY,
        fixtureRegression: fixtureRegression ? {
            status: fixtureRegression.status,
            counts: fixtureRegression.counts,
            results: fixtureRegression.results,
        } : null,
        liveSmoke: liveSmoke ? {
            mode: liveSmoke.mode,
            smokeId: liveSmoke.smokeId,
            status: liveSmoke.status,
            counts: liveSmoke.counts,
            artifactPath: liveSmoke.artifactPath ?? null,
        } : null,
        gateStatus: blockingFailures.length > 0 ? "failed" : warnings.length > 0 ? "warning" : "passed",
        blockingFailures: blockingFailures.map(sanitizeText),
        warnings: warnings.map(sanitizeText),
    };
}
export function buildFixtureRegressionFromWorkspace(rootDir) {
    const fixtureDir = resolve(rootDir, "tests", "fixtures", "web-retrieval");
    const fixtures = loadWebRetrievalFixturesFromDir(fixtureDir);
    if (fixtures.length === 0)
        return null;
    return runWebRetrievalFixtureRegression(fixtures);
}
export function fixtureFileNameForId(id) {
    return `${basename(id).replace(/[^A-Za-z0-9_.-]/g, "-")}.json`;
}
//# sourceMappingURL=web-retrieval-smoke.js.map