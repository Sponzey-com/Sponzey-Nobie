import type { DataExchangePackage, ExpectedOutputContract, OrchestrationMode, SubSessionStatus } from "../contracts/sub-agent-orchestration.js";
import { type TopologyRunTraceProjection } from "../topology-runtime/trace.js";
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
    signalCount: number;
    strategyChangeCount?: number;
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
    assignmentSource?: "topology" | "agent" | "team" | "direct";
    assignedTopologyId?: string;
    assignedExecutorId?: string;
    assignedExecutorName?: string;
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
    fallbackWarnings?: string[];
    selectedExecutorSource?: string;
    selectedExecutorId?: string;
    rejectedExecutorId?: string;
    rejectedReasonCodes?: string[];
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
export interface RunRuntimeInspectorTopologyRun {
    topologyRunId: string;
    topologyId: string;
    status: string;
    entryNodeId?: string;
    startedAt: number;
    finishedAt?: number;
    nodeRunCount: number;
    workOrderCount: number;
    traceEventCount: number;
    toolCallCount: number;
    failureCount: number;
    observedEdgeCount: number;
    projection: TopologyRunTraceProjection;
}
export interface RunRuntimeInspectorTopologyRouting {
    mode: "route" | "fallback" | "unknown";
    reasonCode?: string;
    featureFlagMode?: string;
    executionDecisionSource?: string;
    executionDecisionGraphId?: string;
    executionDecisionGraphSource?: string;
    executionDecisionCurrentExecutorId?: string;
    executionDecisionAvailableExecutorIds?: string[];
    executionDecisionDiagnosticExecutorIds?: string[];
    executionDecisionAllExecutorIds?: string[];
    executionDecisionAllRegisteredExecutorIds?: string[];
    executionDecisionSelectedExecutorId?: string;
    executionDecisionSelectedConnectionPath?: string[];
    executionDecisionNormalizedConnectionPath?: string[];
    executionDecisionRoute?: string;
    executionDecisionFallbackReason?: string;
    executionDecisionValidationStatus?: string;
    executionDecisionValidationIssues?: string[];
    executionDecisionResolvedExecutorId?: string;
    providerFallbackBlocked: boolean;
    providerFallbackBlockedReasonCode?: string;
    riskBoundaryRequiresUserApproval?: boolean;
    riskBoundaryKind?: string;
    riskBoundaryReason?: string;
    topologyId?: string;
    topologyName?: string;
    topologyVersion?: number;
    topologySchemaVersion?: number;
    topologyMigrationSource?: string;
    entryNodeId?: string;
    entryNodeName?: string;
    explicit?: boolean;
    providerFallback: boolean;
    providerFallbackReasonCode?: string;
    activeTopologyCount?: number;
    selectedExecutorIds: string[];
    selectedEdgeIds: string[];
    assignedTopologyAgentIds: string[];
    issues: string[];
}
export interface RunRuntimeInspectorProjection {
    schemaVersion: 1;
    runId: string;
    requestGroupId: string;
    requestIdentity: RunRuntimeInspectorRequestIdentity;
    generatedAt: number;
    orchestrationMode: OrchestrationMode;
    topologyRouting: RunRuntimeInspectorTopologyRouting;
    plan: RunRuntimeInspectorPlanProjection;
    subSessions: RunRuntimeInspectorSubSession[];
    dataExchanges: RunRuntimeInspectorDataExchangeSummary[];
    approvals: RunRuntimeInspectorApprovalSummary[];
    timeline: RunRuntimeInspectorTimelineEvent[];
    topologyRuns: RunRuntimeInspectorTopologyRun[];
    finalizer: RunRuntimeInspectorFinalizer;
    redaction: {
        payloadsRedacted: true;
        rawPayloadVisible: false;
    };
}
export interface RunRuntimeInspectorRequestIdentity {
    runId: string;
    requestGroupId: string;
    lineageRootRunId?: string;
    parentRunId?: string;
    rootRunId: string;
    userMessageKey?: string;
    requestIsolationMode?: string;
    continuationSource?: string;
    contextMode?: string;
}
export interface RunRuntimeInspectorProjectionOptions {
    now?: number;
    limit?: number;
}
export declare function buildRunRuntimeInspectorProjection(run: RootRun, options?: RunRuntimeInspectorProjectionOptions): RunRuntimeInspectorProjection;
//# sourceMappingURL=runtime-inspector-projection.d.ts.map
