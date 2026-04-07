import { describe, expect, it, vi } from "vitest"
import { prepareStartLaunch } from "../packages/core/src/runs/start-launch.ts"
import { buildStartPlan } from "../packages/core/src/runs/start-plan.ts"

describe("prepare start launch", () => {
  it("creates the run and initializes it from the computed start plan", async () => {
    const buildStartPlan = vi.fn(async () => ({
      entrySemantics: {
        reuse_conversation_context: true,
        active_queue_cancellation_mode: null,
      },
      requestedClosedRequestGroup: false,
      shouldReconnectGroup: true,
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

    const result = await prepareStartLaunch({
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
      hasRequestGroupExecutionQueue: (requestGroupId) => requestGroupId === "group-prev",
    }, {
      buildStartPlan: buildStartPlan as any,
      isReusableRequestGroup: vi.fn(),
      listActiveSessionRequestGroups: vi.fn(),
      compareRequestContinuation: vi.fn(),
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
      requestGroupExecutionQueueActive: true,
      reconnectTargetTitle: "기존 작업",
      reusableWorkerSessionRun: true,
    }), expect.any(Object))
    expect(result.run).toEqual({ id: "run-1" })
    expect(result.queuedBehindRequestGroupRun).toBe(true)
    expect(result.startPlan.requestGroupId).toBe("group-prev")
  })

  it("forwards delayed schedule lineage into start initialization", async () => {
    const buildStartPlan = vi.fn(async () => ({
      entrySemantics: {
        reuse_conversation_context: true,
        active_queue_cancellation_mode: null,
      },
      requestedClosedRequestGroup: false,
      shouldReconnectGroup: false,
      reconnectTarget: undefined,
      reconnectCandidateCount: 0,
      reconnectNeedsClarification: false,
      requestGroupId: "group-delayed",
      isRootRequest: true,
      effectiveTaskProfile: "general_chat",
      initialDelegationTurnCount: 0,
      shouldReuseContext: true,
      effectiveContextMode: "full",
      workerSessionId: undefined,
      reusableWorkerSessionRun: undefined,
    }))
    const applyStartInitialization = vi.fn(() => ({
      queuedBehindRequestGroupRun: false,
      interruptedWorkerRunCount: 0,
    }))

    await prepareStartLaunch({
      message: "delayed hello",
      sessionId: "session-delayed",
      runId: "run-delayed",
      source: "telegram",
      controller: new AbortController(),
      now: 456,
      maxDelegationTurns: 3,
      originRunId: "origin-run-1",
      originRequestGroupId: "origin-group-1",
      hasRequestGroupExecutionQueue: () => false,
    }, {
      buildStartPlan: buildStartPlan as any,
      isReusableRequestGroup: vi.fn(),
      listActiveSessionRequestGroups: vi.fn(),
      compareRequestContinuation: vi.fn(),
      getRequestGroupDelegationTurnCount: vi.fn(),
      buildWorkerSessionId: vi.fn(),
      normalizeTaskProfile: vi.fn(),
      findLatestWorkerSessionRun: vi.fn(),
      ensureSessionExists: vi.fn(),
      createRootRun: vi.fn(() => ({ id: "run-delayed" })) as any,
      applyStartInitialization: applyStartInitialization as any,
      rememberRunInstruction: vi.fn(),
      bindActiveRunController: vi.fn(),
      interruptOrphanWorkerSessionRuns: vi.fn(),
      appendRunEvent: vi.fn(),
      updateRunSummary: vi.fn(),
      setRunStepStatus: vi.fn(),
      updateRunStatus: vi.fn(),
    })

    expect(applyStartInitialization).toHaveBeenCalledWith(expect.objectContaining({
      originRunId: "origin-run-1",
      originRequestGroupId: "origin-group-1",
    }), expect.any(Object))
  })

  it("uses isolated AI comparison result when using the real start plan helper", async () => {
    const result = await prepareStartLaunch({
      message: "continue the previous work",
      sessionId: "session-real",
      runId: "run-real",
      source: "cli",
      controller: new AbortController(),
      now: 789,
      maxDelegationTurns: 5,
      hasRequestGroupExecutionQueue: () => false,
    }, {
      buildStartPlan,
      analyzeRequestEntrySemantics: vi.fn((message: string) => ({
        reuse_conversation_context: false,
        active_queue_cancellation_mode: null,
      })) as any,
      isReusableRequestGroup: vi.fn(() => false),
      listActiveSessionRequestGroups: vi.fn(() => ([
        {
          id: "run-prev",
          requestGroupId: "group-prev",
          title: "기존 작업",
          prompt: "기존 작업",
          summary: "이전 작업",
          updatedAt: 100,
          status: "running",
        } as any,
      ])),
      compareRequestContinuation: vi.fn(async () => ({
        kind: "reuse",
        requestGroupId: "group-prev",
        reason: "same task",
      })) as any,
      getRequestGroupDelegationTurnCount: vi.fn(() => 0),
      buildWorkerSessionId: vi.fn(() => undefined),
      normalizeTaskProfile: vi.fn((taskProfile) => taskProfile ?? "general_chat"),
      findLatestWorkerSessionRun: vi.fn(() => undefined),
      ensureSessionExists: vi.fn(),
      createRootRun: vi.fn(() => ({ id: "run-real" })) as any,
      applyStartInitialization: vi.fn(() => ({
        queuedBehindRequestGroupRun: false,
        interruptedWorkerRunCount: 0,
      })) as any,
      rememberRunInstruction: vi.fn(),
      bindActiveRunController: vi.fn(),
      interruptOrphanWorkerSessionRuns: vi.fn(),
      appendRunEvent: vi.fn(),
      updateRunSummary: vi.fn(),
      setRunStepStatus: vi.fn(),
      updateRunStatus: vi.fn(),
    })

    expect(result.startPlan.entrySemantics.reuse_conversation_context).toBe(true)
    expect(result.startPlan.requestGroupId).toBe("group-prev")
  })
})
