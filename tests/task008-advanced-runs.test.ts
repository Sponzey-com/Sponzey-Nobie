import { describe, expect, it } from "vitest"
import type { RetrievalTimeline } from "../packages/webui/src/api/client.ts"
import type { DoctorReport } from "../packages/webui/src/contracts/doctor.ts"
import type { OperationsSummary, StaleRunCleanupResult } from "../packages/webui/src/contracts/operations.ts"
import type { RootRun } from "../packages/webui/src/contracts/runs.ts"
import type { TaskMonitorCard } from "../packages/webui/src/lib/task-monitor.ts"
import {
  buildAdvancedDiagnosticStatuses,
  buildAdvancedRunListItems,
  buildAdvancedRunSummaryCards,
  buildCleanupNoticeFromDeleteResult,
  buildCleanupNoticeFromStaleResult,
  buildDoctorActionGuides,
  classifyAdvancedRunStatus,
} from "../packages/webui/src/lib/advanced-runs.js"

const text = (ko: string, _en: string) => ko
const now = 1_776_489_600_000

function run(overrides: Partial<RootRun> = {}): RootRun {
  return {
    id: "run-task008",
    sessionId: "session-task008",
    requestGroupId: "task-task008",
    lineageRootRunId: "task-task008",
    runScope: "root",
    title: "메인 화면 캡쳐",
    prompt: "메인 화면 캡쳐해서 보여줘",
    source: "telegram",
    status: "completed",
    taskProfile: "general_chat",
    targetLabel: "samjoko",
    contextMode: "full",
    delegationTurnCount: 0,
    maxDelegationTurns: 5,
    currentStepKey: "done",
    currentStepIndex: 1,
    totalSteps: 1,
    summary: "캡쳐 완료",
    canCancel: false,
    createdAt: now - 10_000,
    updatedAt: now,
    steps: [],
    recentEvents: [],
    ...overrides,
  }
}

function card(overrides: Partial<TaskMonitorCard> = {}): TaskMonitorCard {
  const representative = overrides.representative ?? run()
  return {
    key: "task-task008",
    representative,
    runs: [representative],
    requestText: representative.prompt,
    attempts: [{ id: representative.id, kind: "primary", label: "사용자 요청", prompt: representative.prompt, status: representative.status, summary: representative.summary, userVisible: true, run: representative }],
    visibleAttempts: [{ id: representative.id, kind: "primary", label: "사용자 요청", prompt: representative.prompt, status: representative.status, summary: representative.summary, userVisible: true, run: representative }],
    internalAttempts: [],
    treeNodes: [],
    timeline: [],
    checklist: { items: [], completedCount: 0, actionableCount: 0, failedCount: 0 },
    delivery: { status: "not_requested" },
    duplicateExecutionRisk: false,
    ...overrides,
  }
}

function operations(): OperationsSummary {
  return {
    generatedAt: now,
    health: {
      overall: { key: "overall", label: "overall", status: "degraded", reason: "channel warnings", count: 1 },
      memory: { key: "memory", label: "memory", status: "ok", reason: "memory ok", count: 0 },
      vector: { key: "vector", label: "vector", status: "ok", reason: "vector ok", count: 0 },
      schedule: { key: "schedule", label: "schedule", status: "ok", reason: "schedule ok", count: 0 },
      channel: { key: "channel", label: "channel", status: "degraded", reason: "delivery retries", count: 2 },
    },
    repeatedIssues: [{ key: "delivery", kind: "channel", label: "delivery", status: "degraded", count: 2, lastAt: now, sample: "delivery retry" }],
    stale: { thresholdMs: 60_000, pendingApprovals: [], pendingDeliveries: [], runs: [], total: 0 },
    counts: { runs: 2, tasks: 2, repeatedIssues: 1, stale: 0 },
  }
}

function retrievalTimeline(): RetrievalTimeline {
  return {
    events: [],
    summary: {
      total: 5,
      sessionEvents: 0,
      attempts: 2,
      sources: 2,
      candidates: 1,
      verdicts: 1,
      plannerActions: 0,
      deliveryEvents: 1,
      dedupeSuppressed: 0,
      stops: 0,
      conflicts: 0,
      finalDeliveryStatus: "delivered",
      stopReason: null,
      severityCounts: { debug: 0, info: 5, warning: 0, error: 0 },
    },
  }
}

