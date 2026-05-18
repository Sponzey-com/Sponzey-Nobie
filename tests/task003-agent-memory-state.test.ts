import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { AIChunk, AIProvider, ChatParams, Message } from "../packages/core/src/ai/types.js"
import { reloadConfig } from "../packages/core/src/config/index.js"
import {
  closeDb,
  getAgentMemoryStateByScopeKey,
  getDb,
  insertSession,
  listAgentMemoryStatesForAgent,
  upsertAgentMemoryState,
} from "../packages/core/src/db/index.js"
import {
  buildAgentMemoryStateScopeKey,
  buildMainAgentMemoryStateScope,
  buildSubAgentMemoryStateScope,
} from "../packages/core/src/memory/agent-state.ts"
import { closeMemoryJournalDb } from "../packages/core/src/memory/journal.js"
import { executeRootSessionCompaction } from "../packages/core/src/memory/compaction.ts"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

class CompactionProvider implements AIProvider {
  readonly id = "fake"
  readonly supportedModels = ["fake-model"]

  maxContextTokens(): number {
    return 18_000
  }

  async *chat(_params: ChatParams): AsyncGenerator<AIChunk> {
    yield {
      type: "text_delta",
      delta: JSON.stringify({
        what_happened: "기존 진행 상태를 압축했다.",
        current_goal: ["진행 중인 작업을 이어간다."],
        still_open: ["pending_approval:approval-1"],
        confirmed_facts: ["사용자는 한국어 응답을 원한다."],
        must_keep_constraints: ["민감정보는 노출하지 않는다."],
        artifacts_and_receipts: ["artifact://screen-1"],
        tool_side_effect_boundary: ["기존 산출물을 먼저 확인한다."],
        retry_do_not_repeat: ["screen_capture#attempt-1"],
        handoff_ready_context: ["승인 후 전달만 남았다."],
      }),
    }
    yield { type: "message_stop", usage: { input_tokens: 1, output_tokens: 1 } }
  }
}

function useTempState(): void {
  closeDb()
  closeMemoryJournalDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task003-agent-memory-"))
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

describe("task003 agent memory state", () => {
  it("writes main-agent memory state with internal owner id and stable channel/thread scope", async () => {
    insertSession({
      id: "session-webui",
      source: "webui",
      source_id: null,
      created_at: 1,
      updated_at: 1,
      summary: null,
    })
    const messages: Message[] = [
      { role: "user", content: "pending_approval:approval-1\nconstraint:민감정보 금지\nobjective:현재 승인 완료 후 전달" },
      ...Array.from({ length: 41 }, (_, index) => ({
        role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        content: `긴 대화 블록 ${index} - ${"x".repeat(400)}`,
      })),
    ]

    const result = await executeRootSessionCompaction({
      provider: new CompactionProvider(),
      model: "fake-model",
      sessionId: "session-webui",
      requestGroupId: "group-webui",
      messages,
      sourceTokenEstimate: 5_500,
      triggerReasonCodes: ["message_threshold_exceeded"],
    })

    const scope = buildMainAgentMemoryStateScope({
      sessionId: "session-webui",
      requestGroupId: "group-webui",
      lineageId: "group-webui",
      channelKey: "webui",
      threadKey: "session-webui",
    })
    const state = getAgentMemoryStateByScopeKey(buildAgentMemoryStateScopeKey(scope))

    expect(state).toEqual(expect.objectContaining({
      ownerScope: expect.objectContaining({
        ownerType: "main_agent",
        ownerId: "agent:nobie",
        sessionId: "session-webui",
        requestGroupId: "group-webui",
        lineageId: "group-webui",
        channelKey: "webui",
        threadKey: "session-webui",
      }),
      latestCapsuleId: result.capsuleId,
      nicknameSnapshot: "노비",
      currentRawMessageCount: messages.length,
    }))
  })

  it("keeps ownership stable across rename and separates sibling agent/channel scope keys", () => {
    const subScope = buildSubAgentMemoryStateScope({
      agentId: "agent:researcher",
      sessionId: "session-root",
      requestGroupId: "command:research",
      lineageId: "sub:research",
      channelKey: "slack",
      threadKey: "slack:C123:thread-1",
    })
    const siblingScope = buildSubAgentMemoryStateScope({
      agentId: "agent:writer",
      sessionId: "session-root",
      requestGroupId: "command:writer",
      lineageId: "sub:writer",
      channelKey: "slack",
      threadKey: "slack:C123:thread-1",
    })
    const channelSplitScope = buildSubAgentMemoryStateScope({
      agentId: "agent:researcher",
      sessionId: "session-root",
      requestGroupId: "command:research",
      lineageId: "sub:research",
      channelKey: "telegram",
      threadKey: "telegram:-100:42",
    })

    upsertAgentMemoryState({
      stateId: "state-1",
      ownerScope: subScope,
      ownerScopeKey: buildAgentMemoryStateScopeKey(subScope),
      nicknameSnapshot: "Researcher",
      currentRawTokenEstimate: 120,
      currentRawMessageCount: 3,
      createdAt: 10,
      updatedAt: 10,
    })
    upsertAgentMemoryState({
      stateId: "state-2",
      ownerScope: subScope,
      ownerScopeKey: buildAgentMemoryStateScopeKey(subScope),
      nicknameSnapshot: "Research Archivist",
      currentRawTokenEstimate: 128,
      currentRawMessageCount: 4,
      createdAt: 11,
      updatedAt: 11,
    })
    upsertAgentMemoryState({
      stateId: "state-3",
      ownerScope: siblingScope,
      ownerScopeKey: buildAgentMemoryStateScopeKey(siblingScope),
      nicknameSnapshot: "Writer",
      currentRawTokenEstimate: 32,
      currentRawMessageCount: 1,
      createdAt: 12,
      updatedAt: 12,
    })
    upsertAgentMemoryState({
      stateId: "state-4",
      ownerScope: channelSplitScope,
      ownerScopeKey: buildAgentMemoryStateScopeKey(channelSplitScope),
      nicknameSnapshot: "Research Archivist",
      currentRawTokenEstimate: 64,
      currentRawMessageCount: 2,
      createdAt: 13,
      updatedAt: 13,
    })

    const renamed = getAgentMemoryStateByScopeKey(buildAgentMemoryStateScopeKey(subScope))
    const researcherStates = listAgentMemoryStatesForAgent({
      ownerType: "sub_agent",
      ownerId: "agent:researcher",
    })
    const rowCount = getDb()
      .prepare<[], { count: number }>("SELECT count(*) AS count FROM agent_memory_state")
      .get()?.count

    expect(renamed?.nicknameSnapshot).toBe("Research Archivist")
    expect(researcherStates).toHaveLength(2)
    expect(buildAgentMemoryStateScopeKey(subScope)).not.toBe(buildAgentMemoryStateScopeKey(siblingScope))
    expect(buildAgentMemoryStateScopeKey(subScope)).not.toBe(buildAgentMemoryStateScopeKey(channelSplitScope))
    expect(rowCount).toBe(3)
  })
})
