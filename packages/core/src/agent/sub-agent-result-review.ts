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
  parentAggregationRequired?: boolean
  parentAggregationNextAction?: ParentAggregationNextAction
}

export type ParentAggregationNextAction =
  | "ready_for_finalization"
  | "augment_same_child"
  | "redelegate_direct_child"
  | "self_solve"
  | "ask_user"
  | "return_to_parent"
  | "fail_with_reason"

export type ParentFacingChildResultStatus = "completed" | "partial" | "failed"

export interface ParentFacingChildResult {
  subSessionId: string
  resultReportId?: string
  status: ParentFacingChildResultStatus
  confirmedFacts: string[]
  unverifiedItems: string[]
  attemptedMethods: string[]
  remainingAlternatives: string[]
  artifacts: ResultReport["artifacts"]
  riskNotes: string[]
  handoffSummary: string
  reviewVerdict?: SubAgentResultReviewVerdict
  parentIntegrationStatus?: SubAgentResultParentIntegrationStatus
}

export interface ParentAggregationChildInput {
  subSessionId: string
  resultReport?: ResultReport
  review: Pick<
    SubAgentResultReview,
    "accepted" | "status" | "missingItems" | "risksOrGaps" | "canRetry"
  > &
    Partial<
      Pick<
        SubAgentResultReview,
        | "verdict"
        | "parentIntegrationStatus"
        | "normalizedFailureKey"
        | "manualActionReason"
        | "impossibleReason"
      >
    >
  attemptedMethods?: string[]
  remainingAlternatives?: string[]
  canUseSameChild?: boolean
  canUseOtherDirectChild?: boolean
  canSelfSolve?: boolean
  needsUserDecision?: boolean
  returnToParentAllowed?: boolean
}

export interface ParentAggregationInput {
  parentRunId?: string
  parentAgentId?: string
  requestingAgentId?: string
  originalRequest?: string
  successCriteria?: string[]
  childResults: ParentAggregationChildInput[]
  canSelfSolve?: boolean
  needsUserDecision?: boolean
  returnToParentAllowed?: boolean
}

export interface ParentAggregationTrace {
  kind: "parent_child_result_aggregation"
  parentRunId?: string
  parentAgentId?: string
  requestingAgentId?: string
  originalRequest?: string
  successCriteria: string[]
  childResults: ParentFacingChildResult[]
  nextAction: ParentAggregationNextAction
  finalDeliveryAllowed: boolean
  reasonCodes: string[]
  blockedSubSessionIds: string[]
  limitedSubSessionIds: string[]
  unverifiedSubSessionIds: string[]
  createdAt: number
}

