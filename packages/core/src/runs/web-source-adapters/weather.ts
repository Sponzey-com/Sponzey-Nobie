import type { SourceEvidence, SourceKind, SourceReliability } from "../web-retrieval-policy.js"
import type { RetrievalTargetContract } from "../web-retrieval-session.js"
import {
  extractRetrievedValueCandidates,
  type RetrievalExtractionInputKind,
  type RetrievedValueCandidate,
} from "../web-retrieval-verification.js"
import { createWeatherTargetContract, type WebLocationContract } from "../web-location-contract.js"
import { withAdapterChecksum, type WebSourceAdapterMetadata } from "./types.js"

export type WeatherMetric = "temperature" | "feels_like" | "precipitation" | "humidity" | "wind"
export type WeatherLocationBindingScope = "direct" | "fallback_region" | "unbound"

export interface WeatherKnownSource {
  method: "official_api" | "direct_fetch" | "browser_search" | "known_source_adapter"
  url: string
  sourceDomain: string
  sourceKind: SourceKind
  reliability: SourceReliability
  sourceLabel: string
  expectedTargetBinding: string
}

export interface WeatherMetricCandidate {
  metric: WeatherMetric
  bindingScope: WeatherLocationBindingScope
  bindingLabel: string | null
  caveats: string[]
  candidate: RetrievedValueCandidate
}

export interface WeatherParseInput {
  location: WebLocationContract
  content: string
  sourceUrl?: string | null
  sourceTimestamp?: string | null
  fetchTimestamp?: string
  inputKind?: RetrievalExtractionInputKind
}

export interface WeatherParseResult {
  adapterId: string
  adapterVersion: string
  parserVersion: string
  location: WebLocationContract
  targetContract: RetrievalTargetContract
  sourceEvidenceId: string
  sourceEvidence: SourceEvidence
  metricCandidates: WeatherMetricCandidate[]
}

export const WEATHER_ADAPTER_ID = "weather-current-known-source"
export const WEATHER_ADAPTER_VERSION = "2026.04.17"
export const WEATHER_PARSER_VERSION = "weather-parser-1"

export const WEATHER_ADAPTER_METADATA: WebSourceAdapterMetadata = withAdapterChecksum({
  adapterId: WEATHER_ADAPTER_ID,
  adapterVersion: WEATHER_ADAPTER_VERSION,
  parserVersion: WEATHER_PARSER_VERSION,
  sourceDomains: ["www.weather.go.kr", "weather.naver.com", "www.google.com"],
  supportedTargetKinds: ["weather_current"],
})

const METRIC_PATTERNS: Array<{ metric: WeatherMetric; label: string; pattern: RegExp }> = [
  { metric: "temperature", label: "기온", pattern: /(?:현재\s*)?(?:기온|온도|temperature)\D{0,20}([-+]?\d+(?:\.\d+)?\s*(?:°C|℃))/iu },
  { metric: "feels_like", label: "체감", pattern: /(?:체감|realfeel|feels?\s*like)\D{0,20}([-+]?\d+(?:\.\d+)?\s*(?:°C|℃))/iu },
  { metric: "precipitation", label: "강수", pattern: /(?:강수|비\s*올\s*가능성|precipitation)\D{0,20}(\d+(?:\.\d+)?\s*%)/iu },
  { metric: "humidity", label: "습도", pattern: /(?:습도|humidity)\D{0,20}(\d+(?:\.\d+)?\s*%)/iu },
  { metric: "wind", label: "바람", pattern: /(?:바람|풍속|wind)\D{0,20}(\d+(?:\.\d+)?\s*(?:m\/s|km\/h|kph|mph)?)/iu },
]

function sourceDomain(url: string): string {
  return new URL(url).hostname.toLocaleLowerCase("en-US")
}

function normalizeForLookup(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]+/gu, "")
}

function containsLabel(content: string, label: string | null | undefined): boolean {
  const normalizedLabel = normalizeForLookup(label)
  if (!normalizedLabel) return false
  return normalizeForLookup(content).includes(normalizedLabel)
}

