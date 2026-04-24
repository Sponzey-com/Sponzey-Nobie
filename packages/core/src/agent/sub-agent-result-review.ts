import { randomUUID } from "node:crypto"
import { CONTRACT_SCHEMA_VERSION } from "../contracts/index.js"
import type {
  ExpectedOutputContract,
  FeedbackRequest,
  ResultReport,
  RuntimeIdentity,
} from "../contracts/sub-agent-orchestration.js"

export type SubAgentResultReviewIssueCode =
  | "result_report_not_completed"
  | "result_report_failed"
  | "required_output_missing"
  | "required_output_not_satisfied"
  | "required_evidence_missing"
  | "evidence_source_missing"
  | "artifact_missing"
  | "artifact_path_missing"
  | "artifact_not_found"
  | "reported_risk_or_gap"
  | "impossible_reason_reported"

export type SubAgentRetryClass = "default" | "format_only" | "risk_or_external" | "expensive"

export type SubAgentResultReviewVerdict =
  | "accept"
  | "needs_revision"
  | "reject"
  | "limited_success"
  | "insufficient_evidence"

export type SubAgentResultParentIntegrationStatus =
  | "ready_for_parent_integration"
  | "requires_revision"
  | "blocked_rejected"
  | "limited_parent_integration"
  | "blocked_insufficient_evidence"

export interface SubAgentResultReviewIssue {
  code: SubAgentResultReviewIssueCode
  outputId?: string
  evidenceKind?: string
  artifactId?: string
  detail: string
}

export interface SubAgentResultReviewInput {
  resultReport: ResultReport
  expectedOutputs: ExpectedOutputContract[]
  retryBudgetRemaining: number
  previousFailureKeys?: string[]
  retryClass?: SubAgentRetryClass
  additionalContextRefs?: string[]
  artifactExists?: (artifact: ResultReport["artifacts"][number]) => boolean
  now?: () => number
  idProvider?: () => string
}

export interface SubAgentResultReview {
  accepted: boolean
  status: "completed" | "needs_revision" | "failed"
  verdict: SubAgentResultReviewVerdict
  parentIntegrationStatus: SubAgentResultParentIntegrationStatus
  issues: SubAgentResultReviewIssue[]
  normalizedFailureKey?: string
  missingItems: string[]
  requiredChanges: string[]
  risksOrGaps: string[]
  impossibleReason?: ResultReport["impossibleReason"]
  retryBudgetLimit: number
  retryBudgetRemaining: number
  repeatedFailure: boolean
  canRetry: boolean
  feedbackRequest?: FeedbackRequest
  manualActionReason?: string
}

export interface SubSessionCompletionIntegrationDecision {
  finalDeliveryAllowed: boolean
  blockedSubSessionIds: string[]
  limitedSubSessionIds: string[]
  reviewStatuses: Array<{
    subSessionId: string
    verdict?: SubAgentResultReviewVerdict
    parentIntegrationStatus?: SubAgentResultParentIntegrationStatus
  }>
  reasonCodes: string[]
}

