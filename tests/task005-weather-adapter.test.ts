import { describe, expect, it } from "vitest"
import {
  buildWeatherKnownSources,
  parseWeatherMetricCandidates,
} from "../packages/core/src/runs/web-source-adapters/weather.js"
import { resolveWeatherLocationContract } from "../packages/core/src/runs/web-location-contract.js"
import { verifyRetrievedValueCandidate } from "../packages/core/src/runs/web-retrieval-verification.js"

describe("task005 weather source adapter", () => {
  it("resolves Dongcheon-dong as a hierarchical location contract", () => {
    const resolved = resolveWeatherLocationContract("지금 동천동 날씨 어때?")

    expect(resolved?.contract.locationName).toBe("동천동")
    expect(resolved?.contract.adminArea).toContain("수지구")
    expect(resolved?.contract.fallbackRegion).toBe("수지구")
    expect(resolved?.contract.hierarchy).toEqual(["동천동", "수지구", "용인시", "경기도", "대한민국"])
  })

  it("builds official, representative, and browser weather source ladder", () => {
    const resolved = resolveWeatherLocationContract("동천동 날씨")
    expect(resolved).toBeTruthy()
    const sources = buildWeatherKnownSources(resolved!.contract)

    expect(sources[0]?.sourceKind).toBe("official")
    expect(sources.map((source) => source.method)).toEqual(["official_api", "direct_fetch", "browser_search"])
    expect(sources.every((source) => source.expectedTargetBinding === "동천동")).toBe(true)
  })

  it("extracts direct weather metrics as individual candidates", () => {
    const resolved = resolveWeatherLocationContract("동천동 날씨")!
    const parsed = parseWeatherMetricCandidates({
      location: resolved.contract,
      content: "동천동 현재 기온 25°C 체감 29°C 강수 0% 습도 76% 바람 5m/s",
      sourceTimestamp: "2026-04-17T06:00:00+09:00",
    })
    const metrics = parsed.metricCandidates.map((item) => item.metric)
    const temperature = parsed.metricCandidates.find((item) => item.metric === "temperature")
    const verdict = verifyRetrievedValueCandidate({
      candidate: temperature?.candidate,
      target: parsed.targetContract,
      sourceEvidence: parsed.sourceEvidence,
      policy: "latest_approximate",
    })

    expect(metrics).toEqual(["temperature", "feels_like", "precipitation", "humidity", "wind"])
    expect(parsed.metricCandidates.every((item) => item.bindingScope === "direct")).toBe(true)
    expect(parsed.sourceEvidence.adapterId).toBe("weather-current-known-source")
    expect(verdict.canAnswer).toBe(true)
  })

  it("marks nearby-region weather values with caveats instead of merging them as direct values", () => {
    const resolved = resolveWeatherLocationContract("동천동 날씨")!
    const parsed = parseWeatherMetricCandidates({
      location: resolved.contract,
      content: "수지구 현재 기온 24°C 습도 70%",
    })
    const temperature = parsed.metricCandidates.find((item) => item.metric === "temperature")
    const verdict = verifyRetrievedValueCandidate({
      candidate: temperature?.candidate,
      target: parsed.targetContract,
      sourceEvidence: parsed.sourceEvidence,
      policy: "latest_approximate",
    })

    expect(temperature?.bindingScope).toBe("fallback_region")
    expect(temperature?.bindingLabel).toBe("수지구")
    expect(temperature?.caveats).toContain("nearby_region_value:수지구")
    expect(verdict.canAnswer).toBe(true)
  })

  it("allows partial weather answer when only temperature is present", () => {
    const resolved = resolveWeatherLocationContract("동천동 날씨")!
    const parsed = parseWeatherMetricCandidates({
      location: resolved.contract,
      content: "동천동 현재 기온 25°C",
    })

    expect(parsed.metricCandidates.map((item) => item.metric)).toEqual(["temperature"])
    expect(parsed.metricCandidates.some((item) => item.metric === "humidity")).toBe(false)
  })
})
