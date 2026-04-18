import { describe, expect, it, vi } from "vitest"
import { buildIncomingIntentContract } from "../packages/core/src/runs/active-run-projection.ts"
import { buildStartPlan } from "../packages/core/src/runs/start-plan.ts"
import { hasExplicitContinuationReference } from "../packages/core/src/runs/request-isolation.ts"

function createDependencies(overrides?: Partial<Parameters<typeof buildStartPlan>[1]>) {
  const reconnectRun = {
    id: "run-prev",
    requestGroupId: "group-prev",
    lineageRootRunId: "group-prev",
    title: "파일 전송 작업",
    prompt: "보고서 파일 보내줘",
    summary: "파일 전송 승인 대기",
    updatedAt: 100,
    status: "awaiting_approval",
    source: "telegram",
    sessionId: "session-1",
  } as any
  return {
    analyzeRequestEntrySemantics: vi.fn(() => ({ reuse_conversation_context: false, active_queue_cancellation_mode: null })),
    isReusableRequestGroup: vi.fn(() => false),
    listActiveSessionRequestGroups: vi.fn(() => [reconnectRun]),
    compareRequestContinuation: vi.fn(async () => ({
      kind: "same_run",
      requestGroupId: "group-prev",
      runId: "run-prev",
      decisionSource: "contract_ai",
      reason: "explicit reference selected active run",
    } as const)),
    getRequestGroupDelegationTurnCount: vi.fn(() => 3),
    buildWorkerSessionId: vi.fn(() => undefined),
    normalizeTaskProfile: vi.fn((taskProfile) => taskProfile ?? "general_chat"),
    findLatestWorkerSessionRun: vi.fn(() => undefined),
    ...overrides,
  }
}

describe("task006 continuation contract", () => {
  it("detects explicit references without semantic similarity", () => {
    expect(hasExplicitContinuationReference("방금 그 파일 다시 보내줘")).toBe(true)
    expect(hasExplicitContinuationReference("그거 이어서 진행해줘")).toBe(true)
    expect(hasExplicitContinuationReference("지금 코스닥 지수 알려줘")).toBe(false)
    expect(hasExplicitContinuationReference("메인 화면 캡쳐해서 보여줘")).toBe(false)
  })

  it("allows continuation only when the message contains an explicit reference", async () => {
    const dependencies = createDependencies()
    const result = await buildStartPlan({
      message: "방금 그 파일 다시 보내줘",
      sessionId: "session-1",
      runId: "run-followup",
      source: "telegram",
      incomingIntentContract: buildIncomingIntentContract({ sessionId: "session-1", source: "telegram", targetId: "artifact:last" }),
    }, dependencies)

    expect(dependencies.listActiveSessionRequestGroups).toHaveBeenCalled()
    expect(dependencies.compareRequestContinuation).toHaveBeenCalledTimes(1)
    expect(result.requestGroupId).toBe("group-prev")
    expect(result.isRootRequest).toBe(false)
  })

  it("does not turn a missing explicit-reference candidate into a forced clarification", async () => {
    const dependencies = createDependencies({
      listActiveSessionRequestGroups: vi.fn(() => []),
    })
    const result = await buildStartPlan({
      message: "그거 다시 보내줘",
      sessionId: "session-no-candidate",
      runId: "run-no-candidate",
      source: "webui",
      incomingIntentContract: buildIncomingIntentContract({ sessionId: "session-no-candidate", source: "webui", targetId: "artifact:last" }),
    }, dependencies)

    expect(dependencies.listActiveSessionRequestGroups).toHaveBeenCalled()
    expect(dependencies.compareRequestContinuation).not.toHaveBeenCalled()
    expect(result.reconnectNeedsClarification).toBe(false)
    expect(result.requestGroupId).toBe("run-no-candidate")
    expect(result.isRootRequest).toBe(true)
  })
})

