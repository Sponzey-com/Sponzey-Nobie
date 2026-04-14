import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockApi, mockSetDisconnected } = vi.hoisted(() => ({
  mockApi: {
    runs: vi.fn(),
    tasks: vi.fn(),
    runOperationsSummary: vi.fn(),
    cleanupStaleRuns: vi.fn(),
    createRun: vi.fn(),
    cancelRun: vi.fn(),
    deleteRunHistory: vi.fn(),
    clearHistoricalRunHistory: vi.fn(),
  },
  mockSetDisconnected: vi.fn(),
}))

vi.mock("../packages/webui/src/api/client", () => ({
  api: mockApi,
}))

vi.mock("../packages/webui/src/stores/connection", () => ({
  useConnectionStore: {
    getState: () => ({
      setDisconnected: mockSetDisconnected,
    }),
  },
}))

import { useRunsStore } from "../packages/webui/src/stores/runs.ts"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeRun(id: string, updatedAt: number) {
  return {
    id,
    sessionId: "session-1",
    requestGroupId: id,
    title: id,
    prompt: id,
    source: "webui" as const,
    status: "running" as const,
    taskProfile: "general_chat" as const,
    contextMode: "full" as const,
    delegationTurnCount: 0,
    maxDelegationTurns: 5,
    currentStepKey: "executing",
    currentStepIndex: 4,
    totalSteps: 9,
    summary: id,
    canCancel: true,
    createdAt: updatedAt,
    updatedAt,
    steps: [],
    recentEvents: [],
  }
}

function makeTask(id: string, updatedAt: number) {
  return {
    id,
    requestGroupId: id,
    sessionId: "session-1",
    source: "webui" as const,
    anchorRunId: id,
    latestAttemptId: id,
    runIds: [id],
    title: id,
    requestText: id,
    summary: id,
    status: "running" as const,
    canCancel: true,
    createdAt: updatedAt,
    updatedAt,
    attempts: [],
    recoveryAttempts: [],
    delivery: { taskId: id, status: "not_requested" as const },
    checklist: {
      items: [
        { key: "request" as const, status: "completed" as const, summary: id },
        { key: "execution" as const, status: "running" as const, summary: id },
        { key: "delivery" as const, status: "not_required" as const },
        { key: "completion" as const, status: "running" as const, summary: id },
      ],
      completedCount: 1,
      actionableCount: 3,
      failedCount: 0,
    },
    monitor: {
      activeAttemptCount: 1,
      runningAttemptCount: 1,
      queuedAttemptCount: 0,
      visibleAttemptCount: 1,
      internalAttemptCount: 0,
      recoveryAttemptCount: 0,
      activeRecoveryCount: 0,
      duplicateExecutionRisk: false,
      awaitingApproval: false,
      awaitingUser: false,
      deliveryStatus: "not_requested" as const,
    },
    activities: [],
  }
}

function makeOperationsSummary() {
  return {
    generatedAt: 1,
    health: {
      overall: { key: "overall" as const, label: "전체", status: "ok" as const, reason: "정상", count: 0 },
      memory: { key: "memory" as const, label: "메모리", status: "ok" as const, reason: "정상", count: 0 },
      vector: { key: "vector" as const, label: "벡터", status: "ok" as const, reason: "정상", count: 0 },
      schedule: { key: "schedule" as const, label: "예약", status: "ok" as const, reason: "정상", count: 0 },
      channel: { key: "channel" as const, label: "채널", status: "ok" as const, reason: "정상", count: 0 },
    },
    repeatedIssues: [],
    stale: {
      thresholdMs: 1_800_000,
      pendingApprovals: [],
      pendingDeliveries: [],
      runs: [],
      total: 0,
    },
    counts: {
      runs: 0,
      tasks: 0,
      repeatedIssues: 0,
      stale: 0,
    },
  }
}