export interface ParentAggregationRuntimeEventInput {
  eventKind: "parent_child_result_aggregated"
  parentRunId?: string
  parentAgentId?: string
  requestingAgentId?: string
  summary: string
  payload: ParentAggregationTrace
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
  const canRetry =
    blockingIssues.length > 0 &&
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
    repeatedFailure,
    canRetry,
  }

  if (!canRetry) {
    return {
      ...base,
      manualActionReason: repeatedFailure
        ? "same_sub_agent_result_review_failure_repeated"
        : input.resultReport.impossibleReason
          ? "sub_agent_result_review_impossible_reported"
          : "sub_agent_result_review_not_retryable",
    }
  }

  return {
    ...base,
    feedbackRequest: buildFeedbackRequest({
      resultReport: input.resultReport,
      expectedOutputs: input.expectedOutputs,
      missingItems,
      requiredChanges,
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
  void retryClass
  return Number.MAX_SAFE_INTEGER
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
    reasonCode: input.reasonCode,
    createdAt: now,
  }
}

export function summarizeChildResultForParent(
  input: ParentAggregationChildInput,
): ParentFacingChildResult {
  const report = input.resultReport
  const status = resolveParentFacingChildResultStatus(input)
  const confirmedFacts = report
    ? report.outputs
        .filter((output) => output.status === "satisfied")
        .map((output) => summarizeOutputValue(output.outputId, output.value))
    : []
  const reportUnverifiedItems = report
    ? report.outputs
        .filter((output) => output.status !== "satisfied")
        .map((output) => `${output.outputId}:${output.status}`)
    : []
  const attemptedMethods = uniqueNonEmpty([
    ...(input.attemptedMethods ?? []),
    ...(report
      ? report.evidence.map((evidence) =>
          ["evidence", evidence.kind, evidence.sourceRef].filter(Boolean).join(":"),
        )
      : []),
    ...(report
      ? report.artifacts.map((artifact) =>
          ["artifact", artifact.kind, artifact.path ?? artifact.artifactId].filter(Boolean).join(":"),
        )
      : []),
    report ? `result_report:${report.status}` : "",
  ])
  const riskNotes = uniqueNonEmpty([
    ...input.review.risksOrGaps,
    ...(input.review.impossibleReason ? [input.review.impossibleReason.detail] : []),
  ])
  const unverifiedItems = uniqueNonEmpty([
    ...input.review.missingItems,
    ...reportUnverifiedItems,
  ])

  return {
    subSessionId: input.subSessionId,
    ...(report?.resultReportId ? { resultReportId: report.resultReportId } : {}),
    status,
    confirmedFacts,
    unverifiedItems,
    attemptedMethods,
    remainingAlternatives: uniqueNonEmpty(input.remainingAlternatives ?? []),
    artifacts: report?.artifacts ?? [],
    riskNotes,
    handoffSummary: [
      `sub_session:${input.subSessionId}`,
      `status:${status}`,
      input.review.verdict ? `verdict:${input.review.verdict}` : "",
      input.review.parentIntegrationStatus
        ? `parent_integration:${input.review.parentIntegrationStatus}`
        : "",
    ].filter(Boolean).join(" "),
    ...(input.review.verdict ? { reviewVerdict: input.review.verdict } : {}),
    ...(input.review.parentIntegrationStatus
      ? { parentIntegrationStatus: input.review.parentIntegrationStatus }
      : {}),
  }
}

export function aggregateSubSessionResultsForParent(
  input: ParentAggregationInput,
): ParentAggregationTrace {
  const childResults = input.childResults.map(summarizeChildResultForParent)
  const blockedSubSessionIds = input.childResults
    .filter((item) => !item.review.accepted || item.review.status === "failed")
    .map((item) => item.subSessionId)
  const limitedSubSessionIds = input.childResults
    .filter((item) =>
      item.review.accepted &&
        (item.review.verdict === "limited_success" ||
          item.review.parentIntegrationStatus === "limited_parent_integration"),
    )
    .map((item) => item.subSessionId)
  const unverifiedSubSessionIds = childResults
    .filter((item) =>
      item.status !== "completed" ||
        item.unverifiedItems.length > 0 ||
        item.riskNotes.length > 0,
    )
    .map((item) => item.subSessionId)

  const hasProblem =
    input.childResults.length === 0 ||
    blockedSubSessionIds.length > 0 ||
    limitedSubSessionIds.length > 0 ||
    unverifiedSubSessionIds.length > 0
  const nextAction = hasProblem
    ? chooseParentAggregationAlternative(input)
    : "ready_for_finalization"

  const reasonCodes = buildParentAggregationReasonCodes({
    input,
    blockedSubSessionIds,
    limitedSubSessionIds,
    unverifiedSubSessionIds,
    nextAction,
  })

  return {
    kind: "parent_child_result_aggregation",
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
    ...(input.parentAgentId ? { parentAgentId: input.parentAgentId } : {}),
    ...(input.requestingAgentId ? { requestingAgentId: input.requestingAgentId } : {}),
    ...(input.originalRequest ? { originalRequest: input.originalRequest } : {}),
    successCriteria: uniqueNonEmpty(input.successCriteria ?? []),
    childResults,
    nextAction,
    finalDeliveryAllowed: nextAction === "ready_for_finalization",
    reasonCodes,
    blockedSubSessionIds,
    limitedSubSessionIds,
    unverifiedSubSessionIds,
    createdAt: Date.now(),
  }
}

export function buildParentAggregationRuntimeEvent(
  trace: ParentAggregationTrace,
): ParentAggregationRuntimeEventInput {
  return {
    eventKind: "parent_child_result_aggregated",
    ...(trace.parentRunId ? { parentRunId: trace.parentRunId } : {}),
    ...(trace.parentAgentId ? { parentAgentId: trace.parentAgentId } : {}),
    ...(trace.requestingAgentId ? { requestingAgentId: trace.requestingAgentId } : {}),
    summary: `parent aggregation selected ${trace.nextAction}`,
    payload: trace,
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
    if (limited.length > 0) {
      return {
        finalDeliveryAllowed: false,
        blockedSubSessionIds: [],
        limitedSubSessionIds: limited.map((item) => item.subSessionId),
        reviewStatuses,
        reasonCodes: [
          "parent_aggregation_required",
          "limited_success_parent_integration_requires_parent_decision",
        ],
        parentAggregationRequired: true,
        parentAggregationNextAction: "self_solve",
      }
    }
    return {
      finalDeliveryAllowed: true,
      blockedSubSessionIds: [],
      limitedSubSessionIds: limited.map((item) => item.subSessionId),
      reviewStatuses,
      reasonCodes: ["all_sub_session_results_accepted"],
    }
  }
  return {
    finalDeliveryAllowed: false,
    blockedSubSessionIds: blocked.map((item) => item.subSessionId),
    limitedSubSessionIds: limited.map((item) => item.subSessionId),
    reviewStatuses,
    reasonCodes: [
      "parent_aggregation_required",
      ...new Set(
        blocked.map(
          (item) => item.review.normalizedFailureKey ?? "sub_session_result_not_accepted",
        ),
      ),
    ].sort(),
    parentAggregationRequired: true,
    parentAggregationNextAction: "augment_same_child",
  }
}

function resolveParentFacingChildResultStatus(
  input: ParentAggregationChildInput,
): ParentFacingChildResultStatus {
  if (input.resultReport?.status === "failed" || input.review.status === "failed") return "failed"
  if (
    input.resultReport?.status === "needs_revision" ||
    !input.review.accepted ||
    input.review.verdict === "limited_success" ||
    input.review.parentIntegrationStatus === "limited_parent_integration" ||
    input.resultReport?.outputs.some((output) => output.status !== "satisfied") ||
    input.review.missingItems.length > 0 ||
    input.review.risksOrGaps.length > 0 ||
    input.review.impossibleReason
  ) {
    return "partial"
  }
  return "completed"
}

function chooseParentAggregationAlternative(input: ParentAggregationInput): ParentAggregationNextAction {
  if (input.childResults.length === 0) {
    if (input.canSelfSolve !== false) return "self_solve"
    if (input.returnToParentAllowed) return "return_to_parent"
    if (input.needsUserDecision) return "ask_user"
    return "fail_with_reason"
  }
  if (input.childResults.some((item) => item.canUseSameChild ?? item.review.canRetry)) {
    return "augment_same_child"
  }
  if (
    input.childResults.some(
      (item) => item.canUseOtherDirectChild || (item.remainingAlternatives?.length ?? 0) > 0,
    )
  ) {
    return "redelegate_direct_child"
  }
  const canSelfSolve =
    input.canSelfSolve ??
    (input.childResults.some((item) => item.canSelfSolve) ||
      input.childResults.every((item) => item.canSelfSolve !== false))
  if (canSelfSolve) {
    return "self_solve"
  }
  if (input.needsUserDecision || input.childResults.some((item) => item.needsUserDecision)) {
    return "ask_user"
  }
  if (input.returnToParentAllowed || input.childResults.some((item) => item.returnToParentAllowed)) {
    return "return_to_parent"
  }
  return "fail_with_reason"
}

function buildParentAggregationReasonCodes(input: {
  input: ParentAggregationInput
  blockedSubSessionIds: string[]
  limitedSubSessionIds: string[]
  unverifiedSubSessionIds: string[]
  nextAction: ParentAggregationNextAction
}): string[] {
  return uniqueNonEmpty([
    "parent_aggregation_trace_recorded",
    input.input.childResults.length === 0 ? "no_child_results_to_aggregate" : "",
    input.blockedSubSessionIds.length > 0 ? "child_result_blocked" : "",
    input.limitedSubSessionIds.length > 0 ? "child_result_limited" : "",
    input.unverifiedSubSessionIds.length > 0 ? "child_result_unverified" : "",
    input.input.childResults.some((item) => item.canUseSameChild ?? item.review.canRetry)
      ? "same_child_augmentation_available"
      : "",
    input.input.childResults.some(
      (item) => item.canUseOtherDirectChild || (item.remainingAlternatives?.length ?? 0) > 0,
    )
      ? "direct_child_alternative_available"
      : "",
    input.nextAction === "fail_with_reason" ? "no_safe_alternative_remaining" : "",
    `next_action:${input.nextAction}`,
  ]).sort()
}

function summarizeOutputValue(outputId: string, value: ResultReport["outputs"][number]["value"]): string {
  if (value === undefined) return `output:${outputId}:satisfied`
  if (typeof value === "string") return value.trim() || `output:${outputId}:satisfied`
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return `output:${outputId}:satisfied`
  }
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
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
