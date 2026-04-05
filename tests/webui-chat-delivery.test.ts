import { beforeEach, describe, expect, it } from "vitest"
import { createPendingAssistantTracker } from "../packages/webui/src/stores/chat-delivery.ts"
import { handleWsMessage, useChatStore } from "../packages/webui/src/stores/chat.ts"
import { useRunsStore } from "../packages/webui/src/stores/runs.ts"

function resetChatState() {
  useChatStore.getState().clearMessages()
  useChatStore.setState({
    sessionId: null,
    messages: [],
    running: false,
    connected: false,
    pendingApproval: null,
    inputError: "",
  })
}

function resetRunsState() {
  useRunsStore.setState({
    initialized: false,
    loading: false,
    lastError: "",
    runs: [],
    tasks: [],
    selectedRunId: null,
  })
}

describe("webui chat delivery helper", () => {
  beforeEach(() => {
    resetChatState()
    resetRunsState()
  })

  it("buffers assistant text and flushes a completed assistant message", () => {
    const tracker = createPendingAssistantTracker()

    tracker.start("run-1", "session-1")
    tracker.appendDelta("run-1", "안녕")

    expect(tracker.flush("run-1")).toEqual({
      runId: "run-1",
      content: "안녕",
    })
  })

  it("tracks tool calls alongside buffered text", () => {
    const tracker = createPendingAssistantTracker()

    tracker.start("run-2", "session-2")
    tracker.appendDelta("run-2", "완료")
    tracker.addToolCall("run-2", { name: "screen_capture", params: { full: true } })
    tracker.updateToolCall("run-2", "screen_capture", "ok", true)

    expect(tracker.flush("run-2")).toEqual({
      runId: "run-2",
      content: "완료",
      toolCalls: [{
        name: "screen_capture",
        params: { full: true },
        result: "ok",
        success: true,
      }],
    })
  })

  it("returns null for empty buffered runs and clears state", () => {
    const tracker = createPendingAssistantTracker()

    tracker.start("run-3", "session-3")
    expect(tracker.flush("run-3")).toBeNull()

    tracker.start("run-4", "session-4")
    tracker.appendDelta("run-4", "남음")
    tracker.clear()
    expect(tracker.flush("run-4")).toBeNull()
  })

  it("flushes artifact-only assistant messages", () => {
    const tracker = createPendingAssistantTracker()

    tracker.start("run-5", "session-5")
    tracker.addArtifact("run-5", {
      url: "/api/artifacts/screens/result.png",
      fileName: "result.png",
      mimeType: "image/png",
      caption: "메인 화면",
    })

    expect(tracker.flush("run-5")).toEqual({
      runId: "run-5",
      content: "",
      artifacts: [{
        url: "/api/artifacts/screens/result.png",
        fileName: "result.png",
        mimeType: "image/png",
        caption: "메인 화면",
      }],
    })
  })

  it("shows artifact messages immediately when agent.artifact arrives", () => {
    useChatStore.setState({ sessionId: "session-1" })

    handleWsMessage({ type: "agent.start", sessionId: "session-1", runId: "run-10" })
    handleWsMessage({
      type: "agent.artifact",
      sessionId: "session-1",
      runId: "run-10",
      url: "/api/artifacts/screens/result.png",
      fileName: "result.png",
      mimeType: "image/png",
      caption: "메인 화면",
    })

    expect(useChatStore.getState().messages).toHaveLength(1)
    expect(useChatStore.getState().messages[0]).toMatchObject({
      runId: "run-10",
      role: "assistant",
      content: "",
      artifacts: [{
        url: "/api/artifacts/screens/result.png",
        fileName: "result.png",
        mimeType: "image/png",
        caption: "메인 화면",
      }],
    })

    handleWsMessage({ type: "agent.end", sessionId: "session-1", runId: "run-10", durationMs: 100 })
    expect(useChatStore.getState().messages).toHaveLength(1)
  })

  it("still shows artifacts when run.completed arrives before agent.end", () => {
    useChatStore.setState({ sessionId: "session-1" })

    handleWsMessage({ type: "agent.start", sessionId: "session-1", runId: "run-11" })
    handleWsMessage({
      type: "run.completed",
      run: {
        id: "run-11",
        sessionId: "session-1",
        requestGroupId: "run-11",
        title: "캡처",
        prompt: "캡처",
        source: "webui",
        status: "completed",
        taskProfile: "general_chat",
        contextMode: "full",
        delegationTurnCount: 0,
        maxDelegationTurns: 5,
        currentStepKey: "completed",
        currentStepIndex: 9,
        totalSteps: 9,
        summary: "완료",
        canCancel: false,
        createdAt: 1,
        updatedAt: 2,
        steps: [],
        recentEvents: [],
      },
    })
    handleWsMessage({
      type: "agent.artifact",
      sessionId: "session-1",
      runId: "run-11",
      url: "/api/artifacts/captures/camera.png",
      fileName: "camera.png",
      mimeType: "image/png",
      caption: "카메라 사진",
    })

    expect(useChatStore.getState().messages).toHaveLength(1)
    expect(useChatStore.getState().messages[0]?.artifacts?.[0]).toMatchObject({
      url: "/api/artifacts/captures/camera.png",
      fileName: "camera.png",
      mimeType: "image/png",
      caption: "카메라 사진",
    })

    handleWsMessage({ type: "agent.end", sessionId: "session-1", runId: "run-11", durationMs: 100 })
    expect(useChatStore.getState().messages).toHaveLength(1)
  })
})
