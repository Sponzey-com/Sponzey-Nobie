import { describe, expect, it } from "vitest"
import { reviewSubAgentResult } from "../packages/core/src/agent/sub-agent-result-review.ts"
import { decideSubSessionCompletionIntegration } from "../packages/core/src/agent/sub-agent-result-review.ts"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.ts"
import { validateResultReport } from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import type {
  AgentPromptBundle,
  CommandRequest,
  ExpectedOutputContract,
  MemoryPolicy,
  PermissionProfile,
  ResultReport,
  RuntimeIdentity,
  SkillMcpAllowlist,
  StructuredTaskScope,
  SubSessionReviewRuntimeEventInput,
} from "../packages/core/src/index.ts"
import {
  SubSessionRunner,
  createTextResultReport,
} from "../packages/core/src/orchestration/sub-session-runner.ts"

const now = Date.UTC(2026, 3, 24, 0, 0, 0)

function identity(entityType: RuntimeIdentity["entityType"], entityId: string): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType,
    entityId,
    owner: { ownerType: "sub_agent", ownerId: "agent:reviewer" },
    idempotencyKey: `idem:${entityId}`,
    auditCorrelationId: `audit:${entityId}`,
    parent: {
      parentRunId: "run-parent",
      parentRequestId: "request-parent",
    },
  }
}