export function reviewSubAgentResult(input: SubAgentResultReviewInput): SubAgentResultReview {
  const retryBudgetLimit = getSubAgentResultRetryBudgetLimit(input.retryClass ?? "default")
  const issues = collectResultReviewIssues(input)
  const blockingIssues = issues.filter((issue) => !isLimitedSuccessIssue(issue, input.resultReport))
  const normalizedReviewKey =
    issues.length > 0 ? normalizeResultReviewFailureKey(issues) : undefined
  const normalizedBlockingFailureKey =
    blockingIssues.length > 0 ? normalizeResultReviewFailureKey(blockingIssues) : undefined
  const normalizedFailureKey = normalizedBlockingFailureKey ?? normalizedReviewKey
  const repeatedFailure = Boolean(
    normalizedBlockingFailureKey &&
      (input.previousFailureKeys ?? []).includes(normalizedBlockingFailureKey),
  )
  const retryBudgetRemaining = Math.min(Math.max(0, input.retryBudgetRemaining), retryBudgetLimit)
  const canRetry =
    blockingIssues.length > 0 &&
    retryBudgetRemaining > 0 &&
    !repeatedFailure &&
    !input.resultReport.impossibleReason

  if (issues.length === 0) {
    return {
      accepted: true,
      status: "completed",
      verdict: "accept",
      parentIntegrationStatus: "ready_for_parent_integration",
      issues: [],
      missingItems: [],
      requiredChanges: [],
      risksOrGaps: [],
      ...(input.resultReport.impossibleReason
        ? { impossibleReason: input.resultReport.impossibleReason }
        : {}),
      retryBudgetLimit,
      retryBudgetRemaining,
      repeatedFailure: false,
      canRetry: false,
    }
  }

  const missingItems = issues.map(describeMissingItem)
  const requiredChanges = issues.map(describeRequiredChange)
  const failureKey = normalizedFailureKey ?? "sub_agent_result_review:unknown"
  if (blockingIssues.length === 0) {
    return {
      accepted: true,
      status: "completed",
      verdict: "limited_success",
      parentIntegrationStatus: "limited_parent_integration",
      issues,
      normalizedFailureKey: failureKey,
      missingItems,
      requiredChanges,
      risksOrGaps: input.resultReport.risksOrGaps.filter((riskOrGap) => riskOrGap.trim()),
      ...(input.resultReport.impossibleReason
        ? { impossibleReason: input.resultReport.impossibleReason }
        : {}),
      retryBudgetLimit,
      retryBudgetRemaining,
      repeatedFailure: false,
      canRetry: false,
    }
  }

  const verdict = resolveBlockingReviewVerdict({ blockingIssues, canRetry })
  const base = {
    accepted: false,
    status: canRetry ? ("needs_revision" as const) : ("failed" as const),
    verdict,
    parentIntegrationStatus: resolveParentIntegrationStatus(verdict),
    issues,
    normalizedFailureKey: failureKey,
    missingItems,
    requiredChanges,
    risksOrGaps: input.resultReport.risksOrGaps.filter((riskOrGap) => riskOrGap.trim()),
    ...(input.resultReport.impossibleReason
      ? { impossibleReason: input.resultReport.impossibleReason }
      : {}),
    retryBudgetLimit,
    retryBudgetRemaining,
    repeatedFailure,
    canRetry,
  }

  if (!canRetry) {
    return {
      ...base,
      manualActionReason: repeatedFailure
        ? "same_sub_agent_result_review_failure_repeated"
        : "sub_agent_result_review_retry_budget_exhausted",
    }
  }

  return {
    ...base,
    feedbackRequest: buildFeedbackRequest({
      resultReport: input.resultReport,
      expectedOutputs: input.expectedOutputs,
      missingItems,
      requiredChanges,
      retryBudgetRemaining: Math.max(0, retryBudgetRemaining - 1),
      additionalContextRefs: input.additionalContextRefs ?? [],
      reasonCode: failureKey,
      ...(input.now ? { now: input.now } : {}),
      ...(input.idProvider ? { idProvider: input.idProvider } : {}),
    }),
  }
}

