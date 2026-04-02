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
      reuse_conversation_context: /continue/i.test(message),
      active_queue_cancellation_mode: null,
    })),
    isReusableRequestGroup: vi.fn(() => false),
    findReconnectRequestGroupSelection: vi.fn(() => ({
      best: reconnectRun,
      candidates: [reconnectRun],
      ambiguous: false,
    })),
    getRequestGroupDelegationTurnCount: vi.fn(() => 2),
    buildWorkerSessionId: vi.fn(() => "worker-session-1"),
    normalizeTaskProfile: vi.fn((taskProfile) => taskProfile ?? "general_chat"),
    findLatestWorkerSessionRun: vi.fn(() => undefined),
    ...overrides,
  }
}

describe("build start plan", () => {
  it("reuses reconnect target when continuation context is detected", () => {
    const dependencies = createDependencies()
    const result = buildStartPlan({
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

  it("forces clarification when reconnect selection is ambiguous", () => {
    const dependencies = createDependencies({
      findReconnectRequestGroupSelection: vi.fn(() => ({
        best: {
          id: "run-prev",
          requestGroupId: "group-prev",
          title: "기존 달력 작업",
          updatedAt: 100,
          status: "running",
        } as any,
        candidates: [
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
        ],
        ambiguous: true,
      })),
    })

    const result = buildStartPlan({
      message: "continue the work",
      sessionId: "session-2",
      runId: "run-2",
    }, dependencies)

    expect(result.reconnectNeedsClarification).toBe(true)
    expect(result.requestGroupId).toBe("run-2")
    expect(result.isRootRequest).toBe(true)
  })

  it("treats closed request groups as new roots unless force reuse is set", () => {
    const dependencies = createDependencies({
      analyzeRequestEntrySemantics: vi.fn(() => ({
        reuse_conversation_context: false,
        active_queue_cancellation_mode: null,
      })),
    })

    const result = buildStartPlan({
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
})