export function buildWeatherKnownSources(location: WebLocationContract): WeatherKnownSource[] {
  const encodedLocation = encodeURIComponent(location.locationName)
  const officialQuery = encodeURIComponent(`${location.locationName} ${location.adminArea} 현재 날씨`)
  const urls = [
    `https://www.weather.go.kr/w/index.do#search=${officialQuery}`,
    `https://weather.naver.com/today/${encodedLocation}`,
    `https://www.google.com/search?q=${officialQuery}`,
  ]
  return urls.map((url, index) => ({
    method: index === 0 ? "official_api" : index === 1 ? "direct_fetch" : "browser_search",
    url,
    sourceDomain: sourceDomain(url),
    sourceKind: index === 0 ? "official" : index === 2 ? "search_index" : "third_party",
    reliability: index === 0 ? "high" : "medium",
    sourceLabel: `${location.locationName} ${location.adminArea}`,
    expectedTargetBinding: location.locationName,
  }))
}

export function buildWeatherSourceEvidence(input: {
  location: WebLocationContract
  url?: string | null
  sourceTimestamp?: string | null
  fetchTimestamp?: string
}): SourceEvidence {
  const known = buildWeatherKnownSources(input.location)
  const source = known.find((item) => item.url === input.url) ?? known[0]!
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
    adapterId: WEATHER_ADAPTER_ID,
    adapterVersion: WEATHER_ADAPTER_VERSION,
    parserVersion: WEATHER_PARSER_VERSION,
    adapterStatus: "active",
  }
}

function resolveBinding(input: { location: WebLocationContract; content: string }): { scope: WeatherLocationBindingScope; label: string | null; caveats: string[] } {
  if (containsLabel(input.content, input.location.locationName)) return { scope: "direct", label: input.location.locationName, caveats: [] }
  if (input.location.fallbackRegion && containsLabel(input.content, input.location.fallbackRegion)) {
    return { scope: "fallback_region", label: input.location.fallbackRegion, caveats: [`nearby_region_value:${input.location.fallbackRegion}`] }
  }
  for (const label of input.location.hierarchy.slice(1)) {
    if (containsLabel(input.content, label)) return { scope: "fallback_region", label, caveats: [`nearby_region_value:${label}`] }
  }
  return { scope: "unbound", label: null, caveats: ["location_binding_missing"] }
}

function buildMetricSnippet(input: { bindingLabel: string | null; metricLabel: string; rawValue: string }): string {
  return [input.bindingLabel, input.metricLabel, input.rawValue].filter(Boolean).join(" ")
}

export function parseWeatherMetricCandidates(input: WeatherParseInput): WeatherParseResult {
  const sourceEvidenceInput: Parameters<typeof buildWeatherSourceEvidence>[0] = {
    location: input.location,
    url: input.sourceUrl ?? null,
    sourceTimestamp: input.sourceTimestamp ?? null,
  }
  if (input.fetchTimestamp) sourceEvidenceInput.fetchTimestamp = input.fetchTimestamp
  const sourceEvidence = buildWeatherSourceEvidence(sourceEvidenceInput)
  const directTarget = createWeatherTargetContract(input.location, `${input.location.locationName} 날씨`)
  const binding = resolveBinding({ location: input.location, content: input.content })
  const parserTarget = binding.label && binding.scope !== "unbound"
    ? { ...directTarget, locationName: binding.label }
    : directTarget
  const sourceEvidenceId = `source:${WEATHER_ADAPTER_ID}:${input.location.locationId}:${sourceEvidence.sourceDomain ?? "unknown"}`

  const metricCandidates: WeatherMetricCandidate[] = []
  for (const metric of METRIC_PATTERNS) {
    const match = input.content.match(metric.pattern)
    const rawValue = match?.[1]?.trim()
    if (!rawValue) continue
    const [candidate] = extractRetrievedValueCandidates({
      sourceEvidenceId: `${sourceEvidenceId}:${metric.metric}`,
      sourceEvidence,
      target: parserTarget,
      content: buildMetricSnippet({ bindingLabel: binding.label, metricLabel: metric.label, rawValue }),
      inputKind: input.inputKind ?? "plain_text",
      hints: {
        locationLabel: binding.label,
        sourceTimestamp: input.sourceTimestamp ?? null,
      },
    })
    if (!candidate) continue
    metricCandidates.push({
      metric: metric.metric,
      bindingScope: binding.scope,
      bindingLabel: binding.label,
      caveats: binding.caveats,
      candidate: { ...candidate, targetId: directTarget.targetId },
    })
  }

  return {
    adapterId: WEATHER_ADAPTER_ID,
    adapterVersion: WEATHER_ADAPTER_VERSION,
    parserVersion: WEATHER_PARSER_VERSION,
    location: input.location,
    targetContract: directTarget,
    sourceEvidenceId,
    sourceEvidence,
    metricCandidates,
  }
}