export function collectResultReviewIssues(
  input: Pick<SubAgentResultReviewInput, "resultReport" | "expectedOutputs" | "artifactExists">,
): SubAgentResultReviewIssue[] {
  const issues: SubAgentResultReviewIssue[] = []
  const report = input.resultReport
  const outputById = new Map(report.outputs.map((output) => [output.outputId, output]))

  if (report.status === "failed") {
    issues.push({
      code: "result_report_failed",
      detail: "ResultReport status is failed.",
    })
  } else if (report.status !== "completed") {
    issues.push({
      code: "result_report_not_completed",
      detail: `ResultReport status is ${report.status}.`,
    })
  }

  for (const expected of input.expectedOutputs) {
    if (!expected.required) continue
    const output = outputById.get(expected.outputId)
    if (!output) {
      issues.push({
        code: "required_output_missing",
        outputId: expected.outputId,
        detail: `Required output ${expected.outputId} is missing.`,
      })
    } else if (output.status !== "satisfied") {
      issues.push({
        code: "required_output_not_satisfied",
        outputId: expected.outputId,
        detail: `Required output ${expected.outputId} is ${output.status}.`,
      })
    }

    for (const evidenceKind of expected.acceptance.requiredEvidenceKinds) {
      const matchingEvidence = report.evidence.filter((evidence) => evidence.kind === evidenceKind)
      if (matchingEvidence.length === 0) {
        issues.push({
          code: "required_evidence_missing",
          outputId: expected.outputId,
          evidenceKind,
          detail: `Required evidence kind ${evidenceKind} is missing for ${expected.outputId}.`,
        })
        continue
      }
      if (matchingEvidence.some((evidence) => !evidence.sourceRef.trim())) {
        issues.push({
          code: "evidence_source_missing",
          outputId: expected.outputId,
          evidenceKind,
          detail: `Evidence kind ${evidenceKind} has an empty sourceRef.`,
        })
      }
    }

    if (expected.acceptance.artifactRequired) {
      if (report.artifacts.length === 0) {
        issues.push({
          code: "artifact_missing",
          outputId: expected.outputId,
          detail: `Required artifact is missing for ${expected.outputId}.`,
        })
      }
      for (const artifact of report.artifacts) {
        if (!artifact.path?.trim()) {
          issues.push({
            code: "artifact_path_missing",
            outputId: expected.outputId,
            artifactId: artifact.artifactId,
            detail: `Artifact ${artifact.artifactId} has no path.`,
          })
          continue
        }
        if (input.artifactExists && !input.artifactExists(artifact)) {
          issues.push({
            code: "artifact_not_found",
            outputId: expected.outputId,
            artifactId: artifact.artifactId,
            detail: `Artifact ${artifact.artifactId} was not found.`,
          })
        }
      }
    }
  }

  for (const [index, riskOrGap] of report.risksOrGaps.entries()) {
    if (!riskOrGap.trim()) continue
    issues.push({
      code: "reported_risk_or_gap",
      detail: `ResultReport has risk_or_gap #${index + 1}.`,
    })
  }
  if (report.impossibleReason) {
    issues.push({
      code: "impossible_reason_reported",
      detail: `ResultReport has ${report.impossibleReason.kind} impossible reason ${report.impossibleReason.reasonCode}.`,
    })
  }

  return dedupeIssues(issues)
}

export function normalizeResultReviewFailureKey(issues: SubAgentResultReviewIssue[]): string {
  const tokens = issues.map((issue) =>
    [
      issue.code,
      issue.outputId ?? "none",
      issue.evidenceKind ?? "none",
      issue.artifactId ?? "none",
    ].join(":"),
  )
  return `sub_agent_result_review:${[...new Set(tokens)].sort().join("|")}`
}

export function getSubAgentResultRetryBudgetLimit(retryClass: SubAgentRetryClass): number {
  switch (retryClass) {
    case "format_only":
      return 3
    case "risk_or_external":
    case "expensive":
      return 1
    default:
      return 2
  }
}

function isLimitedSuccessIssue(
  issue: SubAgentResultReviewIssue,
  resultReport: ResultReport,
): boolean {
  if (issue.code === "reported_risk_or_gap" || issue.code === "impossible_reason_reported") {
    return true
  }
  if (issue.code !== "required_output_not_satisfied" || !resultReport.impossibleReason) {
    return false
  }
  const output = resultReport.outputs.find((item) => item.outputId === issue.outputId)
  return output?.status === "partial"
}

function resolveBlockingReviewVerdict(input: {
  blockingIssues: SubAgentResultReviewIssue[]
  canRetry: boolean
}): Exclude<SubAgentResultReviewVerdict, "accept" | "limited_success"> {
  if (!input.canRetry) return "reject"
  return input.blockingIssues.some(
    (issue) =>
      issue.code === "required_evidence_missing" || issue.code === "evidence_source_missing",
  )
    ? "insufficient_evidence"
    : "needs_revision"
}

