import { describe, expect, it } from "vitest"
import { createPendingAssistantTracker } from "../packages/webui/src/stores/chat-delivery.ts"

describe("webui chat delivery helper", () => {
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
})
