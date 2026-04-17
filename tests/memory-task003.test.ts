import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  closeDb,
  getDb,
  insertArtifactReceipt,
  insertDiagnosticEvent,
  insertFlashFeedback,
  rebuildMemorySearchIndexes,
  upsertScheduleMemoryEntry,
} from "../packages/core/src/db/index.js"
import { buildMemoryJournalContext, closeMemoryJournalDb, insertMemoryJournalRecord } from "../packages/core/src/memory/journal.js"
import { buildMemoryContext, storeMemoryDocument } from "../packages/core/src/memory/store.ts"
import { runMemoryRetrievalEvaluation } from "../packages/core/src/memory/evaluation.ts"
import { diagnoseVectorEmbeddingRows, searchMemoryChunks } from "../packages/core/src/memory/search.ts"
import { selectRequestGroupContextMessages } from "../packages/core/src/agent/request-group-context.ts"
import { rememberRunFailure, rememberRunSuccess } from "../packages/core/src/runs/start-support.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import type { DbRequestGroupMessage } from "../packages/core/src/db/index.js"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function useTempState(): void {
  closeDb()
  closeMemoryJournalDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-memory-task003-"))
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

describe("task003 memory scope guard and prompt injection", () => {
  it("runs deterministic retrieval evaluation across FTS, vector, and hybrid modes", async () => {
    const report = await runMemoryRetrievalEvaluation({
      fixture: {
        documents: [
          {
            id: "long-term-weather-preference",
            text: "EVAL_DONGCHEON_WEATHER long-term weather response should use local context.",
            scope: "long-term",
            metadata: { requiresReview: false },
          },
          {
            id: "short-term-channel-correction",
            text: "EVAL_CHANNEL_CORRECTION Slack requests must stay in Slack threads.",
            scope: "short-term",
            ownerId: "session-a",
          },
          {
            id: "schedule-maintenance",
            text: "EVAL_SCHEDULE_MAINTENANCE only for the schedule worker.",
            scope: "schedule",
            scheduleId: "schedule-a",
          },
          {
            id: "diagnostic-capture-failure",
            text: "EVAL_DIAGNOSTIC_CAPTURE_FAILURE invalid display id detail.",
            scope: "diagnostic",
            ownerId: "group-a",
          },
        ],
        queries: [
          {
            id: "long-term-hit",
            query: "EVAL_DONGCHEON_WEATHER",
            expectedHitDocumentIds: ["long-term-weather-preference"],
          },
          {
            id: "session-hit",
            query: "EVAL_CHANNEL_CORRECTION",
            filters: { sessionId: "session-a" },
            expectedHitDocumentIds: ["short-term-channel-correction"],
          },
          {
            id: "schedule-hidden-by-default",
            query: "EVAL_SCHEDULE_MAINTENANCE",
            expectedHitDocumentIds: [],
            unexpectedHitDocumentIds: ["schedule-maintenance"],
          },
          {
            id: "diagnostic-hidden-by-default",
            query: "EVAL_DIAGNOSTIC_CAPTURE_FAILURE",
            filters: { requestGroupId: "group-a" },
            expectedHitDocumentIds: [],
            unexpectedHitDocumentIds: ["diagnostic-capture-failure"],
          },
        ],
      },
      modes: ["fts", "vector", "hybrid"],
    })

    expect(report.summary.total).toBe(12)
    expect(report.summary.modes).toEqual(["fts", "vector", "hybrid"])
    expect(report.queryResults.filter((result) => result.mode === "fts").every((result) => result.passed)).toBe(true)
    expect(report.queryResults.filter((result) => result.mode === "hybrid").every((result) => result.passed)).toBe(true)
    expect(report.queryResults.some((result) => result.mode === "vector" && result.missedDocumentIds.length > 0)).toBe(true)
  })

  it("falls back to FTS when vector backend is disabled and records degraded diagnostics", async () => {
    await storeMemoryDocument({
      rawText: "VECTOR_DISABLED_FALLBACK_DOC survives when vector backend is disabled",
      scope: "long-term",
      sourceType: "test",
      metadata: { requiresReview: false },
    })

    const results = await searchMemoryChunks("VECTOR_DISABLED_FALLBACK_DOC", 3, "vector", {
      sessionId: "session-a",
      runId: "run-vector-disabled",
      requestGroupId: "group-vector-disabled",
    })

    expect(results[0]?.chunk.content).toContain("VECTOR_DISABLED_FALLBACK_DOC")
    expect(results[0]?.source).toBe("fts")

    const diagnostic = getDb()
      .prepare<[], { kind: string; summary: string; detail_json: string | null }>(
        `SELECT kind, summary, detail_json FROM diagnostic_events WHERE run_id = 'run-vector-disabled' LIMIT 1`,
      )
      .get()
    expect(diagnostic?.kind).toBe("memory_vector_degraded")
    expect(diagnostic?.summary).toContain("embedding provider is not configured")
    expect(diagnostic?.detail_json).toContain("disabled")
  })

  it("diagnoses embedding dimension, model, and stale-checksum mismatches without raw errors", () => {
    const diagnostics = diagnoseVectorEmbeddingRows([
      {
        provider: "openai",
        model: "old-model",
        dimensions: 768,
        text_checksum: "old-checksum",
        checksum: "current-checksum",
        vector: Buffer.alloc(768 * 4),
      },
      {
        provider: "openai",
        model: "text-embedding-3-small",
        dimensions: 768,
        text_checksum: "same-checksum",
        checksum: "same-checksum",
        vector: Buffer.alloc(768 * 4),
      },
    ], {
      providerId: "openai",
      modelId: "text-embedding-3-small",
      dimensions: 1536,
    })

    expect(diagnostics.map((diagnostic) => diagnostic.reason)).toEqual([
      "model_mismatch",
      "dimension_mismatch",
      "stale_embedding",
    ])
    expect(diagnostics.map((diagnostic) => diagnostic.summary).join("\n")).not.toMatch(/Error:|stack|<html/i)
  })

  it("creates task003 scope tables and records TTL-backed operational metadata", () => {
    const tables = getDb()
      .prepare<[], { name: string }>(
        `SELECT name FROM sqlite_master
         WHERE name IN ('flash_feedback', 'schedule_entries', 'artifact_receipts', 'diagnostic_events')
         ORDER BY name`,
      )
      .all()
      .map((row) => row.name)

    expect(tables).toEqual(["artifact_receipts", "diagnostic_events", "flash_feedback", "schedule_entries"])

    const before = Date.now()
    insertFlashFeedback({
      sessionId: "session-a",
      runId: "run-a",
      requestGroupId: "group-a",
      content: "방금 지적한 채널 혼선을 다음 실행에 반영",
      severity: "high",
      ttlMs: 60_000,
    })
    upsertScheduleMemoryEntry({
      scheduleId: "schedule-a",
      sessionId: "session-a",
      requestGroupId: "group-a",
      title: "daily check",
      prompt: "매일 확인",
      cronExpression: "0 9 * * *",
      nextRunAt: before + 86_400_000,
    })
    insertArtifactReceipt({
      runId: "run-a",
      requestGroupId: "group-a",
      channel: "slack",
      artifactPath: "/tmp/capture.png",
      mimeType: "image/png",
      sizeBytes: 1234,
      deliveredAt: before,
      deliveryReceipt: { ok: true },
    })
    insertDiagnosticEvent({
      runId: "run-a",
      sessionId: "session-a",
      requestGroupId: "group-a",
      recoveryKey: "screen_capture:main:invalid_display:retry",
      kind: "tool_failure",
      summary: "display id normalized",
      detail: { sanitized: true },
    })

    const feedback = getDb()
      .prepare<[], { expires_at: number; severity: string }>(`SELECT expires_at, severity FROM flash_feedback LIMIT 1`)
      .get()
    const schedule = getDb()
      .prepare<[], { schedule_id: string; prompt: string }>(`SELECT schedule_id, prompt FROM schedule_entries LIMIT 1`)
      .get()
    const receipt = getDb()
      .prepare<[], { channel: string; artifact_path: string; delivered_at: number | null }>(`SELECT channel, artifact_path, delivered_at FROM artifact_receipts LIMIT 1`)
      .get()
    const diagnostic = getDb()
      .prepare<[], { recovery_key: string; summary: string }>(`SELECT recovery_key, summary FROM diagnostic_events LIMIT 1`)
      .get()

    expect(feedback?.severity).toBe("high")
    expect(feedback?.expires_at).toBeGreaterThan(before)
    expect(schedule).toEqual({ schedule_id: "schedule-a", prompt: "매일 확인" })
    expect(receipt).toEqual({ channel: "slack", artifact_path: "/tmp/capture.png", delivered_at: before })
    expect(diagnostic).toEqual({ recovery_key: "screen_capture:main:invalid_display:retry", summary: "display id normalized" })
  })

  it("enforces owner rules for short-term and schedule memory documents", async () => {
    await expect(storeMemoryDocument({
      rawText: "owner 없는 short-term memory",
      scope: "short-term",
      sourceType: "test",
    })).rejects.toThrow("short-term memory requires an owner id")

    await expect(storeMemoryDocument({
      rawText: "owner 없는 schedule memory",
      scope: "schedule",
      sourceType: "test",
    })).rejects.toThrow("schedule memory requires an owner id")

    const flash = await storeMemoryDocument({
      rawText: "FLASH_VISIBLE_FOR_SESSION_A",
      scope: "flash-feedback",
      ownerId: "session-a",
      sourceType: "feedback",
    })
    const schedule = await storeMemoryDocument({
      rawText: "SCHEDULE_VISIBLE_ONLY_FOR_SCHEDULE_A",
      scope: "schedule",
      scheduleId: "schedule-a",
      sourceType: "schedule",
    })

    expect(flash.deduplicated).toBe(false)
    expect(schedule.deduplicated).toBe(false)
  })

  it("separates long-term, session-local, schedule, artifact, and diagnostic retrieval scopes", async () => {
    await storeMemoryDocument({
      rawText: "LONG_TERM_VISIBLE_GLOBAL",
      scope: "long-term",
      sourceType: "preference",
    })
    await storeMemoryDocument({
      rawText: "SHORT_TERM_VISIBLE_SESSION_A",
      scope: "short-term",
      ownerId: "session-a",
      sourceType: "turn_context",
    })
    await storeMemoryDocument({
      rawText: "SCHEDULE_HIDDEN_BY_DEFAULT",
      scope: "schedule",
      scheduleId: "schedule-a",
      sourceType: "schedule",
    })
    await storeMemoryDocument({
      rawText: "ARTIFACT_METADATA_HIDDEN_BY_DEFAULT",
      scope: "artifact",
      ownerId: "group-a",
      sourceType: "artifact",
    })
    await storeMemoryDocument({
      rawText: "DIAGNOSTIC_HIDDEN_BY_DEFAULT",
      scope: "diagnostic",
      ownerId: "group-a",
      sourceType: "diagnostic",
    })
    rebuildMemorySearchIndexes()

    const global = await buildMemoryContext({ query: "LONG_TERM_VISIBLE_GLOBAL", sessionId: "session-b" })
    expect(global).toContain("LONG_TERM_VISIBLE_GLOBAL")

    const hiddenSession = await buildMemoryContext({ query: "SHORT_TERM_VISIBLE_SESSION_A", sessionId: "session-b" })
    expect(hiddenSession).not.toContain("SHORT_TERM_VISIBLE_SESSION_A")

    const visibleSession = await buildMemoryContext({ query: "SHORT_TERM_VISIBLE_SESSION_A", sessionId: "session-a" })
    expect(visibleSession).toContain("SHORT_TERM_VISIBLE_SESSION_A")

    const hiddenSchedule = await buildMemoryContext({ query: "SCHEDULE_HIDDEN_BY_DEFAULT", sessionId: "session-a" })
    expect(hiddenSchedule).not.toContain("SCHEDULE_HIDDEN_BY_DEFAULT")

    const visibleSchedule = await buildMemoryContext({
      query: "SCHEDULE_HIDDEN_BY_DEFAULT",
      includeSchedule: true,
      scheduleId: "schedule-a",
    })
    expect(visibleSchedule).toContain("SCHEDULE_HIDDEN_BY_DEFAULT")

    const hiddenArtifact = await buildMemoryContext({ query: "ARTIFACT_METADATA_HIDDEN_BY_DEFAULT", requestGroupId: "group-a" })
    expect(hiddenArtifact).not.toContain("ARTIFACT_METADATA_HIDDEN_BY_DEFAULT")

    const visibleArtifact = await buildMemoryContext({
      query: "ARTIFACT_METADATA_HIDDEN_BY_DEFAULT",
      requestGroupId: "group-a",
      includeArtifact: true,
    })
    expect(visibleArtifact).toContain("ARTIFACT_METADATA_HIDDEN_BY_DEFAULT")
  })

  it("excludes unapproved long-term candidates and expired flash-feedback from retrieval", async () => {
    await storeMemoryDocument({
      rawText: "LONG_TERM_REVIEW_APPROVED should be injected",
      scope: "long-term",
      sourceType: "durable_fact_candidate",
      metadata: { requiresReview: false, approved: true },
    })
    await storeMemoryDocument({
      rawText: "LONG_TERM_REVIEW_UNAPPROVED should stay hidden",
      scope: "long-term",
      sourceType: "flash_feedback_promotion_candidate",
      metadata: { requiresReview: true, approved: false },
    })
    await storeMemoryDocument({
      rawText: "FLASH_FEEDBACK_ACTIVE should be injected",
      scope: "flash-feedback",
      ownerId: "session-a",
      sourceType: "flash_feedback",
      metadata: { expiresAt: Date.now() + 60_000 },
    })
    await storeMemoryDocument({
      rawText: "FLASH_FEEDBACK_EXPIRED should stay hidden",
      scope: "flash-feedback",
      ownerId: "session-a",
      sourceType: "flash_feedback",
      metadata: { expiresAt: Date.now() - 60_000 },
    })

    const longTermContext = await buildMemoryContext({ query: "LONG_TERM_REVIEW", sessionId: "session-a" })
    expect(longTermContext).toContain("LONG_TERM_REVIEW_APPROVED")
    expect(longTermContext).not.toContain("LONG_TERM_REVIEW_UNAPPROVED")

    const defaultFlashContext = await buildMemoryContext({ query: "FLASH_FEEDBACK", sessionId: "session-a" })
    expect(defaultFlashContext).not.toContain("FLASH_FEEDBACK_ACTIVE")

    const flashContext = await buildMemoryContext({ query: "FLASH_FEEDBACK", sessionId: "session-a", includeFlashFeedback: true })
    expect(flashContext).toContain("FLASH_FEEDBACK_ACTIVE")
    expect(flashContext).not.toContain("FLASH_FEEDBACK_EXPIRED")
  })

  it("limits injected chunks and keeps diagnostic memory out unless explicitly requested", async () => {
    for (let index = 0; index < 6; index++) {
      await storeMemoryDocument({
        rawText: `anchor-global-memory-${index} ${"본문".repeat(300)}`,
        scope: "global",
        sourceType: "test",
      })
    }
    await storeMemoryDocument({
      rawText: "DIAGNOSTIC_ONLY anchor failure detail",
      scope: "diagnostic",
      ownerId: "group-a",
      sourceType: "test_failure",
    })

    const defaultContext = await buildMemoryContext({
      query: "anchor",
      sessionId: "session-a",
      requestGroupId: "group-a",
      runId: "run-a",
      budget: { maxChunks: 2, maxChars: 700, maxChunkChars: 160 },
    })
    const injectedLines = defaultContext.split("\n").filter((line) => line.startsWith("- ["))
    expect(injectedLines.length).toBeLessThanOrEqual(2)
    expect(defaultContext).not.toContain("DIAGNOSTIC_ONLY")
    expect(defaultContext.length).toBeLessThanOrEqual(760)

    const diagnosticContext = await buildMemoryContext({
      query: "DIAGNOSTIC_ONLY",
      sessionId: "session-a",
      requestGroupId: "group-a",
      runId: "run-a",
      includeDiagnostic: true,
      budget: { maxChunks: 2, maxChars: 700, maxChunkChars: 160 },
    })
    expect(diagnosticContext).toContain("DIAGNOSTIC_ONLY")
  })

  it("finds task journal handoff by request group while hiding other task scopes", () => {
    insertMemoryJournalRecord({
      kind: "instruction",
      scope: "task",
      content: "handoff-visible summary",
      summary: "handoff-visible summary",
      sessionId: "session-a",
      runId: "child-a",
      requestGroupId: "group-a",
      source: "webui",
    })
    insertMemoryJournalRecord({
      kind: "failure",
      scope: "task",
      content: "hidden-child failure",
      summary: "hidden-child failure",
      sessionId: "session-a",
      runId: "child-other",
      requestGroupId: "group-other",
      source: "webui",
    })

    const context = buildMemoryJournalContext("handoff-visible", {
      sessionId: "session-a",
      requestGroupId: "group-a",
      runId: "child-b",
    })
    const hidden = buildMemoryJournalContext("hidden-child", {
      sessionId: "session-a",
      requestGroupId: "group-a",
      runId: "child-b",
    })

    expect(context).toContain("handoff-visible")
    expect(hidden).not.toContain("hidden-child")
  })

  it("does not pass sibling child tool results through request-group context", () => {
    const messages: DbRequestGroupMessage[] = [
      createMessage({ id: "root-user", runId: "group-a", role: "user", content: "원 요청" }),
      createMessage({ id: "root-assistant", runId: "group-a", role: "assistant", content: "root summary" }),
      createMessage({ id: "child-a-tool", runId: "child-a", role: "user", content: "SIBLING_TOOL_RESULT", toolCalls: "[{\"type\":\"tool_result\",\"content\":\"SIBLING_TOOL_RESULT\"}]" }),
      createMessage({ id: "child-a-assistant", runId: "child-a", role: "assistant", content: "child private result" }),
    ]

    const selected = selectRequestGroupContextMessages(messages)
    expect(selected.map((message) => message.id)).toEqual(["root-user", "root-assistant"])
    expect(selected.map((message) => message.content).join("\n")).not.toContain("SIBLING_TOOL_RESULT")
  })

  it("writes run completion candidates silently without promoting diagnostics to global memory", () => {
    rememberRunSuccess({
      runId: "run-success",
      sessionId: "session-a",
      source: "webui",
      text: "성공 결과 본문",
      summary: "성공 요약",
    })
    rememberRunFailure({
      runId: "run-failure",
      sessionId: "session-a",
      source: "webui",
      summary: "실패 요약",
      detail: "상세 실패 원인",
      title: "test_failure",
    })

    const rows = getDb()
      .prepare<[], { scope: string; source_type: string }>(
        `SELECT scope, source_type FROM memory_writeback_queue ORDER BY created_at ASC`,
      )
      .all()
    const snapshot = getDb()
      .prepare<[string], { summary: string }>(`SELECT summary FROM session_snapshots WHERE session_id = ?`)
      .get("session-a")

    expect(rows).toEqual([
      { scope: "session", source_type: "success" },
      { scope: "diagnostic", source_type: "test_failure" },
    ])
    expect(snapshot?.summary).toBe("성공 요약")
  })
})

function createMessage(params: {
  id: string
  runId: string
  role: "user" | "assistant"
  content: string
  toolCalls?: string | null
}): DbRequestGroupMessage {
  return {
    id: params.id,
    session_id: "session-a",
    root_run_id: params.runId,
    role: params.role,
    content: params.content,
    tool_calls: params.toolCalls ?? null,
    tool_call_id: null,
    created_at: Date.now(),
    run_prompt: "원 요청",
    run_request_group_id: "group-a",
    run_worker_session_id: params.runId === "group-a" ? null : "worker-a",
    run_context_mode: params.runId === "group-a" ? "full" : "request_group",
  }
}
