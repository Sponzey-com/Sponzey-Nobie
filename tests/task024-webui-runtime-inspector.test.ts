import { describe, expect, it } from "vitest"
import type { RunRuntimeInspectorProjection } from "../packages/webui/src/contracts/runs.ts"
import {
  buildRuntimeInspectorSummaryCards,
  describeRuntimeApprovalState,
  describeRuntimeFinalizerStatus,
  runtimeControlActionLabels,
  selectRuntimeSubSession,
} from "../packages/webui/src/lib/runtime-inspector.js"

const text = (ko: string, _en: string) => ko
const now = Date.UTC(2026, 3, 24, 1, 0, 0)

function projection(): RunRuntimeInspectorProjection {
  return {
    schemaVersion: 1,
    runId: "run:task024",
    requestGroupId: "group:task024",
    generatedAt: now,
    orchestrationMode: "orchestration",
    plan: {
      planId: "plan:task024",
      directTaskCount: 0,
      delegatedTaskCount: 1,
      approvalRequirementCount: 1,
      resourceLockCount: 0,
      parallelGroupCount: 0,
      fallbackMode: "single_nobie",
      fallbackReasonCode: "fallback_if_agent_unavailable",
      taskSummaries: [
        {
          taskId: "task:research",
          executionKind: "delegated_sub_agent",
          goal: "Inspect runtime projection",
          assignedAgentId: "agent:researcher",
          reasonCodes: ["task024"],
        },
      ],
    },
    subSessions: [
      {
        subSessionId: "sub:running",
        parentRunId: "run:task024",
        agentId: "agent:researcher",
        agentDisplayName: "Researcher",
        agentNickname: "Researcher",
        status: "running",
        commandSummary: "Inspect runtime projection",
        expectedOutputs: [
          {
            outputId: "answer",
            kind: "text",
            required: true,
            description: "Evidence-backed answer",
            acceptanceReasonCodes: ["source_backed_answer"],
          },
        ],
        retryBudgetRemaining: 2,
        promptBundleId: "bundle:researcher",
        startedAt: now,
        progress: [
          {
            eventId: "event:progress",
            at: now + 1,
            status: "running",
            summary: "Gathering sources",
          },
        ],
        feedback: { status: "none" },
        approvalState: "pending",
        model: {
          providerId: "openai",
          modelId: "gpt-5.4-mini",
          fallbackApplied: false,
          retryCount: 1,
          estimatedInputTokens: 120,
          estimatedOutputTokens: 64,
          estimatedCost: 0.002,
          latencyMs: 350,
        },
        allowedControlActions: [
          { action: "send", reasonCode: "sub_session_active_control_allowed" },
          { action: "steer", reasonCode: "sub_session_active_control_allowed" },
          { action: "kill", reasonCode: "sub_session_active_control_allowed" },
        ],
      },
      {
        subSessionId: "sub:revision",
        parentRunId: "run:task024",
        agentId: "agent:reviewer",
        agentDisplayName: "Reviewer",
        status: "needs_revision",
        commandSummary: "Review answer",
        expectedOutputs: [],
        retryBudgetRemaining: 1,
        promptBundleId: "bundle:reviewer",
        progress: [],
        result: {
          status: "needs_revision",
          outputCount: 1,
          artifactCount: 0,
          riskOrGapCount: 1,
          risksOrGaps: ["source gap"],
        },
        review: {
          status: "needs_revision",
          verdict: "insufficient_evidence",
          parentIntegrationStatus: "blocked_insufficient_evidence",
          accepted: false,
          issueCodes: ["missing_evidence"],
          normalizedFailureKey: "blocked_insufficient_evidence",
          risksOrGaps: [],
        },
        feedback: {
          status: "requested",
          reasonCode: "blocked_insufficient_evidence",
          missingItemCount: 1,
          requiredChangeCount: 1,
        },
        approvalState: "not_required",
        allowedControlActions: [
          { action: "retry", reasonCode: "sub_session_retry_state_allowed" },
          { action: "feedback", reasonCode: "sub_session_feedback_state_allowed" },
          { action: "redelegate", reasonCode: "sub_session_feedback_state_allowed" },
        ],
      },
    ],
    dataExchanges: [
      {
        exchangeId: "exchange:task024",
        sourceOwnerId: "agent:researcher",
        sourceNickname: "Researcher",
        recipientOwnerId: "agent:reviewer",
        recipientNickname: "Reviewer",
        purpose: "Share redacted research summary",
        allowedUse: "temporary_context",
        retentionPolicy: "session_only",
        redactionState: "redacted",
        provenanceCount: 1,
        createdAt: now,
      },
    ],
    approvals: [
      {
        approvalId: "approval:task024",
        status: "pending",
        subSessionId: "sub:running",
        agentId: "agent:researcher",
        summary: "external source required",
        at: now,
      },
    ],
    timeline: [
      {
        id: "event:reviewed",
        at: now,
        source: "orchestration",
        kind: "result_reviewed",
        summary: "reviewed",
        subSessionId: "sub:revision",
      },
    ],
    finalizer: {
      parentOwnedFinalAnswer: true,
      status: "delivered",
      deliveryKey: "webui:final:task024",
      summary: "parent finalizer delivered once",
      at: now,
    },
    redaction: {
      payloadsRedacted: true,
      rawPayloadVisible: false,
    },
  }
}

describe("task024 webui runtime inspector helpers", () => {
  it("selects sub-sessions and summarizes runtime projection state", () => {
    const runtime = projection()
    const selected = selectRuntimeSubSession(runtime, "sub:revision")
    const cards = buildRuntimeInspectorSummaryCards(runtime, text)

    expect(selected?.agentDisplayName).toBe("Reviewer")
    expect(selected?.review?.parentIntegrationStatus).toBe("blocked_insufficient_evidence")
    expect(cards.find((card) => card.id === "mode")?.value).toBe("orchestration")
    expect(cards.find((card) => card.id === "subsessions")?.tone).toBe("amber")
    expect(cards.find((card) => card.id === "data")?.value).toBe("1")
    expect(describeRuntimeFinalizerStatus(runtime, text)).toContain("parent finalizer")
  })

  it("labels approval states and only exposes controls supplied by the server policy", () => {
    const runtime = projection()
    const running = selectRuntimeSubSession(runtime, "sub:running")
    const revision = selectRuntimeSubSession(runtime, "sub:revision")

    expect(describeRuntimeApprovalState(running?.approvalState ?? "not_required", text)).toBe(
      "승인 대기",
    )
    expect(runtimeControlActionLabels(running, text)).toEqual(["전송", "방향 조정", "중지"])
    expect(runtimeControlActionLabels(revision, text)).toEqual(["재시도", "피드백", "재위임"])
  })

  it("handles empty projection without throwing", () => {
    expect(selectRuntimeSubSession(null, "missing")).toBeNull()
    expect(buildRuntimeInspectorSummaryCards(null, text)[0].value).toBe("불러오는 중")
  })
})
