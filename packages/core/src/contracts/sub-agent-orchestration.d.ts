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
export type DataExchangeRetentionPolicy = "session_only" | "short_term" | "long_term_candidate" | "discard_after_review";
export type LearningApprovalState = "auto_applied" | "pending_review" | "rejected" | "applied_by_user";
export type RelationshipEdgeType = "delegation" | "data_exchange" | "permission" | "capability_delegation" | "team_membership";
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
export interface BaseAgentConfig {
    schemaVersion: ContractSchemaVersion;
    agentType: AgentEntityType;
    agentId: string;
    displayName: string;
    nickname?: string;
    status: AgentStatus;
    role: string;
    personality: string;
    specialtyTags: string[];
    avoidTasks: string[];
    memoryPolicy: MemoryPolicy;
    capabilityPolicy: CapabilityPolicy;
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
    delegation: {
        enabled: boolean;
        maxParallelSessions: number;
        retryBudget: number;
    };
}
export type AgentConfig = NobieConfig | SubAgentConfig;
export interface TeamConfig {
    schemaVersion: ContractSchemaVersion;
    teamId: string;
    displayName: string;
    nickname?: string;
    status: Exclude<AgentStatus, "degraded">;
    purpose: string;
    memberAgentIds: string[];
    roleHints: string[];
    profileVersion: number;
    createdAt: number;
    updatedAt: number;
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
    agentId: string;
    agentDisplayName: string;
    agentNickname?: string;
    commandRequestId: string;
    status: SubSessionStatus;
    retryBudgetRemaining: number;
    promptBundleId: string;
    promptBundleSnapshot?: AgentPromptBundle;
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
        status: "planned" | "degraded";
        plannerVersion: string;
        timedOut: boolean;
        semanticComparisonUsed: false;
        reasonCodes: string[];
        candidateScores: Array<{
            agentId: string;
            teamIds: string[];
            score: number;
            selected: boolean;
            reasonCodes: string[];
            excludedReasonCodes: string[];
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
    renderedPrompt?: string;
    completionCriteria?: ExpectedOutputContract[];
    createdAt: number;
}
export type AgentPromptFragmentKind = "identity" | "role" | "personality" | "specialty" | "avoid_tasks" | "team_context" | "memory_policy" | "capability_policy" | "permission_profile" | "completion_criteria" | "prompt_source" | "imported_profile" | "safety_rule";
export type AgentPromptFragmentStatus = "active" | "inactive" | "blocked";
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
    status: SubSessionStatus;
    summary: string;
    at: number;
}
export interface ResultReport {
    identity: RuntimeIdentity;
    resultReportId: string;
    parentRunId: string;
    subSessionId: string;
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
}
export interface FeedbackRequest {
    identity: RuntimeIdentity;
    feedbackRequestId: string;
    parentRunId: string;
    subSessionId: string;
    missingItems: string[];
    requiredChanges: string[];
    additionalContextRefs: string[];
    expectedRevisionOutputs: ExpectedOutputContract[];
    retryBudgetRemaining: number;
    reasonCode: string;
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
    purpose: string;
    allowedUse: "temporary_context" | "memory_candidate" | "verification_only";
    retentionPolicy: DataExchangeRetentionPolicy;
    redactionState: "redacted" | "not_sensitive" | "blocked";
    provenanceRefs: string[];
    payload: JsonObject;
    expiresAt?: number | null;
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
    status: "requested" | "approved" | "denied" | "completed" | "failed";
}
export interface LearningEvent {
    identity: RuntimeIdentity;
    learningEventId: string;
    agentId: string;
    agentType?: AgentEntityType;
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
export declare function validateAgentConfig(value: unknown): ContractValidationResult<AgentConfig>;
export declare function validateTeamConfig(value: unknown): ContractValidationResult<TeamConfig>;
export declare function validateOrchestrationPlan(value: unknown): ContractValidationResult<OrchestrationPlan>;
export declare function validateAgentPromptBundle(value: unknown): ContractValidationResult<AgentPromptBundle>;
//# sourceMappingURL=sub-agent-orchestration.d.ts.map