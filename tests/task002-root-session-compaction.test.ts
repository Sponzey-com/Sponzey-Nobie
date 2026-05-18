import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { AIChunk, AIProvider, ChatParams, Message } from "../packages/core/src/ai/types.js"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, getDb, getMemoryCapsule, getTaskContinuity, insertMessage, insertSession } from "../packages/core/src/db/index.js"
import { closeMemoryJournalDb } from "../packages/core/src/memory/journal.js"
import {
  buildRootSessionPinnedWorkingSet,
  executeRootSessionCompaction,
  extractRootSessionDeterministicState,
} from "../packages/core/src/memory/compaction.ts"
import { prepareChatContext, runContextPreflight } from "../packages/core/src/runs/context-preflight.ts"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

class CompactionProvider implements AIProvider {
  readonly id = "fake"
  readonly supportedModels = ["fake-model"]
  called = 0

  constructor(
    private readonly contextTokens = 20_000,
    private readonly payload = {
      what_happened: "기존 대화에서 승인과 전달 준비를 진행했다.",
      current_goal: ["현재 목표를 이어서 마무리한다."],
      still_open: ["pending_approval:approval-1"],
      confirmed_facts: ["사용자는 한국어 응답을 원한다."],
      must_keep_constraints: ["민감정보는 노출하지 않는다."],
      artifacts_and_receipts: ["artifact://screen-1"],
      tool_side_effect_boundary: ["screen_capture는 재실행 전에 기존 결과를 확인한다."],
      retry_do_not_repeat: ["screen_capture#attempt-1"],
      handoff_ready_context: ["승인 후 전달만 남았다."],
    },
  ) {}

  maxContextTokens(_model: string): number {
    return this.contextTokens
  }

  async *chat(_params: ChatParams): AsyncGenerator<AIChunk> {
    this.called += 1
    yield { type: "text_delta", delta: JSON.stringify(this.payload) }
    yield { type: "message_stop", usage: { input_tokens: 1, output_tokens: 1 } }
  }
}

