import { describe, expect, it } from "vitest"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import type {
  CommandRequest,
  ExpectedOutputContract,
  ResultReport,
  RuntimeIdentity,
  StructuredTaskScope,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import type { MemoryCapsule } from "../packages/core/src/memory/capsule.ts"
import {
  buildSubSessionFeedbackCapsulePayload,
  buildSubSessionFeedbackPinnedItems,
  buildSubSessionHandoffCapsulePayload,
  buildSubSessionHandoffPinnedItems,
  resolveLatestInstructionPrecedence,
} from "../packages/core/src/memory/flow-capsules.ts"

function identity(entityId: string): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType: "sub_session",
    entityId,
    owner: { ownerType: "sub_agent", ownerId: "agent:researcher" },
    idempotencyKey: `idem:${entityId}`,
    parent: {
      parentRunId: "run:task004",
      parentRequestId: "request:task004",
    },
  }
}

const expectedOutput: ExpectedOutputContract = {
  outputId: "answer",
  kind: "text",
  description: "Provide a concise answer with evidence.",
  required: true,
  acceptance: {
    requiredEvidenceKinds: ["source"],
    artifactRequired: false,
    reasonCodes: ["answer_with_source"],
  },
}

const taskScope: StructuredTaskScope = {
  goal: "Summarize the investigation for parent review.",
  intentType: "review",
  actionType: "delegated_research",
  constraints: ["Do not deliver directly to the user.", "Preserve cited evidence."],
  expectedOutputs: [expectedOutput],
  reasonCodes: ["delegated_research"],
}

function command(): CommandRequest {
  return {
    identity: identity("sub:task004"),
    commandRequestId: "command:task004",
    parentRunId: "run:task004",
    subSessionId: "sub:task004",
    targetAgentId: "agent:researcher",
    targetNicknameSnapshot: "Res",
    taskScope,
    contextPackageIds: ["exchange:ctx-1", "artifact:screen-1"],
    expectedOutputs: [expectedOutput],
  }
}

function latestCapsule(): MemoryCapsule {
  return {
    capsuleId: "capsule:task004",
    capsuleVersion: 1,
    ownerScope: {
      ownerType: "sub_agent",
      ownerId: "agent:researcher",
      sessionId: "session:task004",
      requestGroupId: "command:previous",
      lineageId: "sub:previous",
    },
    capsuleKind: "handoff_compaction",
    summary: "기존 확인된 근거를 유지하고 누락된 인용만 보강한다.",
    activeObjectives: [],
    confirmedFacts: ["근거 2개 확보"],
    decisions: [],
    constraints: ["민감정보 금지"],
    pendingItems: [],
    artifactRefs: [{ note: "screen", artifactId: "artifact:screen-1" }],
    recoveryHints: ["repeat_same_search 금지"],
    sourceRefs: ["exchange:previous"],
    compactedMessageIds: [],
    sourceTokenEstimate: 120,
    resultTokenEstimate: 48,
    createdAt: 1,
  }
}

function resultReport(): ResultReport {
  return {
    identity: identity("sub:result"),
    resultReportId: "result:task004",
    parentRunId: "run:task004",
    subSessionId: "sub:task004",
    status: "completed",
    outputs: [
      { outputId: "answer", status: "partial", value: "초안" },
      { outputId: "notes", status: "satisfied", value: "근거 목록" },
    ],
    evidence: [{ evidenceId: "e1", kind: "source", sourceRef: "source:1" }],
    artifacts: [{ artifactId: "artifact:screen-1", kind: "image", path: "/tmp/screen.png" }],
    risksOrGaps: ["citation missing"],
  }
}

describe("task004 flow capsules", () => {
  it("builds a structured handoff capsule without raw transcript content", () => {
    const payload = buildSubSessionHandoffCapsulePayload({
      command: command(),
      parentSessionId: "session:task004",
      latestCapsule: latestCapsule(),
    })

    expect(payload).toMatchObject({
      kind: "sub_session_handoff_capsule",
      currentGoal: "Summarize the investigation for parent review.",
      latestSafeContextSummary: "기존 확인된 근거를 유지하고 누락된 인용만 보강한다.",
      targetContext: {
        targetAgentId: "agent:researcher",
        commandRequestId: "command:task004",
      },
    })
    expect(buildSubSessionHandoffPinnedItems(payload)).toEqual(
      expect.arrayContaining([
        "handoff_summary:기존 확인된 근거를 유지하고 누락된 인용만 보강한다.",
        expect.stringContaining("completion_criteria:answer"),
        "artifact_ref:exchange:ctx-1",
      ]),
    )
    expect(JSON.stringify(payload)).not.toContain("raw transcript")
  })

  it("builds a structured feedback capsule for revision and redelegation", () => {
    const payload = buildSubSessionFeedbackCapsulePayload({
      resultReports: [resultReport()],
      requiredChanges: ["Attach explicit evidence kind source for answer."],
      additionalConstraints: ["Keep the existing artifact reference."],
      conflictItems: ["draft_without_source"],
      sourceResultReportIds: ["result:task004"],
      expectedOutputRevision: ["answer"],
      reasonCode: "sub_agent_result_review:required_evidence_missing:answer:source:none",
    })

    expect(payload).toEqual(
      expect.objectContaining({
        kind: "sub_session_feedback_capsule",
        keep: ["answer:partial", "notes:satisfied"],
        remove: ["draft_without_source"],
        revise: ["Attach explicit evidence kind source for answer."],
        addConstraints: ["Keep the existing artifact reference."],
        doNotRepeat: ["sub_agent_result_review:required_evidence_missing:answer:source:none"],
        expectedOutputRevision: ["answer"],
        preservedArtifactRefs: ["/tmp/screen.png"],
      }),
    )
    expect(buildSubSessionFeedbackPinnedItems(payload)).toEqual(
      expect.arrayContaining([
        "keep:answer:partial",
        "remove:draft_without_source",
        "revise:Attach explicit evidence kind source for answer.",
      ]),
    )
  })

  it("prefers the latest user instruction over stale continuity restore", () => {
    expect(
      resolveLatestInstructionPrecedence({
        currentInstruction: "방금 수정 지시를 우선한다.",
        latestInstructionSummary: "이전 요약",
        continuityLastGoodState: "stale continuity",
        continuityHandoffSummary: "older handoff",
      }),
    ).toEqual({
      selectedSummary: "방금 수정 지시를 우선한다.",
      selectedSource: "current_instruction",
      staleContinuityIgnored: true,
    })

    expect(
      resolveLatestInstructionPrecedence({
        latestInstructionSummary: "최근 사용자 정정",
        continuityLastGoodState: "older continuity",
      }),
    ).toEqual({
      selectedSummary: "최근 사용자 정정",
      selectedSource: "latest_instruction_summary",
      staleContinuityIgnored: true,
    })
  })
})
