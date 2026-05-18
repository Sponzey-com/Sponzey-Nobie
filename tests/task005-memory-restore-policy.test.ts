import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import {
  closeDb,
  getDb,
  insertMemoryCapsule,
  listMemoryRecallEvents,
  upsertTaskContinuity,
} from "../packages/core/src/db/index.js"
import type { MemoryCapsule } from "../packages/core/src/memory/capsule.ts"
import {
  buildMaintenanceRestoreContext,
  buildPromptTimeRecallContext,
  recordPromptTimeRecallTrace,
  renderMaintenanceRestorePromptBlock,
} from "../packages/core/src/memory/retrieval-restore.ts"
import { closeMemoryJournalDb } from "../packages/core/src/memory/journal.js"
import { storeMemoryDocument } from "../packages/core/src/memory/store.ts"

const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]
const tempDirs: string[] = []

function useTempState(): void {
  closeDb()
  closeMemoryJournalDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task005-restore-"))
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

function baseCapsule(capsuleId: string, createdAt: number, summary: string): MemoryCapsule {
  return {
    capsuleId,
    capsuleVersion: 1,
    ownerScope: {
      ownerType: "main_agent",
      ownerId: "agent:nobie",
      sessionId: "session-task005",
      requestGroupId: "group-task005",
      lineageId: "group-task005",
      channelKey: "webui",
      threadKey: "thread-main",
    },
    nicknameSnapshot: "노비",
    capsuleKind: "session_compaction",
    summary,
    activeObjectives: ["현재 작업 유지"],
    confirmedFacts: ["TASK005_CONFIRM_FACT"],
    decisions: ["최근 capsule을 우선 사용한다"],
    constraints: ["민감정보 금지"],
    pendingItems: ["pending_approval:approval-1"],
    artifactRefs: [{ note: "artifact://task005" }],
    recoveryHints: ["필요 시 rollup capsule을 참고한다"],
    sourceRefs: ["message:1"],
    compactedMessageIds: ["msg-1"],
    sourceTokenEstimate: 2000,
    resultTokenEstimate: 600,
    createdAt,
  }
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

describe("task005 memory restore policy", () => {
  it("keeps latest instruction precedence during maintenance restore", () => {
    insertMemoryCapsule(baseCapsule("capsule-task005-latest", 200, "오래된 capsule 요약"))
    upsertTaskContinuity({
      lineageRootRunId: "group-task005",
      handoffSummary: "handoff summary",
      latestInstructionSummary: "최신 사용자 지시가 우선이다",
      latestSuccessfulSummary: "직전 성공 상태",
      latestTargetContext: "local target",
      pendingApprovals: ["approval-1"],
      pendingDelivery: ["slack:file-1"],
      status: "awaiting_user",
    })

    const context = buildMaintenanceRestoreContext({
      ownerScope: {
        ownerType: "main_agent",
        ownerId: "agent:nobie",
        sessionId: "session-task005",
        requestGroupId: "group-task005",
        lineageId: "group-task005",
        channelKey: "webui",
        threadKey: "thread-main",
      },
      requestGroupId: "group-task005",
    })
    const block = renderMaintenanceRestorePromptBlock(context)

    expect(context.latestInstructionSummary).toBe("최신 사용자 지시가 우선이다")
    expect(block).toContain("latest_instruction_summary: 최신 사용자 지시가 우선이다")
    expect(block).toContain("[latest_compacted_capsule]")
    expect(block).toContain("latest_target_context: local target")
  })

  it("rejects cross-channel archive chunks during prompt-time recall and logs recall events", async () => {
    await storeMemoryDocument({
      rawText: "TASK005_RECALL_MATCH same-channel snippet",
      scope: "session",
      ownerId: "session-task005",
      sourceType: "memory_capsule_archive",
      sourceRef: "capsule:same",
      title: "same-channel",
      metadata: { channelKey: "webui", threadKey: "thread-main" },
    })
    await storeMemoryDocument({
      rawText: "TASK005_RECALL_MATCH other-channel snippet",
      scope: "session",
      ownerId: "session-task005",
      sourceType: "memory_capsule_archive",
      sourceRef: "capsule:other",
      title: "other-channel",
      metadata: { channelKey: "slack", threadKey: "thread-other" },
    })
    await storeMemoryDocument({
      rawText: "TASK005_DIAGNOSTIC_SECRET should stay hidden",
      scope: "diagnostic",
      ownerId: "session-task005",
      sourceType: "diagnostic",
      sourceRef: "diag:1",
      title: "diagnostic-hidden",
      metadata: {},
    })

    const recall = await buildPromptTimeRecallContext({
      messages: [{ role: "user", content: "TASK005_RECALL_MATCH 이어서 정리해줘" }],
      runId: "run-task005-recall",
      sessionId: "session-task005",
      requestGroupId: "group-task005",
      channelKey: "webui",
      threadKey: "thread-main",
    })

    expect(recall.results).toHaveLength(1)
    expect(recall.results[0]?.chunk.content).toContain("same-channel snippet")
    expect(recall.blockedReasonCodes).toContain("cross_channel_thread_restore_blocked")
    expect(recall.promptBlock).toContain("[prompt_time_recall]")
    expect(recall.promptBlock).not.toContain("TASK005_DIAGNOSTIC_SECRET")

    recordPromptTimeRecallTrace({
      context: recall,
      ownerScope: {
        ownerType: "main_agent",
        ownerId: "agent:nobie",
        sessionId: "session-task005",
        requestGroupId: "group-task005",
        lineageId: "group-task005",
        channelKey: "webui",
        threadKey: "thread-main",
      },
      runId: "run-task005-recall",
      sessionId: "session-task005",
      requestGroupId: "group-task005",
    })

    const recallEvents = listMemoryRecallEvents({ runId: "run-task005-recall" })
    expect(recallEvents).toHaveLength(1)
    expect(recallEvents[0]).toEqual(expect.objectContaining({
      sourceType: "prompt_time_recall",
      canUseForFinalAnswer: true,
      sameSession: true,
      reasonCode: "prompt_time_recall_same_session",
    }))

    const diagnostic = getDb()
      .prepare<[], { kind: string; detail_json: string }>(
        "SELECT kind, detail_json FROM diagnostic_events WHERE run_id = 'run-task005-recall' ORDER BY created_at DESC LIMIT 1",
      )
      .get()
    expect(diagnostic?.kind).toBe("memory_capsule_restored")
    expect(diagnostic?.detail_json).toContain("prompt_time_recall")
  })
})
