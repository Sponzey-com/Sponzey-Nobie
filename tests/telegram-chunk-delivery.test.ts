import { afterEach, describe, expect, it, vi } from "vitest"
import { createTelegramChunkDeliveryHandler } from "../packages/core/src/channels/telegram/chunk-delivery.ts"
import { resetArtifactDeliveryDedupeForTest } from "../packages/core/src/runs/delivery.js"

afterEach(() => {
  resetArtifactDeliveryDedupeForTest()
})

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

  it("does not send the same artifact twice for one run", async () => {
    const responder = {
      sendToolStatus: vi.fn(),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn().mockResolvedValueOnce(303).mockResolvedValueOnce(404),
      sendFinalResponse: vi.fn(),
      sendError: vi.fn(),
    }
    const recordOutgoingMessageRef = vi.fn()
    const onChunk = createTelegramChunkDeliveryHandler({
      responder,
      sessionId: "telegram-session",
      chatId: 42120565,
      getRunId: () => "run-duplicate-artifact",
      recordOutgoingMessageRef,
      logError: vi.fn(),
    })
    const chunk = {
      type: "tool_end" as const,
      toolName: "telegram_send_file",
      success: true,
      output: "sent",
      details: {
        kind: "artifact_delivery" as const,
        channel: "telegram" as const,
        filePath: "/tmp/duplicate-result.png",
        caption: "caption",
        size: 123,
        source: "telegram",
      },
    }

    const firstReceipt = await onChunk?.(chunk)
    const secondReceipt = await onChunk?.(chunk)

    expect(responder.sendFile).toHaveBeenCalledTimes(1)
    expect(responder.sendFile).toHaveBeenCalledWith("/tmp/duplicate-result.png", "caption")
    expect(firstReceipt).toEqual({
      artifactDeliveries: [{
        toolName: "telegram_send_file",
        channel: "telegram",
        filePath: "/tmp/duplicate-result.png",
        caption: "caption",
        messageId: 303,
      }],
    })
    expect(secondReceipt).toBeUndefined()
    expect(recordOutgoingMessageRef).toHaveBeenCalledTimes(1)
  })

  it("sends tool status and error messages through the responder", async () => {
    const responder = {
      sendToolStatus: vi.fn().mockResolvedValue(404),
      updateToolStatus: vi.fn(),
      clearToolStatus: vi.fn(),
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

  it("does not create successful shell_exec status messages", async () => {
    const responder = {
      sendToolStatus: vi.fn(),
      updateToolStatus: vi.fn(),
      clearToolStatus: vi.fn(),
      sendFile: vi.fn(),
      sendFinalResponse: vi.fn(),
      sendError: vi.fn(),
    }
    const onChunk = createTelegramChunkDeliveryHandler({
      responder,
      sessionId: "telegram-session",
      chatId: 42120565,
      getRunId: () => "run-shell-success",
      recordOutgoingMessageRef: vi.fn(),
      logError: vi.fn(),
    })

    await onChunk?.({
      type: "tool_start",
      toolName: "shell_exec",
      params: { command: "pwd" },
    })
    await onChunk?.({
      type: "tool_end",
      toolName: "shell_exec",
      success: true,
      output: "ok",
    })

    expect(responder.sendToolStatus).not.toHaveBeenCalled()
    expect(responder.updateToolStatus).not.toHaveBeenCalled()
    expect(responder.clearToolStatus).not.toHaveBeenCalled()
  })

  it("clears successful non-shell tool status messages instead of leaving done messages", async () => {
    const responder = {
      sendToolStatus: vi.fn().mockResolvedValue(606),
      updateToolStatus: vi.fn(),
      clearToolStatus: vi.fn(),
      sendFile: vi.fn(),
      sendFinalResponse: vi.fn(),
      sendError: vi.fn(),
    }
    const onChunk = createTelegramChunkDeliveryHandler({
      responder,
      sessionId: "telegram-session",
      chatId: 42120565,
      getRunId: () => "run-tool-success",
      recordOutgoingMessageRef: vi.fn(),
      logError: vi.fn(),
    })

    await onChunk?.({
      type: "tool_start",
      toolName: "screen_capture",
      params: {},
    })
    await onChunk?.({
      type: "tool_end",
      toolName: "screen_capture",
      success: true,
      output: "captured",
    })

    expect(responder.sendToolStatus).toHaveBeenCalledWith("screen_capture")
    expect(responder.clearToolStatus).toHaveBeenCalledWith(606)
    expect(responder.updateToolStatus).not.toHaveBeenCalled()
  })

  it("keeps failed shell_exec status visible", async () => {
    const responder = {
      sendToolStatus: vi.fn().mockResolvedValue(707),
      updateToolStatus: vi.fn(),
      clearToolStatus: vi.fn(),
      sendFile: vi.fn(),
      sendFinalResponse: vi.fn(),
      sendError: vi.fn(),
    }
    const recordOutgoingMessageRef = vi.fn()
    const onChunk = createTelegramChunkDeliveryHandler({
      responder,
      sessionId: "telegram-session",
      chatId: 42120565,
      getRunId: () => "run-shell-failure",
      recordOutgoingMessageRef,
      logError: vi.fn(),
    })

    await onChunk?.({
      type: "tool_start",
      toolName: "shell_exec",
      params: { command: "missing" },
    })
    await onChunk?.({
      type: "tool_end",
      toolName: "shell_exec",
      success: false,
      output: "command not found",
    })

    expect(responder.sendToolStatus).toHaveBeenCalledWith("shell_exec")
    expect(responder.updateToolStatus).toHaveBeenCalledWith(707, "shell_exec", false)
    expect(responder.clearToolStatus).not.toHaveBeenCalled()
    expect(recordOutgoingMessageRef).toHaveBeenCalledTimes(1)
  })

  it("delivers artifact first and suppresses later AI text for tool-owned responses", async () => {
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

    await onChunk?.({ type: "text", delta: "이 텍스트는 artifact 전달 시 버려집니다." })
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
    await onChunk?.({ type: "text", delta: "파일 전달이 완료되었습니다." })
    await onChunk?.({ type: "done", totalTokens: 0 })

    expect(order).toEqual(["file"])
    expect(responder.sendFinalResponse).not.toHaveBeenCalled()
  })

  it("clears buffered preamble text after artifact delivery succeeds", async () => {
    const responder = {
      sendToolStatus: vi.fn(),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn().mockResolvedValue(808),
      sendFinalResponse: vi.fn().mockResolvedValue([909]),
      sendError: vi.fn(),
    }
    const onChunk = createTelegramChunkDeliveryHandler({
      responder,
      sessionId: "telegram-session",
      chatId: 42120565,
      getRunId: () => "run-5",
      recordOutgoingMessageRef: vi.fn(),
      logError: vi.fn(),
    })

    await onChunk?.({ type: "text", delta: "The request to capture the main all screen has been received." })
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
    const receipt = await onChunk?.({ type: "done", totalTokens: 0 })

    expect(responder.sendFile).toHaveBeenCalledTimes(1)
    expect(responder.sendFinalResponse).not.toHaveBeenCalled()
    expect(receipt).toBeUndefined()
  })

  it("uses isolated Yeonjang tool output as the only final response", async () => {
    const responder = {
      sendToolStatus: vi.fn().mockResolvedValue(1001),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn(),
      sendFinalResponse: vi.fn().mockResolvedValue([1002]),
      sendError: vi.fn(),
    }
    const onChunk = createTelegramChunkDeliveryHandler({
      responder,
      sessionId: "telegram-session",
      chatId: 42120565,
      getRunId: () => "run-6",
      recordOutgoingMessageRef: vi.fn(),
      logError: vi.fn(),
    })

    await onChunk?.({ type: "text", delta: "먼저 들어온 AI 안내문" })
    await onChunk?.({
      type: "tool_start",
      toolName: "yeonjang_camera_list",
      params: {},
    })
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

    expect(responder.sendError).not.toHaveBeenCalled()
    expect(responder.sendFinalResponse).toHaveBeenCalledWith(
      "연장 \"yeonjang-main\" 카메라 1개:\n- FaceTime HD Camera · 사용 가능 (default)",
    )
    expect(receipt).toEqual({
      textDeliveries: [{
        channel: "telegram",
        text: "연장 \"yeonjang-main\" 카메라 1개:\n- FaceTime HD Camera · 사용 가능 (default)",
        messageIds: [1002],
      }],
    })
  })

  it("uses explicit final-text ownership for Yeonjang-backed action output", async () => {
    const responder = {
      sendToolStatus: vi.fn().mockResolvedValue(1101),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn(),
      sendFinalResponse: vi.fn().mockResolvedValue([1102]),
      sendError: vi.fn(),
    }
    const onChunk = createTelegramChunkDeliveryHandler({
      responder,
      sessionId: "telegram-session",
      chatId: 42120565,
      getRunId: () => "run-7",
      recordOutgoingMessageRef: vi.fn(),
      logError: vi.fn(),
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
    await onChunk?.({ type: "done", totalTokens: 0 })

    expect(responder.sendFinalResponse).toHaveBeenCalledWith("(120, 240) 클릭 완료")
    expect(responder.sendError).not.toHaveBeenCalled()
  })
})
