import crypto from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../config/index.js";
import { insertDiagnosticEvent } from "../db/index.js";
import { recordArtifactMetadata } from "../artifacts/lifecycle.js";
import { sanitizeUserFacingError } from "./error-sanitizer.js";
export const WEB_RETRIEVAL_POLICY_VERSION = "2026.04.18-task009";
const TRACKING_QUERY_KEYS = new Set([
    "fbclid",
    "gclid",
    "igshid",
    "mc_cid",
    "mc_eid",
    "utm_campaign",
    "utm_content",
    "utm_medium",
    "utm_source",
    "utm_term",
]);
function kstDateBucket(now) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function isoTimestamp(now) {
    return now.toISOString();
}
function normalizeWhitespace(value) {
    return value.trim().replace(/\s+/g, " ");
}
function canonicalQuery(value) {
    return normalizeWhitespace(typeof value === "string" ? value : "").toLocaleLowerCase("ko-KR");
}
function canonicalUrl(value) {
    const raw = typeof value === "string" ? value.trim() : "";
    if (!raw)
        return { href: "", domain: null };
    try {
        const url = new URL(raw);
        url.hash = "";
        url.hostname = url.hostname.toLowerCase();
        const next = new URL(`${url.protocol}//${url.host}${url.pathname}`);
        const entries = [...url.searchParams.entries()]
            .filter(([key]) => !TRACKING_QUERY_KEYS.has(key.toLowerCase()))
            .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue));
        for (const [key, nested] of entries)
            next.searchParams.append(key, nested);
        return { href: next.toString(), domain: next.hostname };
    }
    catch {
        return { href: raw, domain: null };
    }
}
function hashValue(value) {
    return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}
