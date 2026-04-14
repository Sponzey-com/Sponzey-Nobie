import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { closeDb, getDb } from "../packages/core/src/db/index.js"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeMemoryJournalDb } from "../packages/core/src/memory/journal.js"
import {
  buildRunWritebackCandidates,
  isEphemeralToolOutput,
} from "../packages/core/src/memory/writeback.ts"
import {
  buildSessionCompactionSnapshot,
  hasBalancedToolUsePairs,
  needsSessionCompaction,
} from "../packages/core/src/memory/compaction.ts"
import {
  rememberFlashFeedback,
  rememberRunInstruction,
  rememberToolResultWriteback,
} from "../packages/core/src/runs/start-support.ts"
import type { Message } from "../packages/core/src/ai/types.js"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function useTempState(): void {
  closeDb()
  closeMemoryJournalDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task005-writeback-"))
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

describe("task005 writeback and compaction policy", () => {
  it("classifies durable facts, flash feedback, diagnostics, and ephemeral tool output", () => {
    const instruction = buildRunWritebackCandidates({
      kind: "instruction",
      content: "기억해줘 사용자는 한국어 답변을 선호한다",
      sessionId: "session-a",
      requestGroupId: "group-a",
      runId: "run-a",
      source: "webui",
    })
    const toolResult = buildRunWritebackCandidates({
      kind: "tool_result",
      content: "화면 캡처 완료: /tmp/screen.png",
      sessionId: "session-a",
      requestGroupId: "group-a",
      runId: "run-a",
      source: "webui",
      toolName: "screen_capture",
    })
    const failure = buildRunWritebackCandidates({
      kind: "failure",
      content: "screen_capture failed: invalid display",
      sessionId: "session-a",
      requestGroupId: "group-a",
      runId: "run-a",
      source: "webui",
      metadata: { title: "screen_capture_failure" },
    })
    const promotedFeedback = buildRunWritebackCandidates({
      kind: "flash_feedback",
      content: "앞으로 물리적으로 불가능한 요청은 임의로 바꾸지 마",
      sessionId: "session-a",
      requestGroupId: "group-a",
      runId: "run-a",
      source: "webui",
      repeatCount: 2,
    })

    expect(instruction.map((item) => [item.scope, item.sourceType])).toEqual([
      ["task", "instruction"],
      ["long-term", "durable_fact_candidate"],
    ])
    expect(toolResult).toEqual([])
    expect(isEphemeralToolOutput({ toolName: "telegram_send_file", content: "파일 전달 완료" })).toBe(true)
    expect(failure).toMatchObject([{ scope: "diagnostic", sourceType: "screen_capture_failure" }])
    expect(promotedFeedback.map((item) => [item.scope, item.sourceType])).toEqual([
      ["flash-feedback", "flash_feedback"],
      ["long-term", "flash_feedback_promotion_candidate"],
    ])
  })

  it("queues writeback candidates silently without storing transient screen artifacts", () => {
    rememberRunInstruction({
      runId: "run-memory",
      sessionId: "session-a",
      requestGroupId: "group-a",
      source: "webui",
      message: "기억해줘 사용자는 한국어 답변을 선호한다",
    })
    rememberToolResultWriteback({
      runId: "run-memory",
      sessionId: "session-a",
      requestGroupId: "group-a",
      source: "webui",
      toolName: "screen_capture",
      output: "화면 캡처 완료: /tmp/screen.png",
    })
    rememberFlashFeedback({
      runId: "run-memory",
      sessionId: "session-a",
      requestGroupId: "group-a",
      source: "webui",
      text: "앞으로 결과 파일을 채널에 직접 전달하지 않고 경로만 말하지 마",
      repeatCount: 2,
    })

    const rows = getDb()
      .prepare<[], { scope: string; owner_id: string; source_type: string }>(
        `SELECT scope, owner_id, source_type
         FROM memory_writeback_queue
         ORDER BY scope ASC, source_type ASC`,
      )
      .all()

    expect(rows).toEqual(expect.arrayContaining([
      { scope: "task", owner_id: "group-a", source_type: "instruction" },
      { scope: "long-term", owner_id: "global", source_type: "durable_fact_candidate" },
      { scope: "flash-feedback", owner_id: "session-a", source_type: "flash_feedback" },
      { scope: "long-term", owner_id: "global", source_type: "flash_feedback_promotion_candidate" },
    ]))
    expect(rows.some((row) => row.source_type === "tool_result")).toBe(false)
  })

  it("builds restart-safe compaction snapshots with pending work preserved", () => {
    const snapshot = buildSessionCompactionSnapshot({
      sessionId: "session-a",
      requestGroupId: "group-a",
      activeTaskIds: ["group-a", "child-b"],
      pendingApprovals: ["approval:screen_capture"],
      pendingDelivery: ["slack:/tmp/screen.png"],
      summary: "요약".repeat(700),
    })
    const balanced: Message[] = [
      { role: "assistant", content: [{ type: "tool_use", id: "tool-1", name: "screen_capture", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "ok" }] },
    ]
    const unbalanced: Message[] = [
      { role: "assistant", content: [{ type: "tool_use", id: "tool-1", name: "screen_capture", input: {} }] },
    ]

    expect(snapshot.summary.length).toBeLessThanOrEqual(1_200)
    expect(snapshot.activeTaskIds).toEqual(["group-a", "child-b"])
    expect(snapshot.preservedFacts).toEqual([
      "pending_approval:approval:screen_capture",
      "pending_delivery:slack:/tmp/screen.png",
    ])
    expect(hasBalancedToolUsePairs(balanced)).toBe(true)
    expect(hasBalancedToolUsePairs(unbalanced)).toBe(false)
    expect(needsSessionCompaction(Array.from({ length: 41 }, () => ({ role: "user", content: "ping" })), 10)).toBe(true)
  })
})
