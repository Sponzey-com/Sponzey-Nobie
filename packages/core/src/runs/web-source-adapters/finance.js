import { createRetrievalTargetContract } from "../web-retrieval-session.js";
import { extractRetrievedValueCandidates, } from "../web-retrieval-verification.js";
import { withAdapterChecksum } from "./types.js";
export const FINANCE_ADAPTER_ID = "finance-index-known-source";
export const FINANCE_ADAPTER_VERSION = "2026.04.17";
export const FINANCE_PARSER_VERSION = "finance-parser-1";
export const FINANCE_INDEX_DEFINITIONS = {
    kospi: {
        key: "kospi",
        canonicalName: "KOSPI",
        symbols: ["KOSPI"],
        market: "KRX",
        aliases: ["kospi", "코스피", "코스피지수", "코스피 지수"],
        disambiguationPolicy: "Must not use KOSDAQ values for KOSPI target.",
    },
    kosdaq: {
        key: "kosdaq",
        canonicalName: "KOSDAQ",
        symbols: ["KOSDAQ"],
        market: "KOSDAQ",
        aliases: ["kosdaq", "코스닥", "코스닥지수", "코스닥 지수"],
        disambiguationPolicy: "Must not use KOSPI values for KOSDAQ target.",
    },
    nasdaq_composite: {
        key: "nasdaq_composite",
        canonicalName: "NASDAQ Composite",
        symbols: ["IXIC", "^IXIC", ".IXIC"],
        market: "INDEXNASDAQ",
        aliases: ["nasdaq composite", "나스닥 종합", "나스닥종합", "ixic", "^ixic", ".ixic", "나스닥"],
        disambiguationPolicy: "Generic NASDAQ requests default to NASDAQ Composite unless NASDAQ-100/NDX is explicit.",
    },
    nasdaq_100: {
        key: "nasdaq_100",
        canonicalName: "NASDAQ-100",
        symbols: ["NDX", "^NDX", ".NDX"],
        market: "INDEXNASDAQ",
        aliases: ["nasdaq-100", "nasdaq 100", "나스닥 100", "나스닥100", "ndx", "^ndx", ".ndx"],
        disambiguationPolicy: "Use only when NASDAQ-100/NDX is explicit.",
    },
};
export const FINANCE_ADAPTER_METADATA = withAdapterChecksum({
    adapterId: FINANCE_ADAPTER_ID,
    adapterVersion: FINANCE_ADAPTER_VERSION,
    parserVersion: FINANCE_PARSER_VERSION,
    sourceDomains: ["www.google.com", "finance.yahoo.com", "www.investing.com", "finance.naver.com"],
    supportedTargetKinds: ["finance_index"],
});
function normalizeForLookup(value) {
    return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]+/gu, "");
}
function includesAlias(query, aliases) {
    const normalizedQuery = normalizeForLookup(query);
    return aliases.some((alias) => normalizedQuery.includes(normalizeForLookup(alias)));
}
function targetContractForDefinition(definition, rawQuery) {
    return createRetrievalTargetContract({
        kind: "finance_index",
        rawQuery: rawQuery ?? definition.canonicalName,
        canonicalName: definition.canonicalName,
        symbols: definition.symbols,
        market: definition.market,
        locale: "ko-KR",
    });
}
export function createFinanceIndexTargetContract(key, rawQuery) {
    return targetContractForDefinition(FINANCE_INDEX_DEFINITIONS[key], rawQuery);
}
export function resolveFinanceIndexTarget(query) {
    const rawQuery = query.trim();
    if (!rawQuery)
        return null;
    const normalized = normalizeForLookup(rawQuery);
    let key = null;
    const caveats = [];
    if (includesAlias(rawQuery, FINANCE_INDEX_DEFINITIONS.kosdaq.aliases))
        key = "kosdaq";
    else if (includesAlias(rawQuery, FINANCE_INDEX_DEFINITIONS.kospi.aliases))
        key = "kospi";
    else if (includesAlias(rawQuery, FINANCE_INDEX_DEFINITIONS.nasdaq_100.aliases))
        key = "nasdaq_100";
    else if (includesAlias(rawQuery, FINANCE_INDEX_DEFINITIONS.nasdaq_composite.aliases)) {
        key = "nasdaq_composite";
        const genericNasdaq = normalized.includes("nasdaq") || normalized.includes("나스닥");
        const explicitComposite = normalized.includes("composite") || normalized.includes("종합") || normalized.includes("ixic");
        if (genericNasdaq && !explicitComposite)
            caveats.push("generic_nasdaq_defaults_to_nasdaq_composite");
    }
    if (!key)
        return null;
    const definition = FINANCE_INDEX_DEFINITIONS[key];
    return { key, definition, targetContract: targetContractForDefinition(definition, rawQuery), caveats };
}
function sourceDomain(url) {
    return new URL(url).hostname.toLocaleLowerCase("en-US");
}
export function buildFinanceKnownSources(key) {
    const definition = FINANCE_INDEX_DEFINITIONS[key];
    const bindings = [definition.canonicalName, ...definition.symbols].join(" ");
    const urls = (() => {
        switch (key) {
            case "kospi": return [
                "https://www.google.com/finance/quote/KOSPI:KRX",
                "https://www.investing.com/indices/kospi",
                "https://finance.naver.com/sise/sise_index.naver?code=KOSPI",
            ];
            case "kosdaq": return [
                "https://www.google.com/finance/quote/KOSDAQ:KOSDAQ",
                "https://www.investing.com/indices/kosdaq",
                "https://finance.naver.com/sise/sise_index.naver?code=KOSDAQ",
            ];
            case "nasdaq_composite": return [
                "https://www.google.com/finance/quote/.IXIC:INDEXNASDAQ",
                "https://finance.yahoo.com/quote/%5EIXIC",
                "https://www.investing.com/indices/nasdaq-composite",
            ];
            case "nasdaq_100": return [
                "https://www.google.com/finance/quote/NDX:INDEXNASDAQ",
                "https://finance.yahoo.com/quote/%5ENDX",
                "https://www.investing.com/indices/nq-100",
            ];
        }
    })();
    return urls.map((url, index) => ({
        method: index === 0 ? "direct_fetch" : "browser_search",
        url,
        sourceDomain: sourceDomain(url),
        sourceKind: sourceDomain(url) === "www.google.com" ? "first_party" : "third_party",
        reliability: sourceDomain(url) === "www.google.com" ? "high" : "medium",
        sourceLabel: `${definition.canonicalName} ${definition.symbols.join(" ")}`,
        expectedTargetBinding: bindings,
    }));
}
export function buildFinanceSourceEvidence(input) {
    const known = buildFinanceKnownSources(input.targetKey);
    const source = known.find((item) => item.url === input.url) ?? known[0];
    return {
        method: source.method === "known_source_adapter" ? "direct_fetch" : source.method,
        sourceKind: source.sourceKind,
        reliability: source.reliability,
        sourceUrl: input.url ?? source.url,
        sourceDomain: sourceDomain(input.url ?? source.url),
        sourceLabel: source.sourceLabel,
        sourceTimestamp: input.sourceTimestamp ?? null,
        fetchTimestamp: input.fetchTimestamp ?? new Date().toISOString(),
        freshnessPolicy: "latest_approximate",
        adapterId: FINANCE_ADAPTER_ID,
        adapterVersion: FINANCE_ADAPTER_VERSION,
        parserVersion: FINANCE_PARSER_VERSION,
        adapterStatus: "active",
    };
}
export function parseFinanceQuoteCandidates(input) {
    const definition = FINANCE_INDEX_DEFINITIONS[input.targetKey];
    const targetContract = targetContractForDefinition(definition, definition.canonicalName);
    const sourceEvidenceInput = {
        targetKey: input.targetKey,
        url: input.sourceUrl ?? null,
        sourceTimestamp: input.sourceTimestamp ?? null,
    };
    if (input.fetchTimestamp)
        sourceEvidenceInput.fetchTimestamp = input.fetchTimestamp;
    const sourceEvidence = buildFinanceSourceEvidence(sourceEvidenceInput);
    const sourceEvidenceId = `source:${FINANCE_ADAPTER_ID}:${input.targetKey}:${sourceEvidence.sourceDomain ?? "unknown"}`;
    const candidates = extractRetrievedValueCandidates({
        sourceEvidenceId,
        sourceEvidence,
        target: targetContract,
        content: input.content,
        inputKind: input.inputKind ?? "plain_text",
        hints: {
            pageTitle: `${definition.canonicalName} Quote`,
            quoteCardLabel: `${definition.canonicalName} ${definition.symbols.join(" ")}`,
            tableRowLabel: definition.canonicalName,
            sourceTimestamp: input.sourceTimestamp ?? null,
            ...(input.hints ?? {}),
        },
    });
    return {
        adapterId: FINANCE_ADAPTER_ID,
        adapterVersion: FINANCE_ADAPTER_VERSION,
        parserVersion: FINANCE_PARSER_VERSION,
        targetDefinition: definition,
        targetContract,
        sourceEvidenceId,
        sourceEvidence,
        candidates,
    };
}
//# sourceMappingURL=finance.js.map