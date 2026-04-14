import { afterEach, describe, expect, it, vi } from "vitest"

const memoryItem = {
  id: "memory-1",
  content: "fast fts result",
  tags: "[]",
  source: "agent",
  memory_scope: "global",
  session_id: null,
  run_id: null,
  request_group_id: null,
  type: "user_fact",
  importance: "medium",
  embedding: null,
  created_at: Date.now(),
  updated_at: Date.now(),
}

vi.mock("../packages/core/src/db/index.js", () => ({
  searchMemoryItems: vi.fn(() => [memoryItem]),
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ all: vi.fn(() => []) })),
  })),
}))

vi.mock("../packages/core/src/memory/embedding.js", () => ({
  getEmbeddingProvider: vi.fn(() => ({
    providerId: "openai",
    modelId: "slow-embedding",
    dimensions: 1,
    embed: vi.fn(() => new Promise<number[]>(() => undefined)),
    batchEmbed: vi.fn(() => new Promise<number[][]>(() => undefined)),
  })),
  decodeEmbedding: vi.fn(() => [1]),
  cosineSimilarity: vi.fn(() => 0.5),
}))

const { hybridSearch } = await import("../packages/core/src/memory/search.ts")

afterEach(() => {
  vi.useRealTimers()
})

describe("task004 memory search tuning", () => {
  it("falls back to FTS results when vector search times out", async () => {
    vi.useFakeTimers()

    const pending = hybridSearch("hello", 1)
    await vi.advanceTimersByTimeAsync(800)
    const results = await pending

    expect(results).toHaveLength(1)
    expect(results[0]?.item.id).toBe("memory-1")
  })
})