function useTempState(): void {
  closeDb()
  closeMemoryJournalDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task002-compaction-"))
  tempDirs.push(stateDir)
  const configPath = join(stateDir, "config.json5")
  writeFileSync(configPath, `{
    ai: { connection: { provider: "ollama", model: "llama3.2", endpoint: "http://127.0.0.1:11434" } },
    webui: { enabled: true, host: "127.0.0.1", port: 0, auth: { enabled: false } },
    security: { approvalMode: "off" }
  }`, "utf-8")
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = configPath
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

describe("task002 root session compaction", () => {
  it("extracts deterministic markers and builds a pinned working set", () => {
    const messages: Message[] = [
      {
        role: "user",
        content: [
          "pending_approval:approval-1",
          "pending_delivery:slack:file-1",
          "user_correction:대답은 항상 한국어로 유지",
          "target_selector:yeonjang/local",
          "artifact_receipt:artifact://screen-1",
          "result_review:screen 결과 확인 필요",
          "retry_boundary:screen_capture#attempt-1",
          "final_delivery_block:approval_waiting",
          "confirmed_fact:user_locale=ko",
          "constraint:민감정보 금지",
          "objective:현재 승인 완료 후 전달",
          "active_task:child-task-1",
          "decision:기존 산출물 먼저 재확인",
        ].join("\n"),
      },
    ]

    const deterministicState = extractRootSessionDeterministicState({
      messages,
      requestGroupId: "group-root",
    })
    const pinned = buildRootSessionPinnedWorkingSet({ deterministicState })

    expect(deterministicState.activeTaskIds).toEqual(["group-root", "child-task-1"])
    expect(deterministicState.pendingApprovals).toEqual(["approval-1"])
    expect(deterministicState.pendingDelivery).toEqual(["slack:file-1"])
    expect(deterministicState.explicitTargetSelectors).toEqual(["yeonjang/local"])
    expect(deterministicState.explicitUserCorrections).toEqual(["대답은 항상 한국어로 유지"])
    expect(pinned.pendingItems).toEqual([
      "pending_approval:approval-1",
      "pending_delivery:slack:file-1",
      "result_review:screen 결과 확인 필요",
    ])
    expect(pinned.constraints).toContain("target_selector:yeonjang/local")
    expect(pinned.constraints).toContain("user_correction:대답은 항상 한국어로 유지")
    expect(pinned.constraints).toContain("final_delivery_block:approval_waiting")
    expect(pinned.decisions).toContain("retry_boundary:screen_capture#attempt-1")
    expect(pinned.blockedReasonCodes).toContain("blocked_by_pending_finalization")
  })

  it("persists a root session capsule and keeps deterministic pending items", async () => {
    insertSession({
      id: "session-root",
      source: "webui",
      source_id: null,
      created_at: 1,
      updated_at: 1,
      summary: null,
    })
    const provider = new CompactionProvider()
    const messages: Message[] = [
      { role: "user", content: "pending_approval:approval-1\npending_delivery:slack:file-1\nuser_correction:한국어 유지" },
      { role: "assistant", content: "artifact_receipt:artifact://screen-1\nconstraint:민감정보 금지" },
      ...Array.from({ length: 42 }, (_, index) => ({ role: "user" as const, content: `filler-${index}` })),
    ]

    const result = await executeRootSessionCompaction({
      provider,
      model: "fake-model",
      sessionId: "session-root",
      requestGroupId: "group-root",
      runId: "run-root",
      messages,
      sourceTokenEstimate: 6_000,
      triggerReasonCodes: ["message_threshold_exceeded"],
    })

    expect(provider.called).toBe(1)
    expect(result.capsule.pendingItems).toContain("pending_approval:approval-1")
    expect(result.capsule.pendingItems).toContain("pending_delivery:slack:file-1")
    expect(result.capsule.constraints).toContain("user_correction:한국어 유지")
    expect(getMemoryCapsule(result.capsuleId)?.pendingItems).toContain("pending_approval:approval-1")

    const snapshot = getDb()
      .prepare<[], { summary: string; preserved_facts: string }>(
        "SELECT summary, preserved_facts FROM session_snapshots WHERE session_id = 'session-root' LIMIT 1",
      )
      .get()
    expect(snapshot?.summary).toContain("기존 대화에서 승인과 전달 준비를 진행했다.")
    expect(snapshot?.preserved_facts).toContain("pending_item:pending_approval:approval-1")

    const continuity = getTaskContinuity("group-root")
    expect(continuity).toEqual(expect.objectContaining({
      lineageRootRunId: "group-root",
      pendingApprovals: ["approval-1"],
      pendingDelivery: ["slack:file-1"],
      status: "capsule_projected",
    }))
  })

  it("compacts oversized root session in preflight and rewrites the active window", async () => {
    insertSession({
      id: "session-preflight",
      source: "webui",
      source_id: null,
      created_at: 1,
      updated_at: 1,
      summary: null,
    })
    insertMessage({
      id: "db-msg-1",
      session_id: "session-preflight",
      root_run_id: null,
      role: "user",
      content: "원본 DB 메시지 1",
      tool_calls: null,
      tool_call_id: null,
      created_at: 1,
    })
    insertMessage({
      id: "db-msg-2",
      session_id: "session-preflight",
      root_run_id: null,
      role: "assistant",
      content: "원본 DB 메시지 2",
      tool_calls: null,
      tool_call_id: null,
      created_at: 2,
    })
    const provider = new CompactionProvider(18_000)
    const messages: Message[] = [
      { role: "user", content: "pending_approval:approval-1\nuser_correction:한국어 유지\nconstraint:민감정보 금지" },
      ...Array.from({ length: 44 }, (_, index) => ({
        role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `긴 대화 블록 ${index} - ${"x".repeat(700)}`,
      })),
    ]
    const before = runContextPreflight({
      provider,
      model: "fake-model",
      messages,
      system: "system",
      tools: [],
      metadata: { sessionId: "session-preflight", requestGroupId: "group-preflight", operation: "before_compact" },
    })

    const prepared = await prepareChatContext({
      provider,
      model: "fake-model",
      messages,
      system: "system",
      tools: [],
      metadata: {
        runId: "run-preflight",
        sessionId: "session-preflight",
        requestGroupId: "group-preflight",
        operation: "test_compaction",
      },
    })

    expect(prepared.compaction?.performed).toBe(true)
    expect(prepared.status).toBe("ok")
    expect(prepared.messages.length).toBeLessThan(messages.length)
    expect(typeof prepared.messages[0]?.content).toBe("string")
    expect(String(prepared.messages[0]?.content)).toContain("[pinned_working_set]")
    expect(String(prepared.messages[1]?.content)).toContain("[latest_compacted_capsule]")
    expect(prepared.breakdown.totalTokens).toBeLessThan(before.breakdown.totalTokens)

    const capsuleCount = getDb()
      .prepare<[], { count: number }>("SELECT count(*) AS count FROM memory_capsules")
      .get()?.count
    const originalRows = getDb()
      .prepare<[], { count: number; compressedCount: number }>(
        "SELECT count(*) AS count, SUM(CASE WHEN compressed = 1 THEN 1 ELSE 0 END) AS compressedCount FROM messages WHERE session_id = 'session-preflight'",
      )
      .get()
    expect(capsuleCount).toBe(1)
    expect(originalRows?.count).toBe(2)
    expect(originalRows?.compressedCount ?? 0).toBe(0)
  })

  it("blocks compaction when unmatched tool pairs make the session unsafe to rewrite", async () => {
    insertSession({
      id: "session-blocked",
      source: "webui",
      source_id: null,
      created_at: 1,
      updated_at: 1,
      summary: null,
    })
    const provider = new CompactionProvider(5_000)
    const messages: Message[] = [
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "tool-1", name: "screen_capture", input: {} }],
      },
      ...Array.from({ length: 44 }, (_, index) => ({
        role: "user" as const,
        content: `overflow-${index}-${"y".repeat(1_200)}`,
      })),
    ]

    const prepared = await prepareChatContext({
      provider,
      model: "fake-model",
      messages,
      system: "system",
      tools: [],
      metadata: {
        runId: "run-blocked",
        sessionId: "session-blocked",
        requestGroupId: "group-blocked",
        operation: "test_blocked_compaction",
      },
    })

    expect(prepared.status).toBe("blocked_context_overflow")
    expect(prepared.compaction?.performed).toBe(false)
    expect(prepared.compaction?.blockedReasonCodes).toContain("blocked_by_unmatched_tool_pair")
    expect(provider.called).toBe(0)
  })

  it("falls back to retrieval-only degrade when compacted tail still exceeds the prompt budget", async () => {
    insertSession({
      id: "session-retrieval-only",
      source: "webui",
      source_id: null,
      created_at: 1,
      updated_at: 1,
      summary: null,
    })
    const provider = new CompactionProvider(3_625, {
      what_happened: "기존 대화에서 승인, 산출물 검증, 전달 준비, 도구 실행 경계 정리를 여러 차례 수행했다. ".repeat(6),
      current_goal: [
        "현재 목표를 이어서 마무리한다.",
        "기존 산출물과 승인 상태를 다시 검증한다.",
        "최종 전달 전에 누락된 제약을 다시 확인한다.",
      ],
      still_open: [
        "pending_approval:approval-1",
        "pending_delivery:slack:file-1",
        "result_review:artifact 상태 재검증",
      ],
      confirmed_facts: [
        "사용자는 한국어 응답을 원한다.",
        "기존 산출물을 재사용해야 한다.",
        "민감정보는 노출하면 안 된다.",
      ],
      must_keep_constraints: [
        "민감정보는 노출하지 않는다.",
        "기존 승인 흐름을 무시하지 않는다.",
        "전달 전에 결과 검증을 생략하지 않는다.",
      ],
      artifacts_and_receipts: [
        "artifact://screen-1",
        "receipt://delivery-1",
        "receipt://review-1",
      ],
      tool_side_effect_boundary: [
        "screen_capture는 기존 결과 확인 전 재실행하지 않는다.",
        "전달 도구는 approval 없이 재시도하지 않는다.",
        "동일 artifact를 중복 전달하지 않는다.",
      ],
      retry_do_not_repeat: [
        "screen_capture#attempt-1",
        "delivery#attempt-1",
        "review#attempt-1",
      ],
      handoff_ready_context: [
        "승인 후 전달만 남았다.",
        "기존 receipt와 artifact 상태를 우선 확인한다.",
        "사용자 correction은 한국어 유지다.",
      ],
    })
    const messages: Message[] = [
      {
        role: "user",
        content: [
          "pending_approval:approval-1",
          "pending_delivery:slack:file-1",
          "user_correction:한국어 유지",
          "constraint:민감정보 금지",
          "artifact_receipt:artifact://screen-1",
          "objective:최종 전달 마무리",
          "decision:기존 산출물 확인 후 전달",
        ].join("\n"),
      },
      ...Array.from({ length: 46 }, (_, index) => ({
        role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `retrieval-overflow-${index}-${"z".repeat(900)}`,
      })),
    ]

    const prepared = await prepareChatContext({
      provider,
      model: "fake-model",
      messages,
      system: "system ".repeat(80),
      tools: [],
      metadata: {
        runId: "run-retrieval-only",
        sessionId: "session-retrieval-only",
        requestGroupId: "group-retrieval-only",
        operation: "test_retrieval_only",
      },
    })

    expect(prepared.compaction?.performed).toBe(true)
    expect(prepared.compaction?.degradeMode).toBe("retrieval_only")
    expect(prepared.compaction?.retrievalSnippetCount).toBeGreaterThan(0)
    expect(String(prepared.messages[0]?.content)).toContain("[pinned_working_set_retrieval_only]")
    expect(String(prepared.messages[1]?.content)).toContain("[retrieval_only_context]")
    expect(prepared.status).toBe("ok")
  })
})