const evidenceOutput: ExpectedOutputContract = {
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

const artifactOutput: ExpectedOutputContract = {
  outputId: "artifact",
  kind: "artifact",
  description: "Generated artifact.",
  required: true,
  acceptance: {
    requiredEvidenceKinds: [],
    artifactRequired: true,
    reasonCodes: ["artifact_reference_required"],
  },
}

const plainOutput: ExpectedOutputContract = {
  outputId: "answer",
  kind: "text",
  description: "Plain answer.",
  required: true,
  acceptance: {
    requiredEvidenceKinds: [],
    artifactRequired: false,
    reasonCodes: ["plain_answer"],
  },
}

const taskScope: StructuredTaskScope = {
  goal: "Return a reviewed result.",
  intentType: "review",
  actionType: "sub_agent_result_review",
  constraints: ["Return a typed ResultReport."],
  expectedOutputs: [plainOutput],
  reasonCodes: ["review_required"],
}

const allowlist: SkillMcpAllowlist = {
  enabledSkillIds: ["review"],
  enabledMcpServerIds: [],
  enabledToolNames: [],
  disabledToolNames: [],
}

const permissionProfile: PermissionProfile = {
  profileId: "profile:safe",
  riskCeiling: "moderate",
  approvalRequiredFrom: "high",
  allowExternalNetwork: false,
  allowFilesystemWrite: false,
  allowShellExecution: false,
  allowScreenControl: false,
  allowedPaths: [],
}

const memoryPolicy: MemoryPolicy = {
  owner: { ownerType: "sub_agent", ownerId: "agent:reviewer" },
  visibility: "private",
  readScopes: [{ ownerType: "sub_agent", ownerId: "agent:reviewer" }],
  writeScope: { ownerType: "sub_agent", ownerId: "agent:reviewer" },
  retentionPolicy: "short_term",
  writebackReviewRequired: true,
}

function resultReport(overrides: Partial<ResultReport> = {}): ResultReport {
  return {
    identity: identity("sub_session", "sub:review"),
    resultReportId: "result:review",
    parentRunId: "run-parent",
    subSessionId: "sub:review",
    status: "completed",
    outputs: [{ outputId: "answer", status: "satisfied", value: "42" }],
    evidence: [{ evidenceId: "evidence:source", kind: "source", sourceRef: "source:1" }],
    artifacts: [],
    risksOrGaps: [],
    ...overrides,
  }
}

function command(expectedOutputs: ExpectedOutputContract[] = [plainOutput]): CommandRequest {
  return {
    identity: identity("sub_session", "sub:runner"),
    commandRequestId: "command:runner",
    parentRunId: "run-parent",
    subSessionId: "sub:runner",
    targetAgentId: "agent:reviewer",
    taskScope: { ...taskScope, expectedOutputs },
    contextPackageIds: [],
    expectedOutputs,
    retryBudget: 2,
  }
}

function promptBundle(
  expectedOutputs: ExpectedOutputContract[] = [plainOutput],
): AgentPromptBundle {
  return {
    identity: identity("sub_session", "prompt-bundle:reviewer"),
    bundleId: "prompt-bundle:reviewer",
    agentId: "agent:reviewer",
    agentType: "sub_agent",
    role: "review worker",
    displayNameSnapshot: "Reviewer",
    personalitySnapshot: "Careful",
    teamContext: [],
    memoryPolicy,
    capabilityPolicy: {
      permissionProfile,
      skillMcpAllowlist: allowlist,
      rateLimit: { maxConcurrentCalls: 1 },
    },
    taskScope: { ...taskScope, expectedOutputs },
    safetyRules: ["Do not send sub-session results directly to the user."],
    sourceProvenance: [{ sourceId: "profile:agent:reviewer", version: "1" }],
    createdAt: now,
  }
}

describe("task016 result report review verdict", () => {
  it("validates ResultReport schema and rejects missing required outputs", () => {
    const malformed = validateResultReport({
      ...resultReport(),
      outputs: undefined,
      evidence: undefined,
      artifacts: undefined,
      risksOrGaps: undefined,
    })
    const missingOutput = validateResultReport(resultReport({ outputs: [] }), {
      expectedOutputs: [evidenceOutput],
    })

    expect(malformed.ok).toBe(false)
    if (!malformed.ok) {
      expect(malformed.issues.map((issue) => issue.path)).toEqual(
        expect.arrayContaining(["$.outputs", "$.evidence", "$.artifacts", "$.risksOrGaps"]),
      )
    }
    expect(missingOutput.ok).toBe(false)
    if (!missingOutput.ok)
      expect(missingOutput.issues.map((issue) => issue.path)).toContain("$.outputs")
  })

  it("requires evidence kind and sourceRef for completed reports", () => {
    const validation = validateResultReport(resultReport({ evidence: [] }), {
      expectedOutputs: [evidenceOutput],
    })
    const review = reviewSubAgentResult({
      resultReport: resultReport({ evidence: [] }),
      expectedOutputs: [evidenceOutput],
      retryBudgetRemaining: 2,
    })

    expect(validation.ok).toBe(false)
    if (!validation.ok) expect(validation.issues.map((issue) => issue.path)).toContain("$.evidence")
    expect(review).toMatchObject({
      accepted: false,
      status: "needs_revision",
      verdict: "insufficient_evidence",
      parentIntegrationStatus: "blocked_insufficient_evidence",
    })
    expect(review.feedbackRequest?.missingItems).toEqual(["missing_evidence:answer:source"])
  })

  it("requires artifact references for artifact-required outputs", () => {
    const report = resultReport({
      outputs: [{ outputId: "artifact", status: "satisfied", value: "ready" }],
      evidence: [],
      artifacts: [],
    })
    const validation = validateResultReport(report, { expectedOutputs: [artifactOutput] })
    const review = reviewSubAgentResult({
      resultReport: report,
      expectedOutputs: [artifactOutput],
      retryBudgetRemaining: 2,
    })

    expect(validation.ok).toBe(false)
    if (!validation.ok)
      expect(validation.issues.map((issue) => issue.path)).toContain("$.artifacts")
    expect(review).toMatchObject({
      accepted: false,
      status: "needs_revision",
      verdict: "needs_revision",
      parentIntegrationStatus: "requires_revision",
    })
    expect(review.issues.map((issue) => issue.code)).toContain("artifact_missing")
  })

  it("keeps reported risks and gaps as limited success instead of hidden success", () => {
    const review = reviewSubAgentResult({
      resultReport: resultReport({ risksOrGaps: ["source was stale but still usable"] }),
      expectedOutputs: [evidenceOutput],
      retryBudgetRemaining: 2,
    })

    expect(review).toMatchObject({
      accepted: true,
      status: "completed",
      verdict: "limited_success",
      parentIntegrationStatus: "limited_parent_integration",
      risksOrGaps: ["source was stale but still usable"],
    })
    expect(review.issues.map((issue) => issue.code)).toContain("reported_risk_or_gap")
  })

  it("structures impossible reasons and treats partial impossible work as limited success", () => {
    const impossibleReason = {
      kind: "policy" as const,
      reasonCode: "policy_blocked_exact_output",
      detail: "The exact output would violate the policy boundary.",
    }
    const review = reviewSubAgentResult({
      resultReport: resultReport({
        outputs: [{ outputId: "answer", status: "partial", value: "Allowed summary only." }],
        impossibleReason,
      }),
      expectedOutputs: [evidenceOutput],
      retryBudgetRemaining: 2,
    })
    const invalid = validateResultReport(
      resultReport({
        impossibleReason: {
          ...impossibleReason,
          kind: "temporary",
        } as ResultReport["impossibleReason"],
      }),
    )

    expect(review).toMatchObject({
      accepted: true,
      status: "completed",
      verdict: "limited_success",
      parentIntegrationStatus: "limited_parent_integration",
      impossibleReason,
    })
    expect(review.feedbackRequest).toBeUndefined()
    expect(invalid.ok).toBe(false)
    if (!invalid.ok)
      expect(invalid.issues.map((issue) => issue.path)).toContain("$.impossibleReason.kind")
  })

  it("rejects blocking review failures when retry is not available", () => {
    const review = reviewSubAgentResult({
      resultReport: resultReport({ evidence: [] }),
      expectedOutputs: [evidenceOutput],
      retryBudgetRemaining: 0,
    })

    expect(review).toMatchObject({
      accepted: false,
      status: "failed",
      verdict: "reject",
      parentIntegrationStatus: "blocked_rejected",
      manualActionReason: "sub_agent_result_review_retry_budget_exhausted",
    })
    expect(review.feedbackRequest).toBeUndefined()
  })

  it("allows parent integration for limited success with explicit review status", () => {
    const accepted = reviewSubAgentResult({
      resultReport: resultReport(),
      expectedOutputs: [evidenceOutput],
      retryBudgetRemaining: 2,
    })
    const limited = reviewSubAgentResult({
      resultReport: resultReport({ risksOrGaps: ["non-blocking gap"] }),
      expectedOutputs: [evidenceOutput],
      retryBudgetRemaining: 2,
    })

    expect(
      decideSubSessionCompletionIntegration([
        { subSessionId: "sub:accepted", review: accepted },
        { subSessionId: "sub:limited", review: limited },
      ]),
    ).toMatchObject({
      finalDeliveryAllowed: true,
      blockedSubSessionIds: [],
      limitedSubSessionIds: ["sub:limited"],
      reasonCodes: ["all_sub_session_results_accepted", "limited_success_parent_integration"],
    })
  })

  it("records review verdict in parent timeline and interim audit hook", async () => {
    const events: string[] = []
    const auditEvents: SubSessionReviewRuntimeEventInput[] = []
    const runner = new SubSessionRunner({
      now: () => now,
      idProvider: () => "runner-id",
      loadSubSessionByIdempotencyKey: () => undefined,
      persistSubSession: () => true,
      updateSubSession: () => undefined,
      appendParentEvent: (_runId, label) => {
        events.push(label)
      },
      isParentCancelled: () => false,
      isParentFinalized: () => false,
      recordReviewEvent: (event) => {
        auditEvents.push(event)
        return "audit:review"
      },
    })

    const outcome = await runner.runSubSession(
      {
        command: command(),
        agent: { agentId: "agent:reviewer", displayName: "Reviewer" },
        parentSessionId: "session-parent",
        promptBundle: promptBundle(),
      },
      (input) => createTextResultReport({ command: input.command, text: "done" }),
    )

    expect(outcome.review).toMatchObject({
      verdict: "accept",
      parentIntegrationStatus: "ready_for_parent_integration",
    })
    expect(events).toEqual(
      expect.arrayContaining([
        "sub_session_review_verdict:sub:runner:accept:ready_for_parent_integration",
        "sub_session_result:sub:runner:completed",
      ]),
    )
    expect(auditEvents).toHaveLength(1)
    expect(auditEvents[0]).toMatchObject({
      parentRunId: "run-parent",
      subSessionId: "sub:runner",
      verdict: "accept",
      parentIntegrationStatus: "ready_for_parent_integration",
    })
  })
})
