import { describe, expect, it, vi } from "vitest"
import {
  applyChunkDeliveryReceipt,
  buildSuccessfulDeliverySummary,
  deliverChunk,
  deliverTrackedChunk,
  displayHomePath,
  emitAssistantTextDelivery,
  resolveAssistantTextDeliveryOutcome,
  resolveDeliveryOutcome,
  type SuccessfulFileDelivery,
  type SuccessfulTextDelivery,
} from "../packages/core/src/runs/delivery.ts"

describe("runs delivery helpers", () => {
  it("summarizes the most recent successful file delivery", () => {
    const deliveries: SuccessfulFileDelivery[] = [
      {
        toolName: "telegram_send_file",
        channel: "telegram",
        filePath: "/tmp/alpha.png",
      },
      {
        toolName: "telegram_send_file",
        channel: "telegram",
        filePath: "/tmp/beta.png",
      },
    ]

    expect(buildSuccessfulDeliverySummary(deliveries)).toContain("beta.png")
  })

  it("records delivery receipts without duplicating the same artifact", () => {
    const appendEvent = vi.fn()
    const deliveries: SuccessfulFileDelivery[] = []
    const textDeliveries: SuccessfulTextDelivery[] = []
    const receipt = {
      artifactDeliveries: [
        {
          toolName: "telegram_send_file",
          channel: "telegram" as const,
          filePath: "/tmp/result.png",
          messageId: 123,
        },
      ],
    }

    applyChunkDeliveryReceipt({
      runId: "run-1",
      receipt,
      successfulFileDeliveries: deliveries,
      successfulTextDeliveries: textDeliveries,
      appendEvent,
    })
    applyChunkDeliveryReceipt({
      runId: "run-1",
      receipt,
      successfulFileDeliveries: deliveries,
      successfulTextDeliveries: textDeliveries,
      appendEvent,
    })

    expect(deliveries).toHaveLength(1)
    expect(appendEvent).toHaveBeenCalledTimes(1)
  })

  it("records webui artifact delivery receipts and labels them correctly", () => {
    const appendEvent = vi.fn()
    const deliveries: SuccessfulFileDelivery[] = []
    const textDeliveries: SuccessfulTextDelivery[] = []
    const receipt = {
      artifactDeliveries: [
        {
          toolName: "screen_capture",
          channel: "webui" as const,
          filePath: "/tmp/result.png",
          caption: "메인 화면 캡처",
        },
      ],
    }

    applyChunkDeliveryReceipt({
      runId: "run-1",
      receipt,
      successfulFileDeliveries: deliveries,
      successfulTextDeliveries: textDeliveries,
      appendEvent,
    })

    expect(deliveries).toEqual([
      {
        toolName: "screen_capture",
        channel: "webui",
        filePath: "/tmp/result.png",
        caption: "메인 화면 캡처",
      },
    ])
    expect(buildSuccessfulDeliverySummary(deliveries)).toBe("WebUI 파일 전달 완료: /tmp/result.png")
    expect(appendEvent).toHaveBeenCalledWith("run-1", "WebUI 파일 전달 완료: /tmp/result.png")
  })

  it("records telegram text delivery receipts separately from artifact delivery", () => {
    const appendEvent = vi.fn()
    const deliveries: SuccessfulFileDelivery[] = []
    const textDeliveries: SuccessfulTextDelivery[] = []
    const receipt = {
      textDeliveries: [
        {
          channel: "telegram" as const,
          text: "안녕하세요",
          messageIds: [101, 102],
        },
      ],
    }

    applyChunkDeliveryReceipt({
      runId: "run-1",
      receipt,
      successfulFileDeliveries: deliveries,
      successfulTextDeliveries: textDeliveries,
      appendEvent,
    })

    expect(deliveries).toHaveLength(0)
    expect(textDeliveries).toHaveLength(1)
    expect(textDeliveries[0]?.text).toBe("안녕하세요")
    expect(appendEvent).toHaveBeenCalledWith("run-1", "텔레그램 텍스트 전달 완료")
  })

  it("returns undefined and reports an error when chunk delivery throws", async () => {
    const onError = vi.fn()
    const result = await deliverChunk({
      onChunk: async () => {
        throw new Error("boom")
      },
      chunk: { type: "text", delta: "hello" },
      runId: "run-1",
      onError,
    })

    expect(result).toBeUndefined()
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it("delivers a chunk and applies delivery receipts in one helper", async () => {
    const appendEvent = vi.fn()
    const deliveries: SuccessfulFileDelivery[] = []
    const textDeliveries: SuccessfulTextDelivery[] = []

    const receipt = await deliverTrackedChunk({
      onChunk: vi.fn().mockResolvedValue({
        artifactDeliveries: [
          {
            toolName: "telegram_send_file",
            channel: "telegram",
            filePath: "/tmp/result.png",
            messageId: 12,
          },
        ],
        textDeliveries: [
          {
            channel: "telegram",
            text: "완료",
            messageIds: [12],
          },
        ],
      }),
      chunk: { type: "done", totalTokens: 0 },
      runId: "run-2",
      successfulFileDeliveries: deliveries,
      successfulTextDeliveries: textDeliveries,
      appendEvent,
    })

    expect(receipt?.artifactDeliveries).toHaveLength(1)
    expect(deliveries).toHaveLength(1)
    expect(textDeliveries).toHaveLength(1)
    expect(appendEvent).toHaveBeenNthCalledWith(1, "run-2", "텔레그램 파일 전달 완료: /tmp/result.png")
    expect(appendEvent).toHaveBeenNthCalledWith(2, "run-2", "텔레그램 텍스트 전달 완료")
  })

  it("normalizes home directory display for user-facing paths", () => {
    const home = process.env.HOME
    if (!home) {
      expect(displayHomePath("/tmp/demo.txt")).toBe("/tmp/demo.txt")
      return
    }

    expect(displayHomePath(`${home}/demo.txt`)).toBe("~/demo.txt")
  })

  it("distinguishes direct artifact delivery completion from general execution output", () => {
    const deliveries: SuccessfulFileDelivery[] = [
      {
        toolName: "telegram_send_file",
        channel: "telegram",
        filePath: "/tmp/result.png",
      },
    ]

    const directOutcome = resolveDeliveryOutcome({
      wantsDirectArtifactDelivery: true,
      deliveries,
    })
    expect(directOutcome.deliverySatisfied).toBe(true)
    expect(directOutcome.requiresDirectArtifactRecovery).toBe(false)
    expect(directOutcome.deliverySummary).toContain("result.png")

    const pendingDirectOutcome = resolveDeliveryOutcome({
      wantsDirectArtifactDelivery: true,
      deliveries: [],
    })
    expect(pendingDirectOutcome.deliverySatisfied).toBe(false)
    expect(pendingDirectOutcome.requiresDirectArtifactRecovery).toBe(true)

    const generalOutcome = resolveDeliveryOutcome({
      wantsDirectArtifactDelivery: false,
      deliveries,
    })
    expect(generalOutcome.deliverySatisfied).toBe(false)
    expect(generalOutcome.requiresDirectArtifactRecovery).toBe(false)
    expect(generalOutcome.hasSuccessfulArtifactDelivery).toBe(true)
  })

  it("emits assistant text through the delivery boundary with persistence and done chunk", async () => {
    const insertMessage = vi.fn()
    const emitStart = vi.fn()
    const emitStream = vi.fn()
    const emitEnd = vi.fn()
    const writeReplyLog = vi.fn()
    const onChunk = vi.fn().mockResolvedValue(undefined)

    const receipt = await emitAssistantTextDelivery({
      runId: "run-1",
      sessionId: "session-1",
      text: "안녕하세요",
      source: "telegram",
      onChunk,
      dependencies: {
        now: () => 123,
        createId: () => "msg-1",
        insertMessage,
        emitStart,
        emitStream,
        emitEnd,
        writeReplyLog,
      },
    })

    expect(receipt.persisted).toBe(true)
    expect(receipt.textDelivered).toBe(true)
    expect(receipt.doneDelivered).toBe(true)
    expect(insertMessage).toHaveBeenCalledTimes(1)
    expect(emitStart).toHaveBeenCalledWith({ sessionId: "session-1", runId: "run-1" })
    expect(emitStream).toHaveBeenCalledWith({ sessionId: "session-1", runId: "run-1", delta: "안녕하세요" })
    expect(emitEnd).toHaveBeenCalledWith({ sessionId: "session-1", runId: "run-1", durationMs: 0 })
    expect(onChunk).toHaveBeenCalledTimes(2)
    expect(writeReplyLog).toHaveBeenCalledWith("telegram", "안녕하세요")
  })

  it("classifies assistant text delivery failures separately from execution success", () => {
    const textFailure = resolveAssistantTextDeliveryOutcome({
      persisted: true,
      textDelivered: false,
      doneDelivered: true,
    })
    expect(textFailure.hasDeliveryFailure).toBe(true)
    expect(textFailure.failureStage).toBe("text")
    expect(textFailure.summary).toContain("응답 텍스트 전달")

    const doneFailure = resolveAssistantTextDeliveryOutcome({
      persisted: true,
      textDelivered: true,
      doneDelivered: false,
    })
    expect(doneFailure.hasDeliveryFailure).toBe(true)
    expect(doneFailure.failureStage).toBe("done")
    expect(doneFailure.summary).toContain("완료 신호")

    const success = resolveAssistantTextDeliveryOutcome({
      persisted: true,
      textDelivered: true,
      doneDelivered: true,
    })
    expect(success.hasDeliveryFailure).toBe(false)
    expect(success.failureStage).toBe("none")
  })
})
