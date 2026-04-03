import { describe, expect, it, vi } from "vitest"

vi.mock("../packages/core/src/db/index.js", () => ({
  getDb: () => ({
    prepare: () => ({ run: vi.fn() }),
  }),
  insertSession: vi.fn(),
  getSession: vi.fn(() => null),
  insertMessage: vi.fn(),
  getMessages: vi.fn(() => []),
  getMessagesForRequestGroup: vi.fn(() => []),
  getMessagesForRequestGroupWithRunMeta: vi.fn(() => []),
  insertMemoryItem: vi.fn(),
  markMessagesCompressed: vi.fn(),
}))

vi.mock("../packages/core/src/memory/store.js", () => ({
  buildMemoryContext: vi.fn(async () => ""),
}))

vi.mock("../packages/core/src/memory/nobie-md.js", () => ({
  loadNobieMd: vi.fn(() => ""),
  loadSysPropMd: vi.fn(() => ""),
}))

vi.mock("../packages/core/src/instructions/merge.js", () => ({
  loadMergedInstructions: vi.fn(() => ({ mergedText: "" })),
}))

const { runAgent } = await import("../packages/core/src/agent/index.ts")

describe("runAgent streaming policy", () => {
  it("does not leak partial assistant text when the AI round fails", async () => {
    const provider = {
      chat: vi.fn(async function* () {
        yield { type: "text_delta", delta: "메인 화면을 지금 캡처해서 이 채팅에 바로 보여드릴게요." } as const
        throw new Error("403 forbidden")
      }),
    }

    const chunks = []
    for await (const chunk of runAgent({
      userMessage: "메인 전체 화면 캡처",
      sessionId: "session-agent-streaming-failure",
      runId: "run-agent-streaming-failure",
      model: "gpt-5",
      provider: provider as never,
      source: "telegram",
      toolsEnabled: false,
    })) {
      chunks.push(chunk)
    }

    expect(chunks.some((chunk) => chunk.type === "text")).toBe(false)
    expect(chunks).toEqual([{
      type: "ai_recovery",
      summary: "AI 응답 생성 중 오류가 발생해 다른 방법을 다시 시도합니다.",
      reason: "인증 또는 접근 차단 문제 때문에 모델 호출이 실패했습니다.",
      message: "403 forbidden",
    }])
  })

  it("emits the buffered assistant text only after a successful non-tool round", async () => {
    const provider = {
      chat: vi.fn(async function* () {
        yield { type: "text_delta", delta: "작업을 완료했습니다." } as const
        yield {
          type: "message_stop",
          usage: { input_tokens: 1, output_tokens: 1 },
        } as const
      }),
    }

    const chunks = []
    for await (const chunk of runAgent({
      userMessage: "상태 알려줘",
      sessionId: "session-agent-streaming-success",
      runId: "run-agent-streaming-success",
      model: "gpt-5",
      provider: provider as never,
      source: "telegram",
      toolsEnabled: false,
    })) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual([
      { type: "text", delta: "작업을 완료했습니다." },
      { type: "done", totalTokens: 2 },
    ])
  })
})
