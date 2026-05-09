import { ENTERPRISE_TOPOLOGY_SCHEMA_VERSION, } from "../contracts/enterprise-topology.js";
export function generateFailureReport(input) {
    return {
        schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
        failureReportId: input.failureReportId ?? `failure:${input.workOrder.workOrderId}`,
        topologyRunId: input.workOrder.topologyRunId,
        nodeRunId: input.nodeRunId,
        workOrderId: input.workOrder.workOrderId,
        nodeId: input.nodeContractSnapshot.id,
        exhaustionSummary: input.exhaustion.exhaustionSummary,
        attempts: input.recoveryReview.attempts.map((attempt) => ({ ...attempt })),
        untriedOptions: [...input.exhaustion.untriedOptions],
        ...(input.partialResult !== undefined ? { partialResult: structuredClone(input.partialResult) } : {}),
        issueKind: failureIssueKind(input),
        recoveryActionKind: failureRecoveryActionKind(input.recoveryReview),
        nextActionKind: failureNextActionKind(input.recoveryReview),
        recommendedAction: input.recommendedAction ?? recommendedActionForFailure(input),
        createdAt: input.createdAt ?? Date.now(),
    };
}
function failureIssueKind(input) {
    if (input.exhaustion.unmetSuccessCriteriaIds.length > 0)
        return "success_criteria_unmet";
    if (input.risksOrGaps.length > 0)
        return "runtime_risk";
    if (input.recoveryReview.attempted.tool_execution && !input.recoveryReview.attempted.fallback) {
        return "permission_or_tool_blocked";
    }
    return "execution_incomplete";
}
function failureRecoveryActionKind(recoveryReview) {
    const unreviewed = recoveryReview.signals.find((signal) => signal.possible && !signal.reviewed);
    switch (unreviewed?.kind) {
        case "retry":
            return "retry";
        case "child_delegation":
            return "delegate_to_next_executor";
        case "tool_execution":
            return "add_tool_permission";
        case "fallback":
            return "add_fallback_path";
        case "partial_success_review":
            return "pass_partial_result";
        case "parent_recovery":
            return "return_to_parent";
        case "self_execution":
            return "review_trace";
        default:
            return "review_trace";
    }
}
function failureNextActionKind(recoveryReview) {
    switch (failureRecoveryActionKind(recoveryReview)) {
        case "add_tool_permission":
            return "add_permission";
        case "add_fallback_path":
            return "add_fallback";
        case "pass_partial_result":
            return "pass_partial";
        case "retry":
        case "delegate_to_next_executor":
        case "return_to_parent":
        case "review_trace":
        case "none":
            return "review_trace";
    }
}
function recommendedActionForFailure(input) {
    if (input.exhaustion.blockingUntriedOptions.length > 0) {
        return `Review untried recovery options before declaring final failure: ${input.exhaustion.blockingUntriedOptions.join(", ")}.`;
    }
    if (input.exhaustion.unmetSuccessCriteriaIds.length > 0) {
        return `Escalate with unmet success criteria: ${input.exhaustion.unmetSuccessCriteriaIds.join(", ")}.`;
    }
    if (input.risksOrGaps.length > 0) {
        return `Review unresolved runtime risks: ${input.risksOrGaps.slice(0, 3).join(", ")}.`;
    }
    return "Escalate to the accountable owner with the failure report and runtime trace.";
}
//# sourceMappingURL=failure-report.js.map