function doctor(): DoctorReport {
  return {
    kind: "nobie.doctor.report",
    version: 1,
    id: "doctor-task008",
    mode: "quick",
    createdAt: "2026-04-18T00:00:00.000Z",
    overallStatus: "warning",
    runtimeManifestId: "manifest-task008",
    checks: [
      { name: "channel.delivery", status: "warning", message: "Slack delivery has repeated failures", detail: { token: "xoxb-secret" }, guide: "Check Slack channel id and app token." },
      { name: "database", status: "ok", message: "Database OK", detail: {}, guide: null },
    ],
    summary: { ok: 1, warning: 1, blocked: 0, unknown: 0 },
    manifest: {
      id: "manifest-task008",
      app: { displayVersion: "0.1.5", gitDescribe: "v0.1.5" },
      database: { currentVersion: 1, latestVersion: 1, upToDate: true },
      promptSources: { count: 4, checksum: "abc", localeParityOk: true },
      provider: { provider: "openai", model: "gpt-5.4", profileId: "default" },
    },
  }
}

describe("task008 advanced run monitor", () => {
  it("keeps delivered results from being shown as failed when the later run state flips", () => {
    const status = classifyAdvancedRunStatus(card({ representative: run({ status: "failed" }), delivery: { status: "delivered", channel: "telegram", summary: "전송 완료" } }), text)

    expect(status.kind).toBe("completed")
    expect(status.delivered).toBe(true)
    expect(status.label).toBe("전달 완료")
    expect(status.summary).toContain("결과 전달은 완료")
  })

  it("separates delivery failure, approval waiting, and recovery from generic run failure", () => {
    expect(classifyAdvancedRunStatus(card({ delivery: { status: "failed", channel: "slack", summary: "403" } }), text).kind).toBe("delivery_failed")
    expect(classifyAdvancedRunStatus(card({ representative: run({ status: "running" }), continuity: { lineageRootRunId: "task-task008", pendingApprovals: ["tool:screen_capture"], pendingDelivery: [], updatedAt: now } }), text).kind).toBe("approval_waiting")
    expect(classifyAdvancedRunStatus(card({ diagnostics: { promptSourceIds: [], promptSources: [], latencyEvents: [], memoryEvents: [], toolEvents: [], deliveryEvents: [], recoveryEvents: ["retry"] } }), text).kind).toBe("recovery")
  })

  it("builds an operator-oriented run list with channel, requester, result, and summary counts", () => {
    const items = buildAdvancedRunListItems([
      card({ delivery: { status: "delivered", channel: "telegram", summary: "전송 완료" } }),
      card({ key: "task-delivery-failed", representative: run({ id: "run-failed", source: "slack", targetLabel: "ops" }), delivery: { status: "failed", channel: "slack", summary: "파일 전송 실패" } }),
    ], text)
    const summary = buildAdvancedRunSummaryCards(items, text)

    expect(items[0].channelLabel).toBe("Telegram")
    expect(items[0].requesterLabel).toBe("samjoko")
    expect(items[1].status.kind).toBe("delivery_failed")
    expect(items[1].actionHint).toContain("채널 전달")
    expect(summary.find((item) => item.id === "delivery_failed")?.value).toBe(1)
    expect(summary.find((item) => item.id === "completed")?.value).toBe(1)
  })

  it("builds diagnostics summaries without exposing raw doctor detail", () => {
    const statuses = buildAdvancedDiagnosticStatuses(operations(), retrievalTimeline(), text)
    const guides = buildDoctorActionGuides(doctor(), text)

    expect(statuses.map((status) => status.key)).toEqual(["channel", "scheduler", "memory", "web_retrieval", "yeonjang"])
    expect(statuses.find((status) => status.key === "web_retrieval")?.summary).toContain("검색 시도 2회")
    expect(guides).toHaveLength(1)
    expect(guides[0].label).toBe("channel.delivery")
    expect(JSON.stringify(guides)).not.toContain("xoxb-secret")
  })

  it("creates cleanup result notices for safe history cleanup feedback", () => {
    const staleResult: StaleRunCleanupResult = { cleanedRunCount: 2, skippedRunCount: 1, cleanedRunIds: ["a", "b"], skippedRunIds: ["c"], thresholdMs: 60_000 }

    expect(buildCleanupNoticeFromDeleteResult(3, text).message).toContain("3건")
    expect(buildCleanupNoticeFromStaleResult(staleResult, text).message).toContain("2건")
    expect(buildCleanupNoticeFromStaleResult(staleResult, text).auditHint).toContain("감사")
  })
})
