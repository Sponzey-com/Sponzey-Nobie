export const AGENT_EXECUTION_DECISION_CONTRACT_VERSION = "agent-execution-decision:v1" as const
export const AGENT_EXECUTION_DECISION_V2_CONTRACT_VERSION = "agent-execution-decision:v2" as const

export const AGENT_EXECUTION_DECISION_V2_ACTIONS = [
  "delegate",
  "self_solve",
  "ask_user",
  "return_to_parent",
  "fail_with_reason",
] as const

export type AgentExecutionDecisionV2Action = (typeof AGENT_EXECUTION_DECISION_V2_ACTIONS)[number]

export const AgentExecutionFallbackReason = {
  SelfSolve: "self_solve",
  DirectCurrentAgent: "direct_current_agent",
  DelegateToChild: "delegate_to_child",
  // Direct requester or parent executor, not root Nobie unless that executor requested the work.
  ReturnToParent: "return_to_parent",
  RootNobieDirect: "root_nobie_direct",
  ExplicitProvider: "explicit_provider",
  // Legacy alias accepted for stored phase022 decisions. New decisions should
  // use root_nobie_direct when the current executor is root Nobie.
  NobieDirect: "nobie_direct",
  AskParent: "ask_parent",
  AskUser: "ask_user",
} as const

export type AgentExecutionFallbackReason =
  (typeof AgentExecutionFallbackReason)[keyof typeof AgentExecutionFallbackReason]

export const AGENT_EXECUTION_FALLBACK_REASONS = Object.freeze(
  Object.values(AgentExecutionFallbackReason),
) as readonly AgentExecutionFallbackReason[]

export const AGENT_EXECUTION_ROUTES = [
  "self_solve",
  "direct_current_agent",
  "delegate_to_child",
  "return_to_parent",
  "root_nobie_direct",
  "explicit_provider",
  "nobie_direct",
  "ask_parent",
  "ask_user",
  "sub_agent",
  "yeonjang",
] as const

export type AgentExecutionRoute = (typeof AGENT_EXECUTION_ROUTES)[number]

export const AGENT_EXECUTION_BEHAVIOR_PATTERNS = [
  "answer",
  "plan",
  "split",
  "delegate",
  "execute",
  "review",
  "aggregate",
  "clarify",
  "recover",
] as const

export type AgentExecutionBehaviorPattern = (typeof AGENT_EXECUTION_BEHAVIOR_PATTERNS)[number]

export const AGENT_EXECUTION_RISK_BOUNDARY_KINDS = [
  "privacy",
  "permission",
  "delete",
  "payment",
  "external_transfer",
  "local_system_control",
] as const

export type AgentExecutionRiskBoundaryKind =
  (typeof AGENT_EXECUTION_RISK_BOUNDARY_KINDS)[number]

export interface AgentExecutionRequiredOutput {
  id: string
  label: string
  acceptance_criteria?: string[]
  recipient_executor_id?: string
}

export interface AgentExecutionTaskUnit {
  id: string
  title: string
  goal: string
  preferred_executor_id?: string
  required_outputs?: AgentExecutionRequiredOutput[]
  depends_on_unit_ids?: string[]
}

export interface AgentExecutionTaskProfile {
  title: string
  summary: string
  goals: string[]
  task_units: AgentExecutionTaskUnit[]
  success_criteria: string[]
  constraints?: string[]
}

export interface AgentExecutionTaskSplitUnitV2 {
  executor_id: string
  objective: string
  expected_return: string
  depends_on_executor_ids?: string[]
}

export interface AgentExecutionRiskBoundary {
  requires_user_approval: boolean
  reason: string
  boundary_kind?: AgentExecutionRiskBoundaryKind
  policy_refs?: string[]
}

// A stored decision from the current executor's position in the graph. It is
// evaluated from structured context, not local language-specific string rules.
export interface AgentExecutionDecision {
  contract_version: typeof AGENT_EXECUTION_DECISION_CONTRACT_VERSION
  current_executor_id: string
  parent_executor_id?: string
  domain: string
  behavior_pattern: AgentExecutionBehaviorPattern
  execution_route: AgentExecutionRoute
  selected_executor_id?: string
  selected_connection_path: string[]
  task_profile: AgentExecutionTaskProfile
  required_outputs: AgentExecutionRequiredOutput[]
  risk_boundary: AgentExecutionRiskBoundary
  confidence: number
  fallback_if_unavailable: AgentExecutionFallbackReason
  unresolved_reason?: string
  reason: string
}

