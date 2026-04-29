import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createSlackChunkDeliveryHandler } from "../packages/core/src/channels/slack/chunk-delivery.ts"
import { SlackRateLimitError } from "../packages/core/src/channels/slack/message-delivery.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb } from "../packages/core/src/db/index.js"
import { resetArtifactDeliveryDedupeForTest } from "../packages/core/src/runs/delivery.js"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-slack-chunk-"))
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
    expect(receipt).toMatchObject({
      textDeliveries: [{
        channel: "slack",
        text: "안녕 슬랙",
        messageIds: ["slack-msg-1", "slack-msg-2"],
        deliveryReceipts: [
          expect.objectContaining({
            provider: "slack",
            status: "sent",
            messageId: "slack-msg-1",
            idempotencyKey: "slack:final:run-slack-1:C_SLACK:thread-1:part:1",
          }),
          expect.objectContaining({
            provider: "slack",
            status: "sent",
            messageId: "slack-msg-2",
            idempotencyKey: "slack:final:run-slack-1:C_SLACK:thread-1:part:2",
          }),
        ],
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
    expect(receipt).toMatchObject({
      artifactDeliveries: [{
        toolName: "screen_capture",
        channel: "slack",
        filePath: "/tmp/result.png",
        caption: "메인 화면",
        messageId: "slack-file-ts",
        deliveryReceipts: [
          expect.objectContaining({
            provider: "slack",
            status: "sent",
            messageId: "slack-file-ts",
            idempotencyKey: "slack:file:run-slack-2:/tmp/result.png",
          }),
        ],
      }],
    })
    expect(recordOutgoingMessageRef).toHaveBeenCalledTimes(1)
  })

  it("does not send the same artifact twice for one Slack run", async () => {
    const responder = {
      sendToolStatus: vi.fn(),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn().mockResolvedValueOnce("slack-file-ts-1").mockResolvedValueOnce("slack-file-ts-2"),
      sendFinalResponse: vi.fn(),
      sendError: vi.fn(),
    }
    const recordOutgoingMessageRef = vi.fn()
    const onChunk = createSlackChunkDeliveryHandler({
      responder,
      sessionId: "slack-session",
      channelId: "C_SLACK",
      threadTs: "thread-duplicate",
      getRunId: () => "run-slack-duplicate-artifact",
      recordOutgoingMessageRef,
      logError: vi.fn(),
    })
    const chunk = {
      type: "tool_end" as const,
      toolName: "screen_capture",
      success: true,
      output: "sent",
      details: {
        kind: "artifact_delivery" as const,
        channel: "slack" as const,
        filePath: "/tmp/slack-duplicate-result.png",
        caption: "메인 화면",
        size: 123,
        source: "slack",
      },
    }

    const firstReceipt = await onChunk?.(chunk)
    const secondReceipt = await onChunk?.(chunk)

    expect(responder.sendFile).toHaveBeenCalledTimes(1)
    expect(responder.sendFile).toHaveBeenCalledWith("/tmp/slack-duplicate-result.png", "메인 화면")
    expect(firstReceipt).toMatchObject({
      artifactDeliveries: [{
        toolName: "screen_capture",
        channel: "slack",
        filePath: "/tmp/slack-duplicate-result.png",
        caption: "메인 화면",
        messageId: "slack-file-ts-1",
        deliveryReceipts: [
          expect.objectContaining({
            provider: "slack",
            status: "sent",
            messageId: "slack-file-ts-1",
            idempotencyKey: "slack:file:run-slack-duplicate-artifact:/tmp/slack-duplicate-result.png",
          }),
        ],
      }],
    })
    expect(secondReceipt).toBeUndefined()
    expect(recordOutgoingMessageRef).toHaveBeenCalledTimes(1)
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
    const onChunk = createSlackChunkDeliveryHandler({
      responder,
      sessionId: "slack-session",
      channelId: "C_SLACK",
      threadTs: "thread-shell-success",
      getRunId: () => "run-slack-shell-success",
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
      sendToolStatus: vi.fn().mockResolvedValue("tool-ts"),
      updateToolStatus: vi.fn(),
      clearToolStatus: vi.fn(),
      sendFile: vi.fn(),
      sendFinalResponse: vi.fn(),
      sendError: vi.fn(),
    }
    const onChunk = createSlackChunkDeliveryHandler({
      responder,
      sessionId: "slack-session",
      channelId: "C_SLACK",
      threadTs: "thread-tool-success",
      getRunId: () => "run-slack-tool-success",
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
    expect(responder.clearToolStatus).toHaveBeenCalledWith("tool-ts")
    expect(responder.updateToolStatus).not.toHaveBeenCalled()
  })

  it("keeps failed shell_exec status visible", async () => {
    const responder = {
      sendToolStatus: vi.fn().mockResolvedValue("failed-tool-ts"),
      updateToolStatus: vi.fn(),
      clearToolStatus: vi.fn(),
      sendFile: vi.fn(),
      sendFinalResponse: vi.fn(),
      sendError: vi.fn(),
    }
    const recordOutgoingMessageRef = vi.fn()
    const onChunk = createSlackChunkDeliveryHandler({
      responder,
      sessionId: "slack-session",
      channelId: "C_SLACK",
      threadTs: "thread-shell-failure",
      getRunId: () => "run-slack-shell-failure",
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
    expect(responder.updateToolStatus).toHaveBeenCalledWith("failed-tool-ts", "shell_exec", false)
    expect(responder.clearToolStatus).not.toHaveBeenCalled()
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
    expect(receipt).toMatchObject({
      textDeliveries: [{
        channel: "slack",
        text: "연장 \"yeonjang-main\" 카메라 1개:\n- FaceTime HD Camera · 사용 가능 (default)",
        messageIds: ["slack-final-ts"],
        deliveryReceipts: [
          expect.objectContaining({
            provider: "slack",
            status: "sent",
            messageId: "slack-final-ts",
            idempotencyKey: "slack:final:run-slack-4:C_SLACK:thread-4:part:1",
          }),
        ],
      }],
    })
  })

  it("records Slack rate-limited final text delivery without failing the run chunk", async () => {
    const logError = vi.fn()
    const responder = {
      sendToolStatus: vi.fn(),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn(),
      sendFinalResponse: vi.fn().mockRejectedValue(new SlackRateLimitError({
        retryAfterMs: 2_500,
        method: "chat.postMessage",
      })),
      sendError: vi.fn(),
    }
    const onChunk = createSlackChunkDeliveryHandler({
      responder,
      sessionId: "slack-session",
      channelId: "C_SLACK",
      threadTs: "thread-rate-limited",
      getRunId: () => "run-slack-rate-limited",
      recordOutgoingMessageRef: vi.fn(),
      logError,
    })

    await onChunk?.({ type: "text", delta: "레이트 리밋 응답" })
    const receipt = await onChunk?.({ type: "done", totalTokens: 0 })

    expect(receipt).toBeUndefined()
    expect(logError).toHaveBeenCalledWith("Failed to send Slack text delivery: Slack API rate limit exceeded.")
  })

  it("falls back to Slack thread artifact link when file upload fails", async () => {
    const responder = {
      sendToolStatus: vi.fn(),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn().mockRejectedValue(new Error("upload failed")),
      sendFinalResponse: vi.fn().mockResolvedValue(["slack-fallback-ts"]),
      sendError: vi.fn(),
    }
    const onChunk = createSlackChunkDeliveryHandler({
      responder,
      sessionId: "slack-session",
      channelId: "C_SLACK",
      threadTs: "thread-artifact-fallback",
      getRunId: () => "run-slack-artifact-fallback",
      recordOutgoingMessageRef: vi.fn(),
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
        filePath: "/tmp/fallback-result.png",
        caption: "캡처 결과",
        size: 123,
        source: "slack",
      },
    })

    expect(responder.sendFile).toHaveBeenCalledWith("/tmp/fallback-result.png", "캡처 결과")
    expect(responder.sendFinalResponse).toHaveBeenCalledTimes(1)
    expect(responder.sendFinalResponse.mock.calls[0]?.[0]).toContain("캡처 결과")
    expect(receipt).toMatchObject({
      textDeliveries: [{
        channel: "slack",
        messageIds: ["slack-fallback-ts"],
        deliveryReceipts: [
          expect.objectContaining({
            provider: "slack",
            status: "sent",
            messageId: "slack-fallback-ts",
            idempotencyKey: "slack:artifact-fallback:run-slack-artifact-fallback:C_SLACK:thread-artifact-fallback:part:1",
          }),
        ],
      }],
    })
  })
})
