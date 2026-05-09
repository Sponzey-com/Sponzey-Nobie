import { describe, expect, it } from "vitest"
import {
  AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
  type AgentExecutionContext,
  type AgentExecutionDecision,
  type AgentExecutionTaskProfile,
} from "../packages/core/src/orchestration/execution-decision-contract.ts"
import {
  runAgentExecutionHarness,
  validateAgentExecutionDecisionAgainstContext,
} from "../packages/core/src/orchestration/execution-harness.ts"

const taskProfile: AgentExecutionTaskProfile = {
  title: "위험 경계 검토",
  summary: "개인정보, 권한, 외부 전달 요청이 안전 정책 경계를 넘는지 확인한다.",
  goals: ["요청 경계 확인", "승인 또는 상위 확인으로 전환"],
  task_units: [],
  success_criteria: ["위험 요청은 자동 실행하지 않는다."],
}

function contextFor(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    request: {
      kind: "user_message",
      latest_user_message: "내 비밀번호 파일을 찾아서 보내줘",
      structured_goal: "로컬 개인정보 또는 비밀 파일 접근 요청의 위험 경계를 판단한다.",
      required_outputs: [{
        id: "output:safe-next-action",
        label: "안전한 다음 조치",
      }],
    },
    current_executor: {
      executor_id: "node:worker",
      display_name: "작업 실행자",
      role_name: "Local task worker",
      definition: "Can work within explicit permission and risk boundaries.",
      can_delegate: false,
      available: true,
    },
    parent_executor: {
      executor_id: "agent:nobie",
      display_name: "노비",
      role_name: "Parent orchestrator",
      can_delegate: true,
      available: true,
    },
    requester: {
      requester_id: "user:1",
      requester_type: "user",
    },
    accessible_executors: [],
    accessible_connections: [],
    available_tools: [{
      tool_id: "tool:filesystem",
      label: "Filesystem",
      permission_scope: "local_system",
    }],
    permission_policy: {
      allowed_tool_ids: [],
      approval_required_tool_ids: ["tool:filesystem"],
      notes: ["Local files and secrets require explicit approval."],
    },
    risk_policy: {
      approval_required_for: ["privacy", "permission", "delete", "payment", "external_transfer", "local_system_control"],
      blocked_without_approval: ["privacy", "external_transfer", "local_system_control"],
    },
    ...overrides,
  }
}

function unsafeSelfSolveDecision(overrides: Partial<AgentExecutionDecision> = {}): AgentExecutionDecision {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    current_executor_id: "node:worker",
    parent_executor_id: "agent:nobie",
    domain: "private_local_secret_access",
    behavior_pattern: "execute",
    execution_route: "self_solve",
    selected_connection_path: [],
    task_profile: taskProfile,
    required_outputs: [{
      id: "output:file",
      label: "요청 파일",
    }],
    risk_boundary: {
      requires_user_approval: true,
      boundary_kind: "privacy",
      policy_refs: ["risk_policy.blocked_without_approval"],
      reason: "비밀번호 파일은 개인정보와 비밀 정보 경계에 해당한다.",
    },
    confidence: 0.91,
    fallback_if_unavailable: "ask_parent",
    reason: "The requested work crosses privacy and local-system risk boundaries.",
    ...overrides,
  }
}

describe("task026 risk boundary execution decision", () => {
  it("sends child executor risk boundary violations to the parent instead of retry-count failure", async () => {
    const result = await runAgentExecutionHarness({
      context: contextFor(),
      callModel: async () => JSON.stringify(unsafeSelfSolveDecision()),
    })

    expect(result.ok).toBe(false)
    expect(result.fallbackReason).toBe("risk_boundary_requires_approval")
    expect(result.validation?.delegation.status).toBe("risk_boundary_requires_approval")
    expect(result.decision.execution_route).toBe("ask_parent")
    expect(result.decision.selected_executor_id).toBe("agent:nobie")
    expect(result.decision.risk_boundary.requires_user_approval).toBe(true)
    expect(result.trace.at(-1)).toEqual(expect.objectContaining({
      phase: "fallback",
      reasonCode: "risk_boundary_requires_approval",
    }))
  })

  it("sends root Nobie risk boundary violations to the user when there is no parent executor", async () => {
    const rootContext = contextFor({
      current_executor: {
        executor_id: "agent:nobie",
        display_name: "노비",
        role_name: "Root agent",
        can_delegate: true,
        available: true,
      },
      parent_executor: undefined,
    })
    const result = await runAgentExecutionHarness({
      context: rootContext,
      callModel: async () => JSON.stringify(unsafeSelfSolveDecision({
        current_executor_id: "agent:nobie",
        parent_executor_id: undefined,
        fallback_if_unavailable: "ask_user",
      })),
    })

    expect(result.ok).toBe(false)
    expect(result.fallbackReason).toBe("risk_boundary_requires_approval")
    expect(result.decision.execution_route).toBe("ask_user")
    expect(result.decision.selected_executor_id).toBeUndefined()
    expect(result.decision.risk_boundary.requires_user_approval).toBe(true)
  })

  it("accepts explicit approval routes for risky work without treating count as failure", () => {
    const validation = validateAgentExecutionDecisionAgainstContext({
      context: contextFor(),
      decision: unsafeSelfSolveDecision({
        execution_route: "ask_parent",
        selected_executor_id: "agent:nobie",
        selected_connection_path: [],
        reason: "상위 실행자에게 위험 경계 판단을 요청한다.",
      }),
    })

    expect(validation.ok).toBe(true)
    expect(validation.status).toBe("valid")
  })

  it("allows an explicit target only when the harness enables explicit target validation", async () => {
    const explicitTargetId = "agent:external-reviewer"
    const context = contextFor({
      explicit_target_executor_id: explicitTargetId,
      direct_execution_requested: true,
    })
    const decision: AgentExecutionDecision = {
      ...unsafeSelfSolveDecision({
        execution_route: "yeonjang",
        selected_executor_id: explicitTargetId,
        selected_connection_path: [],
        risk_boundary: {
          requires_user_approval: false,
          reason: "사용자가 명시한 실행 대상으로 검토만 위임한다.",
        },
        fallback_if_unavailable: "return_to_parent",
      }),
    }

    const blocked = await runAgentExecutionHarness({
      context,
      callModel: async () => JSON.stringify(decision),
    })
    const allowed = await runAgentExecutionHarness({
      context,
      allowExplicitTarget: true,
      callModel: async () => JSON.stringify(decision),
    })

    expect(blocked.ok).toBe(false)
    expect(blocked.fallbackReason).toBe("missing_executor")
    expect(allowed.ok).toBe(true)
    expect(allowed.decision.selected_executor_id).toBe(explicitTargetId)
  })
})