export interface AgentExecutionDecisionV2 {
  contract_version: typeof AGENT_EXECUTION_DECISION_V2_CONTRACT_VERSION
  current_executor_id: string
  parent_executor_id?: string
  domain: string
  behavior_pattern: AgentExecutionBehaviorPattern
  action: AgentExecutionDecisionV2Action
  selected_executor_ids: string[]
  selected_connection_path: string[]
  task_profile: AgentExecutionTaskProfile
  task_split?: AgentExecutionTaskSplitUnitV2[]
  required_outputs: AgentExecutionRequiredOutput[]
  risk_boundary: AgentExecutionRiskBoundary
  confidence: number
  unresolved_reason?: string
  reason: string
}

// Context is scoped to the executor making the decision: requester, parent,
// visible child/next executors, graph edges, tools, permissions, and risk policy.
export interface AgentExecutionContextRequest {
  kind: "user_message" | "work_order" | "delegation_request"
  latest_user_message?: string
  work_order_id?: string
  work_order?: Record<string, unknown>
  delegation_request_id?: string
  structured_goal?: string
  required_outputs?: AgentExecutionRequiredOutput[]
  channel_id?: string
}

export interface AgentExecutionExecutorProfile {
  executor_id: string
  display_name: string
  role_name?: string
  definition?: string
  can_delegate: boolean
  available: boolean
}

export interface AgentExecutionDiagnosticExecutorProfile extends AgentExecutionExecutorProfile {
  visibility: "current" | "direct_child" | "indirect" | "parent" | "unavailable_direct_child"
  graph_source?: string
  parent_executor_ids?: string[]
  reason_codes?: string[]
}

export interface AgentExecutionRequester {
  requester_id: string
  requester_type: "user" | "executor" | "channel" | "system"
  display_name?: string
}

export interface AgentExecutionConnection {
  from_executor_id: string
  to_executor_id: string
  relation: "delegates_to" | "reports_to" | "collaborates_with" | "handoff_to"
  label?: string
}

export interface AgentExecutionToolBinding {
  tool_id: string
  label: string
  permission_scope: "read" | "write" | "external" | "local_system" | "approval_required"
}

export interface AgentExecutionPermissionPolicy {
  allowed_tool_ids: string[]
  blocked_tool_ids?: string[]
  approval_required_tool_ids?: string[]
  notes?: string[]
}

export interface AgentExecutionRiskPolicy {
  approval_required_for: AgentExecutionRiskBoundaryKind[]
  blocked_without_approval?: AgentExecutionRiskBoundaryKind[]
  notes?: string[]
}

export interface AgentExecutionGraphContext {
  graph_id: string
  graph_source: string
  root_executor_id: string
  current_executor_id: string
  available_executor_ids: string[]
  diagnostic_executor_ids: string[]
  all_active_executor_ids: string[]
  all_registered_executor_ids?: string[]
  allowed_connections: AgentExecutionConnection[]
  validation_issue_codes: string[]
  topology_id?: string
  topology_version?: number
}

export interface AgentExecutionContext {
  contract_version: typeof AGENT_EXECUTION_DECISION_CONTRACT_VERSION
  request: AgentExecutionContextRequest
  current_executor: AgentExecutionExecutorProfile
  parent_executor?: AgentExecutionExecutorProfile
  requester?: AgentExecutionRequester
  accessible_executors: AgentExecutionExecutorProfile[]
  diagnostic_executors?: AgentExecutionDiagnosticExecutorProfile[]
  accessible_connections: AgentExecutionConnection[]
  available_tools: AgentExecutionToolBinding[]
  permission_policy: AgentExecutionPermissionPolicy
  risk_policy: AgentExecutionRiskPolicy
  execution_graph?: AgentExecutionGraphContext
  direct_execution_requested?: boolean
  explicit_target_executor_id?: string
  explicit_provider_target_id?: string
}

