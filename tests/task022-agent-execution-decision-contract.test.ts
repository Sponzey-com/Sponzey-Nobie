import { describe, expect, it } from "vitest"
import {
  AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
  AGENT_EXECUTION_FALLBACK_REASONS,
  AGENT_EXECUTION_RISK_BOUNDARY_KINDS,
  AgentExecutionFallbackReason,
  isAgentExecutionFallbackReason,
  isAgentExecutionRoute,
  normalizeAgentExecutionConfidence,
  validateAgentExecutionDecisionShape,
} from "../packages/core/src/orchestration/execution-decision-contract.ts"
import type {
  AgentExecutionContext,
  AgentExecutionDecision,
  AgentExecutionRequiredOutput,
  AgentExecutionTaskProfile,
  AggregationResult,
  DelegationDecision,
  DelegationValidationResult,
  SelfSolveAttempt,
  WorkOrderSplit,
} from "../packages/core/src/orchestration/execution-decision-contract.ts"

const taskProfile: AgentExecutionTaskProfile = {
  title: "기능 구현 계획",
  summary: "작업을 분석하고 실행 가능한 단위로 나눈다.",
  goals: ["목표를 확인한다", "작업을 나눈다", "결과를 취합한다"],
  task_units: [
    {
      id: "unit:plan",
      title: "계획",
      goal: "요구사항을 구조화한다.",
      preferred_executor_id: "node:planner",
    },
  ],
  success_criteria: ["필요 산출물이 모두 설명된다"],
  constraints: ["권한 경계를 넘지 않는다"],
}

const requiredOutputs: AgentExecutionRequiredOutput[] = [
  {
    id: "output:summary",
    label: "요약",
    acceptance_criteria: ["누락된 작업이 드러난다"],
  },
]

function createDecision(overrides: Partial<AgentExecutionDecision> = {}): AgentExecutionDecision {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    current_executor_id: "node:intake",
    parent_executor_id: "node:lead",
    domain: "product_delivery",
    behavior_pattern: "delegate",
    execution_route: "delegate_to_child",
    selected_executor_id: "node:planner",
    selected_connection_path: ["node:intake", "node:planner"],
    task_profile: taskProfile,
    required_outputs: requiredOutputs,
    risk_boundary: {
      requires_user_approval: false,
      reason: "정책 경계 안에서 처리 가능하다.",
      boundary_kind: "permission",
    },
    confidence: 0.82,
    fallback_if_unavailable: AgentExecutionFallbackReason.SelfSolve,
    reason: "연결된 실행자가 계획 수립에 적합하다.",
    ...overrides,
  }
}

