import { describe, expect, it, vi } from "vitest"
import { buildStartPlan } from "../packages/core/src/runs/start-plan.ts"

function createDependencies(overrides?: Partial<Parameters<typeof buildStartPlan>[1]>) {
  const reconnectRun = {
    id: "run-prev",
    requestGroupId: "group-prev",
    title: "기존 달력 작업",
    updatedAt: 100,
    status: "running",
  } as any
  return {
    analyzeRequestEntrySemantics: vi.fn((message: string) => ({
      reuse_conversation_context: false,
      active_queue_cancellation_mode: null,
    })),
    isReusableRequestGroup: vi.fn(() => false),
    listActiveSessionRequestGroups: vi.fn(() => [reconnectRun]),
    compareRequestContinuation: vi.fn(async () => ({
      kind: "same_run",
      requestGroupId: "group-prev",
      runId: "run-prev",
      decisionSource: "contract_ai",
      reason: "same task",
    })),
    getRequestGroupDelegationTurnCount: vi.fn(() => 2),
    buildWorkerSessionId: vi.fn(() => "worker-session-1"),
    normalizeTaskProfile: vi.fn((taskProfile) => taskProfile ?? "general_chat"),
    findLatestWorkerSessionRun: vi.fn(() => undefined),
    ...overrides,
  }
}

describe("build start plan", () => {
  it("reuses reconnect target when AI comparison selects an active task", async () => {
    const dependencies = createDependencies()
    const result = await buildStartPlan({
      message: "continue the calendar work",
      sessionId: "session-1",
      runId: "run-1",
      taskProfile: "coding",
      targetId: "provider:openai",
    }, dependencies)

    expect(result.requestGroupId).toBe("group-prev")
    expect(result.isRootRequest).toBe(false)
    expect(result.reconnectNeedsClarification).toBe(false)
    expect(result.initialDelegationTurnCount).toBe(2)
    expect(result.effectiveTaskProfile).toBe("coding")
    expect(result.effectiveContextMode).toBe("request_group")
    expect(result.workerSessionId).toBe("worker-session-1")
  })

  it("forces clarification when AI comparison is ambiguous", async () => {
    const dependencies = createDependencies({
      listActiveSessionRequestGroups: vi.fn(() => ([
        {
          id: "run-prev",
          requestGroupId: "group-prev",
          title: "기존 달력 작업",
          updatedAt: 100,
          status: "running",
        } as any,
        {
          id: "run-prev-2",
          requestGroupId: "group-prev-2",
          title: "기존 계산기 작업",
          updatedAt: 90,
          status: "running",
        } as any,
      ])),
      compareRequestContinuation: vi.fn(async () => ({
        kind: "clarify",
        decisionSource: "contract_ai",
        reason: "ambiguous candidates",
      })),
    })

    const result = await buildStartPlan({
      message: "continue the work",
      sessionId: "session-2",
      runId: "run-2",
    }, dependencies)

    expect(result.reconnectNeedsClarification).toBe(true)
    expect(result.requestGroupId).toBe("run-2")
    expect(result.isRootRequest).toBe(true)
  })

  it("treats closed request groups as new roots unless force reuse is set", async () => {
    const dependencies = createDependencies({
      analyzeRequestEntrySemantics: vi.fn(() => ({
        reuse_conversation_context: false,
        active_queue_cancellation_mode: null,
      })),
    })

    const result = await buildStartPlan({
      message: "new message",
      sessionId: "session-3",
      runId: "run-3",
      requestGroupId: "group-closed",
    }, dependencies)

    expect(result.requestedClosedRequestGroup).toBe(true)
    expect(result.requestGroupId).toBe("run-3")
    expect(result.isRootRequest).toBe(true)
    expect(result.effectiveContextMode).toBe("isolated")
  })

  it("skips AI continuation comparison for cancellation commands", async () => {
    const compareRequestContinuation = vi.fn(async () => ({
      kind: "same_run",
      requestGroupId: "group-prev",
      runId: "run-prev",
      decisionSource: "contract_ai",
      reason: "should not be used",
    }))
    const dependencies = createDependencies({
      analyzeRequestEntrySemantics: vi.fn(() => ({
        reuse_conversation_context: false,
        active_queue_cancellation_mode: "latest",
      })),
      compareRequestContinuation,
    })

    const result = await buildStartPlan({
      message: "지금 작업 취소해줘",
      sessionId: "session-4",
      runId: "run-4",
    }, dependencies)

    expect(compareRequestContinuation).not.toHaveBeenCalled()
    expect(result.requestGroupId).toBe("run-4")
    expect(result.isRootRequest).toBe(true)
  })

  it("uses explicit reusable request group without contract projection comparison", async () => {
    const compareRequestContinuation = vi.fn(async () => ({
      kind: "same_run",
      requestGroupId: "group-prev",
      runId: "run-prev",
      decisionSource: "contract_ai",
      reason: "should not be called",
    }))
    const dependencies = createDependencies({
      isReusableRequestGroup: vi.fn(() => true),
      compareRequestContinuation,
    })

    const result = await buildStartPlan({
      message: "후속 작업",
      sessionId: "session-5",
      runId: "run-5",
      requestGroupId: "group-explicit",
    }, dependencies)

    expect(compareRequestContinuation).not.toHaveBeenCalled()
    expect(result.requestGroupId).toBe("group-explicit")
    expect(result.isRootRequest).toBe(false)
  })

  it("uses explicit target run id as a fast path without AI comparison", async () => {
    const compareRequestContinuation = vi.fn(async () => ({
      kind: "same_run",
      requestGroupId: "group-prev",
      runId: "run-prev",
      decisionSource: "contract_ai",
      reason: "should not be called",
    }))
    const dependencies = createDependencies({ compareRequestContinuation })

    const result = await buildStartPlan({
      message: "이 실행에 이어서 처리",
      sessionId: "session-6",
      runId: "run-6",
      targetRunId: "run-prev",
    }, dependencies)

    expect(compareRequestContinuation).not.toHaveBeenCalled()
    expect(result.requestGroupId).toBe("group-prev")
    expect(result.isRootRequest).toBe(false)
  })
})
