import { describe, expect, it, vi } from "vitest"
import { prepareStartLaunch } from "../packages/core/src/runs/start-launch.ts"

describe("prepare start launch", () => {
  it("creates the run and initializes it from the computed start plan", () => {
    const buildStartPlan = vi.fn(() => ({
      entrySemantics: {
        reuse_conversation_context: true,
        active_queue_cancellation_mode: null,
      },
      requestedClosedRequestGroup: false,
      shouldReconnectGroup: true,
      reconnectSelection: {
        best: undefined,
        candidates: [],
        ambiguous: false,
      },
      reconnectTarget: {
        id: "run-prev",
        requestGroupId: "group-prev",
        title: "기존 작업",
        updatedAt: 1,
        status: "running",
      },
      reconnectCandidateCount: 1,
      reconnectNeedsClarification: false,
      requestGroupId: "group-prev",
      isRootRequest: false,
      effectiveTaskProfile: "coding",
      initialDelegationTurnCount: 2,
      shouldReuseContext: true,
      effectiveContextMode: "request_group",
      workerSessionId: "worker-1",
      reusableWorkerSessionRun: {
        id: "run-worker",
        requestGroupId: "group-prev",
        title: "worker",
        updatedAt: 1,
        status: "running",
      },
    }))
    const ensureSessionExists = vi.fn()
    const createRootRun = vi.fn(() => ({ id: "run-1" }))
    const applyStartInitialization = vi.fn(() => ({
      queuedBehindRequestGroupRun: true,
      interruptedWorkerRunCount: 0,
    }))

    const result = prepareStartLaunch({
      message: "continue work",
      sessionId: "session-1",
      runId: "run-1",
      source: "cli",
      controller: new AbortController(),
      now: 123,
      maxDelegationTurns: 7,
      model: "gpt-5",
      targetId: "provider:openai",
      targetLabel: "OpenAI",
      hasRequestGroupQueue: (requestGroupId) => requestGroupId === "group-prev",
    }, {
      buildStartPlan: buildStartPlan as any,
      isReusableRequestGroup: vi.fn(),
      findReconnectRequestGroupSelection: vi.fn(),
      getRequestGroupDelegationTurnCount: vi.fn(),
      buildWorkerSessionId: vi.fn(),
      normalizeTaskProfile: vi.fn(),
      findLatestWorkerSessionRun: vi.fn(),
      ensureSessionExists,
      createRootRun: createRootRun as any,
      applyStartInitialization: applyStartInitialization as any,
      rememberRunInstruction: vi.fn(),
      bindActiveRunController: vi.fn(),
      interruptOrphanWorkerSessionRuns: vi.fn(),
      appendRunEvent: vi.fn(),
      updateRunSummary: vi.fn(),
      setRunStepStatus: vi.fn(),
      updateRunStatus: vi.fn(),
    })

    expect(ensureSessionExists).toHaveBeenCalledWith("session-1", "cli", 123)
    expect(createRootRun).toHaveBeenCalledWith(expect.objectContaining({
      id: "run-1",
      requestGroupId: "group-prev",
      taskProfile: "coding",
      delegationTurnCount: 2,
      contextMode: "request_group",
      workerSessionId: "worker-1",
    }))
    expect(applyStartInitialization).toHaveBeenCalledWith(expect.objectContaining({
      requestGroupId: "group-prev",
      requestGroupQueueActive: true,
      reconnectTargetTitle: "기존 작업",
      reusableWorkerSessionRun: true,
    }), expect.any(Object))
    expect(result.run).toEqual({ id: "run-1" })
    expect(result.queuedBehindRequestGroupRun).toBe(true)
    expect(result.startPlan.requestGroupId).toBe("group-prev")
  })
})
