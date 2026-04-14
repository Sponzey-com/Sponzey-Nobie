import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { closeDb, enqueueMemoryWritebackCandidate, getDb } from "../packages/core/src/db/index.js"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeMemoryJournalDb } from "../packages/core/src/memory/journal.js"
import { searchMemoryDetailed } from "../packages/core/src/memory/store.ts"
import {
  buildRunWritebackCandidates,
  inspectMemoryWritebackSafety,
  listMemoryWritebackReviewItems,
  prepareMemoryWritebackQueueInput,
  reviewMemoryWritebackCandidate,
} from "../packages/core/src/memory/writeback.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function useTempState(): void {
  closeDb()
  closeMemoryJournalDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task004-review-"))
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

describe("task004 long-term memory review", () => {
  it("queues explicit memory requests for review and promotes only after approval", async () => {
    const candidates = buildRunWritebackCandidates({
      kind: "instruction",
      content: "기억해줘 TASK004_KOREAN_PREF 사용자는 짧은 한국어 답변을 선호한다",
      sessionId: "session-review",
      requestGroupId: "request-review",
      runId: "run-review",
      source: "webui",
    })
    const longTerm = candidates.find((candidate) => candidate.scope === "long-term")
    expect(longTerm?.metadata).toMatchObject({ requiresReview: true, approved: false, confidence: "high" })

    const id = enqueueMemoryWritebackCandidate(prepareMemoryWritebackQueueInput(longTerm!))
    expect(await searchMemoryDetailed("TASK004_KOREAN_PREF", 5)).toEqual([])

    const reviewItems = listMemoryWritebackReviewItems()
    expect(reviewItems).toMatchObject([{
      id,
      sourceRunId: "run-review",
      sourceChannel: "webui",
      sessionId: "session-review",
      requestGroupId: "request-review",
      confidence: "high",
      status: "pending",
    }])

    const result = await reviewMemoryWritebackCandidate({ id, action: "approve_long_term", reviewerId: "tester" })
    expect(result.ok).toBe(true)
    expect(result.documentId).toBeTruthy()

    const rows = await searchMemoryDetailed("TASK004_KOREAN_PREF", 5)
    expect(rows.map((row) => row.chunk.document_id)).toContain(result.documentId)
    expect(getDb().prepare<[string], { status: string }>(`SELECT status FROM memory_writeback_queue WHERE id = ?`).get(id)?.status).toBe("completed")
  })

  it("keeps reviewed candidates in session scope when requested", async () => {
    const id = enqueueMemoryWritebackCandidate(prepareMemoryWritebackQueueInput({
      scope: "long-term",
      ownerId: "global",
      sourceType: "flash_feedback_promotion_candidate",
      content: "TASK004_SESSION_ONLY 앞으로 이 세션에서는 파일 경로만 말하지 않는다",
      metadata: {
        sessionId: "session-only",
        requestGroupId: "group-only",
        source: "slack",
        requiresReview: true,
      },
      runId: "run-session-only",
    }))

    const result = await reviewMemoryWritebackCandidate({ id, action: "keep_session" })
    expect(result.ok).toBe(true)

    const visibleInSession = await searchMemoryDetailed("TASK004_SESSION_ONLY", 5, { sessionId: "session-only" })
    const hiddenGlobally = await searchMemoryDetailed("TASK004_SESSION_ONLY", 5)
    expect(visibleInSession).toHaveLength(1)
    expect(hiddenGlobally).toHaveLength(0)
  })

  it("stores edited review text, records audit, and dedupes discarded candidates", async () => {
    const id = enqueueMemoryWritebackCandidate(prepareMemoryWritebackQueueInput({
      scope: "long-term",
      ownerId: "global",
      sourceType: "durable_fact_candidate",
      content: "TASK004_EDIT_ORIGINAL 사용자는 긴 설명을 선호한다",
      metadata: {
        sessionId: "session-edit",
        requestGroupId: "group-edit",
        source: "webui",
        requiresReview: true,
      },
      runId: "run-edit",
    }))

    const edited = await reviewMemoryWritebackCandidate({
      id,
      action: "approve_edited",
      editedContent: "TASK004_EDITED_TEXT 사용자는 짧은 설명을 선호한다",
      reviewerId: "tester-edit",
    })
    expect(edited.ok).toBe(true)
    expect(await searchMemoryDetailed("TASK004_EDITED_TEXT", 5)).toHaveLength(1)
    expect(await searchMemoryDetailed("TASK004_EDIT_ORIGINAL", 5)).toHaveLength(0)
    expect(getDb().prepare<[], { count: number }>(`SELECT count(*) AS count FROM audit_logs WHERE tool_name = 'memory_writeback_review' AND result = 'success'`).get()?.count).toBe(1)

    const discardId = enqueueMemoryWritebackCandidate(prepareMemoryWritebackQueueInput({
      scope: "long-term",
      ownerId: "global",
      sourceType: "flash_feedback_promotion_candidate",
      content: "TASK004_DEDUPE_DISCARD 앞으로 이 문구는 저장하지 않는다",
      metadata: { sessionId: "session-edit", source: "telegram" },
      runId: "run-discard",
    }))
    await reviewMemoryWritebackCandidate({ id: discardId, action: "discard", reviewerId: "tester-edit" })

    const duplicate = prepareMemoryWritebackQueueInput({
      scope: "long-term",
      ownerId: "global",
      sourceType: "flash_feedback_promotion_candidate",
      content: "TASK004_DEDUPE_DISCARD 앞으로 이 문구는 저장하지 않는다",
      metadata: { sessionId: "session-edit", source: "telegram" },
      runId: "run-discard-2",
    })
    expect(duplicate.status).toBe("discarded")
    expect(duplicate.lastError).toContain("previously_discarded")
  })

  it("masks sensitive values and blocks raw errors from long-term promotion", async () => {
    const safety = inspectMemoryWritebackSafety({
      scope: "long-term",
      sourceType: "durable_fact_candidate",
      content: "<html><body>403</body></html> token: sk-testSECRET1234567890 /Users/dongwooshin/private/file.txt",
    })
    expect(safety.blockReasons).toContain("raw_html_error")
    expect(safety.content).not.toContain("sk-testSECRET")
    expect(safety.content).not.toContain("dongwooshin")

    const id = enqueueMemoryWritebackCandidate(prepareMemoryWritebackQueueInput({
      scope: "long-term",
      ownerId: "global",
      sourceType: "durable_fact_candidate",
      content: "<html><body>403</body></html> token: sk-testSECRET1234567890 /Users/dongwooshin/private/file.txt",
      metadata: { source: "telegram", sessionId: "session-sensitive" },
      runId: "run-sensitive",
    }))

    const queued = getDb()
      .prepare<[string], { content: string; status: string; last_error: string | null }>(
        `SELECT content, status, last_error FROM memory_writeback_queue WHERE id = ?`,
      )
      .get(id)
    expect(queued?.content).not.toContain("sk-testSECRET")
    expect(queued?.content).not.toContain("dongwooshin")
    expect(queued?.status).toBe("discarded")

    const result = await reviewMemoryWritebackCandidate({ id, action: "approve_long_term" })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain("raw_html_error")
    expect(await searchMemoryDetailed("403", 5, { includeDiagnostic: true })).toEqual([])
  })
})
