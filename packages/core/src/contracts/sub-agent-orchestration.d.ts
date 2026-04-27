import { type ContractSchemaVersion, type ContractValidationResult, type JsonObject, type JsonValue } from "./index.js";
export declare const SUB_AGENT_CONTRACT_SCHEMA_VERSION: 1;
export type AgentEntityType = "nobie" | "sub_agent";
export type RelationshipEntityType = AgentEntityType | "team" | "session" | "sub_session" | "capability" | "data_exchange";
export type AgentStatus = "enabled" | "disabled" | "archived" | "degraded";
export type OrchestrationMode = "single_nobie" | "orchestration";
export type SubSessionStatus = "created" | "queued" | "running" | "waiting_for_input" | "awaiting_approval" | "completed" | "needs_revision" | "failed" | "cancelled";
export type TaskExecutionKind = "direct_nobie" | "delegated_sub_agent";
export type ResourceLockKind = "file" | "display" | "channel" | "mcp_server" | "secret_scope" | "external_target" | "custom";
export type CapabilityRiskLevel = "safe" | "moderate" | "external" | "sensitive" | "dangerous";
export type DepthScopedToolKind = "session_control" | "system" | "mcp" | "shell" | "filesystem" | "network" | "screen" | "other";
export type DataExchangeRetentionPolicy = "session_only" | "short_term" | "long_term_candidate" | "discard_after_review";
export type LearningApprovalState = "auto_applied" | "pending_review" | "rejected" | "applied_by_user";
export type RelationshipEdgeType = "parent_child" | "delegation" | "data_exchange" | "permission" | "capability_delegation" | "team_membership";
export type NicknameEntityType = AgentEntityType | "team";
export type NamedDeliveryKind = "data_exchange" | "result_report" | "handoff_context";
export type TeamResultPolicyMode = "lead_synthesis" | "owner_synthesis" | "reviewer_required" | "verifier_required" | "quorum_required";
export type TeamConflictPolicyMode = "lead_decides" | "owner_decides" | "reviewer_decides" | "report_conflict";
export type TeamMembershipStatus = "active" | "inactive" | "fallback_only" | "removed";
export type AgentRelationshipStatus = "active" | "disabled" | "archived";
export type FeedbackTargetAgentPolicy = "same_agent" | "alternative_direct_child" | "parent_decides" | "fallback_agent" | "lead_assigns" | "nobie_direct";
export interface ModelProfile {
    providerId: string;
    modelId: string;
    effort?: string;
    temperature?: number;
    maxOutputTokens?: number;
    timeoutMs?: number;
    retryCount?: number;
    costBudget?: number;
    fallbackModelId?: string;
}
export interface ModelExecutionSnapshot {
    providerId: string;
    modelId: string;
    effort?: string;
    fallbackApplied: boolean;
    fallbackFromModelId?: string;
    fallbackReasonCode?: string;
    timeoutMs?: number;
    retryCount: number;
    costBudget?: number;
    maxOutputTokens?: number;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    estimatedCost: number;
    attemptCount?: number;
    latencyMs?: number;
    reasonCodes: string[];
}
export interface DelegationPolicy {
    enabled: boolean;
    maxParallelSessions: number;
    retryBudget: number;
}
export interface NicknameSnapshot {
    entityType: NicknameEntityType;
    entityId: string;
    nicknameSnapshot: string;
}
export interface NicknameNamespaceEntry extends NicknameSnapshot {
    sourcePath?: string;
}
export interface NicknameNamespaceConflict {
    normalizedNickname: string;
    existing: NicknameNamespaceEntry;
    attempted: NicknameNamespaceEntry;
}
export interface OwnerScope {
    ownerType: "nobie" | "sub_agent" | "team" | "system";
    ownerId: string;
}
export interface ParentLinkage {
    parentRunId?: string;
    parentSessionId?: string;
    parentSubSessionId?: string;
    parentRequestId?: string;
}
export interface RuntimeIdentity {
    schemaVersion: ContractSchemaVersion;
    entityType: RelationshipEntityType;
    entityId: string;
    owner: OwnerScope;
    idempotencyKey: string;
    auditCorrelationId?: string;
    parent?: ParentLinkage;
}
export interface MemoryPolicy {
    owner: OwnerScope;
    visibility: "private" | "coordinator_visible" | "team_visible";
    readScopes: OwnerScope[];
    writeScope: OwnerScope;
    retentionPolicy: "session" | "short_term" | "long_term";
    writebackReviewRequired: boolean;
}
export interface SkillMcpAllowlist {
    enabledSkillIds: string[];
    enabledMcpServerIds: string[];
    enabledToolNames: string[];
    disabledToolNames: string[];
    secretScopeId?: string;
}
export interface PermissionProfile {
    profileId: string;
    riskCeiling: CapabilityRiskLevel;
    approvalRequiredFrom: CapabilityRiskLevel;
    allowExternalNetwork: boolean;
    allowFilesystemWrite: boolean;
    allowShellExecution: boolean;
    allowScreenControl: boolean;
    allowedPaths: string[];
}
export interface CapabilityPolicy {
    permissionProfile: PermissionProfile;
    skillMcpAllowlist: SkillMcpAllowlist;
    rateLimit: {
        maxConcurrentCalls: number;
        maxCallsPerMinute?: number;
    };
}
export interface DepthScopedToolPolicy {
    maxDepthByToolKind: Partial<Record<DepthScopedToolKind, number>>;
    deniedToolNamesByDepth?: Record<string, string[]>;
}
export interface BaseAgentConfig {
    schemaVersion: ContractSchemaVersion;
    agentType: AgentEntityType;
    agentId: string;
    displayName: string;
    nickname?: string;
    normalizedNickname?: string;
    status: AgentStatus;
    role: string;
    personality: string;
    specialtyTags: string[];
    avoidTasks: string[];
    modelProfile?: ModelProfile;
    memoryPolicy: MemoryPolicy;
    capabilityPolicy: CapabilityPolicy;
    delegationPolicy?: DelegationPolicy;
    profileVersion: number;
    createdAt: number;
    updatedAt: number;
}
export interface NobieConfig extends BaseAgentConfig {
    agentType: "nobie";
    coordinator: {
        defaultMode: OrchestrationMode;
        fallbackMode: "single_nobie";
        maxDelegatedSubSessions: number;
    };
}
export interface SubAgentConfig extends BaseAgentConfig {
    agentType: "sub_agent";
    teamIds: string[];
    delegation: DelegationPolicy;
}
export type AgentConfig = NobieConfig | SubAgentConfig;
export interface TeamMembership {
    membershipId: string;
    teamId: string;
    agentId: string;
    ownerAgentIdSnapshot?: string;
    teamRoles: string[];
    primaryRole: string;
    required: boolean;
    fallbackForAgentId?: string;
    sortOrder: number;
    status: TeamMembershipStatus;
}
export interface AgentRelationship {
    edgeId: string;
    parentAgentId: string;
    childAgentId: string;
    relationshipType: "parent_child";
    status: AgentRelationshipStatus;
    sortOrder: number;
    createdAt?: number;
    updatedAt?: number;
}
export interface TeamConfig {
    schemaVersion: ContractSchemaVersion;
    teamId: string;
    displayName: string;
    nickname?: string;
    normalizedNickname?: string;
    status: Exclude<AgentStatus, "degraded">;
    purpose: string;
    ownerAgentId?: string;
    leadAgentId?: string;
    memberCountMin?: number;
    memberCountMax?: number;
    requiredTeamRoles?: string[];
    requiredCapabilityTags?: string[];
    resultPolicy?: TeamResultPolicyMode;
    conflictPolicy?: TeamConflictPolicyMode;
    memberships?: TeamMembership[];
    memberAgentIds: string[];
    roleHints: string[];
    profileVersion: number;
    createdAt: number;
    updatedAt: number;
}
export interface TeamExecutionPlanAssignment {
    agentId: string;
    taskIds: string[];
    role?: string;
    membershipId?: string;
    required?: boolean;
    executionState?: "active" | "fallback" | "synthesis" | "review" | "verification";
    taskKinds?: Array<"member" | "synthesis" | "review" | "verification">;
    inputContext?: JsonObject;
    expectedOutputs?: ExpectedOutputContract[];
    validationCriteria?: string[];
    dependsOnTaskIds?: string[];
    fallbackForAgentId?: string;
    reasonCodes?: string[];
    tasks?: TeamExecutionTaskSnapshot[];
}
export interface TeamExecutionTaskSnapshot {
    taskId: string;
    taskKind: "member" | "synthesis" | "review" | "verification";
    executionKind: TaskExecutionKind;
    scope: StructuredTaskScope;
    assignedAgentId?: string;
    assignedTeamId?: string;
    requiredCapabilities: string[];
    resourceLockIds: string[];
    inputContext: JsonObject;
    expectedOutputs: ExpectedOutputContract[];
    validationCriteria: string[];
    dependsOnTaskIds: string[];
    required: boolean;
    reasonCodes: string[];
}
export interface TeamExecutionFallbackAssignment {
    missingAgentId: string;
    fallbackAgentId: string;
    reasonCode?: string;
}
export interface TeamExecutionPlan {
    teamExecutionPlanId: string;
    parentRunId: string;
    teamId: string;
    teamNicknameSnapshot?: string;
    ownerAgentId: string;
    leadAgentId: string;
    memberTaskAssignments: TeamExecutionPlanAssignment[];
    reviewerAgentIds: string[];
    verifierAgentIds: string[];
    fallbackAssignments: TeamExecutionFallbackAssignment[];
    coverageReport: JsonObject;
    conflictPolicySnapshot: TeamConflictPolicyMode;
    resultPolicySnapshot: TeamResultPolicyMode;
    createdAt: number;
}
export interface ExpectedOutputContract {
    outputId: string;
    kind: "text" | "artifact" | "tool_result" | "data_package" | "state_change";
    description: string;
    required: boolean;
    acceptance: {
        statusField?: string;
        requiredEvidenceKinds: string[];
        artifactRequired: boolean;
        reasonCodes: string[];
    };
}
export interface StructuredTaskScope {
    goal: string;
    intentType: string;
    actionType: string;
    constraints: string[];
    expectedOutputs: ExpectedOutputContract[];
    reasonCodes: string[];
}
export interface SessionContract {
    identity: RuntimeIdentity;
    sessionId: string;
    mode: OrchestrationMode;
    source: "webui" | "cli" | "telegram" | "slack" | "scheduler" | "system";
    owner: OwnerScope;
    parentRequestId: string;
    status: SubSessionStatus;
    agentDisplayName?: string;
    agentNickname?: string;
    orchestrationPlanId?: string;
    startedAt?: number;
    finishedAt?: number;
}
export interface SubSessionContract {
    identity: RuntimeIdentity;
    subSessionId: string;
    parentSessionId: string;
    parentRunId: string;
    parentAgentId?: string;
    parentAgentDisplayName?: string;
    parentAgentNickname?: string;
    agentId: string;
    agentDisplayName: string;
    agentNickname?: string;
    commandRequestId: string;
    status: SubSessionStatus;
    retryBudgetRemaining: number;
    promptBundleId: string;
    promptBundleSnapshot?: AgentPromptBundle;
    modelExecutionSnapshot?: ModelExecutionSnapshot;
    startedAt?: number;
    finishedAt?: number;
}
export interface ResourceLockContract {
    lockId: string;
    kind: ResourceLockKind;
    target: string;
    mode: "shared" | "exclusive";
    reasonCode: string;
}
export interface DependencyEdgeContract {
    fromTaskId: string;
    toTaskId: string;
    reasonCode: string;
}
export interface ParallelSubSessionGroup {
    groupId: string;
    parentRunId: string;
    subSessionIds: string[];
    dependencyEdges: DependencyEdgeContract[];
    resourceLocks: ResourceLockContract[];
    concurrencyLimit: number;
    status: "planned" | "running" | "completed" | "blocked" | "failed";
}
export interface OrchestrationTask {
    taskId: string;
    executionKind: TaskExecutionKind;
    scope: StructuredTaskScope;
    assignedAgentId?: string;
    assignedTeamId?: string;
    requiredCapabilities: string[];
    resourceLockIds: string[];
    planningTrace?: {
        score?: number;
        reasonCodes: string[];
        excludedReasonCodes?: string[];
        explanation?: string;
    };
}
export interface ApprovalRequirementContract {
    approvalId: string;
    taskId: string;
    agentId?: string;
    capability: string;
    risk: CapabilityRiskLevel;
    reasonCode: string;
}
export interface OrchestrationPlan {
    identity: RuntimeIdentity;
    planId: string;
    parentRunId: string;
    parentRequestId: string;
    directNobieTasks: OrchestrationTask[];
    delegatedTasks: OrchestrationTask[];
    dependencyEdges: DependencyEdgeContract[];
    resourceLocks: ResourceLockContract[];
    parallelGroups: ParallelSubSessionGroup[];
    approvalRequirements: ApprovalRequirementContract[];
    fallbackStrategy: {
        mode: "single_nobie" | "ask_user" | "fail_with_reason";
        reasonCode: string;
        userMessage?: string;
    };
    plannerMetadata?: {
        status: "planned" | "degraded" | "requires_team_expansion" | "requires_workflow_recommendation";
        plannerVersion: string;
        timedOut: boolean;
        latencyMs?: number;
        targetP95Ms?: number;
        semanticComparisonUsed: false;
        reasonCodes: string[];
        fastPath?: {
            classification: "direct_nobie" | "delegation_candidate" | "workflow_candidate";
            reasonCodes: string[];
            targetP95Ms: number;
            latencyMs: number;
            explanation: string;
        };
        candidateScores: Array<{
            agentId: string;
            teamIds: string[];
            score: number;
            selected: boolean;
            reasonCodes: string[];
            excludedReasonCodes: string[];
            explanation?: string;
        }>;
        directReasonCodes: string[];
        fallbackReasonCodes: string[];
    };
    createdAt: number;
}
export interface AgentPromptBundle {
    identity: RuntimeIdentity;
    bundleId: string;
    agentId: string;
    agentType: AgentEntityType;
    role: string;
    displayNameSnapshot: string;
    nicknameSnapshot?: string;
    personalitySnapshot: string;
    teamContext: Array<{
        teamId: string;
        displayName: string;
        roleHint?: string;
    }>;
    memoryPolicy: MemoryPolicy;
    capabilityPolicy: CapabilityPolicy;
    modelProfileSnapshot?: ModelProfile;
    taskScope: StructuredTaskScope;
    safetyRules: string[];
    sourceProvenance: Array<{
        sourceId: string;
        version: string;
        checksum?: string;
    }>;
    fragments?: AgentPromptFragment[];
    validation?: AgentPromptBundleValidationSummary;
    cacheKey?: string;
    promptChecksum?: string;
    profileVersionSnapshot?: number;
    renderedPrompt?: string;
    completionCriteria?: ExpectedOutputContract[];
    createdAt: number;
}
export type AgentPromptFragmentKind = "identity" | "role" | "personality" | "specialty" | "avoid_tasks" | "team_context" | "memory_policy" | "capability_policy" | "permission_profile" | "model_profile" | "completion_criteria" | "prompt_source" | "imported_profile" | "safety_rule" | "self_nickname_rule" | "nickname_attribution_rule" | "capability_catalog" | "capability_binding";
export type AgentPromptFragmentStatus = "active" | "inactive" | "review" | "blocked";
export interface AgentPromptFragment {
    fragmentId: string;
    kind: AgentPromptFragmentKind;
    title: string;
    content: string;
    status: AgentPromptFragmentStatus;
    sourceId: string;
    version: string;
    checksum?: string;
    issueCodes?: string[];
}
export interface AgentPromptBundleValidationSummary {
    ok: boolean;
    issueCodes: string[];
    blockedFragmentIds: string[];
    inactiveFragmentIds: string[];
}
export interface CommandRequest {
    identity: RuntimeIdentity;
    commandRequestId: string;
    parentRunId: string;
    subSessionId: string;
    targetAgentId: string;
    targetNicknameSnapshot?: string;
    taskScope: StructuredTaskScope;
    contextPackageIds: string[];
    expectedOutputs: ExpectedOutputContract[];
    retryBudget: number;
}
export interface ProgressEvent {
    identity: RuntimeIdentity;
    eventId: string;
    parentRunId: string;
    subSessionId: string;
    speaker?: NicknameSnapshot;
    status: SubSessionStatus;
    summary: string;
    at: number;
}
export type ResultReportImpossibleReasonKind = "physical" | "logical" | "policy";
export interface ResultReportImpossibleReason {
    kind: ResultReportImpossibleReasonKind;
    reasonCode: string;
    detail: string;
}
export interface ResultReport {
    identity: RuntimeIdentity;
    resultReportId: string;
    parentRunId: string;
    subSessionId: string;
    source?: NicknameSnapshot;
    status: "completed" | "needs_revision" | "failed";
    outputs: Array<{
        outputId: string;
        status: "satisfied" | "missing" | "partial";
        value?: JsonValue;
    }>;
    evidence: Array<{
        evidenceId: string;
        kind: string;
        sourceRef: string;
        sourceTimestamp?: string;
    }>;
    artifacts: Array<{
        artifactId: string;
        kind: string;
        path?: string;
    }>;
    risksOrGaps: string[];
    impossibleReason?: ResultReportImpossibleReason;
}
export interface FeedbackRequest {
    identity: RuntimeIdentity;
    feedbackRequestId: string;
    parentRunId: string;
    subSessionId: string;
    sourceResultReportIds: string[];
    previousSubSessionIds: string[];
    targetAgentPolicy: FeedbackTargetAgentPolicy;
    targetAgentId?: string;
    targetAgentNicknameSnapshot?: string;
    requestingAgentNicknameSnapshot?: string;
    synthesizedContextExchangeId?: string;
    carryForwardOutputs: Array<{
        outputId: string;
        status: "satisfied" | "partial";
        value?: JsonValue;
    }>;
    missingItems: string[];
    conflictItems: string[];
    requiredChanges: string[];
    additionalConstraints: string[];
    additionalContextRefs: string[];
    expectedRevisionOutputs: ExpectedOutputContract[];
    retryBudgetRemaining: number;
    reasonCode: string;
    createdAt?: number;
}
export interface ErrorReport {
    identity: RuntimeIdentity;
    errorReportId: string;
    parentRunId: string;
    subSessionId?: string;
    reasonCode: string;
    safeMessage: string;
    retryable: boolean;
}
export interface DataExchangePackage {
    identity: RuntimeIdentity;
    exchangeId: string;
    sourceOwner: OwnerScope;
    recipientOwner: OwnerScope;
    sourceNicknameSnapshot?: string;
    recipientNicknameSnapshot?: string;
    purpose: string;
    allowedUse: "temporary_context" | "memory_candidate" | "verification_only";
    retentionPolicy: DataExchangeRetentionPolicy;
    redactionState: "redacted" | "not_sensitive" | "blocked";
    provenanceRefs: string[];
    payload: JsonObject;
    expiresAt?: number | null;
    createdAt: number;
}
export interface UserVisibleAgentMessage {
    identity: RuntimeIdentity;
    messageId: string;
    parentRunId: string;
    speaker: NicknameSnapshot;
    text: string;
    createdAt: number;
}
export interface NamedHandoffEvent {
    identity: RuntimeIdentity;
    handoffId: string;
    parentRunId: string;
    sender: NicknameSnapshot;
    recipient: NicknameSnapshot;
    purpose: string;
    createdAt: number;
}
export interface NamedDeliveryEvent {
    identity: RuntimeIdentity;
    deliveryId: string;
    parentRunId: string;
    deliveryKind: NamedDeliveryKind;
    sender: NicknameSnapshot;
    recipient: NicknameSnapshot;
    summary: string;
    exchangeId?: string;
    resultReportId?: string;
    createdAt: number;
}
export interface CapabilityDelegationRequest {
    identity: RuntimeIdentity;
    delegationId: string;
    requester: OwnerScope;
    provider: OwnerScope;
    capability: string;
    risk: CapabilityRiskLevel;
    inputPackageIds: string[];
    resultPackageId?: string;
    approvalId?: string;
    status: "requested" | "approved" | "denied" | "expired" | "completed" | "failed";
}
export interface LearningEvent {
    identity: RuntimeIdentity;
    learningEventId: string;
    agentId: string;
    agentType?: AgentEntityType;
    sourceRunId?: string;
    sourceSessionId?: string;
    sourceSubSessionId?: string;
    learningTarget: "memory" | "role" | "personality" | "team_profile";
    before?: JsonObject;
    after?: JsonObject;
    beforeSummary: string;
    afterSummary: string;
    evidenceRefs: string[];
    confidence: number;
    approvalState: LearningApprovalState;
    policyReasonCode?: string;
}
export interface HistoryVersion {
    identity: RuntimeIdentity;
    historyVersionId: string;
    targetEntityType: "agent" | "team" | "memory";
    targetEntityId: string;
    version: number;
    before: JsonObject;
    after: JsonObject;
    reasonCode: string;
    createdAt: number;
}
export interface RestoreEvent {
    identity: RuntimeIdentity;
    restoreEventId: string;
    targetEntityType: "agent" | "team" | "memory";
    targetEntityId: string;
    restoredHistoryVersionId: string;
    dryRun: boolean;
    effectSummary: string[];
    createdAt: number;
}
export interface RelationshipGraphNode {
    nodeId: string;
    entityType: RelationshipEntityType;
    entityId: string;
    label: string;
    status?: AgentStatus | SubSessionStatus;
    metadata?: JsonObject;
}
export interface RelationshipGraphEdge {
    edgeId: string;
    edgeType: RelationshipEdgeType;
    fromNodeId: string;
    toNodeId: string;
    label?: string;
    metadata?: JsonObject;
}
export declare function normalizeNicknameSnapshot(value: string): string;
export declare function normalizeNickname(value: string): string;
export declare function findNicknameNamespaceConflict(entries: NicknameNamespaceEntry[]): NicknameNamespaceConflict | undefined;
export declare function validateTeamMembership(value: unknown): ContractValidationResult<TeamMembership>;
export declare function validateAgentRelationship(value: unknown): ContractValidationResult<AgentRelationship>;
export declare function validateAgentConfig(value: unknown): ContractValidationResult<AgentConfig>;
export declare function validateTeamConfig(value: unknown): ContractValidationResult<TeamConfig>;
export declare function validateTeamExecutionPlan(value: unknown): ContractValidationResult<TeamExecutionPlan>;
export declare function validateOrchestrationPlan(value: unknown): ContractValidationResult<OrchestrationPlan>;
export declare function validateCommandRequest(value: unknown): ContractValidationResult<CommandRequest>;
export declare function validateDataExchangePackage(value: unknown): ContractValidationResult<DataExchangePackage>;
export declare function validateResultReport(value: unknown, options?: {
    expectedOutputs?: ExpectedOutputContract[];
}): ContractValidationResult<ResultReport>;
export declare function validateFeedbackRequest(value: unknown): ContractValidationResult<FeedbackRequest>;
export declare function validateAgentPromptBundle(value: unknown): ContractValidationResult<AgentPromptBundle>;
export declare function validateUserVisibleAgentMessage(value: unknown): ContractValidationResult<UserVisibleAgentMessage>;
export declare function validateNamedHandoffEvent(value: unknown): ContractValidationResult<NamedHandoffEvent>;
export declare function validateNamedDeliveryEvent(value: unknown): ContractValidationResult<NamedDeliveryEvent>;
//# sourceMappingURL=sub-agent-orchestration.d.ts.map