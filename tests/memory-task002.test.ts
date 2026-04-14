import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { closeDb, getDb, insertMemoryEmbeddingIfMissing, rebuildMemorySearchIndexes } from "../packages/core/src/db/index.js"
import { runMigrations } from "../packages/core/src/db/migrations.js"
import { encodeEmbedding, getVectorBackendStatus } from "../packages/core/src/memory/embedding.js"
import { searchMemoryDetailed, storeMemoryDocument } from "../packages/core/src/memory/store.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function useTempState(): string {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-memory-task002-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  reloadConfig()
  return stateDir
}

afterEach(() => {
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

beforeEach(() => {
  useTempState()
})

describe("task002 memory document backend", () => {
  it("creates the document, chunk, FTS, vector, access log, and continuity tables idempotently", () => {
    const db = getDb()
    runMigrations(db)

    const tables = db
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master
         WHERE name IN (
           'memory_documents', 'memory_chunks', 'memory_chunks_fts', 'memory_embeddings',
           'memory_index_jobs', 'memory_access_log', 'memory_writeback_queue',
           'session_snapshots', 'task_continuity'
         )
         ORDER BY name`,
      )
      .all()
      .map((row) => row.name)

    expect(tables).toEqual([
      "memory_access_log",
      "memory_chunks",
      "memory_chunks_fts",
      "memory_documents",
      "memory_embeddings",
      "memory_index_jobs",
      "memory_writeback_queue",
      "session_snapshots",
      "task_continuity",
    ])
  })

  it("stores chunked memory documents, deduplicates by checksum, and rejects ownerless task memory", async () => {
    const first = await storeMemoryDocument({
      rawText: "동천동 날씨 확인 규칙과 화면 캡처 작업 기록",
      scope: "global",
      sourceType: "test",
      title: "task002 global memory",
    })
    const duplicate = await storeMemoryDocument({
      rawText: "동천동 날씨 확인 규칙과 화면 캡처 작업 기록",
      scope: "global",
      sourceType: "test",
      title: "task002 duplicate memory",
    })

    expect(first.deduplicated).toBe(false)
    expect(duplicate.deduplicated).toBe(true)
    expect(duplicate.documentId).toBe(first.documentId)

    const sessionA = await storeMemoryDocument({
      rawText: "같은 원문이라도 세션 owner가 다르면 분리 저장한다",
      scope: "session",
      ownerId: "session-a",
      sourceType: "test",
    })
    const sessionB = await storeMemoryDocument({
      rawText: "같은 원문이라도 세션 owner가 다르면 분리 저장한다",
      scope: "session",
      ownerId: "session-b",
      sourceType: "test",
    })
    expect(sessionB.deduplicated).toBe(false)
    expect(sessionB.documentId).not.toBe(sessionA.documentId)

    await expect(storeMemoryDocument({
      rawText: "owner 없는 task 메모리",
      scope: "task",
      sourceType: "test",
    })).rejects.toThrow("task memory requires an owner id")
  })

  it("uses safe FTS fallback and keeps session memory scoped to its owner", async () => {
    await storeMemoryDocument({
      rawText: "특수 *** 검색 입력도 안전하게 찾아야 한다",
      scope: "global",
      sourceType: "test",
    })
    await storeMemoryDocument({
      rawText: "세션 A 전용 비밀 메모리",
      scope: "session",
      ownerId: "session-a",
      sourceType: "test",
    })
    rebuildMemorySearchIndexes()

    const fallbackResults = await searchMemoryDetailed("***", 5, { sessionId: "session-a", requestGroupId: "group-a" })
    expect(fallbackResults.some((result) => result.source === "like" && result.chunkId)).toBe(true)
    expect(fallbackResults.every((result) => Number.isFinite(result.latencyMs))).toBe(true)

    const hiddenResults = await searchMemoryDetailed("세션 A 전용 비밀", 5, { sessionId: "session-b" })
    expect(hiddenResults).toHaveLength(0)

    const visibleResults = await searchMemoryDetailed("세션 A 전용 비밀", 5, { sessionId: "session-a" })
    expect(visibleResults.some((result) => result.chunk.content.includes("세션 A 전용"))).toBe(true)

    const accessLogs = getDb().prepare<[], { count: number }>(`SELECT COUNT(*) AS count FROM memory_access_log`).get()
    expect(accessLogs?.count).toBeGreaterThan(0)
  })

  it("deduplicates embedding cache rows and reports a degraded vector backend without an embedding provider", async () => {
    const stored = await storeMemoryDocument({
      rawText: "벡터 캐시 중복 제거 테스트",
      scope: "global",
      sourceType: "test",
    })
    const textChecksum = "checksum-for-same-embedding-input"
    const first = insertMemoryEmbeddingIfMissing({
      chunkId: stored.chunkIds[0]!,
      provider: "test-provider",
      model: "test-model",
      dimensions: 2,
      textChecksum,
      vector: encodeEmbedding([0.1, 0.2]),
    })
    const duplicate = insertMemoryEmbeddingIfMissing({
      chunkId: stored.chunkIds[0]!,
      provider: "test-provider",
      model: "test-model",
      dimensions: 2,
      textChecksum,
      vector: encodeEmbedding([0.1, 0.2]),
    })

    const count = getDb()
      .prepare<[string], { count: number }>(`SELECT COUNT(*) AS count FROM memory_embeddings WHERE text_checksum = ?`)
      .get(textChecksum)?.count

    expect(duplicate).toBe(first)
    expect(count).toBe(1)
    expect(getVectorBackendStatus()).toEqual({
      available: false,
      backend: "none",
      reason: "embedding provider is not configured",
    })
  })
})
