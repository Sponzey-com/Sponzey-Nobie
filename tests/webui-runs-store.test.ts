import { beforeEach, describe, expect, it, vi } from "vitest"

const { mockApi, mockSetDisconnected } = vi.hoisted(() => ({
  mockApi: {
    runs: vi.fn(),
    tasks: vi.fn(),
    createRun: vi.fn(),
    cancelRun: vi.fn(),
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

describe("webui runs store", () => {
  beforeEach(() => {
    useRunsStore.setState({
      initialized: false,
      loading: false,
      lastError: "",
      runs: [],
      tasks: [],
      selectedRunId: null,
    })
    mockApi.runs.mockReset()
    mockApi.tasks.mockReset()
    mockApi.createRun.mockReset()
    mockApi.cancelRun.mockReset()
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
})
