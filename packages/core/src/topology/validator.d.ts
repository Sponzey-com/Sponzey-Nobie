import { type EnterpriseEntityType, type EnterpriseTimestamp, type EnterpriseTopologyValidationCode } from "../contracts/enterprise-topology.js";
export type TopologyValidatorSeverity = "info" | "warning" | "blocked" | "invalid";
export type TopologyValidatorIssueCode = EnterpriseTopologyValidationCode | "duplicate_entity_id" | "missing_entity_reference" | "delegation_cycle" | "max_delegation_depth_exceeded" | "empty_team_nodes" | "empty_process_steps" | "authority_rule_conflict" | "invalid_authority_rule_action" | "approval_authority_missing" | "tool_permission_missing" | "system_permission_missing" | "declared_tool_relation_missing" | "declared_system_relation_missing" | "process_owner_missing" | "process_step_owner_missing" | "process_transition_reference_invalid" | "responsibility_matrix_missing" | "raci_accountable_missing" | "failure_policy_missing" | "recovery_policy_missing" | "invalid_failure_policy" | "invalid_recovery_policy" | "org_unit_hierarchy_cycle" | "position_reports_to_cycle" | "position_reports_to_invalid_org_scope" | "membership_validity_invalid" | "membership_allocation_invalid" | "person_membership_allocation_exceeded" | "approval_limit_missing" | "approval_limit_exceeded" | "authority_delegation_invalid" | "process_sla_missing" | "process_sla_invalid" | "critical_system_access_missing" | "data_domain_access_missing";
export interface TopologyValidatorIssue {
    path: string;
    code: TopologyValidatorIssueCode;
    reasonCode: TopologyValidatorIssueCode;
    severity: TopologyValidatorSeverity;
    message: string;
    entityId?: string;
    entityType?: EnterpriseEntityType;
    relationId?: string;
    refId?: string;
    refType?: EnterpriseEntityType;
    sourceEntityId?: string;
    targetEntityId?: string;
}
export interface TopologyValidatorIssueInput {
    path: string;
    code: TopologyValidatorIssueCode;
    severity: TopologyValidatorSeverity;
    message: string;
    reasonCode?: TopologyValidatorIssueCode;
    entityId?: string;
    entityType?: EnterpriseEntityType;
    relationId?: string;
    refId?: string;
    refType?: EnterpriseEntityType;
    sourceEntityId?: string;
    targetEntityId?: string;
}
export interface TopologyValidationIssueCounts {
    info: number;
    warning: number;
    blocked: number;
    invalid: number;
}
export interface TopologyValidationResult {
    ok: boolean;
    executable: boolean;
    issues: TopologyValidatorIssue[];
    issueCounts: TopologyValidationIssueCounts;
}
export interface TopologyValidatorOptions {
    maxDelegationDepth?: number;
    asOf?: EnterpriseTimestamp;
}
export declare const TOPOLOGY_VALIDATOR_QUICK_FIX_CODES: readonly ["missing_entity_reference", "duplicate_entity_id", "authority_rule_conflict", "invalid_authority_rule_action", "approval_authority_missing", "tool_permission_missing", "system_permission_missing", "declared_tool_relation_missing", "declared_system_relation_missing", "process_owner_missing", "process_step_owner_missing", "process_transition_reference_invalid", "responsibility_matrix_missing", "raci_accountable_missing", "failure_policy_missing", "recovery_policy_missing", "invalid_failure_policy", "invalid_recovery_policy", "membership_validity_invalid", "person_membership_allocation_exceeded", "approval_limit_missing", "approval_limit_exceeded", "authority_delegation_invalid", "critical_system_access_missing", "data_domain_access_missing"];
export declare class TopologyValidationGateError extends Error {
    readonly issues: TopologyValidatorIssue[];
    constructor(issues: TopologyValidatorIssue[]);
}
export declare function createTopologyValidatorIssue(input: TopologyValidatorIssueInput): TopologyValidatorIssue;
export declare function validateTopology(value: unknown, options?: TopologyValidatorOptions): TopologyValidationResult;
export declare function isTopologyValidationExecutable(result: TopologyValidationResult): boolean;
export declare function assertTopologyValidationExecutable(result: TopologyValidationResult): void;
//# sourceMappingURL=validator.d.ts.map