// A delegation contract records the selected graph path; later graph validation
// may reject missing or inaccessible targets without changing the decision shape.
export interface DelegationDecision {
  contract_version: typeof AGENT_EXECUTION_DECISION_CONTRACT_VERSION
  from_executor_id: string
  to_executor_id: string
  connection_path: string[]
  task_profile: AgentExecutionTaskProfile
  required_outputs: AgentExecutionRequiredOutput[]
  confidence: number
  fallback_if_unavailable: AgentExecutionFallbackReason
  reason: string
}

export interface WorkOrderSplit {
  contract_version: typeof AGENT_EXECUTION_DECISION_CONTRACT_VERSION
  parent_work_order_id?: string
  split_by_executor_id: string
  task_profile: AgentExecutionTaskProfile
  work_units: AgentExecutionTaskUnit[]
  aggregation_executor_id?: string
  reason: string
}

export interface DelegationValidationIssue {
  code:
    | "missing_executor"
    | "empty_selected_path"
    | "inaccessible_connection_path"
    | "selected_executor_not_in_graph"
    | "selected_executor_not_direct_child"
    | "selected_connection_path_invalid"
    | "permission_denied"
    | "risk_boundary_requires_approval"
    | "executor_unavailable"
    | "fallback_not_allowed"
    | "provider_target_missing"
    | "parent_executor_missing"
  message: string
  executor_id?: string
  connection_path?: string[]
}

export interface DelegationValidationResult {
  contract_version: typeof AGENT_EXECUTION_DECISION_CONTRACT_VERSION
  ok: boolean
  status:
    | "valid"
    | "missing_executor"
    | "empty_selected_path"
    | "inaccessible_connection_path"
    | "selected_executor_not_in_graph"
    | "selected_executor_not_direct_child"
    | "selected_connection_path_invalid"
    | "permission_denied"
    | "risk_boundary_requires_approval"
    | "executor_unavailable"
    | "fallback_not_allowed"
    | "provider_target_missing"
    | "parent_executor_missing"
  issues: DelegationValidationIssue[]
  fallback_if_invalid: AgentExecutionFallbackReason
}

export interface AgentExecutionDecisionTraceSnapshot {
  contract_version: typeof AGENT_EXECUTION_DECISION_CONTRACT_VERSION
  decision_source: string
  graph_id?: string
  graph_source?: string
  root_executor_id?: string
  current_executor_id: string
  available_executor_ids: string[]
  diagnostic_executor_ids: string[]
  all_active_executor_ids: string[]
  all_registered_executor_ids?: string[]
  selected_executor_id?: string
  selected_connection_path: string[]
  normalized_connection_path?: string[]
  execution_route: AgentExecutionRoute
  fallback_if_unavailable: AgentExecutionFallbackReason
  fallback_reason?: string
  validation_ok?: boolean
  validation_status?: DelegationValidationResult["status"]
  validation_issues?: DelegationValidationIssue[]
  resolved_execution_route?: AgentExecutionRoute
  resolved_selected_executor_id?: string
}

export interface AggregationResult {
  contract_version: typeof AGENT_EXECUTION_DECISION_CONTRACT_VERSION
  aggregator_executor_id: string
  source_executor_ids: string[]
  status: "complete" | "partial" | "needs_more_work" | "blocked"
  outputs: AgentExecutionRequiredOutput[]
  unresolved_items?: string[]
  reason: string
}

export interface SelfSolveAttempt {
  contract_version: typeof AGENT_EXECUTION_DECISION_CONTRACT_VERSION
  executor_id: string
  task_profile: AgentExecutionTaskProfile
  selected_tool_ids: string[]
  status: "planned" | "running" | "completed" | "blocked" | "returned"
  outputs?: AgentExecutionRequiredOutput[]
  unresolved_reason?: string
  reason: string
}

export interface AgentExecutionDecisionShapeValidation {
  ok: boolean
  issues: string[]
}