describe("webui runs store", () => {
  beforeEach(() => {
    useRunsStore.setState({
      initialized: false,
      loading: false,
      lastError: "",
      runs: [],
      tasks: [],
      operationsSummary: null,
      selectedRunId: null,
    })
    mockApi.runs.mockReset()
    mockApi.tasks.mockReset()
    mockApi.runOperationsSummary.mockReset()
    mockApi.runOperationsSummary.mockResolvedValue({ summary: makeOperationsSummary() })
    mockApi.cleanupStaleRuns.mockReset()
    mockApi.createRun.mockReset()
    mockApi.cancelRun.mockReset()
    mockApi.deleteRunHistory.mockReset()
    mockApi.clearHistoricalRunHistory.mockReset()
    mockSetDisconnected.mockReset()
  })

  it("selects a newly created root task when it arrives from realtime updates", () => {
    useRunsStore.getState().upsertRun({
      id: "task-new",
      sessionId: "session-1",
      requestGroupId: "task-new",
      title: "새 태스크",
      prompt: "새 태스크",
      source: "telegram",
      status: "running",
      taskProfile: "general_chat",
      contextMode: "full",
      delegationTurnCount: 0,
      maxDelegationTurns: 5,
      currentStepKey: "executing",
      currentStepIndex: 4,
      totalSteps: 9,
      summary: "실행 중",
      canCancel: true,
      createdAt: 1,
      updatedAt: 2,
      steps: [],
      recentEvents: [],
    })

    expect(useRunsStore.getState().selectedRunId).toBe("task-new")
  })

  it("ignores stale refresh responses when concurrent snapshots resolve out of order", async () => {
    const runsFirst = deferred<{ runs: ReturnType<typeof makeRun>[] }>()
    const tasksFirst = deferred<{ tasks: ReturnType<typeof makeTask>[] }>()
    const operationsFirst = deferred<{ summary: ReturnType<typeof makeOperationsSummary> }>()
    const runsSecond = deferred<{ runs: ReturnType<typeof makeRun>[] }>()
    const tasksSecond = deferred<{ tasks: ReturnType<typeof makeTask>[] }>()
    const operationsSecond = deferred<{ summary: ReturnType<typeof makeOperationsSummary> }>()

    mockApi.runs
      .mockReturnValueOnce(runsFirst.promise)
      .mockReturnValueOnce(runsSecond.promise)
    mockApi.tasks
      .mockReturnValueOnce(tasksFirst.promise)
      .mockReturnValueOnce(tasksSecond.promise)
    mockApi.runOperationsSummary
      .mockReturnValueOnce(operationsFirst.promise)
      .mockReturnValueOnce(operationsSecond.promise)

    const firstRefresh = useRunsStore.getState().refresh()
    const secondRefresh = useRunsStore.getState().refresh()

    runsSecond.resolve({ runs: [makeRun("task-newer", 20), makeRun("task-older", 10)] })
    tasksSecond.resolve({ tasks: [makeTask("task-newer", 20), makeTask("task-older", 10)] })
    operationsSecond.resolve({ summary: makeOperationsSummary() })
    await secondRefresh

    runsFirst.resolve({ runs: [makeRun("task-older", 10)] })
    tasksFirst.resolve({ tasks: [makeTask("task-older", 10)] })
    operationsFirst.resolve({ summary: makeOperationsSummary() })
    await firstRefresh

    expect(useRunsStore.getState().runs.map((run) => run.id)).toEqual(["task-newer", "task-older"])
    expect(useRunsStore.getState().tasks.map((task) => task.id)).toEqual(["task-newer", "task-older"])
    expect(useRunsStore.getState().selectedRunId).toBe("task-newer")
  })

  it("removes the selected history item through the delete API and refreshes", async () => {
    mockApi.deleteRunHistory.mockResolvedValue({ ok: true, deletedRunCount: 1 })
    mockApi.runs.mockResolvedValue({ runs: [] })
    mockApi.tasks.mockResolvedValue({ tasks: [] })

    useRunsStore.setState({
      initialized: true,
      loading: false,
      lastError: "",
      runs: [makeRun("task-old", 10)],
      tasks: [makeTask("task-old", 10)],
      operationsSummary: makeOperationsSummary(),
      selectedRunId: "task-old",
    })

    await useRunsStore.getState().deleteRunHistory("task-old")

    expect(mockApi.deleteRunHistory).toHaveBeenCalledWith("task-old")
    expect(mockApi.runs).toHaveBeenCalled()
    expect(mockApi.tasks).toHaveBeenCalled()
    expect(mockApi.runOperationsSummary).toHaveBeenCalled()
  })

  it("clears historical history through the delete API and refreshes", async () => {
    mockApi.clearHistoricalRunHistory.mockResolvedValue({ ok: true, deletedRunCount: 3 })
    mockApi.runs.mockResolvedValue({ runs: [makeRun("task-active", 20)] })
    mockApi.tasks.mockResolvedValue({ tasks: [makeTask("task-active", 20)] })

    await useRunsStore.getState().clearHistoricalRunHistory()

    expect(mockApi.clearHistoricalRunHistory).toHaveBeenCalledTimes(1)
    expect(mockApi.runs).toHaveBeenCalled()
    expect(mockApi.tasks).toHaveBeenCalled()
  })

  it("cleans stale runs through the operations API and refreshes snapshots", async () => {
    mockApi.cleanupStaleRuns.mockResolvedValue({
      ok: true,
      cleanup: {
        cleanedRunCount: 1,
        skippedRunCount: 0,
        cleanedRunIds: ["task-stale"],
        skippedRunIds: [],
        thresholdMs: 1_800_000,
      },
      summary: makeOperationsSummary(),
    })
    mockApi.runs.mockResolvedValue({ runs: [] })
    mockApi.tasks.mockResolvedValue({ tasks: [] })

    await useRunsStore.getState().cleanupStaleRuns()

    expect(mockApi.cleanupStaleRuns).toHaveBeenCalledTimes(1)
    expect(mockApi.runs).toHaveBeenCalled()
    expect(mockApi.tasks).toHaveBeenCalled()
    expect(useRunsStore.getState().operationsSummary).toEqual(makeOperationsSummary())
  })
})
