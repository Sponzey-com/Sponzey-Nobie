import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  loadWebRetrievalFixturesFromDir,
  runWebRetrievalFixtureRegression,
  type WebRetrievalFixture,
} from "../packages/core/src/runs/web-retrieval-smoke.ts"

const fixtureDir = join(process.cwd(), "tests", "fixtures", "web-retrieval")

describe("task008 web retrieval fixture regression", () => {
  it("runs finance, weather, timeout fallback, and no-network fixtures without network", () => {
    const fixtures = loadWebRetrievalFixturesFromDir(fixtureDir)
    const summary = runWebRetrievalFixtureRegression(fixtures, {
      startedAt: new Date("2026-04-17T00:00:00.000Z"),
      finishedAt: new Date("2026-04-17T00:00:01.000Z"),
    })

    expect(fixtures.map((fixture) => fixture.id)).toEqual([
      "finance-kospi-latest",
      "finance-nasdaq-browser-timeout-fallback",
      "finance-source-conflict",
      "no-network-limited-completion",
      "weather-dongcheon-partial",
    ])
    expect(summary.status).toBe("passed")
    expect(summary.counts).toEqual({ total: 5, passed: 5, failed: 0, skipped: 0 })
    expect(summary.results.find((result) => result.fixtureId === "finance-kospi-latest")?.verdict).toMatchObject({
      canAnswer: true,
      acceptedValue: "3085.42",
      evidenceSufficiency: "sufficient_approximate",
    })
    expect(summary.results.find((result) => result.fixtureId === "finance-nasdaq-browser-timeout-fallback")?.attempts).toBe(2)
    expect(summary.results.find((result) => result.fixtureId === "no-network-limited-completion")?.verdict).toMatchObject({
      canAnswer: false,
      evidenceSufficiency: "insufficient_candidate_missing",
    })
    expect(JSON.stringify(summary)).not.toMatch(/Bearer\s+|sk-|<html|\/Users\//i)
  })

  it("fails an early surrender regression before the minimum source ladder is exhausted", () => {
    const fixture = loadWebRetrievalFixturesFromDir(fixtureDir).find((item) => item.id === "no-network-limited-completion")
    if (!fixture) throw new Error("missing no-network fixture")
    const regressed: WebRetrievalFixture = {
      ...fixture,
      id: "no-network-early-surrender",
      sources: fixture.sources.slice(0, 1),
    }

    const summary = runWebRetrievalFixtureRegression([regressed])

    expect(summary.status).toBe("failed")
    expect(summary.results[0]?.failures.join("\n")).toContain("early_stop_before_minimum_ladder")
  })
})
