import { randomUUID } from "node:crypto";
import { CONTRACT_SCHEMA_VERSION } from "../contracts/index.js";
export function reviewSubAgentResult(input) {
    const retryBudgetLimit = getSubAgentResultRetryBudgetLimit(input.retryClass ?? "default");
    const issues = collectResultReviewIssues(input);
    const normalizedFailureKey = issues.length > 0 ? normalizeResultReviewFailureKey(issues) : undefined;
    const repeatedFailure = Boolean(normalizedFailureKey && (input.previousFailureKeys ?? []).includes(normalizedFailureKey));
    const retryBudgetRemaining = Math.min(Math.max(0, input.retryBudgetRemaining), retryBudgetLimit);
    const canRetry = issues.length > 0 && retryBudgetRemaining > 0 && !repeatedFailure;
    if (issues.length === 0) {
        return {
            accepted: true,
            status: "completed",
            issues: [],
            missingItems: [],
            requiredChanges: [],
            retryBudgetLimit,
            retryBudgetRemaining,
            repeatedFailure: false,
            canRetry: false,
        };
    }
    const missingItems = issues.map(describeMissingItem);
    const requiredChanges = issues.map(describeRequiredChange);
    const failureKey = normalizedFailureKey ?? "sub_agent_result_review:unknown";
    const base = {
        accepted: false,
        status: canRetry ? "needs_revision" : "failed",
        issues,
        normalizedFailureKey: failureKey,
        missingItems,
        requiredChanges,
        retryBudgetLimit,
        retryBudgetRemaining,
        repeatedFailure,
        canRetry,
    };
    if (!canRetry) {
        return {
            ...base,
            manualActionReason: repeatedFailure
                ? "same_sub_agent_result_review_failure_repeated"
                : "sub_agent_result_review_retry_budget_exhausted",
        };
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
    };
}
export function collectResultReviewIssues(input) {
    const issues = [];
    const report = input.resultReport;
    const outputById = new Map(report.outputs.map((output) => [output.outputId, output]));
    if (report.status === "failed") {
        issues.push({
            code: "result_report_failed",
            detail: "ResultReport status is failed.",
        });
    }
    else if (report.status !== "completed") {
        issues.push({
            code: "result_report_not_completed",
            detail: `ResultReport status is ${report.status}.`,
        });
    }
    for (const expected of input.expectedOutputs) {
        if (!expected.required)
            continue;
        const output = outputById.get(expected.outputId);
        if (!output) {
            issues.push({
                code: "required_output_missing",
                outputId: expected.outputId,
                detail: `Required output ${expected.outputId} is missing.`,
            });
        }
        else if (output.status !== "satisfied") {
            issues.push({
                code: "required_output_not_satisfied",
                outputId: expected.outputId,
                detail: `Required output ${expected.outputId} is ${output.status}.`,
            });
        }
        for (const evidenceKind of expected.acceptance.requiredEvidenceKinds) {
            const matchingEvidence = report.evidence.filter((evidence) => evidence.kind === evidenceKind);
            if (matchingEvidence.length === 0) {
                issues.push({
                    code: "required_evidence_missing",
                    outputId: expected.outputId,
                    evidenceKind,
                    detail: `Required evidence kind ${evidenceKind} is missing for ${expected.outputId}.`,
                });
                continue;
            }
            if (matchingEvidence.some((evidence) => !evidence.sourceRef.trim())) {
                issues.push({
                    code: "evidence_source_missing",
                    outputId: expected.outputId,
                    evidenceKind,
                    detail: `Evidence kind ${evidenceKind} has an empty sourceRef.`,
                });
            }
        }
        if (expected.acceptance.artifactRequired) {
            if (report.artifacts.length === 0) {
                issues.push({
                    code: "artifact_missing",
                    outputId: expected.outputId,
                    detail: `Required artifact is missing for ${expected.outputId}.`,
                });
            }
            for (const artifact of report.artifacts) {
                if (!artifact.path?.trim()) {
                    issues.push({
                        code: "artifact_path_missing",
                        outputId: expected.outputId,
                        artifactId: artifact.artifactId,
                        detail: `Artifact ${artifact.artifactId} has no path.`,
                    });
                    continue;
                }
                if (input.artifactExists && !input.artifactExists(artifact)) {
                    issues.push({
                        code: "artifact_not_found",
                        outputId: expected.outputId,
                        artifactId: artifact.artifactId,
                        detail: `Artifact ${artifact.artifactId} was not found.`,
                    });
                }
            }
        }
    }
    for (const [index, riskOrGap] of report.risksOrGaps.entries()) {
        if (!riskOrGap.trim())
            continue;
        issues.push({
            code: "reported_risk_or_gap",
            detail: `ResultReport has risk_or_gap #${index + 1}.`,
        });
    }
    return dedupeIssues(issues);
}
export function normalizeResultReviewFailureKey(issues) {
    const tokens = issues.map((issue) => [
        issue.code,
        issue.outputId ?? "none",
        issue.evidenceKind ?? "none",
        issue.artifactId ?? "none",
    ].join(":"));
    return `sub_agent_result_review:${[...new Set(tokens)].sort().join("|")}`;
}
export function getSubAgentResultRetryBudgetLimit(retryClass) {
    switch (retryClass) {
        case "format_only":
            return 3;
        case "risk_or_external":
        case "expensive":
            return 1;
        case "default":
        default:
            return 2;
    }
}
export function buildFeedbackRequest(input) {
    const now = input.now?.() ?? Date.now();
    const feedbackRequestId = input.idProvider?.() ?? randomUUID();
    const identity = {
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
        ...(input.resultReport.identity.auditCorrelationId ? { auditCorrelationId: input.resultReport.identity.auditCorrelationId } : {}),
    };
    return {
        identity,
        feedbackRequestId,
        parentRunId: input.resultReport.parentRunId,
        subSessionId: input.resultReport.subSessionId,
        missingItems: input.missingItems,
        requiredChanges: input.requiredChanges,
        additionalContextRefs: input.additionalContextRefs,
        expectedRevisionOutputs: input.expectedOutputs.filter((output) => output.required),
        retryBudgetRemaining: input.retryBudgetRemaining,
        reasonCode: input.reasonCode,
    };
}
export function decideSubSessionCompletionIntegration(reviews) {
    const blocked = reviews.filter((item) => !item.review.accepted);
    if (blocked.length === 0) {
        return {
            finalDeliveryAllowed: true,
            blockedSubSessionIds: [],
            reasonCodes: ["all_sub_session_results_accepted"],
        };
    }
    return {
        finalDeliveryAllowed: false,
        blockedSubSessionIds: blocked.map((item) => item.subSessionId),
        reasonCodes: [...new Set(blocked.map((item) => item.review.normalizedFailureKey ?? "sub_session_result_not_accepted"))].sort(),
    };
}
function dedupeIssues(issues) {
    const seen = new Set();
    const result = [];
    for (const issue of issues) {
        const key = [issue.code, issue.outputId, issue.evidenceKind, issue.artifactId].join(":");
        if (seen.has(key))
            continue;
        seen.add(key);
        result.push(issue);
    }
    return result;
}
function describeMissingItem(issue) {
    switch (issue.code) {
        case "required_output_missing":
            return `missing_output:${issue.outputId ?? "unknown"}`;
        case "required_output_not_satisfied":
            return `unsatisfied_output:${issue.outputId ?? "unknown"}`;
        case "required_evidence_missing":
            return `missing_evidence:${issue.outputId ?? "unknown"}:${issue.evidenceKind ?? "unknown"}`;
        case "evidence_source_missing":
            return `missing_evidence_source:${issue.outputId ?? "unknown"}:${issue.evidenceKind ?? "unknown"}`;
        case "artifact_missing":
            return `missing_artifact:${issue.outputId ?? "unknown"}`;
        case "artifact_path_missing":
        case "artifact_not_found":
            return `${issue.code}:${issue.artifactId ?? "unknown"}`;
        case "reported_risk_or_gap":
            return "reported_risk_or_gap";
        case "result_report_failed":
        case "result_report_not_completed":
        default:
            return issue.code;
    }
}
function describeRequiredChange(issue) {
    switch (issue.code) {
        case "required_output_missing":
            return `Submit required output ${issue.outputId ?? "unknown"} with status=satisfied.`;
        case "required_output_not_satisfied":
            return `Revise output ${issue.outputId ?? "unknown"} until status=satisfied.`;
        case "required_evidence_missing":
            return `Attach explicit evidence kind ${issue.evidenceKind ?? "unknown"} for ${issue.outputId ?? "unknown"}.`;
        case "evidence_source_missing":
            return `Provide non-empty sourceRef for evidence kind ${issue.evidenceKind ?? "unknown"}.`;
        case "artifact_missing":
            return `Attach the required artifact for ${issue.outputId ?? "unknown"}.`;
        case "artifact_path_missing":
            return `Provide an artifact path for ${issue.artifactId ?? "unknown"}.`;
        case "artifact_not_found":
            return `Regenerate or attach an existing artifact for ${issue.artifactId ?? "unknown"}.`;
        case "reported_risk_or_gap":
            return "Resolve the reported risk or gap, or explicitly mark it as a non-blocking reviewed gap in a revised result.";
        case "result_report_failed":
            return "Retry the delegated work and return a non-failed ResultReport.";
        case "result_report_not_completed":
        default:
            return "Return a completed ResultReport after addressing the typed completion criteria.";
    }
}
//# sourceMappingURL=sub-agent-result-review.js.map