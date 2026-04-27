import type { DataExchangePackage, ExpectedOutputContract, OrchestrationMode, SubSessionStatus } from "../contracts/sub-agent-orchestration.js";
import type { RootRun } from "./types.js";
export type RuntimeInspectorControlAction = "send" | "steer" | "retry" | "feedback" | "redelegate" | "cancel" | "kill";
export type RuntimeInspectorApprovalState = "not_required" | "required" | "approved" | "denied" | "pending";
export interface RuntimeInspectorAllowedControlAction {
    action: RuntimeInspectorControlAction;
    reasonCode: string;
}
export interface RunRuntimeInspectorExpectedOutput {
    outputId: string;
    kind: ExpectedOutputContract["kind"];
    required: boolean;
    description: string;
    acceptanceReasonCodes: string[];
}
export interface RunRuntimeInspectorProgressItem {
    eventId: string;
    at: number;
    status: string;
    summary: string;
}
export interface RunRuntimeInspectorReview {
    resultReportId?: string;
    status?: string;
    verdict?: string;
    parentIntegrationStatus?: string;
    accepted?: boolean;
    issueCodes: string[];
    normalizedFailureKey?: string;
    risksOrGaps: string[];
}
export interface RunRuntimeInspectorResult {
    resultReportId?: string;
    status?: string;
    outputCount?: number;
    artifactCount?: number;
    riskOrGapCount?: number;
    risksOrGaps: string[];
    summary?: string;
    impossibleReasonKind?: string;
}
export interface RunRuntimeInspectorFeedback {
    status: "none" | "requested" | "redelegation_requested";
    feedbackRequestId?: string;
    targetAgentId?: string;
    targetAgentNickname?: string;
    reasonCode?: string;
    missingItemCount?: number;
    requiredChangeCount?: number;
}
export interface RunRuntimeInspectorModel {
    providerId: string;
    modelId: string;
    fallbackApplied: boolean;
    fallbackFromModelId?: string;
    fallbackReasonCode?: string;
    effort?: string;
    retryCount: number;
    attemptCount?: number;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    estimatedCost: number;
    latencyMs?: number;
    status?: string;
}
export interface RunRuntimeInspectorSubSession {
    subSessionId: string;
    parentRunId: string;
    parentSubSessionId?: string;
    childSubSessionIds: string[];
    depth: number;
    resultAggregationStage: "nobie_finalization" | "parent_sub_agent_review";
    resultReturnTargetAgentId?: string;
    resultReturnTargetSubSessionId?: string;
    agentId: string;
    agentDisplayName: string;
    agentNickname?: string;
    status: SubSessionStatus;
    commandSummary: string;
    expectedOutputs: RunRuntimeInspectorExpectedOutput[];
    retryBudgetRemaining: number;
    promptBundleId: string;
    startedAt?: number;
    finishedAt?: number;
    progress: RunRuntimeInspectorProgressItem[];
    result?: RunRuntimeInspectorResult;
    review?: RunRuntimeInspectorReview;
    feedback: RunRuntimeInspectorFeedback;
    approvalState: RuntimeInspectorApprovalState;
    model?: RunRuntimeInspectorModel;
    allowedControlActions: RuntimeInspectorAllowedControlAction[];
}
export interface RunRuntimeInspectorDataExchangeSummary {
    exchangeId: string;
    sourceOwnerId: string;
    sourceNickname?: string;
    recipientOwnerId: string;
    recipientNickname?: string;
    purpose: string;
    allowedUse: DataExchangePackage["allowedUse"];
    retentionPolicy: DataExchangePackage["retentionPolicy"];
    redactionState: DataExchangePackage["redactionState"];
    provenanceCount: number;
    createdAt: number;
    expiresAt?: number;
}
export interface RunRuntimeInspectorApprovalSummary {
    approvalId: string;
    status: RuntimeInspectorApprovalState;
    subSessionId?: string;
    agentId?: string;
    summary: string;
    at: number;
}
export interface RunRuntimeInspectorTimelineEvent {
    id: string;
    at: number;
    source: "run_event" | "orchestration" | "message_ledger";
    kind: string;
    status?: string;
    severity?: string;
    summary: string;
    subSessionId?: string;
    agentId?: string;
    exchangeId?: string;
    approvalId?: string;
}
export interface RunRuntimeInspectorPlanTask {
    taskId: string;
    executionKind: string;
    goal: string;
    assignedAgentId?: string;
    assignedTeamId?: string;
    reasonCodes: string[];
}
export interface RunRuntimeInspectorPlanProjection {
    planId?: string;
    parentRequestId?: string;
    createdAt?: number;
    plannerStatus?: string;
    directTaskCount: number;
    delegatedTaskCount: number;
    approvalRequirementCount: number;
    resourceLockCount: number;
    parallelGroupCount: number;
    fallbackMode?: string;
    fallbackReasonCode?: string;
    taskSummaries: RunRuntimeInspectorPlanTask[];
}
export interface RunRuntimeInspectorFinalizer {
    parentOwnedFinalAnswer: true;
    status: "not_started" | "generated" | "delivered" | "suppressed" | "failed";
    deliveryKey?: string;
    idempotencyKey?: string;
    summary?: string;
    at?: number;
}
export interface RunRuntimeInspectorProjection {
    schemaVersion: 1;
    runId: string;
    requestGroupId: string;
    generatedAt: number;
    orchestrationMode: OrchestrationMode;
    plan: RunRuntimeInspectorPlanProjection;
    subSessions: RunRuntimeInspectorSubSession[];
    dataExchanges: RunRuntimeInspectorDataExchangeSummary[];
    approvals: RunRuntimeInspectorApprovalSummary[];
    timeline: RunRuntimeInspectorTimelineEvent[];
    finalizer: RunRuntimeInspectorFinalizer;
    redaction: {
        payloadsRedacted: true;
        rawPayloadVisible: false;
    };
}
export interface RunRuntimeInspectorProjectionOptions {
    now?: number;
    limit?: number;
}
export declare function buildRunRuntimeInspectorProjection(run: RootRun, options?: RunRuntimeInspectorProjectionOptions): RunRuntimeInspectorProjection;
//# sourceMappingURL=runtime-inspector-projection.d.ts.map