import { describe, expect, it, vi, beforeEach } from "vitest"

const storeMemoryMock = vi.fn(async () => "memory-id-1")
const searchMemoryMock = vi.fn(async () => [])

vi.mock("../packages/core/src/memory/store.js", () => ({
  storeMemory: (...args: unknown[]) => storeMemoryMock(...args),
  searchMemory: (...args: unknown[]) => searchMemoryMock(...args),
}))

const { memoryStoreTool, memorySearchTool } = await import("../packages/core/src/tools/builtin/memory.ts")

describe("memory tool scope", () => {
  beforeEach(() => {
    storeMemoryMock.mockClear()
    searchMemoryMock.mockClear()
  })

  it("stores explicit long-term memories as global scope", async () => {
    await memoryStoreTool.execute({
      content: "사용자는 한글 답변을 선호함",
    }, {
      sessionId: "session-1",
      runId: "run-1",
      requestGroupId: "group-1",
      workDir: "/tmp",
      userMessage: "이걸 기억해줘",
      source: "webui",
      allowWebAccess: false,
      onProgress: () => {},
      signal: new AbortController().signal,
    })

    expect(storeMemoryMock).toHaveBeenCalledWith(expect.objectContaining({
      content: "사용자는 한글 답변을 선호함",
      scope: "global",
      type: "user_fact",
    }))
  })

  it("searches visible memories using session and current run scope", async () => {
    searchMemoryMock.mockResolvedValueOnce([])

    await memorySearchTool.execute({
      query: "최근 실패 원인",
      limit: 3,
    }, {
      sessionId: "session-2",
      runId: "run-2",
      requestGroupId: "group-2",
      workDir: "/tmp",
      userMessage: "최근 실패 원인 찾아줘",
      source: "cli",
      allowWebAccess: false,
      onProgress: () => {},
      signal: new AbortController().signal,
    })

    expect(searchMemoryMock).toHaveBeenCalledWith("최근 실패 원인", 3, {
      sessionId: "session-2",
      runId: "run-2",
      requestGroupId: "group-2",
    })
  })
})
