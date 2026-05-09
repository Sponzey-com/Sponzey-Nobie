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
  reviewSubAgentResult,
} from "../packages/core/src/agent/sub-agent-result-review.ts"

function identity(entityId: string): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType: "sub_session",
    entityId,
    owner: { ownerType: "sub_agent", ownerId: "agent:finance" },
    idempotencyKey: `identity:${entityId}`,
    parent: {
      parentRunId: "run-parent",
      parentRequestId: "request-parent",
    },
  }
}

const sourcedAnswer: ExpectedOutputContract = {
  outputId: "answer",
  kind: "text",
  description: "Primary source-backed answer.",
  required: true,
  acceptance: {
    requiredEvidenceKinds: ["source"],
    artifactRequired: false,
    reasonCodes: ["source_backed_answer"],
  },
}

const marketContext: ExpectedOutputContract = {
  outputId: "market_context",
  kind: "text",
  description: "Secondary market context.",
  required: true,
  acceptance: {
    requiredEvidenceKinds: ["source"],
    artifactRequired: false,
    reasonCodes: ["context_checked"],
  },
}

function resultReport(overrides: Partial<ResultReport> = {}): ResultReport {
  return {
    identity: identity("sub:finance"),
    resultReportId: "result:finance",
    parentRunId: "run-parent",
    subSessionId: "sub:finance",
    status: "completed",
    outputs: [
      { outputId: "answer", status: "satisfied", value: "코스피 지수는 2,700선입니다." },
      { outputId: "market_context", status: "partial", value: "미국 지수만 확인됨" },
    ],
    evidence: [{ evidenceId: "evidence:finance", kind: "source", sourceRef: "source:market-feed" }],
    artifacts: [{ artifactId: "artifact:summary", kind: "note", path: "/tmp/market-summary.md" }],
    risksOrGaps: ["코스피 값의 1차 출처 확인이 부족합니다."],
    ...overrides,
  }
}

describe("task008 child result parent aggregation v2", () => {
  it("keeps a complete parent-facing child result schema before parent finalization", () => {
    const report = resultReport()
    const review = reviewSubAgentResult({
      resultReport: report,
      expectedOutputs: [sourcedAnswer, marketContext],
    })

    const trace = aggregateSubSessionResultsForParent({
      parentRunId: "run-parent",
      parentAgentId: "agent:nobie",
      requestingAgentId: "agent:nobie",
      originalRequest: "현재 코스피와 미국 지수를 확인해줘",
      successCriteria: ["answer and market_context are source-backed"],
      childResults: [{
        subSessionId: "sub:finance",
        resultReport: report,
        review,
        canUseSameChild: false,
        canUseOtherDirectChild: true,
        remainingAlternatives: ["다른 직접 하위 실행자에게 독립 출처 확인 위임"],
      }],
      canSelfSolve: false,
    })
    const child = trace.childResults[0]

    expect(trace).toMatchObject({
      kind: "parent_child_result_aggregation",
      parentRunId: "run-parent",
      nextAction: "redelegate_direct_child",
      finalDeliveryAllowed: false,
      blockedSubSessionIds: ["sub:finance"],
      unverifiedSubSessionIds: ["sub:finance"],
    })
    expect(child).toMatchObject({
      subSessionId: "sub:finance",
      resultReportId: "result:finance",
      status: "partial",
      confirmedFacts: ["코스피 지수는 2,700선입니다."],
      unverifiedItems: expect.arrayContaining([
        "unsatisfied_output:market_context",
        "market_context:partial",
        "reported_risk_or_gap",
      ]),
      attemptedMethods: expect.arrayContaining([
        "evidence:source:source:market-feed",
        "artifact:note:/tmp/market-summary.md",
        "result_report:completed",
      ]),
      remainingAlternatives: ["다른 직접 하위 실행자에게 독립 출처 확인 위임"],
      riskNotes: ["코스피 값의 1차 출처 확인이 부족합니다."],
      handoffSummary: expect.stringContaining("sub_session:sub:finance"),
      reviewVerdict: "needs_revision",
      parentIntegrationStatus: "requires_revision",
    })
    expect(child?.artifacts).toHaveLength(1)
    expect(trace.reasonCodes).toEqual(expect.arrayContaining([
      "child_result_blocked",
      "child_result_unverified",
      "direct_child_alternative_available",
      "next_action:redelegate_direct_child",
      "parent_aggregation_trace_recorded",
    ]))
  })

  it("records parent aggregation before any final channel delivery event can be considered", () => {
    const report = resultReport({
      outputs: [{ outputId: "answer", status: "satisfied", value: "확인 완료" }],
      risksOrGaps: [],
    })
    const review = reviewSubAgentResult({
      resultReport: report,
      expectedOutputs: [sourcedAnswer],
    })
    const trace = aggregateSubSessionResultsForParent({
      parentRunId: "run-parent",
      childResults: [{ subSessionId: "sub:finance", resultReport: report, review }],
    })
    const aggregationEvent = buildParentAggregationRuntimeEvent(trace)
    const auditSequence = [
      { order: 1, kind: "sub_session_completed" },
      { order: 2, kind: aggregationEvent.eventKind },
      { order: 3, kind: "final_answer_delivered" },
    ]

    expect(aggregationEvent).toMatchObject({
      eventKind: "parent_child_result_aggregated",
      parentRunId: "run-parent",
      payload: trace,
    })
    expect(
      auditSequence.find((event) => event.kind === "parent_child_result_aggregated")?.order,
    ).toBeLessThan(
      auditSequence.find((event) => event.kind === "final_answer_delivered")?.order ?? 0,
    )
  })
})
