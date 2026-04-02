import { describe, expect, it, vi } from "vitest"
import { createTelegramChunkDeliveryHandler } from "../packages/core/src/channels/telegram/chunk-delivery.ts"

describe("telegram chunk delivery helper", () => {
  it("buffers text and returns text delivery receipt on done", async () => {
    const responder = {
      sendToolStatus: vi.fn(),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn(),
      sendFinalResponse: vi.fn().mockResolvedValue([101, 102]),
      sendError: vi.fn(),
    }
    const recordOutgoingMessageRef = vi.fn()
    const onChunk = createTelegramChunkDeliveryHandler({
      responder,
      sessionId: "telegram-session",
      chatId: 42120565,
      getRunId: () => "run-1",
      recordOutgoingMessageRef,
      logError: vi.fn(),
    })

    await onChunk?.({ type: "text", delta: "안녕" })
    const receipt = await onChunk?.({ type: "done", totalTokens: 0 })

    expect(responder.sendFinalResponse).toHaveBeenCalledWith("안녕")
    expect(receipt).toEqual({
      textDeliveries: [{
        channel: "telegram",
        text: "안녕",
        messageIds: [101, 102],
      }],
    })
    expect(recordOutgoingMessageRef).toHaveBeenCalledTimes(2)
  })

  it("returns artifact delivery receipt for successful file delivery", async () => {
    const responder = {
      sendToolStatus: vi.fn(),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn().mockResolvedValue(303),
      sendFinalResponse: vi.fn(),
      sendError: vi.fn(),
    }
    const recordOutgoingMessageRef = vi.fn()
    const onChunk = createTelegramChunkDeliveryHandler({
      responder,
      sessionId: "telegram-session",
      chatId: 42120565,
      getRunId: () => "run-2",
      recordOutgoingMessageRef,
      logError: vi.fn(),
    })

    const receipt = await onChunk?.({
      type: "tool_end",
      toolName: "telegram_send_file",
      success: true,
      output: "sent",
      details: {
        kind: "artifact_delivery",
        channel: "telegram",
        filePath: "/tmp/result.png",
        caption: "caption",
        size: 123,
        source: "telegram",
      },
    })

    expect(responder.sendFile).toHaveBeenCalledWith("/tmp/result.png", "caption")
    expect(receipt).toEqual({
      artifactDeliveries: [{
        toolName: "telegram_send_file",
        channel: "telegram",
        filePath: "/tmp/result.png",
        caption: "caption",
        messageId: 303,
      }],
    })
    expect(recordOutgoingMessageRef).toHaveBeenCalledTimes(1)
  })

  it("sends tool status and error messages through the responder", async () => {
    const responder = {
      sendToolStatus: vi.fn().mockResolvedValue(404),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn(),
      sendFinalResponse: vi.fn(),
      sendError: vi.fn().mockResolvedValue(505),
    }
    const recordOutgoingMessageRef = vi.fn()
    const onChunk = createTelegramChunkDeliveryHandler({
      responder,
      sessionId: "telegram-session",
      chatId: 42120565,
      getRunId: () => "run-3",
      recordOutgoingMessageRef,
      logError: vi.fn(),
    })

    await onChunk?.({
      type: "tool_start",
      toolName: "screen_capture",
      params: {},
    })
    await onChunk?.({
      type: "error",
      message: "failure",
    })

    expect(responder.sendToolStatus).toHaveBeenCalledWith("screen_capture")
    expect(responder.sendError).toHaveBeenCalledWith("failure")
    expect(recordOutgoingMessageRef).toHaveBeenCalledTimes(2)
  })

  it("delivers artifact first and final text after done in order", async () => {
    const order: string[] = []
    const responder = {
      sendToolStatus: vi.fn(),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn().mockImplementation(async () => {
        order.push("file")
        return 606
      }),
      sendFinalResponse: vi.fn().mockImplementation(async () => {
        order.push("text")
        return [707]
      }),
      sendError: vi.fn(),
    }
    const onChunk = createTelegramChunkDeliveryHandler({
      responder,
      sessionId: "telegram-session",
      chatId: 42120565,
      getRunId: () => "run-4",
      recordOutgoingMessageRef: vi.fn(),
      logError: vi.fn(),
    })

    await onChunk?.({ type: "text", delta: "결과를 보냈습니다." })
    await onChunk?.({
      type: "tool_end",
      toolName: "telegram_send_file",
      success: true,
      output: "sent",
      details: {
        kind: "artifact_delivery",
        channel: "telegram",
        filePath: "/tmp/result.png",
        size: 123,
        source: "telegram",
      },
    })
    await onChunk?.({ type: "done", totalTokens: 0 })

    expect(order).toEqual(["file", "text"])
  })
})
