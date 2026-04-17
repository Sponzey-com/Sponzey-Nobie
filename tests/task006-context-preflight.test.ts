import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, getDb } from "../packages/core/src/db/index.js"
import type { AIChunk, AIProvider, ChatParams, Message, MessageContent } from "../packages/core/src/ai/types.js"
import {
  ContextPreflightBlockedError,
  chatWithContextPreflight,
  prepareChatContext,
} from "../packages/core/src/runs/context-preflight.ts"
import { persistSessionCompactionMaintenance } from "../packages/core/src/memory/compaction.ts"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

class FakeProvider implements AIProvider {
  readonly id = "fake"
  readonly supportedModels = ["fake-model"]
  called = 0

  constructor(private readonly contextTokens: number) {}

  maxContextTokens(_model: string): number {
    return this.contextTokens
  }

  async *chat(_params: ChatParams): AsyncGenerator<AIChunk> {
    this.called += 1
    yield { type: "text_delta", delta: "ok" }
    yield { type: "message_stop", usage: { input_tokens: 1, output_tokens: 1 } }
  }
}

function useTempConfig(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task006-context-"))
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

async function collectChunks(generator: AsyncGenerator<AIChunk>): Promise<AIChunk[]> {
  const chunks: AIChunk[] = []
  for await (const chunk of generator) chunks.push(chunk)
  return chunks
}

beforeEach(() => {
  useTempConfig()
})

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

describe("task006 context preflight", () => {
  it("detects large old tool results and prunes only transient context", () => {
    const oldToolResult = "old-tool-result\n".repeat(700)
    const imageBlock = { type: "image", url: "artifact://screen.png" } as unknown as MessageContent
    const messages: Message[] = [
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tool-1", content: oldToolResult },
          imageBlock,
        ],
      },
      ...Array.from({ length: 8 }, (_, index) => ({ role: "user" as const, content: `recent-${index}` })),
    ]

    const prepared = prepareChatContext({
      provider: new FakeProvider(20_000),
      model: "fake-model",
      messages,
      system: "system prompt",
      tools: [],
      metadata: { runId: "run-context-prune", sessionId: "session-context", operation: "test_pruning" },
    })

    expect(prepared.initialStatus).toBe("needs_pruning")
    expect(prepared.status).toBe("ok")
    expect(prepared.pruningDecisions).toHaveLength(1)
    const originalBlocks = messages[0]?.content as MessageContent[]
    const preparedBlocks = prepared.messages[0]?.content as MessageContent[]
    expect(originalBlocks[0]).toMatchObject({ content: oldToolResult })
    expect(preparedBlocks[0]).toMatchObject({ type: "tool_result" })
    expect(JSON.stringify(preparedBlocks[0])).toContain("tool_result_pruned")
    expect(preparedBlocks[1]).toEqual(imageBlock)
  })

  it("blocks provider calls before context overflow reaches the model", async () => {
    const provider = new FakeProvider(100)
    const messages: Message[] = [{ role: "user", content: "x".repeat(2_000) }]

    await expect(collectChunks(chatWithContextPreflight({
      provider,
      model: "fake-model",
      messages,
      system: "system",
      tools: [],
      metadata: { runId: "run-context-block", sessionId: "session-context", operation: "test_block" },
    }))).rejects.toBeInstanceOf(ContextPreflightBlockedError)

    expect(provider.called).toBe(0)
    const diagnostic = getDb()
      .prepare<[], { kind: string; summary: string; detail_json: string }>(
        "SELECT kind, summary, detail_json FROM diagnostic_events WHERE kind = 'context_preflight' ORDER BY created_at DESC LIMIT 1",
      )
      .get()
    expect(diagnostic?.summary).toContain("blocked_context_overflow")
    expect(diagnostic?.detail_json).toContain("test_block")
  })

  it("persists compaction snapshots through a silent memory flush without user delivery", () => {
    const result = persistSessionCompactionMaintenance({
      sessionId: "session-compact",
      runId: "run-compact",
      requestGroupId: "group-compact",
      summary: "요약된 컨텍스트",
      pendingApprovals: ["approval-1"],
      pendingDelivery: ["telegram:file"],
      durableFacts: ["사용자는 빠른 응답을 선호한다"],
    })

    expect(result.snapshotId).toBeTruthy()
    expect(result.flushCandidateId).toBeTruthy()
    const candidate = getDb()
      .prepare<[string], { source_type: string; content: string; metadata_json: string }>(
        "SELECT source_type, content, metadata_json FROM memory_writeback_queue WHERE id = ?",
      )
      .get(result.flushCandidateId!)
    expect(candidate?.source_type).toBe("compaction_silent_flush")
    expect(candidate?.content).toContain("pending_approval:approval-1")
    expect(candidate?.content).toContain("pending_delivery:telegram:file")
    expect(candidate?.metadata_json).toContain('"silent":true')

    const snapshot = getDb()
      .prepare<[], { summary: string; preserved_facts: string }>(
        "SELECT summary, preserved_facts FROM session_snapshots WHERE session_id = 'session-compact' LIMIT 1",
      )
      .get()
    expect(snapshot?.summary).toBe("요약된 컨텍스트")
    expect(snapshot?.preserved_facts).toContain("pending_approval:approval-1")
    expect(snapshot?.preserved_facts).toContain("pending_delivery:telegram:file")

    const messageCount = getDb().prepare<[], { count: number }>("SELECT count(*) AS count FROM messages").get()?.count
    expect(messageCount).toBe(0)
  })
})
