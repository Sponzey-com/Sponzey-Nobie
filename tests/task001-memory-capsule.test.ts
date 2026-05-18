import { describe, expect, it } from "vitest"
import {
  applyMemoryCapsuleDeterministicState,
  buildSessionSnapshotProjectionFromMemoryCapsule,
  buildTaskContinuityProjectionFromMemoryCapsule,
  normalizeMemoryCapsule,
  validateMemoryCapsule,
  type MemoryCapsule,
} from "../packages/core/src/memory/capsule.ts"

function baseCapsule(overrides: Partial<MemoryCapsule> = {}): MemoryCapsule {
  return {
    capsuleId: "capsule-1",
    capsuleVersion: 1,
    ownerScope: {
      ownerType: "main_agent",
      ownerId: "agent:nobie",
      sessionId: "session-1",
      requestGroupId: "group-1",
      lineageId: "lineage-1",
      channelKey: "webui",
      threadKey: "thread-1",
    },
    nicknameSnapshot: "노비",
    capsuleKind: "session_compaction",
    summary: " 최근 진행 상황 요약 ",
    activeObjectives: [" 현재 작업 유지 ", "현재 작업 유지"],
    confirmedFacts: ["승인 필요 항목이 있다"],
    decisions: ["로컬 작업을 유지한다"],
    constraints: ["민감정보는 요약에 포함하지 않는다"],
    pendingItems: ["pending_approval:screen", "pending_delivery:slack:file"],
    artifactRefs: [{ artifactId: "artifact-1", note: "최근 스크린샷" }],
    recoveryHints: ["문맥이 길어지면 compact를 다시 수행한다"],
    sourceRefs: ["message:1", "message:1", " result:2 "],
    compactedMessageIds: ["msg-1", " msg-2 "],
    sourceTokenEstimate: 2000,
    resultTokenEstimate: 900,
    createdAt: 1_717_171_717,
    ...overrides,
  }
}

describe("task001 memory capsule contract", () => {
  it("normalizes and validates a capsule with expected owner scope", () => {
    const capsule = normalizeMemoryCapsule(baseCapsule())
    const validation = validateMemoryCapsule(capsule, {
      expectedOwnerScope: {
        ownerType: "main_agent",
        ownerId: "agent:nobie",
        sessionId: "session-1",
        channelKey: "webui",
      },
    })

    expect(validation).toEqual({ ok: true, reasonCodes: [] })
    expect(capsule.summary).toBe("최근 진행 상황 요약")
    expect(capsule.activeObjectives).toEqual(["현재 작업 유지"])
    expect(capsule.sourceRefs).toEqual(["message:1", "result:2"])
    expect(capsule.compactedMessageIds).toEqual(["msg-1", "msg-2"])
  })

  it("rejects missing source refs, owner mismatches, and forbidden raw content", () => {
    const missingRefs = validateMemoryCapsule(baseCapsule({ sourceRefs: [] }))
    const ownerMismatch = validateMemoryCapsule(baseCapsule(), {
      expectedOwnerScope: { ownerId: "agent:other", sessionId: "session-1" },
    })
    const forbidden = validateMemoryCapsule(baseCapsule({
      summary: "Bearer very-secret-token-value",
    }))

    expect(missingRefs.reasonCodes).toContain("source_refs_missing")
    expect(ownerMismatch.reasonCodes).toContain("owner_scope_mismatch:ownerId")
    expect(forbidden.reasonCodes).toContain("forbidden_capsule_content:plaintext_secret")
  })

  it("applies deterministic state precedence and builds compatibility projections", () => {
    const merged = applyMemoryCapsuleDeterministicState({
      capsule: baseCapsule({
        pendingItems: [],
        constraints: ["모델이 만든 제약"],
        artifactRefs: [{ artifactId: "artifact-old", note: "모델 요약 산출물" }],
      }),
      deterministicState: {
        constraints: ["runtime constraint"],
        pendingItems: ["pending_approval:screen", "pending_delivery:slack:file"],
        artifactRefs: [{ receiptId: "receipt-1", note: "runtime receipt" }],
      },
    })
    const sessionProjection = buildSessionSnapshotProjectionFromMemoryCapsule(merged)
    const continuityProjection = buildTaskContinuityProjectionFromMemoryCapsule(merged)

    expect(merged.constraints).toEqual(["runtime constraint"])
    expect(merged.pendingItems).toEqual(["pending_approval:screen", "pending_delivery:slack:file"])
    expect(merged.artifactRefs).toEqual([{ receiptId: "receipt-1", note: "runtime receipt" }])
    expect(sessionProjection).toEqual({
      sessionId: "session-1",
      summary: "최근 진행 상황 요약",
      preservedFacts: [
        "pending_item:pending_approval:screen",
        "pending_item:pending_delivery:slack:file",
        "constraint:runtime constraint",
        "confirmed_fact:승인 필요 항목이 있다",
      ],
      activeTaskIds: ["group-1", "lineage-1"],
    })
    expect(continuityProjection).toEqual({
      lineageRootRunId: "lineage-1",
      parentRunId: "group-1",
      handoffSummary: "최근 진행 상황 요약",
      lastGoodState: "최근 진행 상황 요약",
      pendingApprovals: ["screen"],
      pendingDelivery: ["slack:file"],
      status: "capsule_projected",
    })
  })
})
