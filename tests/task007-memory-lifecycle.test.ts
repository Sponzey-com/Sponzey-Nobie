import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  closeDb,
  enqueueMemoryWritebackCandidate,
  getDb,
  listMemoryAccessTraceForRun,
} from "../packages/core/src/db/index.js"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { searchMemoryChunks } from "../packages/core/src/memory/search.ts"
import { searchMemoryDetailed, storeMemoryDocument } from "../packages/core/src/memory/store.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task007-memory-lifecycle-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  reloadConfig()
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

describe("task007 memory source and index lifecycle", () => {
  it("keeps source checksum on chunks and degrades vector indexing without losing source documents", async () => {
    const stored = await storeMemoryDocument({
      rawText: "TASK007_SOURCE_OF_TRUTH_VECTOR_DISABLED should still be searchable by FTS",
      scope: "global",
      sourceType: "test_source_file",
      sourceRef: "prompts/user.md",
      title: "task007 source contract",
    })

    const db = getDb()
    const document = db
      .prepare<[string], { checksum: string; raw_text: string }>(`SELECT checksum, raw_text FROM memory_documents WHERE id = ?`)
      .get(stored.documentId)
    const chunk = db
      .prepare<[string], { source_checksum: string | null; token_estimate: number; ordinal: number }>(`SELECT source_checksum, token_estimate, ordinal FROM memory_chunks WHERE id = ?`)
      .get(stored.chunkIds[0]!)
    const job = db
      .prepare<[string], { status: string; last_error: string | null }>(`SELECT status, last_error FROM memory_index_jobs WHERE document_id = ?`)
      .get(stored.documentId)

    expect(document?.raw_text).toContain("TASK007_SOURCE_OF_TRUTH_VECTOR_DISABLED")
    expect(chunk?.source_checksum).toBe(document?.checksum)
    expect(chunk?.token_estimate).toBeGreaterThan(0)
    expect(chunk?.ordinal).toBe(0)
    expect(job).toMatchObject({ status: "disabled", last_error: "embedding provider is not configured" })

    const results = await searchMemoryChunks("TASK007_SOURCE_OF_TRUTH_VECTOR_DISABLED", 5, "vector", { runId: "run-task007-vector-disabled" })
    expect(results.some((result) => result.chunk.content.includes("TASK007_SOURCE_OF_TRUTH_VECTOR_DISABLED"))).toBe(true)
    expect(results.every((result) => result.source === "fts" || result.source === "like")).toBe(true)

    const diagnosticCount = db
      .prepare<[], { count: number }>(`SELECT count(*) AS count FROM diagnostic_events WHERE kind = 'memory_vector_degraded'`)
      .get()?.count ?? 0
    expect(diagnosticCount).toBeGreaterThan(0)
  })

  it("excludes diagnostic memory, flash-feedback, and pending writeback from default long-term retrieval", async () => {
    await storeMemoryDocument({
      rawText: "TASK007_DIAGNOSTIC_MEMORY_SECRET should be hidden by default",
      scope: "diagnostic",
      ownerId: "run-task007-diagnostic",
      sourceType: "screen_capture_failure",
    })
    await storeMemoryDocument({
      rawText: "TASK007_FLASH_FEEDBACK_TEMP should be hidden from normal retrieval",
      scope: "flash-feedback",
      ownerId: "session-task007",
      sourceType: "flash_feedback",
      metadata: { expiresAt: Date.now() + 60_000 },
    })
    enqueueMemoryWritebackCandidate({
      scope: "long-term",
      sourceType: "durable_fact_candidate",
      content: "TASK007_WRITEBACK_PENDING should not be retrieved before review",
      metadata: { requiresReview: true, approved: false },
    })

    const defaultDiagnostic = await searchMemoryDetailed("TASK007_DIAGNOSTIC_MEMORY_SECRET", 5, {
      runId: "run-task007-diagnostic",
      sessionId: "session-task007",
      requestGroupId: "group-task007",
    })
    const explicitDiagnostic = await searchMemoryDetailed("TASK007_DIAGNOSTIC_MEMORY_SECRET", 5, {
      runId: "run-task007-diagnostic",
      sessionId: "session-task007",
      requestGroupId: "group-task007",
      includeDiagnostic: true,
    })
    const defaultFlash = await searchMemoryDetailed("TASK007_FLASH_FEEDBACK_TEMP", 5, { sessionId: "session-task007" })
    const explicitFlash = await searchMemoryDetailed("TASK007_FLASH_FEEDBACK_TEMP", 5, {
      sessionId: "session-task007",
      includeFlashFeedback: true,
    })
    const pendingWriteback = await searchMemoryDetailed("TASK007_WRITEBACK_PENDING", 5)

    expect(defaultDiagnostic).toHaveLength(0)
    expect(explicitDiagnostic.some((result) => result.chunk.scope === "diagnostic")).toBe(true)
    expect(defaultFlash).toHaveLength(0)
    expect(explicitFlash.some((result) => result.chunk.scope === "flash-feedback")).toBe(true)
    expect(pendingWriteback).toHaveLength(0)
  })

  it("records memory access trace with chunk id, source checksum, scope, score, and reason", async () => {
    await storeMemoryDocument({
      rawText: "TASK007_TRACE_SOURCE_CHECKSUM should leave trace evidence",
      scope: "global",
      sourceType: "user_profile_file",
      sourceRef: "prompts/user.md",
    })

    const results = await searchMemoryDetailed("TASK007_TRACE_SOURCE_CHECKSUM", 5, {
      runId: "run-task007-trace",
      sessionId: "session-task007-trace",
      requestGroupId: "group-task007-trace",
    })
    expect(results).toHaveLength(1)

    const traces = listMemoryAccessTraceForRun("run-task007-trace")
    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({
      run_id: "run-task007-trace",
      session_id: "session-task007-trace",
      request_group_id: "group-task007-trace",
      chunk_id: results[0]!.chunkId,
      source_checksum: results[0]!.chunk.source_checksum,
      scope: "global",
      result_source: results[0]!.source,
      reason: "accepted_retrieval_candidate",
    })
    expect(typeof traces[0]!.score).toBe("number")
  })
})
