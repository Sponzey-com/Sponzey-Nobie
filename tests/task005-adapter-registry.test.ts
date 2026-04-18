import { describe, expect, it } from "vitest"
import {
  buildWebSourceAdapterRegistrySnapshot,
  checkAdapterFixtureParserVersions,
  FINANCE_ADAPTER_METADATA,
  rankWebSourceAdaptersForTarget,
  WEATHER_ADAPTER_METADATA,
} from "../packages/core/src/runs/web-source-adapters/index.js"

describe("task005 web source adapter registry", () => {
  it("reports adapter and parser versions with checksums", () => {
    const snapshot = buildWebSourceAdapterRegistrySnapshot()

    expect(snapshot.activeCount).toBeGreaterThanOrEqual(2)
    expect(snapshot.degradedCount).toBe(0)
    expect(snapshot.adapters.map((adapter) => adapter.adapterId)).toEqual(expect.arrayContaining([
      "finance-index-known-source",
      "weather-current-known-source",
    ]))
    expect(snapshot.adapters.every((adapter) => adapter.adapterVersion && adapter.parserVersion && adapter.checksum.length === 16)).toBe(true)
  })

  it("detects parser fixture version mismatches", () => {
    const [ok, mismatch] = checkAdapterFixtureParserVersions([
      { metadata: FINANCE_ADAPTER_METADATA, expectedParserVersion: FINANCE_ADAPTER_METADATA.parserVersion },
      { metadata: WEATHER_ADAPTER_METADATA, expectedParserVersion: "older-weather-parser" },
    ])

    expect(ok?.ok).toBe(true)
    expect(mismatch?.ok).toBe(false)
    expect(mismatch?.message).toContain("mismatch")
  })

  it("moves degraded adapters behind active adapters for source ladder ranking", () => {
    const ranked = rankWebSourceAdaptersForTarget("finance_index", { degradedAdapterIds: [FINANCE_ADAPTER_METADATA.adapterId] })

    expect(ranked).toHaveLength(1)
    expect(ranked[0]?.status).toBe("degraded")
    expect(ranked[0]?.degradedReason).toBeTruthy()
  })
})
