import { describe, expect, it, vi } from "vitest"
import {
  buildTelegramFailedDeliveryReceipt,
  sendTelegramFile,
  sendTelegramFileWithReceipt,
  sendTelegramPlainMessage,
  sendTelegramTextParts,
  sendTelegramTextPartsWithReceipts,
} from "../packages/core/src/channels/telegram/message-delivery.ts"

describe("telegram message delivery helper", () => {
  it("sends split text parts in order and preserves thread target", async () => {
    const api = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce({ message_id: 11 })
        .mockResolvedValueOnce({ message_id: 12 }),
      sendDocument: vi.fn(),
    }

    const messageIds = await sendTelegramTextParts({
      api,
      target: { chatId: 42120565, threadId: 7 },
      text: "a".repeat(4100),
    })

    expect(messageIds).toEqual([11, 12])
    expect(api.sendMessage).toHaveBeenCalledTimes(2)
    expect(api.sendMessage.mock.calls[0]?.[0]).toBe(42120565)
    expect(api.sendMessage.mock.calls[0]?.[2]).toEqual({ message_thread_id: 7 })
  })

  it("sends plain receipt text and files through the same target contract", async () => {
    const api = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 21 }),
      sendDocument: vi.fn().mockResolvedValue({ message_id: 31 }),
    }

    const receiptId = await sendTelegramPlainMessage({
      api,
      target: { chatId: 42120565 },
      text: "접수했습니다.",
    })

    const fileId = await sendTelegramFile({
      api,
      target: { chatId: 42120565, threadId: 9 },
      filePath: "/tmp/result.png",
      caption: "result",
    })

    expect(receiptId).toBe(21)
    expect(fileId).toBe(31)
    expect(api.sendMessage).toHaveBeenCalledWith(42120565, "접수했습니다.", {})
    expect(api.sendDocument).toHaveBeenCalledTimes(1)
    expect(api.sendDocument.mock.calls[0]?.[0]).toBe(42120565)
    expect(api.sendDocument.mock.calls[0]?.[2]).toEqual({ message_thread_id: 9, caption: "result" })
  })

  it("returns delivery receipts for split text parts", async () => {
    const api = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce({ message_id: 41, bot_token: "123456789:abcdefghijklmnopqrstuvwxyz123456" })
        .mockResolvedValueOnce({ message_id: 42, raw_response: "ok" }),
      sendDocument: vi.fn(),
    }

    const result = await sendTelegramTextPartsWithReceipts({
      api,
      target: { chatId: 42120565, threadId: 7 },
      text: "a".repeat(4100),
      idempotencyKeyPrefix: "telegram:final:run-1:42120565:7",
      timestamp: 1_710_000_000_000,
    })

    expect(result.messageIds).toEqual([41, 42])
    expect(result.receipts).toHaveLength(2)
    expect(result.receipts[0]).toMatchObject({
      channelId: "telegram:primary",
      provider: "telegram",
      connectionId: "telegram:primary",
      target: { roomId: "42120565", threadId: "7" },
      status: "sent",
      timestamp: 1_710_000_000_000,
      idempotencyKey: "telegram:final:run-1:42120565:7:part:1",
      messageId: "41",
      threadId: "7",
      providerResponseRef: {
        storage: "redacted_inline",
        redactionState: "redacted",
        provider: "telegram",
      },
    })
    expect(result.receipts[0]?.providerResponseRef?.preview).toMatchObject({
      message_id: 41,
      bot_token: "[redacted]",
    })
  })

  it("returns delivery receipts for file delivery and delivery failures", async () => {
    const api = {
      sendMessage: vi.fn(),
      sendDocument: vi.fn().mockResolvedValue({ message_id: 51 }),
    }

    const file = await sendTelegramFileWithReceipt({
      api,
      target: { chatId: 42120565 },
      filePath: "/tmp/result.png",
      caption: "result",
      idempotencyKey: "telegram:file:run-2:/tmp/result.png",
      timestamp: 1_710_000_001_000,
    })
    const failed = buildTelegramFailedDeliveryReceipt({
      target: { chatId: 42120565, threadId: 9 },
      idempotencyKey: "telegram:final:run-2:failed",
      error: new Error("network down"),
      timestamp: 1_710_000_002_000,
    })

    expect(file.messageId).toBe(51)
    expect(file.receipt).toMatchObject({
      channelId: "telegram:primary",
      provider: "telegram",
      connectionId: "telegram:primary",
      target: { roomId: "42120565" },
      status: "sent",
      timestamp: 1_710_000_001_000,
      idempotencyKey: "telegram:file:run-2:/tmp/result.png",
      messageId: "51",
    })
    expect(failed).toMatchObject({
      channelId: "telegram:primary",
      provider: "telegram",
      connectionId: "telegram:primary",
      target: { roomId: "42120565", threadId: "9" },
      status: "failed",
      timestamp: 1_710_000_002_000,
      idempotencyKey: "telegram:final:run-2:failed",
      errorCode: "telegram_delivery_failed",
      errorMessage: "network down",
    })
  })
})
