export declare const ENTERPRISE_TOPOLOGY_SCHEMA_VERSION: 1;
export type EnterpriseTopologySchemaVersion = typeof ENTERPRISE_TOPOLOGY_SCHEMA_VERSION;
export type EnterpriseEntityStatus = "draft" | "active" | "inactive" | "archived";
export type EnterpriseTimestamp = number | string;
export type EnterpriseMetadataValue = string | number | boolean | null | EnterpriseMetadataValue[] | {
    [key: string]: EnterpriseMetadataValue | undefined;
};
export type EnterpriseMetadata = {
    [key: string]: EnterpriseMetadataValue | undefined;
};
export type EnterpriseEntityType = "topology" | "topology_version" | "node" | "team" | "org_unit" | "position" | "person" | "membership" | "authority_rule" | "responsibility_matrix_entry" | "enterprise_system" | "enterprise_tool" | "process_definition" | "relation";
export type NodeType = "function" | "process_step" | "approval_node" | "review_node" | "decision_node" | "automation_node" | "data_owner_node" | "external_node" | "system_interface_node";
export type EnterpriseRelationType = "reports_to" | "belongs_to" | "delegates_to" | "approves" | "owns" | "collaborates_with" | "escalates_to" | "informs" | "uses_system" | "uses_tool" | "has_access_to" | "depends_on" | "consults" | "accountable_for";
export declare const ENTERPRISE_NODE_TYPES: readonly NodeType[];
export declare const ENTERPRISE_RELATION_TYPES: readonly EnterpriseRelationType[];
export interface EnterpriseBaseEntity<TType extends EnterpriseEntityType = EnterpriseEntityType> {
    schemaVersion: EnterpriseTopologySchemaVersion;
    entityType: TType;
    id: string;
    name: string;
    displayName?: string;
    status: EnterpriseEntityStatus;
    createdAt: EnterpriseTimestamp;
    updatedAt: EnterpriseTimestamp;
    metadata?: EnterpriseMetadata;
}
export interface EnterpriseEntityRef<TType extends EnterpriseEntityType = EnterpriseEntityType> {
    entityType: TType;
    id: string;
}
export interface NodeTemplateRef {
    templateId: string;
    source: "user_preset" | "system_preset" | "imported";
    fixedRoleCatalog?: false;
    metadata?: EnterpriseMetadata;
}
export type NodeOwnerEntityType = "position" | "org_unit" | "person" | "enterprise_system";
export interface NodeContract extends EnterpriseBaseEntity<"node"> {
    nodeType: NodeType;
    owner?: EnterpriseEntityRef<NodeOwnerEntityType>;
    instruction?: string;
    description?: string;
    tags: string[];
    children: string[];
    template?: NodeTemplateRef;
    allowedToolIds: string[];
    allowedSystemIds: string[];
    failurePolicy?: FailurePolicy;
    recoveryPolicy?: RecoveryPolicy;
    metadata?: EnterpriseMetadata & {
        importedFromAgentConfigId?: string;
    };
}
export interface EnterpriseTeam extends EnterpriseBaseEntity<"team"> {
    purpose?: string;
    nodeIds: string[];
    tags: string[];
}
export interface OrgUnit extends EnterpriseBaseEntity<"org_unit"> {
    parentOrgUnitId?: string;
    positionIds: string[];
    personIds: string[];
    budget?: EnterpriseMetadata;
    kpiIds: string[];
    authorityScope?: EnterpriseMetadata;
    responsibilityArea?: string;
}
export interface Position extends EnterpriseBaseEntity<"position"> {
    orgUnitId: string;
    reportsToPositionId?: string;
    personIds: string[];
    approvalLimit?: number;
    responsibilityIds: string[];
    backupPositionId?: string;
}
export interface Person extends EnterpriseBaseEntity<"person"> {
    positionIds: string[];
    orgUnitIds: string[];
    availability?: "available" | "limited" | "unavailable" | "unknown";
}
export interface Membership extends EnterpriseBaseEntity<"membership"> {
    personId: string;
    positionId?: string;
    orgUnitId?: string;
    teamId?: string;
    validFrom?: EnterpriseTimestamp;
    validTo?: EnterpriseTimestamp;
    allocationPercent?: number;
}
export interface AuthorityRule extends EnterpriseBaseEntity<"authority_rule"> {
    subject: EnterpriseEntityRef<"position" | "person" | "org_unit" | "node">;
    action: string;
    object: EnterpriseEntityRef;
    condition?: EnterpriseMetadata;
    delegable: boolean;
    requiresAuditLog: boolean;
}
export interface ResponsibilityMatrixEntry extends EnterpriseBaseEntity<"responsibility_matrix_entry"> {
    scope: EnterpriseEntityRef<"node" | "process_definition" | "enterprise_system" | "enterprise_tool">;
    responsible: EnterpriseEntityRef<"position" | "person" | "org_unit" | "node">;
    accountable?: EnterpriseEntityRef<"position" | "person" | "org_unit" | "node">;
    consulted: Array<EnterpriseEntityRef<"position" | "person" | "org_unit" | "node">>;
    informed: Array<EnterpriseEntityRef<"position" | "person" | "org_unit" | "node">>;
}
export interface EnterpriseSystem extends EnterpriseBaseEntity<"enterprise_system"> {
    systemType: "internal" | "external" | "data_store" | "communication" | "automation" | "unknown";
    dataDomainIds: string[];
    criticality: "low" | "medium" | "high" | "critical" | "unknown";
}
export interface EnterpriseTool extends EnterpriseBaseEntity<"enterprise_tool"> {
    toolType: "read_only" | "write" | "external_action" | "analysis" | "unknown";
    systemId?: string;
    inputSchema?: EnterpriseMetadata;
    outputSchema?: EnterpriseMetadata;
}
export interface ProcessDefinition extends EnterpriseBaseEntity<"process_definition"> {
    ownerNodeId?: string;
    stepNodeIds: string[];
    accountablePositionId?: string;
    slaMs?: number;
}
export interface EnterpriseRelation extends EnterpriseBaseEntity<"relation"> {
    relationType: EnterpriseRelationType;
    from: EnterpriseEntityRef;
    to: EnterpriseEntityRef;
    label?: string;
    scope?: EnterpriseMetadata;
    condition?: EnterpriseMetadata;
}
export interface EnterpriseTopology extends EnterpriseBaseEntity<"topology"> {
    description?: string;
    nodes: NodeContract[];
    teams: EnterpriseTeam[];
    orgUnits: OrgUnit[];
    positions: Position[];
    persons: Person[];
    memberships: Membership[];
    authorityRules: AuthorityRule[];
    responsibilities: ResponsibilityMatrixEntry[];
    systems: EnterpriseSystem[];
    tools: EnterpriseTool[];
    processes: ProcessDefinition[];
    relations: EnterpriseRelation[];
}
export interface EnterpriseTopologyVersionEnvelope extends EnterpriseBaseEntity<"topology_version"> {
    topologyId: string;
    version: number;
    topology: EnterpriseTopology;
    validationSnapshotId?: string;
    compiledSnapshotId?: string;
    createdBy?: string;
}
export type WorkOrderTargetType = "node" | "enterprise_tool" | "enterprise_system" | "position" | "person" | "org_unit";
export type SuccessCriterionValidationKind = "manual" | "schema" | "evidence" | "tool" | "policy";
export type NodeResultStatus = "completed" | "partial_success" | "failed_candidate" | "permission_limited" | "needs_revision" | "failed";
export type NodeRuntimeState = "created" | "work_order_received" | "analyzing" | "planning" | "permission_checking" | "self_executing" | "child_delegating" | "tool_executing" | "aggregating" | "validating" | "reporting" | "completed" | "partial_success" | "failed_candidate" | "exhaustion_checking" | "failed";
export type AttemptKind = "self_execution" | "child_delegation" | "tool_execution" | "retry" | "fallback" | "partial_success_review" | "parent_recovery";
export type AttemptStatus = "attempted" | "skipped" | "blocked" | "succeeded" | "failed";
export type FailureIssueKind = "success_criteria_unmet" | "runtime_risk" | "execution_incomplete" | "permission_or_tool_blocked" | "unknown";
export type FailureRecoveryActionKind = "retry" | "delegate_to_next_executor" | "add_tool_permission" | "add_fallback_path" | "pass_partial_result" | "return_to_parent" | "review_trace" | "none";
export type FailureNextActionKind = "add_permission" | "pass_partial" | "add_fallback" | "revise_description" | "review_trace" | "user_review";
export type TracePhase = "topology_run" | "work_order" | "permission" | "authority" | "self_execution" | "child_delegation" | "tool_execution" | "aggregation" | "validation" | "recovery" | "exhaustion" | "reporting";
export interface WorkOrderTarget {
    type: WorkOrderTargetType;
    id: string;
}
export interface WorkOrderScope {
    included: string[];
    excluded: string[];
}
export interface WorkOrderSuccessCriterion {
    criterionId: string;
    description: string;
    required: boolean;
    validationKind: SuccessCriterionValidationKind;
    metadata?: EnterpriseMetadata;
}
export interface PermissionScope {
    allowedToolIds: string[];
    allowedSystemIds: string[];
    dataDomainIds: string[];
    riskLevel?: "low" | "medium" | "high" | "critical" | "unknown";
}
export interface AuthorityScope {
    requiredAuthorityRuleIds: string[];
    approvalRequired: boolean;
    approvedBy?: Array<EnterpriseEntityRef<"position" | "person" | "org_unit">>;
}
export interface WorkOrder {
    schemaVersion: EnterpriseTopologySchemaVersion;
    workOrderId: string;
    topologyRunId: string;
    parentWorkOrderId?: string | null;
    fromNodeId: string;
    to: WorkOrderTarget;
    objective: string;
    scope: WorkOrderScope;
    input: EnterpriseMetadata;
    expectedOutputSchema: EnterpriseMetadata;
    successCriteria: WorkOrderSuccessCriterion[];
    permissionScope: PermissionScope;
    authorityScope: AuthorityScope;
    failureReportRequired: boolean;
    delegationPath: string[];
    createdAt: EnterpriseTimestamp;
}
export interface AttemptRecord {
    attemptId: string;
    kind: AttemptKind;
    status: AttemptStatus;
    at: EnterpriseTimestamp;
    reasonCode?: string;
    summary?: string;
    target?: WorkOrderTarget;
}
export interface ExhaustionSummary {
    selfExecutionAttempted: boolean;
    childDelegationAttempted: boolean;
    toolExecutionAttempted: boolean;
    retryAttempted: boolean;
    fallbackAttempted: boolean;
    partialSuccessChecked: boolean;
    parentRecoveryPossibleChecked: boolean;
    successCriteriaStillNotMet: boolean;
    complete: boolean;
}
export interface NodeResultOutput {
    outputId: string;
    status: "satisfied" | "partial" | "missing";
    value?: EnterpriseMetadataValue;
}
export interface NodeResultReport {
    schemaVersion: EnterpriseTopologySchemaVersion;
    resultReportId: string;
    topologyRunId: string;
    nodeRunId: string;
    workOrderId: string;
    nodeId: string;
    status: NodeResultStatus;
    outputs: NodeResultOutput[];
    unmetSuccessCriteriaIds: string[];
    risksOrGaps: string[];
    partialResult?: EnterpriseMetadata;
    failureReportId?: string;
    createdAt: EnterpriseTimestamp;
}
export interface FailureReport {
    schemaVersion: EnterpriseTopologySchemaVersion;
    failureReportId: string;
    topologyRunId: string;
    nodeRunId: string;
    workOrderId: string;
    nodeId: string;
    exhaustionSummary: ExhaustionSummary;
    attempts: AttemptRecord[];
    untriedOptions: string[];
    partialResult?: EnterpriseMetadata;
    organizationalCause?: string;
    processCause?: string;
    authorityCause?: string;
    issueKind?: FailureIssueKind;
    recoveryActionKind?: FailureRecoveryActionKind;
    nextActionKind?: FailureNextActionKind;
    recommendedAction: string;
    createdAt: EnterpriseTimestamp;
}
export interface TraceEvent {
    schemaVersion: EnterpriseTopologySchemaVersion;
    traceEventId: string;
    topologyRunId: string;
    nodeRunId: string;
    workOrderId: string;
    parentWorkOrderId?: string | null;
    delegationPath: string[];
    phase: TracePhase;
    component: string;
    at: EnterpriseTimestamp;
    reasonCode: string;
    payload?: EnterpriseMetadata;
}
export interface FailurePolicy {
    failureReportRequired: boolean;
    allowPartialSuccess: boolean;
    fallbackNodeIds: string[];
}
export interface RecoveryPolicy {
    retryAllowed: boolean;
    redelegationAllowed: boolean;
    fallbackAllowed: boolean;
    partialSuccessAllowed: boolean;
}
/**
 * Execution-only profile derived from NodeContract + WorkOrder + CompiledTopology + PermissionScope.
 * This snapshot must never become the source topology model or require a persistent AgentConfig id.
 */