function resolveParentIntegrationStatus(
  verdict: SubAgentResultReviewVerdict,
): SubAgentResultParentIntegrationStatus {
  switch (verdict) {
    case "accept":
      return "ready_for_parent_integration"
    case "limited_success":
      return "limited_parent_integration"
    case "insufficient_evidence":
      return "blocked_insufficient_evidence"
    case "reject":
      return "blocked_rejected"
    default:
      return "requires_revision"
  }
}

export function buildFeedbackRequest(input: {
  resultReport: ResultReport
  expectedOutputs: ExpectedOutputContract[]
  missingItems: string[]
  requiredChanges: string[]
  additionalContextRefs: string[]
  retryBudgetRemaining: number
  reasonCode: string
  now?: () => number
  idProvider?: () => string
}): FeedbackRequest {
  const now = input.now?.() ?? Date.now()
  const feedbackRequestId = input.idProvider?.() ?? randomUUID()
  const synthesizedContextExchangeId = input.additionalContextRefs.find((ref) =>
    ref.startsWith("exchange:"),
  )
  const identity: RuntimeIdentity = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType: "sub_session",
    entityId: feedbackRequestId,
    owner: input.resultReport.identity.owner,
    idempotencyKey: `feedback:${input.resultReport.subSessionId}:${input.reasonCode}:${feedbackRequestId}`,
    parent: {
      ...input.resultReport.identity.parent,
      parentRunId: input.resultReport.parentRunId,
      parentSubSessionId: input.resultReport.subSessionId,
    },
    ...(input.resultReport.identity.auditCorrelationId
      ? { auditCorrelationId: input.resultReport.identity.auditCorrelationId }
      : {}),
  }

  return {
    identity,
    feedbackRequestId,
    parentRunId: input.resultReport.parentRunId,
    subSessionId: input.resultReport.subSessionId,
    sourceResultReportIds: [input.resultReport.resultReportId],
    previousSubSessionIds: [input.resultReport.subSessionId],
    targetAgentPolicy: "same_agent",
    ...(input.resultReport.identity.owner.ownerType === "sub_agent"
      ? { targetAgentId: input.resultReport.identity.owner.ownerId }
      : {}),
    ...(input.resultReport.source?.nicknameSnapshot
      ? { targetAgentNicknameSnapshot: input.resultReport.source.nicknameSnapshot }
      : {}),
    ...(synthesizedContextExchangeId ? { synthesizedContextExchangeId } : {}),
    carryForwardOutputs: input.resultReport.outputs
      .filter((output) => output.status !== "missing")
      .map((output) => ({
        outputId: output.outputId,
        status: output.status === "partial" ? "partial" : "satisfied",
        ...(output.value !== undefined ? { value: output.value } : {}),
      })),
    missingItems: input.missingItems,
    conflictItems: [],
    requiredChanges: input.requiredChanges,
    additionalConstraints: [],
    additionalContextRefs: input.additionalContextRefs,
    expectedRevisionOutputs: input.expectedOutputs.filter((output) => output.required),
    retryBudgetRemaining: input.retryBudgetRemaining,
    reasonCode: input.reasonCode,
    createdAt: now,
  }
}

