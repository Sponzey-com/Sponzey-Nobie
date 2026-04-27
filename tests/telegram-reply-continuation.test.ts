import { beforeEach, describe, expect, it, vi } from "vitest"

const findChannelMessageRefMock = vi.fn((..._args: unknown[]): unknown => null)
const findLatestChannelMessageRefForThreadMock = vi.fn((..._args: unknown[]): unknown => null)

vi.mock("grammy", () => ({
  Bot: class {
    api = {}
    on(): void {}
    catch(): void {}
    start(): Promise<void> {
      return Promise.resolve()
    }
    stop(): void {}
  },
}))

vi.mock("../packages/core/src/db/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../packages/core/src/db/index.js")>()
  return {
    ...actual,
    findChannelMessageRef: (...args: unknown[]) => findChannelMessageRefMock(...args),
    findLatestChannelMessageRefForThread: (...args: unknown[]) => findLatestChannelMessageRefForThreadMock(...args),
  }
})

const { findTelegramReplyTaskRef } = await import("../packages/core/src/channels/telegram/bot.ts")

describe("telegram reply continuation", () => {
  beforeEach(() => {
    findChannelMessageRefMock.mockReset().mockReturnValue(null)
    findLatestChannelMessageRefForThreadMock.mockReset().mockReturnValue(null)
  })

  it("resolves the exact replied Telegram message reference first", () => {
    const ref = {
      id: "ref-exact",
      source: "telegram",
      session_id: "session-telegram-1",
      root_run_id: "run-telegram-1",
      request_group_id: "request-group-telegram",
      external_chat_id: "42120565",
      external_thread_id: "7",
      external_message_id: "101",
      role: "assistant",
      created_at: 1712570000100,
    }
    findChannelMessageRefMock.mockReturnValue(ref)

    expect(findTelegramReplyTaskRef({ chatId: 42120565, replyToMessageId: 101, threadId: 7 })).toBe(ref)
    expect(findChannelMessageRefMock).toHaveBeenCalledWith({
      source: "telegram",
      externalChatId: "42120565",
      externalMessageId: "101",
      externalThreadId: "7",
    })
    expect(findLatestChannelMessageRefForThreadMock).not.toHaveBeenCalled()
  })

  it("falls back to the latest Nobie response in the Telegram topic when the replied message was not recorded", () => {
    const ref = {
      id: "ref-topic-latest",
      source: "telegram",
      session_id: "session-telegram-1",
      root_run_id: "run-telegram-1",
      request_group_id: "request-group-telegram",
      external_chat_id: "42120565",
      external_thread_id: "7",
      external_message_id: "104",
      role: "assistant",
      created_at: 1712570000400,
    }
    findLatestChannelMessageRefForThreadMock.mockReturnValue(ref)

    expect(findTelegramReplyTaskRef({ chatId: 42120565, replyToMessageId: 999, threadId: 7 })).toBe(ref)
    expect(findLatestChannelMessageRefForThreadMock).toHaveBeenCalledWith({
      source: "telegram",
      externalChatId: "42120565",
      externalThreadId: "7",
    })
  })

  it("falls back to the latest Nobie response in a main Telegram chat without a topic id", () => {
    const ref = {
      id: "ref-main-latest",
      source: "telegram",
      session_id: "session-telegram-main",
      root_run_id: "run-telegram-main",
      request_group_id: "request-group-main",
      external_chat_id: "42120565",
      external_thread_id: null,
      external_message_id: "204",
      role: "assistant",
      created_at: 1712570000400,
    }
    findLatestChannelMessageRefForThreadMock.mockReturnValue(ref)

    expect(findTelegramReplyTaskRef({ chatId: 42120565, replyToMessageId: 999 })).toBe(ref)
    expect(findLatestChannelMessageRefForThreadMock).toHaveBeenCalledWith({
      source: "telegram",
      externalChatId: "42120565",
    })
  })
})