export interface NodeRuntimeProfileSnapshot {
    schemaVersion: EnterpriseTopologySchemaVersion;
    profileSnapshotId: string;
    topologyId: string;
    compiledTopologySnapshotId: string;
    nodeId: string;
    workOrderId: string;
    permissionScope: PermissionScope;
    authorityScope: AuthorityScope;
    allowedToolIds: string[];
    allowedSystemIds: string[];
    delegationPath: string[];
    createdAt: EnterpriseTimestamp;
    source: {
        nodeContractId: string;
        workOrderId: string;
        compiledTopologySnapshotId: string;
    };
}
export type EnterpriseTopologyValidationCode = "enterprise_contract_validation_failed" | "unsupported_enterprise_topology_schema_version" | "missing_required_field" | "invalid_entity_type" | "invalid_entity_status" | "invalid_node_type" | "invalid_node_owner" | "invalid_relation_type" | "invalid_relation_endpoint" | "team_execution_semantics_forbidden" | "team_org_unit_mixed" | "fixed_role_catalog_forbidden" | "missing_success_criteria" | "missing_exhaustion_summary" | "missing_trace_linkage" | "invalid_runtime_state" | "final_failure_without_failure_report";
export interface EnterpriseTopologyValidationIssue {
    path: string;
    code: EnterpriseTopologyValidationCode;
    reasonCode: EnterpriseTopologyValidationCode;
    message: string;
    entityId?: string;
    relationId?: string;
}
export type EnterpriseTopologyValidationResult<T> = {
    ok: true;
    value: T;
    issues: [];
} | {
    ok: false;
    issues: EnterpriseTopologyValidationIssue[];
};
export declare function validateNodeContract(value: unknown): EnterpriseTopologyValidationResult<NodeContract>;
export declare function validateEnterpriseTeam(value: unknown): EnterpriseTopologyValidationResult<EnterpriseTeam>;
export declare function validateEnterpriseOrgUnit(value: unknown): EnterpriseTopologyValidationResult<OrgUnit>;
export declare function validateEnterpriseRelation(value: unknown): EnterpriseTopologyValidationResult<EnterpriseRelation>;
export declare function validateEnterpriseTopology(value: unknown): EnterpriseTopologyValidationResult<EnterpriseTopology>;
export declare function validateWorkOrder(value: unknown): EnterpriseTopologyValidationResult<WorkOrder>;
export declare function validateNodeResultReport(value: unknown): EnterpriseTopologyValidationResult<NodeResultReport>;
export declare function validateFailureReport(value: unknown): EnterpriseTopologyValidationResult<FailureReport>;
export declare function validateTraceEvent(value: unknown): EnterpriseTopologyValidationResult<TraceEvent>;
//# sourceMappingURL=enterprise-topology.d.ts.map