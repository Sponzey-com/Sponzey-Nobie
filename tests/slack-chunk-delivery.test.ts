import { describe, expect, it, vi } from "vitest"
import { createSlackChunkDeliveryHandler } from "../packages/core/src/channels/slack/chunk-delivery.ts"

describe("slack chunk delivery helper", () => {
  it("buffers assistant text and returns text delivery receipt on done", async () => {
    const responder = {
      sendToolStatus: vi.fn(),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn(),
      sendFinalResponse: vi.fn().mockResolvedValue(["slack-msg-1", "slack-msg-2"]),
      sendError: vi.fn(),
    }
    const recordOutgoingMessageRef = vi.fn()
    const onChunk = createSlackChunkDeliveryHandler({
      responder,
      sessionId: "slack-session",
      channelId: "C_SLACK",
      threadTs: "thread-1",
      getRunId: () => "run-slack-1",
      recordOutgoingMessageRef,
      logError: vi.fn(),
    })

    await onChunk?.({ type: "text", delta: "안녕 슬랙" })
    const receipt = await onChunk?.({ type: "done", totalTokens: 0 })

    expect(responder.sendFinalResponse).toHaveBeenCalledWith("안녕 슬랙")
    expect(receipt).toEqual({
      textDeliveries: [{
        channel: "slack",
        text: "안녕 슬랙",
      }],
    })
    expect(recordOutgoingMessageRef).toHaveBeenCalledTimes(2)
  })

  it("returns artifact delivery receipt for successful Slack file delivery", async () => {
    const responder = {
      sendToolStatus: vi.fn(),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn().mockResolvedValue("slack-file-ts"),
      sendFinalResponse: vi.fn(),
      sendError: vi.fn(),
    }
    const recordOutgoingMessageRef = vi.fn()
    const onChunk = createSlackChunkDeliveryHandler({
      responder,
      sessionId: "slack-session",
      channelId: "C_SLACK",
      threadTs: "thread-2",
      getRunId: () => "run-slack-2",
      recordOutgoingMessageRef,
      logError: vi.fn(),
    })

    const receipt = await onChunk?.({
      type: "tool_end",
      toolName: "screen_capture",
      success: true,
      output: "sent",
      details: {
        kind: "artifact_delivery",
        channel: "slack",
        filePath: "/tmp/result.png",
        caption: "메인 화면",
        size: 123,
        source: "slack",
      },
    })

    expect(responder.sendFile).toHaveBeenCalledWith("/tmp/result.png", "메인 화면")
    expect(receipt).toEqual({
      artifactDeliveries: [{
        toolName: "screen_capture",
        channel: "slack",
        filePath: "/tmp/result.png",
        caption: "메인 화면",
      }],
    })
    expect(recordOutgoingMessageRef).toHaveBeenCalledTimes(1)
  })

  it("suppresses later AI text after artifact delivery succeeds", async () => {
    const order: string[] = []
    const responder = {
      sendToolStatus: vi.fn(),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn().mockImplementation(async () => {
        order.push("file")
        return "slack-file-ts"
      }),
      sendFinalResponse: vi.fn().mockImplementation(async () => {
        order.push("text")
        return ["slack-final-ts"]
      }),
      sendError: vi.fn(),
    }
    const onChunk = createSlackChunkDeliveryHandler({
      responder,
      sessionId: "slack-session",
      channelId: "C_SLACK",
      threadTs: "thread-3",
      getRunId: () => "run-slack-3",
      recordOutgoingMessageRef: vi.fn(),
      logError: vi.fn(),
    })

    await onChunk?.({ type: "text", delta: "사전 안내문" })
    await onChunk?.({
      type: "tool_end",
      toolName: "screen_capture",
      success: true,
      output: "sent",
      details: {
        kind: "artifact_delivery",
        channel: "slack",
        filePath: "/tmp/result.png",
        size: 456,
        source: "slack",
      },
    })
    await onChunk?.({ type: "text", delta: "나중 AI 요약문" })
    await onChunk?.({ type: "done", totalTokens: 0 })

    expect(order).toEqual(["file"])
    expect(responder.sendFinalResponse).not.toHaveBeenCalled()
  })

  it("uses isolated Yeonjang text output as the only final response", async () => {
    const responder = {
      sendToolStatus: vi.fn().mockResolvedValue("tool-ts"),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn(),
      sendFinalResponse: vi.fn().mockResolvedValue(["slack-final-ts"]),
      sendError: vi.fn(),
    }
    const onChunk = createSlackChunkDeliveryHandler({
      responder,
      sessionId: "slack-session",
      channelId: "C_SLACK",
      threadTs: "thread-4",
      getRunId: () => "run-slack-4",
      recordOutgoingMessageRef: vi.fn(),
      logError: vi.fn(),
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
    await onChunk?.({ type: "text", delta: "나중 AI 요약문" })
    await onChunk?.({ type: "error", message: "late failure" })
    const receipt = await onChunk?.({ type: "done", totalTokens: 0 })

    expect(responder.sendError).not.toHaveBeenCalled()
    expect(responder.sendFinalResponse).toHaveBeenCalledWith(
      "연장 \"yeonjang-main\" 카메라 1개:\n- FaceTime HD Camera · 사용 가능 (default)",
    )
    expect(receipt).toEqual({
      textDeliveries: [{
        channel: "slack",
        text: "연장 \"yeonjang-main\" 카메라 1개:\n- FaceTime HD Camera · 사용 가능 (default)",
      }],
    })
  })
})
