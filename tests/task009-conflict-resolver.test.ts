import { describe, expect, it } from "vitest"
import {
  conflictResolutionToVerdict,
  resolveEvidenceConflict,
} from "../packages/core/src/runs/web-conflict-resolver.ts"
import type { SourceEvidence } from "../packages/core/src/runs/web-retrieval-policy.ts"
import { createRetrievalTargetContract } from "../packages/core/src/runs/web-retrieval-session.ts"
import type { RetrievalVerificationVerdict } from "../packages/core/src/runs/web-retrieval-verification.ts"

const target = createRetrievalTargetContract({
  kind: "finance_index",
  rawQuery: "지금 나스닥 지수",
  canonicalName: "NASDAQ Composite",
  symbols: ["IXIC", "^IXIC", ".IXIC"],
  market: "INDEXNASDAQ",
})

function source(id: string, overrides: Partial<SourceEvidence> = {}): SourceEvidence {
  return {
    method: "direct_fetch",
    sourceKind: "first_party",
    reliability: "high",
    sourceLabel: `NASDAQ Composite ${id}`,
    sourceDomain: "www.google.com",
    sourceTimestamp: null,
    fetchTimestamp: "2026-04-17T06:00:00.000Z",
    freshnessPolicy: "latest_approximate",
    adapterStatus: "active",
    ...overrides,
  }
}

function verdict(id: string, value: string): RetrievalVerificationVerdict {
  return {
    candidateId: `candidate:${id}`,
    canAnswer: true,
    bindingStrength: "strong",
    evidenceSufficiency: "sufficient_approximate",
    rejectionReason: null,
    policy: "latest_approximate",
    sourceEvidenceId: id,
    targetId: target.targetId,
    acceptedValue: value,
    acceptedUnit: "point",
    bindingSignals: [{ kind: "symbol", value: "IXIC", weight: 0.45, evidenceField: "target.symbols" }],
    conflicts: [],
    caveats: [],
  }
}

describe("task009 evidence conflict resolver", () => {
  it("blocks finance values that are outside tolerance instead of averaging or guessing", () => {
    const resolution = resolveEvidenceConflict({
      target,
      policy: "latest_approximate",
      verdicts: [verdict("google", "24102.5"), verdict("snippet", "17000")],
      sourceEvidenceById: {
        google: source("google"),
        snippet: source("snippet", { sourceKind: "search_index", reliability: "medium" }),
      },
    })

    const finalVerdict = conflictResolutionToVerdict({ resolution, target, policy: "latest_approximate" })

    expect(resolution.status).toBe("conflict")
    expect(finalVerdict.canAnswer).toBe(false)
    expect(finalVerdict.evidenceSufficiency).toBe("insufficient_conflict")
    expect(finalVerdict.acceptedValue).toBeNull()
    expect(finalVerdict.conflicts.join("\n")).toContain("24102.5")
    expect(finalVerdict.conflicts.join("\n")).toContain("17000")
  })

  it("selects the highest priority source when values differ only within tolerance", () => {
    const resolution = resolveEvidenceConflict({
      target,
      policy: "latest_approximate",
      verdicts: [verdict("google", "24102.5"), verdict("investing", "24103")],
      sourceEvidenceById: {
        google: source("google", { reliability: "high", sourceKind: "first_party" }),
        investing: source("investing", { reliability: "medium", sourceKind: "third_party" }),
      },
    })

    expect(resolution.status).toBe("selected")
    expect(resolution.selectedVerdict?.acceptedValue).toBe("24102.5")
    expect(resolution.selectedVerdict?.caveats).toContain("candidate_value_variance_within_tolerance")
  })

  it("moves degraded adapters behind active sources during conflict-safe selection", () => {
    const resolution = resolveEvidenceConflict({
      target,
      policy: "latest_approximate",
      verdicts: [verdict("active", "24102.5"), verdict("degraded", "24102.7")],
      sourceEvidenceById: {
        active: source("active", { sourceKind: "third_party", reliability: "medium", adapterId: "active-adapter", adapterStatus: "active" }),
        degraded: source("degraded", { sourceKind: "first_party", reliability: "high", adapterId: "degraded-adapter", adapterStatus: "degraded" }),
      },
      adapterPriority: { "active-adapter": 1, "degraded-adapter": 100 },
    })

    expect(resolution.status).toBe("selected")
    expect(resolution.selectedVerdict?.sourceEvidenceId).toBe("active")
  })
})