function freshnessPolicyFromParam(value) {
    if (value === "normal" || value === "latest_approximate" || value === "strict_timestamp")
        return value;
    return null;
}
function inferFreshnessPolicyFromSource(input) {
    if (input.sourceKind === "search_index" || input.sourceKind === "browser_evidence")
        return "latest_approximate";
    const href = input.href.toLowerCase();
    const domain = input.domain ?? "";
    if (domain === "www.google.com" && href.includes("/finance/quote/"))
        return "latest_approximate";
    if (domain.endsWith("investing.com") && /\/(indices|currencies|equities|crypto)\//i.test(href))
        return "latest_approximate";
    if (domain === "finance.yahoo.com" && href.includes("/quote/"))
        return "latest_approximate";
    if (domain.endsWith("finance.naver.com") || domain.endsWith("finance.daum.net"))
        return "latest_approximate";
    return "normal";
}
function sourceKindFromDomain(domain, method) {
    if (method === "browser_search")
        return "browser_evidence";
    if (!domain)
        return method === "fast_text_search" ? "search_index" : "unknown";
    if (/(go\.kr|gov|kma\.go\.kr|weather\.go\.kr|data\.go\.kr|law\.go\.kr|moleg\.go\.kr)$/i.test(domain))
        return "official";
    if (/(openai\.com|anthropic\.com|google\.com|microsoft\.com|apple\.com)$/i.test(domain))
        return "first_party";
    return method === "fast_text_search" ? "search_index" : "third_party";
}
function reliabilityFor(kind) {
    switch (kind) {
        case "official": return "high";
        case "first_party": return "high";
        case "third_party": return "medium";
        case "search_index": return "medium";
        case "browser_evidence": return "medium";
        case "unknown": return "unknown";
    }
}
export function buildWebRetrievalPolicyDecision(input) {
    if (input.toolName !== "web_search" && input.toolName !== "web_fetch")
        return null;
    const now = input.now ?? new Date();
    const fetchTimestamp = isoTimestamp(now);
    if (input.toolName === "web_search") {
        // Web search is a discovery step, not a source-certification step. It must
        // not derive policy from the user's natural-language phrasing.
        const query = canonicalQuery(input.params.query);
        const locale = typeof input.params.locale === "string" ? input.params.locale.trim().toLowerCase() : "ko-KR";
        const dateRange = typeof input.params.dateRange === "string" ? input.params.dateRange : "none";
        const canonicalParams = {
            query,
            locale,
            dateRange,
            freshnessPolicy: "latest_approximate",
            timeBucket: kstDateBucket(now),
            method: "fast_text_search",
            sourceKind: "search_index",
        };
        const dedupeKey = `web:search:${hashValue(canonicalParams)}`;
        return {
            applies: true,
            method: "fast_text_search",
            dedupeKey,
            canonicalParams,
            freshnessPolicy: "latest_approximate",
            sourceKind: "search_index",
            reliability: "medium",
            fetchTimestamp,
            answerDirective: buildAnswerDirective("latest_approximate", "search_index", null, fetchTimestamp),
        };
    }
    const canonical = canonicalUrl(input.params.url);
    const mode = typeof input.params.mode === "string" ? input.params.mode : "text";
    const waitForSelector = typeof input.params.waitForSelector === "string" ? normalizeWhitespace(input.params.waitForSelector) : "";
    const method = waitForSelector || mode === "screenshot" ? "browser_search" : "direct_fetch";
    const sourceKind = sourceKindFromDomain(canonical.domain, method);
    const freshnessPolicy = freshnessPolicyFromParam(input.params.freshnessPolicy)
        ?? inferFreshnessPolicyFromSource({ href: canonical.href, domain: canonical.domain, method, sourceKind });
    const canonicalParams = {
        url: canonical.href,
        domain: canonical.domain,
        mode,
        waitForSelector,
        method,
        freshnessPolicy,
        timeBucket: kstDateBucket(now),
        sourceKind,
    };
    const dedupeKey = `web:fetch:${hashValue(canonicalParams)}`;
    return {
        applies: true,
        method,
        dedupeKey,
        canonicalParams,
        freshnessPolicy,
        sourceKind,
        reliability: reliabilityFor(sourceKind),
        fetchTimestamp,
        answerDirective: buildAnswerDirective(freshnessPolicy, sourceKind, canonical.domain, fetchTimestamp),
    };
}
export function buildAnswerDirective(freshnessPolicy, sourceKind, sourceDomain, fetchTimestamp) {
    const sourceLabel = sourceDomain ? `${sourceDomain} (${sourceKind})` : sourceKind;
    if (freshnessPolicy === "latest_approximate") {
        if (sourceKind === "search_index") {
            return `최신 근사 허용 정책입니다. source=${sourceLabel}, fetchTimestamp=${fetchTimestamp}를 근거로 현재/최신 수치 후보가 보이면 "수집 시각 기준 근사값"으로 답변하세요. 단, web_search는 발견 단계입니다. 검색 결과에 요청 대상과 직접 연결된 수치 후보가 없으면 값 미추출 최종 답변으로 끝내지 말고, 검색 결과 URL 또는 알려진 직접 시세 URL을 web_fetch로 최소 1회 확인하세요. 같은 검색어 반복이나 workspace file_search로 우회하지 마세요. 근사 허용은 추정 허용이 아닙니다. 요청 대상과 같은 출처 항목, 심볼, 이름, 검색 결과 항목에 직접 붙어 있는 수치 후보만 사용하세요. 주변 지수, 다른 티커, 다른 표 행, 기사 숫자, 과거 값, 모델 기억값으로 범위나 숫자를 만들지 마세요. web_fetch까지 확인했는데 수치 후보 자체가 없거나 대상과 수치의 연결이 불명확할 때만 값 미추출로 완료하세요.`;
        }
        return `최신 근사 허용 정책입니다. source=${sourceLabel}, fetchTimestamp=${fetchTimestamp}를 근거로 현재/최신 수치 후보가 보이면 "수집 시각 기준 근사값"으로 답변하세요. 단, 근사 허용은 추정 허용이 아닙니다. 요청 대상과 같은 출처 항목, 심볼, 이름, 검색 결과 항목에 직접 붙어 있는 수치 후보만 사용하세요. 주변 지수, 다른 티커, 다른 표 행, 기사 숫자, 과거 값, 모델 기억값으로 범위나 숫자를 만들지 마세요. 수치 후보 자체가 없거나 대상과 수치의 연결이 불명확할 때만 값 미추출로 완료하세요.`;
    }
    if (freshnessPolicy === "strict_timestamp") {
        return `엄격한 기준 시각 정책입니다. 답변에는 source=${sourceLabel}, fetchTimestamp=${fetchTimestamp}, sourceTimestamp 유무를 명시하고, sourceTimestamp 또는 신뢰 가능한 기준 시각이 없으면 수치를 확정하지 마세요.`;
    }
    return `웹 근거 source=${sourceLabel}, fetchTimestamp=${fetchTimestamp}를 필요한 경우 답변에 반영하세요.`;
}
export function evaluateSourceReliabilityGuard(input) {
    const freshnessPolicy = input.freshnessPolicy ?? "normal";
    const hasUsableSource = input.reliability === "high" || input.reliability === "medium";
    const hasSourceTimestamp = Boolean(input.sourceTimestamp?.trim());
    if (!hasUsableSource) {
        return {
            status: "insufficient_source",
            userMessage: "신뢰 가능한 출처를 확보하지 못해 확정할 수 없습니다.",
            mustAvoidGuessing: true,
            evidence: input,
        };
    }
    if (!hasSourceTimestamp) {
        if (freshnessPolicy === "latest_approximate") {
            return {
                status: "approximate_latest",
                userMessage: "출처 기준 시각은 없지만 수집 시각 기준 근사값으로 답변할 수 있습니다.",
                mustAvoidGuessing: false,
                evidence: input,
            };
        }
        if (freshnessPolicy === "strict_timestamp") {
            return {
                status: "limited_success",
                userMessage: "출처는 확인했지만 기준 시각이 명확하지 않아 수치를 확정할 수 없습니다.",
                mustAvoidGuessing: true,
                evidence: input,
            };
        }
    }
    return {
        status: "ready",
        userMessage: "출처 근거가 답변 생성에 사용할 수 있는 상태입니다.",
        mustAvoidGuessing: false,
        evidence: input,
    };
}
export function extractSourceTimestampFromHtml(html) {
    const patterns = [
        /<meta[^>]+(?:property|name)=["'](?:article:published_time|article:modified_time|date|dc\.date|pubdate|last-modified)["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:article:published_time|article:modified_time|date|dc\.date|pubdate|last-modified)["']/i,
        /<time[^>]+datetime=["']([^"']+)["']/i,
        /"datePublished"\s*:\s*"([^"]+)"/i,
        /"dateModified"\s*:\s*"([^"]+)"/i,
    ];
    for (const pattern of patterns) {
        const match = html.match(pattern);
        const value = match?.[1]?.trim();
        if (value)
            return value;
    }
    return null;
}
export function recordBrowserSearchEvidence(input) {
    const createdAt = input.createdAt ?? Date.now();
    const safeError = input.error == null ? null : sanitizeUserFacingError(input.error instanceof Error ? input.error.message : String(input.error)).userMessage;
    const payload = {
        kind: "browser_search_evidence",
        query: input.query,
        url: input.url ?? null,
        extractedText: input.extractedText?.slice(0, 20_000) ?? null,
        screenshotBase64: input.screenshotBase64 ?? null,
        timeoutReason: input.timeoutReason ?? null,
        error: safeError,
        fetchTimestamp: new Date(createdAt).toISOString(),
        method: input.method ?? "browser_search",
    };
    const root = join(PATHS.stateDir, "artifacts", "browser-search");
    mkdirSync(root, { recursive: true });
    const fileName = `browser-search-${createdAt}-${hashValue({ query: input.query, url: input.url ?? null }).slice(0, 10)}.json`;
    const artifactPath = join(root, fileName);
    writeFileSync(artifactPath, JSON.stringify(payload, null, 2), "utf-8");
    let artifactId = null;
    let diagnosticEventId = null;
    try {
        artifactId = recordArtifactMetadata({
            artifactPath,
            mimeType: "application/json",
            sourceRunId: input.runId ?? null,
            requestGroupId: input.requestGroupId ?? null,
            ownerChannel: "browser_search",
            channelTarget: null,
            retentionPolicy: "ephemeral",
            metadata: { kind: "browser_search_evidence", query: input.query, url: input.url ?? null },
            createdAt,
            updatedAt: createdAt,
        });
    }
    catch {
        artifactId = null;
    }
    try {
        diagnosticEventId = insertDiagnosticEvent({
            kind: "browser_search_evidence",
            summary: input.timeoutReason ? "browser search timed out; evidence artifact captured" : "browser search evidence artifact captured",
            ...(input.runId ? { runId: input.runId } : {}),
            ...(input.requestGroupId ? { requestGroupId: input.requestGroupId } : {}),
            detail: {
                artifactPath: existsSync(artifactPath) ? artifactPath : null,
                artifactId,
                query: input.query,
                url: input.url ?? null,
                timeoutReason: input.timeoutReason ?? null,
            },
        });
    }
    catch {
        diagnosticEventId = null;
    }
    return {
        artifactPath,
        artifactId,
        diagnosticEventId,
        userMessage: "브라우저 검색 증거를 artifact로 저장했습니다.",
    };
}
//# sourceMappingURL=web-retrieval-policy.js.map