export interface AgentExecutionDecisionV2ValidationIssue {
  code:
    | "invalid_contract_version"
    | "invalid_current_executor"
    | "invalid_action"
    | "missing_selected_executor"
    | "selected_executor_not_direct_child"
    | "selected_executor_not_in_context"
    | "invalid_selected_connection_path"
    | "invalid_task_profile"
    | "invalid_required_outputs"
    | "invalid_risk_boundary"
    | "invalid_confidence"
    | "invalid_reason"
    | "invalid_task_split_executor"
    | "invalid_task_split_objective"
    | "invalid_task_split_expected_return"
  message: string
  executor_id?: string
  connection_path?: string[]
}

export interface AgentExecutionDecisionV2Validation {
  ok: boolean
  issues: AgentExecutionDecisionV2ValidationIssue[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function hasString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

export function isAgentExecutionFallbackReason(
  value: unknown,
): value is AgentExecutionFallbackReason {
  return typeof value === "string" && AGENT_EXECUTION_FALLBACK_REASONS.includes(value as AgentExecutionFallbackReason)
}

export function isAgentExecutionRoute(value: unknown): value is AgentExecutionRoute {
  return typeof value === "string" && AGENT_EXECUTION_ROUTES.includes(value as AgentExecutionRoute)
}

export function normalizeAgentExecutionConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

export function validateAgentExecutionDecisionShape(
  decision: unknown,
): AgentExecutionDecisionShapeValidation {
  const issues: string[] = []

  if (!isRecord(decision)) {
    return { ok: false, issues: ["decision must be an object"] }
  }

  if (decision.contract_version !== AGENT_EXECUTION_DECISION_CONTRACT_VERSION) {
    issues.push("contract_version must match agent execution decision contract")
  }
  if (!hasString(decision.current_executor_id)) {
    issues.push("current_executor_id must be a non-empty string")
  }
  if (!hasString(decision.domain)) {
    issues.push("domain must be a non-empty string")
  }
  if (
    typeof decision.behavior_pattern !== "string" ||
    !AGENT_EXECUTION_BEHAVIOR_PATTERNS.includes(decision.behavior_pattern as AgentExecutionBehaviorPattern)
  ) {
    issues.push("behavior_pattern must be a known behavior pattern")
  }
  if (!isAgentExecutionRoute(decision.execution_route)) {
    issues.push("execution_route must be a known execution route")
  }
  if (!isStringArray(decision.selected_connection_path)) {
    issues.push("selected_connection_path must be an array of executor ids")
  }
  if (!Array.isArray(decision.required_outputs)) {
    issues.push("required_outputs must be an array")
  }
  if (!isRecord(decision.task_profile)) {
    issues.push("task_profile must be an object")
  }
  if (!isRecord(decision.risk_boundary)) {
    issues.push("risk_boundary must be an object")
  } else {
    if (typeof decision.risk_boundary.requires_user_approval !== "boolean") {
      issues.push("risk_boundary.requires_user_approval must be boolean")
    }
    if (!hasString(decision.risk_boundary.reason)) {
      issues.push("risk_boundary.reason must be a non-empty string")
    }
    if (
      decision.risk_boundary.boundary_kind !== undefined &&
      (typeof decision.risk_boundary.boundary_kind !== "string" ||
        !AGENT_EXECUTION_RISK_BOUNDARY_KINDS.includes(
          decision.risk_boundary.boundary_kind as AgentExecutionRiskBoundaryKind,
        ))
    ) {
      issues.push("risk_boundary.boundary_kind must be a known policy boundary")
    }
  }
  if (typeof decision.confidence !== "number" || !Number.isFinite(decision.confidence)) {
    issues.push("confidence must be a finite number")
  } else if (decision.confidence < 0 || decision.confidence > 1) {
    issues.push("confidence must be between 0 and 1")
  }
  if (!isAgentExecutionFallbackReason(decision.fallback_if_unavailable)) {
    issues.push("fallback_if_unavailable must be a known fallback reason")
  }
  if (!hasString(decision.reason)) {
    issues.push("reason must be a non-empty string")
  }

  return { ok: issues.length === 0, issues }
}

export function isAgentExecutionDecisionV2Action(value: unknown): value is AgentExecutionDecisionV2Action {
  return typeof value === "string" && AGENT_EXECUTION_DECISION_V2_ACTIONS.includes(value as AgentExecutionDecisionV2Action)
}

export function isAgentExecutionDecisionV2(value: unknown): value is AgentExecutionDecisionV2 {
  return isRecord(value) && value.contract_version === AGENT_EXECUTION_DECISION_V2_CONTRACT_VERSION
}

export function validateAgentExecutionDecisionV2AgainstContext(input: {
  context: AgentExecutionContext
  decision: unknown
}): AgentExecutionDecisionV2Validation {
  const issues: AgentExecutionDecisionV2ValidationIssue[] = []
  const decision = input.decision
  if (!isRecord(decision)) {
    return {
      ok: false,
      issues: [{
        code: "invalid_contract_version",
        message: "AgentExecutionDecisionV2 must be an object.",
      }],
    }
  }

  const directChildIds = new Set(input.context.execution_graph?.available_executor_ids ??
    input.context.accessible_executors.map((executor) => executor.executor_id))
  const allContextExecutorIds = new Set([
    input.context.current_executor.executor_id,
    input.context.parent_executor?.executor_id,
    ...(input.context.execution_graph?.all_active_executor_ids ?? []),
    ...(input.context.execution_graph?.all_registered_executor_ids ?? []),
    ...input.context.accessible_executors.map((executor) => executor.executor_id),
    ...(input.context.diagnostic_executors ?? []).map((executor) => executor.executor_id),
  ].filter((value): value is string => Boolean(value?.trim())))

  if (decision.contract_version !== AGENT_EXECUTION_DECISION_V2_CONTRACT_VERSION) {
    issues.push({
      code: "invalid_contract_version",
      message: "contract_version must be agent-execution-decision:v2.",
    })
  }
  if (decision.current_executor_id !== input.context.current_executor.executor_id) {
    issues.push({
      code: "invalid_current_executor",
      message: "current_executor_id must match the current executor context.",
      ...(typeof decision.current_executor_id === "string" ? { executor_id: decision.current_executor_id } : {}),
    })
  }
  if (!isAgentExecutionDecisionV2Action(decision.action)) {
    issues.push({
      code: "invalid_action",
      message: "action must be delegate, self_solve, ask_user, return_to_parent, or fail_with_reason.",
    })
  }
  if (!isStringArray(decision.selected_executor_ids)) {
    issues.push({
      code: "missing_selected_executor",
      message: "selected_executor_ids must be an array.",
    })
  } else {
    if (decision.action === "delegate" && decision.selected_executor_ids.length === 0) {
      issues.push({
        code: "missing_selected_executor",
        message: "delegate action requires at least one selected executor.",
      })
    }
    for (const executorId of decision.selected_executor_ids) {
      if (!allContextExecutorIds.has(executorId)) {
        issues.push({
          code: "selected_executor_not_in_context",
          message: "selected_executor_ids may only reference executors in the provided graph context.",
          executor_id: executorId,
        })
        continue
      }
      if (!directChildIds.has(executorId)) {
        issues.push({
          code: "selected_executor_not_direct_child",
          message: "selected_executor_ids may only reference direct child executors.",
          executor_id: executorId,
        })
      }
    }
  }
  if (!isStringArray(decision.selected_connection_path)) {
    issues.push({
      code: "invalid_selected_connection_path",
      message: "selected_connection_path must be an array of executor ids.",
    })
  }
  if (!isRecord(decision.task_profile)) {
    issues.push({
      code: "invalid_task_profile",
      message: "task_profile must be an object.",
    })
  }
  if (!Array.isArray(decision.required_outputs)) {
    issues.push({
      code: "invalid_required_outputs",
      message: "required_outputs must be an array.",
    })
  }
  if (!isRecord(decision.risk_boundary)) {
    issues.push({
      code: "invalid_risk_boundary",
      message: "risk_boundary must be an object.",
    })
  } else {
    if (typeof decision.risk_boundary.requires_user_approval !== "boolean" || !hasString(decision.risk_boundary.reason)) {
      issues.push({
        code: "invalid_risk_boundary",
        message: "risk_boundary must include requires_user_approval and a reason.",
      })
    }
  }
  if (typeof decision.confidence !== "number" || !Number.isFinite(decision.confidence) || decision.confidence < 0 || decision.confidence > 1) {
    issues.push({
      code: "invalid_confidence",
      message: "confidence must be a finite number from 0 through 1.",
    })
  }
  if (!hasString(decision.reason)) {
    issues.push({
      code: "invalid_reason",
      message: "reason must be a non-empty string.",
    })
  }
  if (decision.task_split !== undefined) {
    if (!Array.isArray(decision.task_split)) {
      issues.push({
        code: "invalid_task_split_objective",
        message: "task_split must be an array when present.",
      })
    } else {
      for (const unit of decision.task_split) {
        if (!isRecord(unit)) {
          issues.push({
            code: "invalid_task_split_objective",
            message: "Each task_split item must be an object.",
          })
          continue
        }
        const executorId = unit.executor_id
        if (!hasString(executorId) || !directChildIds.has(executorId)) {
          issues.push({
            code: "invalid_task_split_executor",
            message: "task_split executor_id must reference a direct child executor.",
            ...(hasString(executorId) ? { executor_id: executorId } : {}),
          })
        }
        if (!hasString(unit.objective)) {
          issues.push({
            code: "invalid_task_split_objective",
            message: "Each task_split item must include a non-empty objective.",
            ...(hasString(executorId) ? { executor_id: executorId } : {}),
          })
        }
        if (!hasString(unit.expected_return)) {
          issues.push({
            code: "invalid_task_split_expected_return",
            message: "Each task_split item must include a non-empty expected_return.",
            ...(hasString(executorId) ? { executor_id: executorId } : {}),
          })
        }
      }
    }
  }

  return { ok: issues.length === 0, issues }
}

export function convertAgentExecutionDecisionV2ToV1(
  decision: AgentExecutionDecisionV2,
): AgentExecutionDecision {
  const firstSelectedExecutorId = decision.selected_executor_ids[0]
  const fallback = fallbackForV2Action(decision.action)
  const unresolvedReason =
    decision.unresolved_reason ??
    (decision.action === "self_solve" ? decision.reason : undefined)
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    current_executor_id: decision.current_executor_id,
    ...(decision.parent_executor_id ? { parent_executor_id: decision.parent_executor_id } : {}),
    domain: decision.domain,
    behavior_pattern: decision.behavior_pattern,
    execution_route: routeForV2Action(decision.action),
    ...(firstSelectedExecutorId ? { selected_executor_id: firstSelectedExecutorId } : {}),
    selected_connection_path: [...decision.selected_connection_path],
    task_profile: {
      ...decision.task_profile,
      task_units: decision.task_split?.map((unit, index) => ({
        id: `task_split:${index + 1}`,
        title: unit.objective,
        goal: unit.objective,
        preferred_executor_id: unit.executor_id,
        required_outputs: [{
          id: `task_split:${index + 1}:return`,
          label: unit.expected_return,
        }],
        ...(unit.depends_on_executor_ids ? { depends_on_unit_ids: unit.depends_on_executor_ids } : {}),
      })) ?? decision.task_profile.task_units,
    },
    required_outputs: [...decision.required_outputs],
    risk_boundary: { ...decision.risk_boundary },
    confidence: decision.confidence,
    fallback_if_unavailable: fallback,
    ...(unresolvedReason ? { unresolved_reason: unresolvedReason } : {}),
    reason: decision.reason,
  }
}

function routeForV2Action(action: AgentExecutionDecisionV2Action): AgentExecutionRoute {
  if (action === "delegate") return "delegate_to_child"
  if (action === "ask_user" || action === "fail_with_reason") return "ask_user"
  if (action === "return_to_parent") return "return_to_parent"
  return "self_solve"
}

function fallbackForV2Action(action: AgentExecutionDecisionV2Action): AgentExecutionFallbackReason {
  if (action === "delegate") return AgentExecutionFallbackReason.SelfSolve
  if (action === "ask_user" || action === "fail_with_reason") return AgentExecutionFallbackReason.AskUser
  if (action === "return_to_parent") return AgentExecutionFallbackReason.ReturnToParent
  return AgentExecutionFallbackReason.SelfSolve
}
