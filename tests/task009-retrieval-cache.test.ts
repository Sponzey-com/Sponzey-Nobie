import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.ts"
import { closeDb, getDb } from "../packages/core/src/db/index.ts"
import {
  buildRetrievalCacheEntry,
  createInMemoryRetrievalCache,
  evaluateRetrievalCacheEntry,
  getPersistentRetrievalCacheEntry,
  putPersistentRetrievalCacheEntry,
} from "../packages/core/src/runs/web-retrieval-cache.ts"
import { createRetrievalTargetContract } from "../packages/core/src/runs/web-retrieval-session.ts"
import type { SourceEvidence } from "../packages/core/src/runs/web-retrieval-policy.ts"
import type { RetrievalVerificationVerdict } from "../packages/core/src/runs/web-retrieval-verification.ts"

let stateDir: string
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

const target = createRetrievalTargetContract({ kind: "finance_index", canonicalName: "KOSPI", symbols: ["KOSPI"], market: "KRX" })
const sourceEvidence: SourceEvidence = {
  method: "direct_fetch",
  sourceKind: "first_party",
  reliability: "high",
  sourceLabel: "KOSPI",
  sourceDomain: "www.google.com",
  sourceTimestamp: null,
  fetchTimestamp: "2026-04-17T06:00:00.000Z",
  freshnessPolicy: "latest_approximate",
  adapterId: "finance-index-known-source",
  adapterVersion: "2026.04.17",
  parserVersion: "finance-parser-1",
  adapterStatus: "active",
}
const verdict: RetrievalVerificationVerdict = {
  candidateId: "candidate:kospi",
  canAnswer: true,
  bindingStrength: "strong",
  evidenceSufficiency: "sufficient_approximate",
  rejectionReason: null,
  policy: "latest_approximate",
  sourceEvidenceId: "source:kospi",
  targetId: target.targetId,
  acceptedValue: "3085.42",
  acceptedUnit: "point",
  bindingSignals: [{ kind: "symbol", value: "KOSPI", weight: 0.45, evidenceField: "target.symbols" }],
  conflicts: [],
  caveats: ["collection-time approximate value"],
}

beforeEach(() => {
  closeDb()
  stateDir = mkdtempSync(join(tmpdir(), "nobie-task009-cache-"))
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = join(stateDir, "config.json5")
  reloadConfig()
  getDb()
})

afterEach(() => {
  closeDb()
  if (previousStateDir === undefined) delete process.env["NOBIE_STATE_DIR"]
  else process.env["NOBIE_STATE_DIR"] = previousStateDir
  if (previousConfig === undefined) delete process.env["NOBIE_CONFIG"]
  else process.env["NOBIE_CONFIG"] = previousConfig
  reloadConfig()
  rmSync(stateDir, { recursive: true, force: true })
})

describe("task009 retrieval cache", () => {
  it("uses TTL-valid cache as final answer only in the same session", () => {
    const entry = buildRetrievalCacheEntry({ target, sourceEvidence, verdict, now: new Date("2026-04-17T06:00:01.000Z"), ttlMs: 20_000 })
    const cache = createInMemoryRetrievalCache()
    cache.put(entry)

    const sameSession = evaluateRetrievalCacheEntry({ entry: cache.get(entry.cacheKey), now: new Date("2026-04-17T06:00:10.000Z"), sameSession: true, userRequestedLatest: true })
    const crossSession = evaluateRetrievalCacheEntry({ entry: cache.get(entry.cacheKey), now: new Date("2026-04-17T06:00:10.000Z"), sameSession: false, userRequestedLatest: true })

    expect(sameSession.status).toBe("usable_final")
    expect(sameSession.cacheAgeMs).toBe(10_000)
    expect(crossSession.status).toBe("usable_discovery_hint")
    expect(crossSession.canUseForFinalAnswer).toBe(false)
  })

  it("rejects stale cache for final answers but keeps it as a discovery hint", () => {
    const entry = buildRetrievalCacheEntry({ target, sourceEvidence, verdict, now: new Date("2026-04-17T06:00:01.000Z"), ttlMs: 1_000 })

    const evaluation = evaluateRetrievalCacheEntry({ entry, now: new Date("2026-04-17T06:00:05.000Z"), sameSession: true, userRequestedLatest: true })

    expect(evaluation.status).toBe("expired")
    expect(evaluation.canUseForFinalAnswer).toBe(false)
    expect(evaluation.canUseAsDiscoveryHint).toBe(true)
  })

  it("persists cache entries with cache age evidence", () => {
    const entry = buildRetrievalCacheEntry({ target, sourceEvidence, verdict, now: new Date("2026-04-17T06:00:01.000Z"), ttlMs: 20_000 })

    putPersistentRetrievalCacheEntry(entry)
    const loaded = getPersistentRetrievalCacheEntry(entry.cacheKey)

    expect(loaded?.cacheKey).toBe(entry.cacheKey)
    expect(loaded?.value).toBe("3085.42")
    const evaluation = evaluateRetrievalCacheEntry({ entry: loaded, now: new Date("2026-04-17T06:00:10.000Z"), sameSession: true })
    expect(evaluation.canUseForFinalAnswer).toBe(true)
    expect(evaluation.cacheAgeMs).toBe(10_000)
  })
})