export function decideSubSessionCompletionIntegration(
  reviews: Array<{
    subSessionId: string
    review: Pick<SubAgentResultReview, "accepted" | "normalizedFailureKey"> &
      Partial<Pick<SubAgentResultReview, "verdict" | "parentIntegrationStatus">>
  }>,
): SubSessionCompletionIntegrationDecision {
  const blocked = reviews.filter((item) => !item.review.accepted)
  const limited = reviews.filter(
    (item) =>
      item.review.accepted &&
      (item.review.verdict === "limited_success" ||
        item.review.parentIntegrationStatus === "limited_parent_integration"),
  )
  const reviewStatuses = reviews.map((item) => ({
    subSessionId: item.subSessionId,
    ...(item.review.verdict ? { verdict: item.review.verdict } : {}),
    ...(item.review.parentIntegrationStatus
      ? { parentIntegrationStatus: item.review.parentIntegrationStatus }
      : {}),
  }))
  if (blocked.length === 0) {
    return {
      finalDeliveryAllowed: true,
      blockedSubSessionIds: [],
      limitedSubSessionIds: limited.map((item) => item.subSessionId),
      reviewStatuses,
      reasonCodes:
        limited.length > 0
          ? ["all_sub_session_results_accepted", "limited_success_parent_integration"]
          : ["all_sub_session_results_accepted"],
    }
  }
  return {
    finalDeliveryAllowed: false,
    blockedSubSessionIds: blocked.map((item) => item.subSessionId),
    limitedSubSessionIds: limited.map((item) => item.subSessionId),
    reviewStatuses,
    reasonCodes: [
      ...new Set(
        blocked.map(
          (item) => item.review.normalizedFailureKey ?? "sub_session_result_not_accepted",
        ),
      ),
    ].sort(),
  }
}

function dedupeIssues(issues: SubAgentResultReviewIssue[]): SubAgentResultReviewIssue[] {
  const seen = new Set<string>()
  const result: SubAgentResultReviewIssue[] = []
  for (const issue of issues) {
    const key = [issue.code, issue.outputId, issue.evidenceKind, issue.artifactId].join(":")
    if (seen.has(key)) continue
    seen.add(key)
    result.push(issue)
  }
  return result
}

function describeMissingItem(issue: SubAgentResultReviewIssue): string {
  switch (issue.code) {
    case "required_output_missing":
      return `missing_output:${issue.outputId ?? "unknown"}`
    case "required_output_not_satisfied":
      return `unsatisfied_output:${issue.outputId ?? "unknown"}`
    case "required_evidence_missing":
      return `missing_evidence:${issue.outputId ?? "unknown"}:${issue.evidenceKind ?? "unknown"}`
    case "evidence_source_missing":
      return `missing_evidence_source:${issue.outputId ?? "unknown"}:${issue.evidenceKind ?? "unknown"}`
    case "artifact_missing":
      return `missing_artifact:${issue.outputId ?? "unknown"}`
    case "artifact_path_missing":
    case "artifact_not_found":
      return `${issue.code}:${issue.artifactId ?? "unknown"}`
    case "reported_risk_or_gap":
      return "reported_risk_or_gap"
    case "impossible_reason_reported":
      return "impossible_reason_reported"
    default:
      return issue.code
  }
}

function describeRequiredChange(issue: SubAgentResultReviewIssue): string {
  switch (issue.code) {
    case "required_output_missing":
      return `Submit required output ${issue.outputId ?? "unknown"} with status=satisfied.`
    case "required_output_not_satisfied":
      return `Revise output ${issue.outputId ?? "unknown"} until status=satisfied.`
    case "required_evidence_missing":
      return `Attach explicit evidence kind ${issue.evidenceKind ?? "unknown"} for ${issue.outputId ?? "unknown"}.`
    case "evidence_source_missing":
      return `Provide non-empty sourceRef for evidence kind ${issue.evidenceKind ?? "unknown"}.`
    case "artifact_missing":
      return `Attach the required artifact for ${issue.outputId ?? "unknown"}.`
    case "artifact_path_missing":
      return `Provide an artifact path for ${issue.artifactId ?? "unknown"}.`
    case "artifact_not_found":
      return `Regenerate or attach an existing artifact for ${issue.artifactId ?? "unknown"}.`
    case "reported_risk_or_gap":
      return "Resolve the reported risk or gap, or explicitly mark it as a non-blocking reviewed gap in a revised result."
    case "impossible_reason_reported":
      return "Review the structured impossible reason and decide whether the parent can integrate a limited success."
    case "result_report_failed":
      return "Retry the delegated work and return a non-failed ResultReport."
    default:
      return "Return a completed ResultReport after addressing the typed completion criteria."
  }
}
