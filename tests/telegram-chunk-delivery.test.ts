import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createTelegramChunkDeliveryHandler } from "../packages/core/src/channels/telegram/chunk-delivery.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb } from "../packages/core/src/db/index.js"
import { resetArtifactDeliveryDedupeForTest } from "../packages/core/src/runs/delivery.js"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-telegram-chunk-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  reloadConfig()
}

beforeEach(() => {
  useTempState()
})

afterEach(() => {
  resetArtifactDeliveryDedupeForTest()
  closeDb()
  if (previousStateDir === undefined) delete process.env["NOBIE_STATE_DIR"]
  else process.env["NOBIE_STATE_DIR"] = previousStateDir
  if (previousConfig === undefined) delete process.env["NOBIE_CONFIG"]
  else process.env["NOBIE_CONFIG"] = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
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
    expect(receipt).toMatchObject({
      textDeliveries: [{
        channel: "telegram",
        text: "안녕",
        messageIds: [101, 102],
        deliveryReceipts: [
          expect.objectContaining({
            status: "sent",
            messageId: "101",
            idempotencyKey: "telegram:final:run-1:42120565:main:part:1",
          }),
          expect.objectContaining({
            status: "sent",
            messageId: "102",
            idempotencyKey: "telegram:final:run-1:42120565:main:part:2",
          }),
        ],
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
    expect(receipt).toMatchObject({
      artifactDeliveries: [{
        toolName: "telegram_send_file",
        channel: "telegram",
        filePath: "/tmp/result.png",
        caption: "caption",
        messageId: 303,
        deliveryReceipts: [
          expect.objectContaining({
            status: "sent",
            messageId: "303",
            idempotencyKey: "telegram:file:run-2:/tmp/result.png",
          }),
        ],
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
    expect(firstReceipt).toMatchObject({
      artifactDeliveries: [{
        toolName: "telegram_send_file",
        channel: "telegram",
        filePath: "/tmp/duplicate-result.png",
        caption: "caption",
        messageId: 303,
        deliveryReceipts: [
          expect.objectContaining({
            status: "sent",
            messageId: "303",
            idempotencyKey: "telegram:file:run-duplicate-artifact:/tmp/duplicate-result.png",
          }),
        ],
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
    expect(receipt).toMatchObject({
      textDeliveries: [{
        channel: "telegram",
        text: "연장 \"yeonjang-main\" 카메라 1개:\n- FaceTime HD Camera · 사용 가능 (default)",
        messageIds: [1002],
        deliveryReceipts: [
          expect.objectContaining({
            status: "sent",
            messageId: "1002",
            idempotencyKey: "telegram:final:run-6:42120565:main:part:1",
          }),
        ],
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

  it("falls back to a compact diagnostic message when final text would create too many chunks", async () => {
    const responder = {
      sendToolStatus: vi.fn(),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn(),
      sendFinalResponse: vi.fn().mockResolvedValue([1201]),
      sendError: vi.fn(),
    }
    const recordOutgoingMessageRef = vi.fn()
    const onChunk = createTelegramChunkDeliveryHandler({
      responder,
      sessionId: "telegram-session",
      chatId: 42120565,
      getRunId: () => "run-too-many-chunks",
      maxTextChunks: 1,
      recordOutgoingMessageRef,
      logError: vi.fn(),
    })
    const longText = "a".repeat(4100)

    await onChunk?.({ type: "text", delta: longText })
    const receipt = await onChunk?.({ type: "done", totalTokens: 0 })

    expect(responder.sendFinalResponse).toHaveBeenCalledTimes(1)
    const deliveredText = responder.sendFinalResponse.mock.calls[0]?.[0]
    expect(deliveredText).toContain("결과가 너무 길어")
    expect(deliveredText).not.toBe(longText)
    expect(receipt).toMatchObject({
      textDeliveries: [{
        channel: "telegram",
        text: deliveredText,
        messageIds: [1201],
        deliveryKind: "diagnostic",
        deliveryReceipts: [
          expect.objectContaining({
            status: "sent",
            messageId: "1201",
            idempotencyKey: "telegram:final:run-too-many-chunks:42120565:main:part:1",
          }),
        ],
      }],
    })
    expect(recordOutgoingMessageRef).toHaveBeenCalledTimes(1)
  })

  it("records text delivery failures without failing the execution chunk", async () => {
    const logError = vi.fn()
    const responder = {
      sendToolStatus: vi.fn(),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn(),
      sendFinalResponse: vi.fn().mockRejectedValue(new Error("telegram unavailable")),
      sendError: vi.fn(),
    }
    const onChunk = createTelegramChunkDeliveryHandler({
      responder,
      sessionId: "telegram-session",
      chatId: 42120565,
      getRunId: () => "run-delivery-failure",
      recordOutgoingMessageRef: vi.fn(),
      logError,
    })

    await onChunk?.({ type: "text", delta: "final answer" })
    const receipt = await onChunk?.({ type: "done", totalTokens: 0 })

    expect(receipt).toBeUndefined()
    expect(responder.sendFinalResponse).toHaveBeenCalledWith("final answer")
    expect(logError).toHaveBeenCalledWith("Failed to send Telegram text delivery: telegram unavailable")
  })
})