describe("task022 agent execution decision contract", () => {
  it("keeps fallback names stable for prompts and harness code", () => {
    expect(AGENT_EXECUTION_FALLBACK_REASONS).toEqual([
      "self_solve",
      "direct_current_agent",
      "delegate_to_child",
      "return_to_parent",
      "root_nobie_direct",
      "explicit_provider",
      "explicit_provider_target",
      "boundary_failure",
      "nobie_direct",
      "ask_parent",
      "ask_user",
    ])
    expect(Object.values(AgentExecutionFallbackReason)).toEqual(AGENT_EXECUTION_FALLBACK_REASONS)
    expect(isAgentExecutionFallbackReason("return_to_parent")).toBe(true)
    expect(isAgentExecutionRoute("sub_agent")).toBe(true)
  })

  it("accepts a complete structured execution decision shape", () => {
    const decision = createDecision()
    const validation = validateAgentExecutionDecisionShape(decision)

    expect(validation).toEqual({ ok: true, issues: [] })
    expect(normalizeAgentExecutionConfidence(-1)).toBe(0)
    expect(normalizeAgentExecutionConfidence(2)).toBe(1)
    expect(normalizeAgentExecutionConfidence(0.48)).toBe(0.48)
  })

  it("represents invalid delegation targets for later graph validation", () => {
    const context: AgentExecutionContext = {
      contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
      request: {
        kind: "work_order",
        work_order_id: "wo:root",
        structured_goal: "보이는 연결 그래프로 작업을 나눈다.",
        required_outputs: requiredOutputs,
      },
      current_executor: {
        executor_id: "node:intake",
        display_name: "접수",
        role_name: "요청 정리",
        can_delegate: true,
        available: true,
      },
      parent_executor: {
        executor_id: "node:lead",
        display_name: "상위 실행자",
        can_delegate: true,
        available: true,
      },
      accessible_executors: [
        {
          executor_id: "node:planner",
          display_name: "계획",
          can_delegate: true,
          available: true,
        },
      ],
      accessible_connections: [
        {
          from_executor_id: "node:intake",
          to_executor_id: "node:planner",
          relation: "delegates_to",
        },
      ],
      available_tools: [
        {
          tool_id: "tool:read",
          label: "읽기",
          permission_scope: "read",
        },
      ],
      permission_policy: {
        allowed_tool_ids: ["tool:read"],
      },
      risk_policy: {
        approval_required_for: ["privacy", "permission", "delete", "payment", "external_transfer", "local_system_control"],
      },
    }

    const missingExecutorDecision = createDecision({
      selected_executor_id: "node:missing",
      selected_connection_path: ["node:intake", "node:missing"],
    })
    const emptyPathDecision = createDecision({
      selected_executor_id: "node:planner",
      selected_connection_path: [],
    })
    const inaccessiblePathDecision = createDecision({
      selected_executor_id: "node:hidden",
      selected_connection_path: ["node:intake", "node:hidden"],
    })
    const graphValidationResults: DelegationValidationResult[] = [
      {
        contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
        ok: false,
        status: "missing_executor",
        issues: [
          {
            code: "missing_executor",
            message: "Selected executor is not present in the accessible executor set.",
            executor_id: "node:missing",
          },
        ],
        fallback_if_invalid: "self_solve",
      },
      {
        contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
        ok: false,
        status: "empty_selected_path",
        issues: [
          {
            code: "empty_selected_path",
            message: "Selected path is empty.",
            connection_path: [],
          },
        ],
        fallback_if_invalid: "ask_parent",
      },
      {
        contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
        ok: false,
        status: "inaccessible_connection_path",
        issues: [
          {
            code: "inaccessible_connection_path",
            message: "Selected path is outside the accessible graph.",
            connection_path: ["node:intake", "node:hidden"],
          },
        ],
        fallback_if_invalid: "return_to_parent",
      },
    ]

    expect(context.accessible_executors.map((executor) => executor.executor_id)).toEqual(["node:planner"])
    expect(validateAgentExecutionDecisionShape(missingExecutorDecision).ok).toBe(true)
    expect(validateAgentExecutionDecisionShape(emptyPathDecision).ok).toBe(true)
    expect(validateAgentExecutionDecisionShape(inaccessiblePathDecision).ok).toBe(true)
    expect(graphValidationResults.map((result) => result.status)).toEqual([
      "missing_executor",
      "empty_selected_path",
      "inaccessible_connection_path",
    ])
  })

  it("defines return_to_parent as the requester above the current executor", () => {
    const context: AgentExecutionContext = {
      contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
      request: {
        kind: "delegation_request",
        delegation_request_id: "delegation:1",
        structured_goal: "하위 실행자가 처리 불가능한 일을 상위에 돌려준다.",
      },
      current_executor: {
        executor_id: "node:worker",
        display_name: "작업자",
        can_delegate: true,
        available: true,
      },
      parent_executor: {
        executor_id: "node:lead",
        display_name: "상위 실행자",
        can_delegate: true,
        available: true,
      },
      accessible_executors: [],
      accessible_connections: [],
      available_tools: [],
      permission_policy: {
        allowed_tool_ids: [],
      },
      risk_policy: {
        approval_required_for: [],
      },
    }
    const decision = createDecision({
      current_executor_id: "node:worker",
      parent_executor_id: "node:lead",
      execution_route: "return_to_parent",
      selected_executor_id: "node:lead",
      selected_connection_path: ["node:worker", "node:lead"],
      fallback_if_unavailable: "return_to_parent",
      unresolved_reason: "현재 실행자의 하위와 도구 안에서 처리할 수 없다.",
    })

    expect(context.parent_executor?.executor_id).toBe("node:lead")
    expect(context.parent_executor?.executor_id).not.toBe("nobie")
    expect(decision.fallback_if_unavailable).toBe("return_to_parent")
  })

  it("keeps risk boundaries policy-based and leaves numeric stop rules out of the contract", () => {
    expect(AGENT_EXECUTION_RISK_BOUNDARY_KINDS).toEqual([
      "privacy",
      "permission",
      "delete",
      "payment",
      "external_transfer",
      "local_system_control",
    ])
    expect(AGENT_EXECUTION_RISK_BOUNDARY_KINDS).not.toContain("retry_count")
    expect(AGENT_EXECUTION_RISK_BOUNDARY_KINDS).not.toContain("max_attempts")
  })

  it("covers delegation, split, aggregation, and self-solve contracts", () => {
    const delegation: DelegationDecision = {
      contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
      from_executor_id: "node:intake",
      to_executor_id: "node:planner",
      connection_path: ["node:intake", "node:planner"],
      task_profile: taskProfile,
      required_outputs: requiredOutputs,
      confidence: 0.75,
      fallback_if_unavailable: "self_solve",
      reason: "계획 담당자에게 나눠 맡길 수 있다.",
    }
    const split: WorkOrderSplit = {
      contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
      split_by_executor_id: "node:planner",
      task_profile: taskProfile,
      work_units: taskProfile.task_units,
      aggregation_executor_id: "node:planner",
      reason: "목표를 실행 가능한 작업으로 나눈다.",
    }
    const aggregation: AggregationResult = {
      contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
      aggregator_executor_id: "node:planner",
      source_executor_ids: ["node:worker"],
      status: "partial",
      outputs: requiredOutputs,
      unresolved_items: ["추가 검토 필요"],
      reason: "일부 결과를 취합했다.",
    }
    const selfSolve: SelfSolveAttempt = {
      contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
      executor_id: "node:worker",
      task_profile: taskProfile,
      selected_tool_ids: ["tool:read"],
      status: "planned",
      reason: "위임할 대상이 없으면 자기 권한 안에서 먼저 처리한다.",
    }

    expect(delegation.to_executor_id).toBe("node:planner")
    expect(split.work_units).toHaveLength(1)
    expect(aggregation.status).toBe("partial")
    expect(selfSolve.status).toBe("planned")
  })
})
