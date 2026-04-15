import { describe, expect, it } from "vitest"
import {
  buildRetentionCleanupPlan,
  buildRetryFailureFingerprint,
  buildSoakHealthSummary,
  buildSoakReportArtifact,
  collectSoakResourceMetrics,
  evaluateRetryBackoff,
  expandSoakOperationMix,
  getSoakProfile,
  runRetentionCleanup,
  runSoakProfile,
  shouldStopRepeatedFailure,
  type RetentionItem,
  type SoakOperationKind,
} from "../packages/core/src/runs/soak-retention.ts"

const DAY_MS = 24 * 60 * 60 * 1000

describe("task006 soak and retention policy", () => {
  it("defines staged soak profiles and runs a deterministic short profile", async () => {
    const short = getSoakProfile("short")
    const oneHour = getSoakProfile("one_hour")
    expect(oneHour.durationMs).toBeGreaterThan(short.durationMs)
    expect(expandSoakOperationMix(short)).toEqual(expect.arrayContaining<SoakOperationKind>(["safe_tool", "memory_read", "yeonjang_status"]))

    let clock = 1_000
    const executed: SoakOperationKind[] = []
    const summary = await runSoakProfile({
      profile: "short",
      maxOperations: 4,
      waitBetweenOperations: false,
      now: () => {
        clock += 100
        return clock
      },
      collectMetrics: () => collectSoakResourceMetrics({ now: clock, queueLength: executed.length, activeRunCount: 1, mqttConnected: true, openFileDescriptorCount: 12 }),
      executeOperation: async (operation) => {
        executed.push(operation)
        return { ok: true, summary: `ok:${operation}` }
      },
    })

    expect(summary.totalOperations).toBe(4)
    expect(summary.failedOperations).toBe(0)
    expect(summary.succeededOperations).toBe(4)
    expect(summary.metrics.length).toBe(5)
    expect(summary.metrics.at(-1)).toMatchObject({ queueLength: 4, activeRunCount: 1, mqttConnected: true, openFileDescriptorCount: 12 })
    expect(summary.auditSummary).toContain("soak:short")
    expect(summary.lastSuccess?.summary).toBe("ok:memory_write")
  })

  it("stops a soak profile on failure and stores a sanitized failure summary", async () => {
    const summary = await runSoakProfile({
      profile: "short",
      maxOperations: 5,
      waitBetweenOperations: false,
      stopOnFailure: true,
      executeOperation: async (operation, context) => {
        if (context.iteration === 1) return { ok: false, errorMessage: "screen_capture failed: permission denied" }
        return { ok: true, summary: `ok:${operation}` }
      },
    })

    expect(summary.totalOperations).toBe(2)
    expect(summary.failedOperations).toBe(1)
    expect(summary.lastFailure).toMatchObject({ operation: "safe_tool", errorKind: "tool_failure" })
    expect(summary.lastFailure?.userMessage).toBe("도구 또는 실행 경로에서 오류가 발생했습니다.")
  })

  it("calculates degraded soak health metrics and report payload", async () => {
    const summary = await runSoakProfile({
      profile: "short",
      maxOperations: 1,
      waitBetweenOperations: false,
      collectMetrics: () => collectSoakResourceMetrics({ now: 1_000, openFileDescriptorCount: 3 }),
      executeOperation: async () => ({ ok: true, summary: "ok" }),
    })
    const health = buildSoakHealthSummary({
      runLatencyMs: [10, 20, 100],
      memoryRetrievalLatencyMs: [5, 10, 80],
      dbQueryLatencyMs: [3, 4, 40],
      eventLoopLagMs: [1, 2, 30],
      rssBytes: 2_000,
      artifactCount: 5,
      auditRowCount: 10,
      thresholds: {
        runLatencyP95Ms: 50,
        memoryRetrievalP95Ms: 100,
        dbQueryP95Ms: 100,
        eventLoopLagP95Ms: 100,
        rssBytes: 1_000,
        artifactCount: 10,
        auditRowCount: 20,
      },
    })
    const report = JSON.parse(buildSoakReportArtifact(summary, health)) as { profileId: string; metricSampleCount: number; health: { status: string; degradedReasons: string[] } }

    expect(health.status).toBe("degraded")
    expect(health.runLatency.p95Ms).toBe(100)
    expect(health.degradedReasons).toEqual(["run_latency_p95", "rss_bytes"])
    expect(report).toMatchObject({ profileId: "short", metricSampleCount: 2, health: { status: "degraded" } })
  })

  it("selects retention cleanup candidates by age, count, bytes and excludes active runs", async () => {
    const now = 100 * DAY_MS
    const items: RetentionItem[] = [
      { id: "artifact-old", kind: "artifact", createdAt: now - 40 * DAY_MS, sizeBytes: 30, runId: "finished-run" },
      { id: "artifact-active-old", kind: "artifact", createdAt: now - 50 * DAY_MS, sizeBytes: 1_000, runId: "active-run" },
      { id: "artifact-newest", kind: "artifact", createdAt: now - 1_000, sizeBytes: 70, runId: "finished-run" },
      { id: "artifact-middle", kind: "artifact", createdAt: now - 2_000, sizeBytes: 70, runId: "finished-run" },
      { id: "artifact-third", kind: "artifact", createdAt: now - 3_000, sizeBytes: 70, runId: "finished-run" },
      { id: "audit-old", kind: "audit_log", createdAt: now - 120 * DAY_MS, sizeBytes: 10 },
    ]

    const plan = buildRetentionCleanupPlan({
      items,
      activeRunIds: ["active-run"],
      now,
      dryRun: true,
      policy: {
        artifact: { maxAgeMs: 30 * DAY_MS, maxCount: 2, maxBytes: 120 },
        audit_log: { maxAgeMs: 90 * DAY_MS },
      },
    })

    expect(plan.dryRun).toBe(true)
    expect(plan.candidates.map((candidate) => candidate.id)).toEqual(["audit-old", "artifact-old", "artifact-third", "artifact-middle"])
    expect(plan.candidates.find((candidate) => candidate.id === "artifact-old")?.reasons).toEqual(expect.arrayContaining(["max_age", "max_count", "max_bytes"]))
    expect(plan.skippedActive.map((item) => item.id)).toEqual(["artifact-active-old"])
    expect(plan.byKind.artifact).toMatchObject({ candidateCount: 3, skippedActiveCount: 1, estimatedBytes: 170 })
    expect(plan.estimatedBytes).toBe(180)
    expect(plan.auditSummary).toContain("retention:dry-run")

    const deleted: string[] = []
    let auditRecorded = false
    const result = await runRetentionCleanup({
      items,
      activeRunIds: ["active-run"],
      now,
      dryRun: false,
      policy: {
        artifact: { maxAgeMs: 30 * DAY_MS, maxCount: 2, maxBytes: 120 },
        audit_log: { maxAgeMs: 90 * DAY_MS },
      },
      deleteCandidate: (candidate) => {
        deleted.push(candidate.id)
      },
      recordAudit: () => {
        auditRecorded = true
      },
    })

    expect(result.failures).toEqual([])
    expect(result.auditRecorded).toBe(true)
    expect(auditRecorded).toBe(true)
    expect(deleted).toEqual(["audit-old", "artifact-old", "artifact-third", "artifact-middle"])
    expect(deleted).not.toContain("artifact-active-old")
  })

  it("separates retry fingerprints and applies bounded backoff", () => {
    const telegramConflict = buildRetryFailureFingerprint({
      domain: "channel",
      channel: "telegram",
      targetId: "bot-a",
      errorMessage: "Call to 'getUpdates' failed! (409: Conflict: terminated by other getUpdates request)",
    })
    const telegramOtherTarget = buildRetryFailureFingerprint({
      domain: "channel",
      channel: "telegram",
      targetId: "bot-b",
      errorMessage: "Call to 'getUpdates' failed! (409: Conflict: terminated by other getUpdates request)",
    })
    const slackDelivery = buildRetryFailureFingerprint({
      domain: "delivery",
      channel: "slack",
      targetId: "C123",
      errorMessage: "<html><body>403 Forbidden</body></html>",
    })

    expect(telegramConflict).toContain("kind=channel_conflict")
    expect(telegramConflict).toContain("channel=telegram")
    expect(telegramConflict).not.toBe(telegramOtherTarget)
    expect(slackDelivery).toContain("kind=access_blocked")
    expect(slackDelivery).not.toContain("html")

    expect(evaluateRetryBackoff({ domain: "channel", attempt: 1, maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 2_000 })).toMatchObject({
      shouldRetry: true,
      exhausted: false,
      nextDelayMs: 500,
    })
    expect(evaluateRetryBackoff({ domain: "channel", attempt: 3, maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 2_000 })).toMatchObject({
      shouldRetry: false,
      exhausted: true,
      reason: "retry_exhausted",
    })
    expect(shouldStopRepeatedFailure({ fingerprint: telegramConflict, seenCount: 3, threshold: 3 })).toMatchObject({ shouldStop: true })
  })
})
