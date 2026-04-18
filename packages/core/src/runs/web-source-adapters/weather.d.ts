import type { SourceEvidence, SourceKind, SourceReliability } from "../web-retrieval-policy.js";
import type { RetrievalTargetContract } from "../web-retrieval-session.js";
import { type RetrievalExtractionInputKind, type RetrievedValueCandidate } from "../web-retrieval-verification.js";
import { type WebLocationContract } from "../web-location-contract.js";
import { type WebSourceAdapterMetadata } from "./types.js";
export type WeatherMetric = "temperature" | "feels_like" | "precipitation" | "humidity" | "wind";
export type WeatherLocationBindingScope = "direct" | "fallback_region" | "unbound";
export interface WeatherKnownSource {
    method: "official_api" | "direct_fetch" | "browser_search" | "known_source_adapter";
    url: string;
    sourceDomain: string;
    sourceKind: SourceKind;
    reliability: SourceReliability;
    sourceLabel: string;
    expectedTargetBinding: string;
}
export interface WeatherMetricCandidate {
    metric: WeatherMetric;
    bindingScope: WeatherLocationBindingScope;
    bindingLabel: string | null;
    caveats: string[];
    candidate: RetrievedValueCandidate;
}
export interface WeatherParseInput {
    location: WebLocationContract;
    content: string;
    sourceUrl?: string | null;
    sourceTimestamp?: string | null;
    fetchTimestamp?: string;
    inputKind?: RetrievalExtractionInputKind;
}
export interface WeatherParseResult {
    adapterId: string;
    adapterVersion: string;
    parserVersion: string;
    location: WebLocationContract;
    targetContract: RetrievalTargetContract;
    sourceEvidenceId: string;
    sourceEvidence: SourceEvidence;
    metricCandidates: WeatherMetricCandidate[];
}
export declare const WEATHER_ADAPTER_ID = "weather-current-known-source";
export declare const WEATHER_ADAPTER_VERSION = "2026.04.17";
export declare const WEATHER_PARSER_VERSION = "weather-parser-1";
export declare const WEATHER_ADAPTER_METADATA: WebSourceAdapterMetadata;
export declare function buildWeatherKnownSources(location: WebLocationContract): WeatherKnownSource[];
export declare function buildWeatherSourceEvidence(input: {
    location: WebLocationContract;
    url?: string | null;
    sourceTimestamp?: string | null;
    fetchTimestamp?: string;
}): SourceEvidence;
export declare function parseWeatherMetricCandidates(input: WeatherParseInput): WeatherParseResult;
//# sourceMappingURL=weather.d.ts.map