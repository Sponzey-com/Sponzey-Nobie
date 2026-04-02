import { describe, expect, it, vi } from "vitest"
import { sendTelegramFile, sendTelegramPlainMessage, sendTelegramTextParts } from "../packages/core/src/channels/telegram/message-delivery.ts"

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
})
