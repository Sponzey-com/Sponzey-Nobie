import { describe, expect, it } from "vitest"
import {
  AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
  AGENT_EXECUTION_DECISION_V2_ACTIONS,
  AGENT_EXECUTION_DECISION_V2_CONTRACT_VERSION,
  type AgentExecutionConnection,
  type AgentExecutionContext,
  type AgentExecutionDecisionV2,
  type AgentExecutionTaskProfile,
  convertAgentExecutionDecisionV2ToV1,
  validateAgentExecutionDecisionV2AgainstContext,
} from "../packages/core/src/orchestration/execution-decision-contract.ts"
import { buildAgentExecutionDecisionPrompt } from "../packages/core/src/orchestration/execution-harness.ts"

const taskProfile: AgentExecutionTaskProfile = {
  title: "요청 라우팅",
  summary: "현재 실행자의 direct child 후보를 기준으로 위임 여부를 판단한다.",
  goals: ["직속 실행자 후보 검증", "위임 결과 반환"],
  task_units: [],
  success_criteria: ["선택된 실행자가 direct child이다."],
}

const connections: AgentExecutionConnection[] = [
  { from_executor_id: "agent:nobie", to_executor_id: "node:finance", relation: "delegates_to" },
  { from_executor_id: "agent:nobie", to_executor_id: "node:lead", relation: "delegates_to" },
  { from_executor_id: "node:lead", to_executor_id: "node:backend", relation: "delegates_to" },
]

function context(): AgentExecutionContext {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    request: {
      kind: "user_message",
      latest_user_message: "시장 질문을 검토해줘",
      structured_goal: "적합한 실행자에게 위임한다.",
    },
    current_executor: {
      executor_id: "agent:nobie",
      display_name: "노비",
      can_delegate: true,
      available: true,
    },
    accessible_executors: [
      {
        executor_id: "node:finance",
        display_name: "행랑아범",
        role_name: "재무 담당",
        can_delegate: false,
        available: true,
      },
      {
        executor_id: "node:lead",
        display_name: "마당쇠",
        role_name: "개발 리드",
        can_delegate: true,
        available: true,
      },
    ],
    diagnostic_executors: [{
      executor_id: "node:backend",
      display_name: "삼식이",
      role_name: "백엔드",
      can_delegate: false,
      available: true,
      visibility: "indirect",
      parent_executor_ids: ["node:lead"],
    }],
    accessible_connections: connections,
    available_tools: [],
    permission_policy: { allowed_tool_ids: [] },
    risk_policy: { approval_required_for: [] },
    execution_graph: {
      graph_id: "execution-graph:v2",
      graph_source: "workspace_draft",
      root_executor_id: "agent:nobie",
      current_executor_id: "agent:nobie",
      available_executor_ids: ["node:finance", "node:lead"],
      diagnostic_executor_ids: ["node:backend"],
      all_active_executor_ids: ["agent:nobie", "node:finance", "node:lead", "node:backend"],
      allowed_connections: connections,
      validation_issue_codes: [],
      topology_id: "workspace:draft",
      topology_version: 1,
    },
  }
}

function decision(overrides: Partial<AgentExecutionDecisionV2> = {}): AgentExecutionDecisionV2 {
  return {
    contract_version: AGENT_EXECUTION_DECISION_V2_CONTRACT_VERSION,
    current_executor_id: "agent:nobie",
    domain: "finance",
    behavior_pattern: "delegate",
    action: "delegate",
    selected_executor_ids: ["node:finance"],
    selected_connection_path: ["node:finance"],
    task_profile: taskProfile,
    task_split: [{
      executor_id: "node:finance",
      objective: "시장 질문을 재무 관점에서 검토한다.",
      expected_return: "검토 결과와 근거",
    }],
    required_outputs: [{ id: "answer", label: "최종 답변" }],
    risk_boundary: {
      requires_user_approval: false,
      reason: "공개 시장 정보 검토이다.",
    },
    confidence: 0.82,
    reason: "재무 담당 직속 실행자가 요청에 가장 적합하다.",
    ...overrides,
  }
}

describe("AgentExecutionDecisionV2 direct child prompt contract", () => {
  it("asks the model for V2 actions and marks diagnostics as non-selectable", () => {
    const prompt = buildAgentExecutionDecisionPrompt(context())

    expect(prompt).toContain("AgentExecutionDecisionV2")
    expect(prompt).toContain(AGENT_EXECUTION_DECISION_V2_CONTRACT_VERSION)
    for (const action of AGENT_EXECUTION_DECISION_V2_ACTIONS) {
      expect(prompt).toContain(action)
    }
    expect(prompt).toContain("accessible_executors contains only direct children")
    expect(prompt).toContain("diagnostic_executors and all_active_executor_ids are reference-only")
    expect(prompt).toContain("Do not choose self_solve merely because the current executor could answer")
    expect(prompt).toContain("unresolved_reason is required")
    expect(prompt).not.toContain("sub_agent | delegate_to_child")
    expect(prompt).not.toContain("active_default_workflow_candidate")
  })

  it("accepts V2 delegation only when selected executors and task_split target direct children", () => {
    const validation = validateAgentExecutionDecisionV2AgainstContext({
      context: context(),
      decision: decision(),
    })
    const converted = convertAgentExecutionDecisionV2ToV1(decision())

    expect(validation.ok).toBe(true)
    expect(converted.execution_route).toBe("delegate_to_child")
    expect(converted.selected_executor_id).toBe("node:finance")
    expect(converted.task_profile.task_units[0]?.preferred_executor_id).toBe("node:finance")
  })

  it("rejects indirect selected executors and indirect task split targets", () => {
    const validation = validateAgentExecutionDecisionV2AgainstContext({
      context: context(),
      decision: decision({
        selected_executor_ids: ["node:backend"],
        selected_connection_path: ["node:lead", "node:backend"],
        task_split: [{
          executor_id: "node:backend",
          objective: "백엔드 작업을 처리한다.",
          expected_return: "처리 결과",
        }],
      }),
    })

    expect(validation.ok).toBe(false)
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "selected_executor_not_direct_child", executor_id: "node:backend" }),
      expect.objectContaining({ code: "invalid_task_split_executor", executor_id: "node:backend" }),
    ]))
  })

  it("does not accept legacy route names as V2 actions", () => {
    const validation = validateAgentExecutionDecisionV2AgainstContext({
      context: context(),
      decision: {
        ...decision(),
        action: "sub_agent",
      },
    })

    expect(validation.ok).toBe(false)
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_action" }),
    ]))
  })
})
