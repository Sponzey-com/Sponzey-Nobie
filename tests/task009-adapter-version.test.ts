import { describe, expect, it } from "vitest"
import {
  FINANCE_ADAPTER_METADATA,
  buildWebSourceAdapterDegradationState,
  buildWebSourceAdapterRegistrySnapshot,
  checkAdapterFixtureParserVersions,
  rankWebSourceAdaptersForTarget,
} from "../packages/core/src/runs/web-source-adapters/index.ts"
import { buildWebRetrievalReleaseGateSummary } from "../packages/core/src/runs/web-retrieval-smoke.ts"

describe("task009 adapter version and degraded mode", () => {
  it("degrades adapters after repeated parser failures", () => {
    const state = buildWebSourceAdapterDegradationState({
      failureSamples: [
        { adapterId: FINANCE_ADAPTER_METADATA.adapterId, failureKind: "parser_failed" },
        { adapterId: FINANCE_ADAPTER_METADATA.adapterId, failureKind: "parser_failed" },
        { adapterId: FINANCE_ADAPTER_METADATA.adapterId, failureKind: "parser_failed" },
      ],
    })

    expect(state.degradedAdapterIds).toContain(FINANCE_ADAPTER_METADATA.adapterId)
    expect(state.degradedReasons[FINANCE_ADAPTER_METADATA.adapterId]).toBe("parser_failure_threshold_exceeded")
  })

  it("marks parser version drift as immediate degraded evidence", () => {
    const [mismatch] = checkAdapterFixtureParserVersions([
      { metadata: FINANCE_ADAPTER_METADATA, expectedParserVersion: "previous-parser" },
    ])
    const state = buildWebSourceAdapterDegradationState({
      failureSamples: [{ adapterId: FINANCE_ADAPTER_METADATA.adapterId, failureKind: mismatch?.ok ? "unknown" : "parser_version_mismatch" }],
    })

    expect(mismatch?.ok).toBe(false)
    expect(state.degradedAdapterIds).toContain(FINANCE_ADAPTER_METADATA.adapterId)
    expect(state.degradedReasons[FINANCE_ADAPTER_METADATA.adapterId]).toBe("parser_version_mismatch")
  })

  it("surfaces degraded adapter status in ranking and release gate warnings", () => {
    const degradedReasons = { [FINANCE_ADAPTER_METADATA.adapterId]: "parser_failure_threshold_exceeded" }
    const ranked = rankWebSourceAdaptersForTarget("finance_index", {
      degradedAdapterIds: [FINANCE_ADAPTER_METADATA.adapterId],
    })
    const snapshot = buildWebSourceAdapterRegistrySnapshot({
      degradedAdapterIds: [FINANCE_ADAPTER_METADATA.adapterId],
      degradedReasons,
    })
    const gate = buildWebRetrievalReleaseGateSummary({ sourceAdapters: snapshot })

    expect(ranked[0]?.status).toBe("degraded")
    expect(snapshot.degradedReasons[FINANCE_ADAPTER_METADATA.adapterId]).toBe("parser_failure_threshold_exceeded")
    expect(gate.gateStatus).toBe("warning")
    expect(gate.warnings).toContain("degraded_web_source_adapter")
  })
})
