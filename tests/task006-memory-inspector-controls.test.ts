import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { AIChunk, AIProvider, ChatParams } from "../packages/core/src/ai/types.js"
import { reloadConfig } from "../packages/core/src/config/index.js"
import {
  closeDb,
  insertMessage,
  insertSession,
  upsertAgentMemoryState,
} from "../packages/core/src/db/index.js"
import {
  buildMainAgentMemoryStateScope,
} from "../packages/core/src/memory/agent-state.ts"
import {
  buildMemoryInspectorSnapshot,
  runMemoryInspectorControl,
} from "../packages/core/src/memory/inspector.ts"
import { closeMemoryJournalDb } from "../packages/core/src/memory/journal.js"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

class ManualControlProvider implements AIProvider {
  readonly id = "task006-memory-inspector-controls"
  readonly supportedModels = ["compact-manual-control"]

  maxContextTokens(): number {
    return 20_000
  }

  async *chat(_params: ChatParams): AsyncGenerator<AIChunk> {
    yield {
      type: "text_delta",
      delta: JSON.stringify({
        what_happened: "manual control compaction",
        current_goal: ["memory inspector 강제 compact"],
        still_open: ["pending_approval:manual-approval"],
        confirmed_facts: ["user_locale=ko"],
        must_keep_constraints: ["민감정보 금지"],
        artifacts_and_receipts: [],
        tool_side_effect_boundary: ["기존 결과 재사용"],
        retry_do_not_repeat: [],
        handoff_ready_context: ["manual restore ready"],
      }),
    }
    yield { type: "message_stop", usage: { input_tokens: 1, output_tokens: 1 } }
  }
}

function useTempState(): void {
  closeDb()
  closeMemoryJournalDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task006-memory-controls-"))
  tempDirs.push(stateDir)
  const configPath = join(stateDir, "config.json5")
  writeFileSync(configPath, `{
    ai: {
      connection: {
        provider: "openai",
        model: "compact-manual-control",
        auth: {
          mode: "api_key",
          apiKey: "test-key-task006"
        }
      }
    },
    memory: {
      compaction: {
        minContextTokens: 3000
      }
    }
  }`, "utf-8")
  process.env["NOBIE_STATE_DIR"] = stateDir
  process.env["NOBIE_CONFIG"] = configPath
  reloadConfig()
}

function seedRootSessionState(): void {
  const now = Date.now()
  insertSession({
    id: "session-task006-memory-controls",
    source: "webui",
    source_id: "thread-task006-memory-controls",
    created_at: now,
    updated_at: now,
    summary: "task006 memory controls",
  })
  insertMessage({
    id: "msg-task006-memory-controls-user",
    session_id: "session-task006-memory-controls",
    root_run_id: null,
    role: "user",
    content: [
      "active_task:task006-memory-controls",
      "objective:memory inspector 강제 compact",
      "pending_approval:manual-approval",
      "pending_delivery:telegram:manual-delivery",
      "confirmed_fact:user_locale=ko",
      "constraint:민감정보 금지",
      "decision:기존 결과 재사용",
    ].join("\n"),
    tool_calls: null,
    tool_call_id: null,
    created_at: now,
  })
  upsertAgentMemoryState({
    stateId: "state-task006-memory-controls",
    ownerScope: buildMainAgentMemoryStateScope({
      sessionId: "session-task006-memory-controls",
      channelKey: "webui",
      threadKey: "thread-task006-memory-controls",
    }),
    ownerScopeKey: "",
    nicknameSnapshot: "노비",
    currentRawTokenEstimate: 180_000,
    currentRawMessageCount: 1,
    createdAt: now,
    updatedAt: now,
  })
}

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

describe("task006 memory inspector controls", () => {
  it("executes force compaction and invalidates the latest capsule pointer without deleting history", async () => {
    useTempState()
    seedRootSessionState()

    const before = buildMemoryInspectorSnapshot({
      ownerType: "main_agent",
      ownerId: "agent:nobie",
      sessionId: "session-task006-memory-controls",
      limit: 12,
    })
    expect(before.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "force_compaction", enabled: true }),
      ]),
    )

    const compactResult = await runMemoryInspectorControl({
      action: "force_compaction",
      ownerType: "main_agent",
      ownerId: "agent:nobie",
      sessionId: "session-task006-memory-controls",
      provider: new ManualControlProvider(),
      model: "compact-manual-control",
      limit: 12,
    })
    expect(compactResult.enabled).toBe(true)
    expect(compactResult.reason).toBe("compaction_written")
    expect(compactResult.latestCapsule?.pendingItems).toEqual(
      expect.arrayContaining([
        "pending_approval:manual-approval",
        "pending_delivery:telegram:manual-delivery",
      ]),
    )

    const afterCompact = buildMemoryInspectorSnapshot({
      ownerType: "main_agent",
      ownerId: "agent:nobie",
      sessionId: "session-task006-memory-controls",
      limit: 12,
    })
    expect(afterCompact.latestCapsule?.summary).toContain("manual control compaction")
    expect(afterCompact.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "capsule_invalidate", enabled: true }),
      ]),
    )

    const invalidateResult = await runMemoryInspectorControl({
      action: "capsule_invalidate",
      ownerType: "main_agent",
      ownerId: "agent:nobie",
      sessionId: "session-task006-memory-controls",
      limit: 12,
    })
    expect(invalidateResult.enabled).toBe(true)
    expect(invalidateResult.reason).toBe("capsule_pointer_cleared")

    const afterInvalidate = buildMemoryInspectorSnapshot({
      ownerType: "main_agent",
      ownerId: "agent:nobie",
      sessionId: "session-task006-memory-controls",
      limit: 12,
    })
    expect(afterInvalidate.latestCapsule).toBeNull()
    expect(afterInvalidate.ownerCards[0]?.compactionBlockReason).toBe("manually_invalidated_from_inspector")
    expect(afterInvalidate.recentCompactionRuns).toHaveLength(1)
  })
})
