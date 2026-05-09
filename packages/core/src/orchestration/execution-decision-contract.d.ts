export declare const AGENT_EXECUTION_DECISION_CONTRACT_VERSION: "agent-execution-decision:v1";
export declare const AgentExecutionFallbackReason: {
    readonly SelfSolve: "self_solve";
    readonly DirectCurrentAgent: "direct_current_agent";
    readonly DelegateToChild: "delegate_to_child";
    readonly ReturnToParent: "return_to_parent";
    readonly RootNobieDirect: "root_nobie_direct";
    readonly ExplicitProvider: "explicit_provider";
    readonly NobieDirect: "nobie_direct";
    readonly AskParent: "ask_parent";
    readonly AskUser: "ask_user";
};
export type AgentExecutionFallbackReason = (typeof AgentExecutionFallbackReason)[keyof typeof AgentExecutionFallbackReason];
export declare const AGENT_EXECUTION_FALLBACK_REASONS: readonly AgentExecutionFallbackReason[];
export declare const AGENT_EXECUTION_ROUTES: readonly ["self_solve", "direct_current_agent", "delegate_to_child", "return_to_parent", "root_nobie_direct", "explicit_provider", "nobie_direct", "ask_parent", "ask_user", "sub_agent", "yeonjang"];
export type AgentExecutionRoute = (typeof AGENT_EXECUTION_ROUTES)[number];
export declare const AGENT_EXECUTION_BEHAVIOR_PATTERNS: readonly ["answer", "plan", "split", "delegate", "execute", "review", "aggregate", "clarify", "recover"];
export type AgentExecutionBehaviorPattern = (typeof AGENT_EXECUTION_BEHAVIOR_PATTERNS)[number];
export declare const AGENT_EXECUTION_RISK_BOUNDARY_KINDS: readonly ["privacy", "permission", "delete", "payment", "external_transfer", "local_system_control"];
export type AgentExecutionRiskBoundaryKind = (typeof AGENT_EXECUTION_RISK_BOUNDARY_KINDS)[number];
export interface AgentExecutionRequiredOutput {
    id: string;
    label: string;
    acceptance_criteria?: string[];
    recipient_executor_id?: string;
}
export interface AgentExecutionTaskUnit {
    id: string;
    title: string;
    goal: string;
    preferred_executor_id?: string;
    required_outputs?: AgentExecutionRequiredOutput[];
    depends_on_unit_ids?: string[];
}
export interface AgentExecutionTaskProfile {
    title: string;
    summary: string;
    goals: string[];
    task_units: AgentExecutionTaskUnit[];
    success_criteria: string[];
    constraints?: string[];
}
export interface AgentExecutionRiskBoundary {
    requires_user_approval: boolean;
    reason: string;
    boundary_kind?: AgentExecutionRiskBoundaryKind;
    policy_refs?: string[];
}
export interface AgentExecutionDecision {
    contract_version: typeof AGENT_EXECUTION_DECISION_CONTRACT_VERSION;
    current_executor_id: string;
    parent_executor_id?: string;
    domain: string;
    behavior_pattern: AgentExecutionBehaviorPattern;
    execution_route: AgentExecutionRoute;
    selected_executor_id?: string;
    selected_connection_path: string[];
    task_profile: AgentExecutionTaskProfile;
    required_outputs: AgentExecutionRequiredOutput[];
    risk_boundary: AgentExecutionRiskBoundary;
    confidence: number;
    fallback_if_unavailable: AgentExecutionFallbackReason;
    unresolved_reason?: string;
    reason: string;
}
export interface AgentExecutionContextRequest {
    kind: "user_message" | "work_order" | "delegation_request";
    latest_user_message?: string;
    work_order_id?: string;
    work_order?: Record<string, unknown>;
    delegation_request_id?: string;
    structured_goal?: string;
    required_outputs?: AgentExecutionRequiredOutput[];
    channel_id?: string;
}
export interface AgentExecutionExecutorProfile {
    executor_id: string;
    display_name: string;
    role_name?: string;
    definition?: string;
    can_delegate: boolean;
    available: boolean;
}
export interface AgentExecutionDiagnosticExecutorProfile extends AgentExecutionExecutorProfile {
    visibility: "current" | "direct_child" | "indirect" | "parent" | "unavailable_direct_child";
    graph_source?: string;
    parent_executor_ids?: string[];
    reason_codes?: string[];
}
export interface AgentExecutionRequester {
    requester_id: string;
    requester_type: "user" | "executor" | "channel" | "system";
    display_name?: string;
}
export interface AgentExecutionConnection {
    from_executor_id: string;
    to_executor_id: string;
    relation: "delegates_to" | "reports_to" | "collaborates_with" | "handoff_to";
    label?: string;
}
export interface AgentExecutionToolBinding {
    tool_id: string;
    label: string;
    permission_scope: "read" | "write" | "external" | "local_system" | "approval_required";
}
export interface AgentExecutionPermissionPolicy {
    allowed_tool_ids: string[];
    blocked_tool_ids?: string[];
    approval_required_tool_ids?: string[];
    notes?: string[];
}
export interface AgentExecutionRiskPolicy {
    approval_required_for: AgentExecutionRiskBoundaryKind[];
    blocked_without_approval?: AgentExecutionRiskBoundaryKind[];
    notes?: string[];
}
export interface AgentExecutionGraphContext {
    graph_id: string;
    graph_source: string;
    root_executor_id: string;
    current_executor_id: string;
    available_executor_ids: string[];
    diagnostic_executor_ids: string[];
    all_active_executor_ids: string[];
    all_registered_executor_ids?: string[];
    allowed_connections: AgentExecutionConnection[];
    validation_issue_codes: string[];
    topology_id?: string;
    topology_version?: number;
}
export interface AgentExecutionContext {
    contract_version: typeof AGENT_EXECUTION_DECISION_CONTRACT_VERSION;
    request: AgentExecutionContextRequest;
    current_executor: AgentExecutionExecutorProfile;
    parent_executor?: AgentExecutionExecutorProfile;
    requester?: AgentExecutionRequester;
    accessible_executors: AgentExecutionExecutorProfile[];
    diagnostic_executors?: AgentExecutionDiagnosticExecutorProfile[];
    accessible_connections: AgentExecutionConnection[];
    available_tools: AgentExecutionToolBinding[];
    permission_policy: AgentExecutionPermissionPolicy;
    risk_policy: AgentExecutionRiskPolicy;
    execution_graph?: AgentExecutionGraphContext;
    direct_execution_requested?: boolean;
    explicit_target_executor_id?: string;
    explicit_provider_target_id?: string;
}
export interface DelegationDecision {
    contract_version: typeof AGENT_EXECUTION_DECISION_CONTRACT_VERSION;
    from_executor_id: string;
    to_executor_id: string;
    connection_path: string[];
    task_profile: AgentExecutionTaskProfile;
    required_outputs: AgentExecutionRequiredOutput[];
    confidence: number;
    fallback_if_unavailable: AgentExecutionFallbackReason;
    reason: string;
}
export interface WorkOrderSplit {
    contract_version: typeof AGENT_EXECUTION_DECISION_CONTRACT_VERSION;
    parent_work_order_id?: string;
    split_by_executor_id: string;
    task_profile: AgentExecutionTaskProfile;
    work_units: AgentExecutionTaskUnit[];
    aggregation_executor_id?: string;
    reason: string;
}
export interface DelegationValidationIssue {
    code: "missing_executor" | "empty_selected_path" | "inaccessible_connection_path" | "selected_executor_not_in_graph" | "selected_executor_not_direct_child" | "selected_connection_path_invalid" | "permission_denied" | "risk_boundary_requires_approval" | "executor_unavailable" | "fallback_not_allowed" | "provider_target_missing" | "parent_executor_missing";
    message: string;
    executor_id?: string;
    connection_path?: string[];
}
export interface DelegationValidationResult {
    contract_version: typeof AGENT_EXECUTION_DECISION_CONTRACT_VERSION;
    ok: boolean;
    status: "valid" | "missing_executor" | "empty_selected_path" | "inaccessible_connection_path" | "selected_executor_not_in_graph" | "selected_executor_not_direct_child" | "selected_connection_path_invalid" | "permission_denied" | "risk_boundary_requires_approval" | "executor_unavailable" | "fallback_not_allowed" | "provider_target_missing" | "parent_executor_missing";
    issues: DelegationValidationIssue[];
    fallback_if_invalid: AgentExecutionFallbackReason;
}
export interface AgentExecutionDecisionTraceSnapshot {
    contract_version: typeof AGENT_EXECUTION_DECISION_CONTRACT_VERSION;
    decision_source: string;
    graph_id?: string;
    graph_source?: string;
    root_executor_id?: string;
    current_executor_id: string;
    available_executor_ids: string[];
    diagnostic_executor_ids: string[];
    all_active_executor_ids: string[];
    all_registered_executor_ids?: string[];
    selected_executor_id?: string;
    selected_connection_path: string[];
    normalized_connection_path?: string[];
    execution_route: AgentExecutionRoute;
    fallback_if_unavailable: AgentExecutionFallbackReason;
    fallback_reason?: string;
    validation_ok?: boolean;
    validation_status?: DelegationValidationResult["status"];
    validation_issues?: DelegationValidationIssue[];
    resolved_execution_route?: AgentExecutionRoute;
    resolved_selected_executor_id?: string;
}
export interface AggregationResult {
    contract_version: typeof AGENT_EXECUTION_DECISION_CONTRACT_VERSION;
    aggregator_executor_id: string;
    source_executor_ids: string[];
    status: "complete" | "partial" | "needs_more_work" | "blocked";
    outputs: AgentExecutionRequiredOutput[];
    unresolved_items?: string[];
    reason: string;
}
export interface SelfSolveAttempt {
    contract_version: typeof AGENT_EXECUTION_DECISION_CONTRACT_VERSION;
    executor_id: string;
    task_profile: AgentExecutionTaskProfile;
    selected_tool_ids: string[];
    status: "planned" | "running" | "completed" | "blocked" | "returned";
    outputs?: AgentExecutionRequiredOutput[];
    unresolved_reason?: string;
    reason: string;
}
export interface AgentExecutionDecisionShapeValidation {
    ok: boolean;
    issues: string[];
}
export declare function isAgentExecutionFallbackReason(value: unknown): value is AgentExecutionFallbackReason;
export declare function isAgentExecutionRoute(value: unknown): value is AgentExecutionRoute;
export declare function normalizeAgentExecutionConfidence(value: unknown): number;
export declare function validateAgentExecutionDecisionShape(decision: unknown): AgentExecutionDecisionShapeValidation;
//# sourceMappingURL=execution-decision-contract.d.ts.map
