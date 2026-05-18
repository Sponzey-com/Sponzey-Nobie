import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import {
  closeDb,
  getDb,
  getMemoryCapsule,
  getTaskContinuity,
  insertMemoryCapsule,
  insertMemoryCapsuleSource,
  insertMemoryCompactionRun,
  insertMessage,
  insertSession,
  listMemoryCapsulesForOwner,
  projectMemoryCapsuleToCompatibilityStores,
} from "../packages/core/src/db/index.js"
import { closeMemoryJournalDb } from "../packages/core/src/memory/journal.js"
import type { MemoryCapsule } from "../packages/core/src/memory/capsule.ts"

const tempDirs: string[] = []
const previousStateDir = process.env["NOBIE_STATE_DIR"]
const previousConfig = process.env["NOBIE_CONFIG"]

function useTempState(): void {
  closeDb()
  closeMemoryJournalDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task001-memory-"))
  tempDirs.push(stateDir)
  process.env["NOBIE_STATE_DIR"] = stateDir
  delete process.env["NOBIE_CONFIG"]
  reloadConfig()
}

function baseCapsule(capsuleId: string, createdAt: number): MemoryCapsule {
  return {
    capsuleId,
    capsuleVersion: 1,
    ownerScope: {
      ownerType: "main_agent",
      ownerId: "agent:nobie",
      sessionId: "session-append",
      requestGroupId: "group-append",
      lineageId: "lineage-append",
      channelKey: "webui",
      threadKey: "thread-append",
    },
    nicknameSnapshot: "노비",
    capsuleKind: "session_compaction",
    summary: `캡슐 ${capsuleId} 요약`,
    activeObjectives: ["현재 작업 유지"],
    confirmedFacts: ["핵심 결정은 보존한다"],
    decisions: ["append-only를 유지한다"],
    constraints: ["민감정보는 제외한다"],
    pendingItems: ["pending_approval:screen", "pending_delivery:slack:file"],
    artifactRefs: [{ artifactId: "artifact-1", note: "최근 스크린샷" }],
    recoveryHints: ["필요 시 continuity로 복원"],
    sourceRefs: ["message:1", "message:2"],
    compactedMessageIds: ["msg-1", "msg-2"],
    sourceTokenEstimate: 2048,
    resultTokenEstimate: 768,
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

describe("task001 append-only memory capsule persistence", () => {
  it("persists capsules append-only while keeping original messages intact", () => {
    insertSession({
      id: "session-append",
      source: "webui",
      source_id: null,
      created_at: 1,
      updated_at: 1,
      summary: null,
    })
    insertMessage({
      id: "msg-1",
      session_id: "session-append",
      root_run_id: null,
      role: "user",
      content: "첫 번째 긴 메시지",
      tool_calls: null,
      tool_call_id: null,
      created_at: 1,
    })
    insertMessage({
      id: "msg-2",
      session_id: "session-append",
      root_run_id: null,
      role: "assistant",
      content: "두 번째 긴 응답",
      tool_calls: null,
      tool_call_id: null,
      created_at: 2,
    })

    const firstCapsule = baseCapsule("capsule-a", 100)
    const secondCapsule = baseCapsule("capsule-b", 200)

    insertMemoryCapsule(firstCapsule)
    insertMemoryCompactionRun({
      capsuleId: firstCapsule.capsuleId,
      ownerScope: firstCapsule.ownerScope,
      triggerReasonCodes: ["token_threshold_exceeded"],
      sourceTokenEstimate: firstCapsule.sourceTokenEstimate,
      resultTokenEstimate: firstCapsule.resultTokenEstimate,
      status: "completed",
      validationSummary: "valid",
    })
    insertMemoryCapsuleSource({
      capsuleId: firstCapsule.capsuleId,
      sourceKind: "message",
      sourceId: "msg-1",
      ownerType: "main_agent",
      ownerId: "agent:nobie",
      metadata: { ordinal: 0 },
    })
    const projection = projectMemoryCapsuleToCompatibilityStores(firstCapsule)
    insertMemoryCapsule(secondCapsule)

    const messageCount = getDb()
      .prepare<[], { count: number }>("SELECT count(*) AS count FROM messages")
      .get()?.count
    const capsuleRows = getDb()
      .prepare<[], { count: number }>("SELECT count(*) AS count FROM memory_capsules")
      .get()?.count
    const compactionRuns = getDb()
      .prepare<[], { count: number }>("SELECT count(*) AS count FROM memory_compaction_runs")
      .get()?.count
    const snapshot = getDb()
      .prepare<[], { summary: string; preserved_facts: string; active_task_ids: string }>(
        "SELECT summary, preserved_facts, active_task_ids FROM session_snapshots WHERE session_id = 'session-append' LIMIT 1",
      )
      .get()
    const continuity = getTaskContinuity("lineage-append")
    const listedCapsules = listMemoryCapsulesForOwner({
      ownerType: "main_agent",
      ownerId: "agent:nobie",
      sessionId: "session-append",
    })

    expect(messageCount).toBe(2)
    expect(capsuleRows).toBe(2)
    expect(compactionRuns).toBe(1)
    expect(getMemoryCapsule("capsule-a")?.summary).toBe("캡슐 capsule-a 요약")
    expect(listedCapsules.map((item) => item.capsuleId)).toEqual(["capsule-b", "capsule-a"])
    expect(projection.sessionSnapshotId).toBeTruthy()
    expect(snapshot?.summary).toBe("캡슐 capsule-a 요약")
    expect(snapshot?.preserved_facts).toContain("pending_item:pending_approval:screen")
    expect(snapshot?.preserved_facts).toContain("constraint:민감정보는 제외한다")
    expect(snapshot?.active_task_ids).toContain("group-append")
    expect(continuity).toEqual(expect.objectContaining({
      lineageRootRunId: "lineage-append",
      handoffSummary: "캡슐 capsule-a 요약",
      lastGoodState: "캡슐 capsule-a 요약",
      pendingApprovals: ["screen"],
      pendingDelivery: ["slack:file"],
      status: "capsule_projected",
    }))
  })
})
