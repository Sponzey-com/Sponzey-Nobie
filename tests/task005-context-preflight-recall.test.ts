import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { AIChunk, AIProvider, ChatParams, Message } from "../packages/core/src/ai/types.js"
import { reloadConfig } from "../packages/core/src/config/index.js"
import {
  closeDb,
  getDb,
  insertSession,
  listMemoryRecallEvents,
} from "../packages/core/src/db/index.js"
import { closeMemoryJournalDb } from "../packages/core/src/memory/journal.js"
import { prepareChatContext } from "../packages/core/src/runs/context-preflight.ts"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

class FakeCompactionProvider implements AIProvider {
  readonly id = "fake"
  readonly supportedModels = ["fake-model"]

  constructor(private readonly contextTokens: number) {}

  maxContextTokens(_model: string): number {
    return this.contextTokens
  }

  async *chat(_params: ChatParams): AsyncGenerator<AIChunk> {
    yield {
      type: "text_delta",
      delta: JSON.stringify({
        what_happened: "이전 대화에서 승인과 전달 준비를 여러 번 진행했다.",
        current_goal: ["현재 목표를 이어서 마무리한다."],
        still_open: ["pending_approval:approval-1"],
        confirmed_facts: ["TASK005_RECALL_MARKER는 계속 중요하다."],
        must_keep_constraints: ["민감정보는 노출하지 않는다."],
        artifacts_and_receipts: ["artifact://task005"],
        tool_side_effect_boundary: ["동일 도구를 반복 실행하지 않는다."],
        retry_do_not_repeat: ["tool#attempt-1"],
        handoff_ready_context: ["현재는 검색된 과거 문맥을 참고한다."],
      }),
    }
    yield { type: "message_stop", usage: { input_tokens: 1, output_tokens: 1 } }
  }
}

function useTempState(): void {
  closeDb()
  closeMemoryJournalDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task005-preflight-"))
  tempDirs.push(stateDir)
  const configPath = join(stateDir, "config.json5")
  writeFileSync(configPath, `{
    ai: { connection: { provider: "ollama", model: "llama3.2", endpoint: "http://127.0.0.1:11434" } },
    memory: { searchMode: "fts" },
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

describe("task005 context preflight recall integration", () => {
  it("archives compacted messages, injects recall paths, and keeps retrieval degrade diagnostic-only", async () => {
    insertSession({
      id: "session-task005-preflight",
      source: "webui",
      source_id: "thread-task005",
      created_at: 1,
      updated_at: 1,
      summary: null,
    })
    const provider = new FakeCompactionProvider(4_200)
    const messages: Message[] = [
      {
        role: "user",
        content: [
          "pending_approval:approval-1",
          "TASK005_RECALL_MARKER 오래된 작업 근거",
          "constraint:민감정보 금지",
        ].join("\n"),
      },
      ...Array.from({ length: 46 }, (_, index) => ({
        role: (index % 2 === 0 ? "assistant" : "user") as "assistant" | "user",
        content: `task005-preflight-${index}-${"x".repeat(850)}`,
      })),
      {
        role: "user",
        content: "TASK005_RECALL_MARKER를 기준으로 이어서 정리해줘",
      },
    ]

    const prepared = await prepareChatContext({
      provider,
      model: "fake-model",
      messages,
      system: "system ".repeat(80),
      tools: [],
      metadata: {
        runId: "run-task005-preflight",
        sessionId: "session-task005-preflight",
        requestGroupId: "group-task005-preflight",
        operation: "task005_preflight",
      },
    })

    expect(prepared.status).toBe("ok")
    expect(prepared.compaction?.performed).toBe(true)
    expect(prepared.compaction?.restorePathCodes).toContain("maintenance_restore")
    expect(prepared.compaction?.restorePathCodes).toContain("prompt_time_recall")
    expect(String(prepared.messages[1]?.content)).toContain("[maintenance_restore]")

    const recallEvents = listMemoryRecallEvents({ runId: "run-task005-preflight" })
    expect(recallEvents.some((event) => event.sourceType === "prompt_time_recall")).toBe(true)
    expect(recallEvents.some((event) => event.sourceType === "maintenance_restore")).toBe(true)

    const archiveDocument = getDb()
      .prepare<[], { source_type: string; raw_text: string }>(
        "SELECT source_type, raw_text FROM memory_documents WHERE source_ref IS NOT NULL ORDER BY created_at DESC LIMIT 1",
      )
      .get()
    expect(archiveDocument?.source_type).toBe("memory_capsule_archive")
    expect(archiveDocument?.raw_text).toContain("TASK005_RECALL_MARKER")

    const diagnostic = getDb()
      .prepare<[], { kind: string; detail_json: string }>(
        "SELECT kind, detail_json FROM diagnostic_events WHERE run_id = 'run-task005-preflight' AND kind = 'memory_capsule_restored' ORDER BY created_at DESC LIMIT 1",
      )
      .get()
    expect(diagnostic?.detail_json).toContain("prompt_time_recall")
  })
})
