import { describe, expect, it } from "vitest"
import { createWebUiChunkDeliveryHandler } from "../packages/core/src/api/ws/chunk-delivery.ts"

describe("webui chunk delivery helper", () => {
  it("uses isolated Yeonjang tool output instead of buffered AI text", async () => {
    const onChunk = createWebUiChunkDeliveryHandler({
      sessionId: "session-1",
      runId: "run-1",
    })

    await onChunk?.({ type: "text", delta: "먼저 들어온 AI 안내문" })
    await onChunk?.({
      type: "tool_end",
      toolName: "yeonjang_camera_list",
      success: true,
      output: "연장 \"yeonjang-main\" 카메라 1개:\n- FaceTime HD Camera · 사용 가능 (default)",
      details: {
        via: "yeonjang",
        responseOwnership: "final_text",
      },
    })
    await onChunk?.({ type: "text", delta: "나중에 생성된 AI 요약문" })
    await onChunk?.({ type: "error", message: "late failure" })
    const receipt = await onChunk?.({ type: "done", totalTokens: 0 })

    expect(receipt).toEqual({
      textDeliveries: [{
        channel: "webui",
        text: "연장 \"yeonjang-main\" 카메라 1개:\n- FaceTime HD Camera · 사용 가능 (default)",
      }],
    })
  })

  it("uses explicit final-text ownership for Yeonjang-backed action output", async () => {
    const onChunk = createWebUiChunkDeliveryHandler({
      sessionId: "session-2",
      runId: "run-2",
    })

    await onChunk?.({ type: "text", delta: "AI가 먼저 만든 안내문" })
    await onChunk?.({
      type: "tool_end",
      toolName: "mouse_click",
      success: true,
      output: "(120, 240) 클릭 완료",
      details: {
        via: "yeonjang",
        responseOwnership: "final_text",
        x: 120,
        y: 240,
        button: "left",
      },
    })
    await onChunk?.({ type: "text", delta: "나중에 생성된 AI 설명" })
    const receipt = await onChunk?.({ type: "done", totalTokens: 0 })

    expect(receipt).toEqual({
      textDeliveries: [{
        channel: "webui",
        text: "(120, 240) 클릭 완료",
      }],
    })
  })
})
