import { describe, expect, it } from "vitest"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.ts"
import type {
  ExpectedOutputContract,
  ResultReport,
  RuntimeIdentity,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import {
  aggregateSubSessionResultsForParent,
  buildParentAggregationRuntimeEvent,
  decideSubSessionCompletionIntegration,
  reviewSubAgentResult,
} from "../packages/core/src/agent/sub-agent-result-review.ts"

function identity(entityId: string): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType: "sub_session",
    entityId,
    owner: { ownerType: "sub_agent", ownerId: "agent:researcher" },
    idempotencyKey: `idem:${entityId}`,
    parent: {
      parentRunId: "run-parent",
      parentRequestId: "request-parent",
    },
  }
}

const sourcedAnswer: ExpectedOutputContract = {
  outputId: "answer",
  kind: "text",
  description: "Source-backed answer.",
  required: true,
  acceptance: {
    requiredEvidenceKinds: ["source"],
    artifactRequired: false,
    reasonCodes: ["source_backed_answer"],
  },
}

function resultReport(overrides: Partial<ResultReport> = {}): ResultReport {
  return {
    identity: identity("sub:child"),
    resultReportId: "result:child",
    parentRunId: "run-parent",
    subSessionId: "sub:child",
    status: "completed",
    outputs: [{ outputId: "answer", status: "satisfied", value: "확인된 답변" }],
    evidence: [{ evidenceId: "evidence:source", kind: "source", sourceRef: "source:primary" }],
    artifacts: [],
    risksOrGaps: [],
    ...overrides,
  }
}

describe("task008 child result parent aggregation", () => {
  it("normalizes child ResultReport into a parent-facing structured aggregation trace", () => {
    const report = resultReport()
    const review = reviewSubAgentResult({
      resultReport: report,
      expectedOutputs: [sourcedAnswer],
    })
    const trace = aggregateSubSessionResultsForParent({
      parentRunId: "run-parent",
      parentAgentId: "agent:nobie",
      originalRequest: "확인된 답변을 알려줘",
      successCriteria: ["answer has source evidence"],
      childResults: [{ subSessionId: "sub:child", resultReport: report, review }],
    })
    const event = buildParentAggregationRuntimeEvent(trace)

    expect(trace).toMatchObject({
      kind: "parent_child_result_aggregation",
      nextAction: "ready_for_finalization",
      finalDeliveryAllowed: true,
      blockedSubSessionIds: [],
      unverifiedSubSessionIds: [],
    })
    expect(trace.childResults[0]).toMatchObject({
      status: "completed",
      confirmedFacts: ["확인된 답변"],
      attemptedMethods: expect.arrayContaining(["evidence:source:source:primary"]),
      unverifiedItems: [],
      remainingAlternatives: [],
      handoffSummary: expect.stringContaining("sub_session:sub:child"),
    })
    expect(event).toMatchObject({
      eventKind: "parent_child_result_aggregated",
      parentRunId: "run-parent",
      payload: trace,
    })
  })

  it("routes an unverified current-fact child result to an available alternative instead of finalizing", () => {
    const report = resultReport({
      outputs: [{ outputId: "answer", status: "partial", value: "나스닥만 확인됨" }],
      evidence: [],
      risksOrGaps: ["코스피 값은 1차 출처에서 확인되지 않음"],
    })
    const review = reviewSubAgentResult({
      resultReport: report,
      expectedOutputs: [sourcedAnswer],
    })
    const trace = aggregateSubSessionResultsForParent({
      parentRunId: "run-parent",
      parentAgentId: "agent:nobie",
      originalRequest: "현재 코스피와 나스닥 지수를 확인해줘",
      successCriteria: ["both values are source-backed"],
      childResults: [{
        subSessionId: "sub:child",
        resultReport: report,
        review,
        canUseSameChild: false,
        canUseOtherDirectChild: true,
        remainingAlternatives: ["다른 직접 하위 실행자에게 별도 출처 확인 위임"],
      }],
      canSelfSolve: false,
    })

    expect(trace.finalDeliveryAllowed).toBe(false)
    expect(trace.nextAction).toBe("redelegate_direct_child")
    expect(trace.unverifiedSubSessionIds).toEqual(["sub:child"])
    expect(trace.reasonCodes).toEqual(expect.arrayContaining([
      "child_result_blocked",
      "child_result_unverified",
      "direct_child_alternative_available",
      "next_action:redelegate_direct_child",
    ]))
  })

  it("does not let limited child success pass the finalizer without parent aggregation", () => {
    const report = resultReport({ risksOrGaps: ["확인 시점이 오래됨"] })
    const review = reviewSubAgentResult({
      resultReport: report,
      expectedOutputs: [sourcedAnswer],
    })
    const trace = aggregateSubSessionResultsForParent({
      parentRunId: "run-parent",
      childResults: [{
        subSessionId: "sub:child",
        resultReport: report,
        review,
        canUseSameChild: true,
      }],
    })

    expect(review.verdict).toBe("limited_success")
    expect(trace.finalDeliveryAllowed).toBe(false)
    expect(trace.nextAction).toBe("augment_same_child")
    expect(decideSubSessionCompletionIntegration([
      { subSessionId: "sub:child", review },
    ])).toMatchObject({
      finalDeliveryAllowed: false,
      parentAggregationRequired: true,
    })
  })

  it("uses fail_with_reason only when no child, self, parent, or user alternative remains", () => {
    const report = resultReport({
      status: "failed",
      outputs: [{ outputId: "answer", status: "missing" }],
      evidence: [],
      risksOrGaps: [],
      impossibleReason: {
        kind: "logical",
        reasonCode: "no_source_exists",
        detail: "확인 가능한 출처가 없습니다.",
      },
    })
    const review = reviewSubAgentResult({
      resultReport: report,
      expectedOutputs: [sourcedAnswer],
    })
    const trace = aggregateSubSessionResultsForParent({
      parentRunId: "run-parent",
      canSelfSolve: false,
      needsUserDecision: false,
      returnToParentAllowed: false,
      childResults: [{
        subSessionId: "sub:child",
        resultReport: report,
        review,
        canUseSameChild: false,
        canUseOtherDirectChild: false,
        canSelfSolve: false,
      }],
    })

    expect(trace.nextAction).toBe("fail_with_reason")
    expect(trace.finalDeliveryAllowed).toBe(false)
    expect(trace.reasonCodes).toContain("no_safe_alternative_remaining")
  })
})
