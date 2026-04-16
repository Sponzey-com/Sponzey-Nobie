import { createRequire } from "node:module"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerMemoryRoute } from "../packages/core/src/api/routes/memory.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import {
  closeDb,
  enqueueMemoryWritebackCandidate,
  getDb,
  insertFlashFeedback,
  recordMemoryAccessLog,
} from "../packages/core/src/db/index.js"
import { closeMemoryJournalDb } from "../packages/core/src/memory/journal.js"
import { buildMemoryQualitySnapshot } from "../packages/core/src/memory/quality.ts"
import { storeMemoryDocument } from "../packages/core/src/memory/store.ts"

const require = createRequire(import.meta.url)
const Fastify = require("../packages/core/node_modules/fastify") as (options: { logger: boolean }) => {
  ready(): Promise<void>
  close(): Promise<void>
  inject(options: { method: string; url: string; payload?: unknown }): Promise<{ statusCode: number; json(): any }>
}

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function useTempState(): void {
  closeDb()
  closeMemoryJournalDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-memory-task009-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  reloadConfig()
}

beforeEach(() => {
  useTempState()
})

afterEach(() => {
  closeDb()
  closeMemoryJournalDb()
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

describe("task009 memory quality dashboard", () => {
  it("reports scope counts, missing embeddings, stale documents, latency, flash-feedback, and writeback failures", async () => {
    const now = Date.now()
    const stored = await storeMemoryDocument({
      rawText: "TASK009_MEMORY_QUALITY should be visible in dashboard metrics",
      scope: "global",
      sourceType: "test",
      metadata: { requiresReview: false },
    })
    getDb()
      .prepare(`UPDATE memory_documents SET updated_at = ? WHERE id = ?`)
      .run(now - 60 * 24 * 60 * 60 * 1000, stored.documentId)
    recordMemoryAccessLog({
      documentId: stored.documentId,
      chunkId: stored.chunkIds[0],
      query: "TASK009_MEMORY_QUALITY",
      resultSource: "fts",
      score: 1,
      latencyMs: 640,
    })
    insertFlashFeedback({
      sessionId: "session-quality",
      content: "다음 요청부터 바로 반영",
      severity: "high",
      ttlMs: 60_000,
    })
    enqueueMemoryWritebackCandidate({
      scope: "long-term",
      ownerId: "global",
      sourceType: "durable_fact_candidate",
      content: "TASK009_WRITEBACK_FAILURE",
      status: "failed",
      lastError: "retry exhausted",
    })

    const snapshot = buildMemoryQualitySnapshot({ now })
    const global = snapshot.scopes.find((scope) => scope.scope === "global")
    const longTerm = snapshot.scopes.find((scope) => scope.scope === "long-term")

    expect(snapshot.status).toBe("degraded")
    expect(global).toMatchObject({
      documents: 1,
      chunks: 1,
      missingEmbeddings: 1,
      staleDocuments: 1,
      accessCount: 1,
      p95RetrievalLatencyMs: 640,
    })
    expect(longTerm?.lastFailure).toBe("retry exhausted")
    expect(snapshot.writeback.failed).toBe(1)
    expect(snapshot.flashFeedback.highSeverityActive).toBe(1)
    expect(snapshot.retrievalPolicy).toMatchObject({
      fastPathBlocksLongTerm: true,
      fastPathBlocksVector: true,
      scheduleMemoryDefaultInjection: false,
    })
  })

  it("exposes the memory quality snapshot through the dashboard API", async () => {
    await storeMemoryDocument({
      rawText: "TASK009_ROUTE_MEMORY_QUALITY",
      scope: "session",
      ownerId: "session-route",
      sourceType: "test",
    })

    const app = Fastify({ logger: false })
    registerMemoryRoute(app)
    await app.ready()
    try {
      const response = await app.inject({ method: "GET", url: "/api/memory/quality" })
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.snapshot.scopes).toEqual(expect.arrayContaining([
        expect.objectContaining({ scope: "session", documents: 1 }),
      ]))
      expect(body.snapshot.retrievalPolicy.fastPathBlocksVector).toBe(true)
    } finally {
      await app.close()
    }
  })
})
