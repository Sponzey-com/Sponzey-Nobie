import { describe, expect, it } from "vitest"
import {
  AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
  type AgentExecutionContext,
  type AgentExecutionDecision,
  type AgentExecutionTaskProfile,
} from "../packages/core/src/orchestration/execution-decision-contract.ts"
import {
  parseAgentExecutionDecisionModelOutput,
  runAgentExecutionHarness,
  validateAgentExecutionDecisionAgainstContext,
} from "../packages/core/src/orchestration/execution-harness.ts"

const taskProfile: AgentExecutionTaskProfile = {
  title: "요청 처리",
  summary: "현재 요청을 실행 가능한 작업으로 정리한다.",
  goals: ["목표 확인", "적합한 실행자 선택", "결과 검증"],
  task_units: [
    {
      id: "unit:plan",
      title: "계획 수립",
      goal: "실행 순서를 만든다.",
    },
  ],
  success_criteria: ["실행 경로와 결과 기준이 분명하다"],
}

function createContext(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    request: {
      kind: "user_message",
      latest_user_message: "사용자 입력은 모델 판단 컨텍스트로만 전달된다.",
      structured_goal: "작업을 적합한 실행자에게 맡긴다.",
      required_outputs: [
        {
          id: "output:answer",
          label: "최종 답변",
          acceptance_criteria: ["사용자가 이해할 수 있다"],
        },
      ],
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
    requester: {
      requester_id: "user:1",
      requester_type: "user",
    },
    accessible_executors: [
      {
        executor_id: "node:planner",
        display_name: "계획",
        role_name: "계획 담당",
        can_delegate: true,
        available: true,
      },
      {
        executor_id: "node:offline",
        display_name: "비활성 실행자",
        can_delegate: false,
        available: false,
      },
    ],
    accessible_connections: [
      {
        from_executor_id: "node:intake",
        to_executor_id: "node:planner",
        relation: "delegates_to",
      },
      {
        from_executor_id: "node:intake",
        to_executor_id: "node:offline",
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
    ...overrides,
  }
}

function createDecision(overrides: Partial<AgentExecutionDecision> = {}): AgentExecutionDecision {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    current_executor_id: "node:intake",
    parent_executor_id: "node:lead",
    domain: "delivery",
    behavior_pattern: "delegate",
    execution_route: "delegate_to_child",
    selected_executor_id: "node:planner",
    selected_connection_path: ["node:intake", "node:planner"],
    task_profile: taskProfile,
    required_outputs: [
      {
        id: "output:answer",
        label: "최종 답변",
      },
    ],
    risk_boundary: {
      requires_user_approval: false,
      reason: "추가 사용자 승인이 필요하지 않다.",
    },
    confidence: 0.92,
    fallback_if_unavailable: "self_solve",
    reason: "연결된 계획 실행자가 적합하다.",
    ...overrides,
  }
}

describe("task023 execution harness", () => {
  it("accepts valid JSON decisions even when confidence is low", async () => {
    const decision = createDecision({ confidence: 0.12 })
    const result = await runAgentExecutionHarness({
      context: createContext(),
      callModel: async () => JSON.stringify(decision),
    })

    expect(result.ok).toBe(true)
    expect(result.decision.confidence).toBe(0.12)
    expect(result.trace.map((event) => event.phase)).toContain("context_validation")
  })

  it("accepts a single JSON decision even when the model wraps it in text", async () => {
    const result = await runAgentExecutionHarness({
      context: createContext(),
      callModel: async () => `Here is the decision: ${JSON.stringify(createDecision())}`,
    })

    expect(result.ok).toBe(true)
    expect(result.decision.execution_route).toBe("delegate_to_child")
    expect(result.decision.selected_executor_id).toBe("node:planner")
    expect(parseAgentExecutionDecisionModelOutput("not json")).toEqual({
      ok: false,
      issue: "Model output must be a single JSON object.",
    })
  })

  it("falls back when the selected executor does not exist", async () => {
    const result = await runAgentExecutionHarness({
      context: createContext(),
      callModel: async () => JSON.stringify(createDecision({
        execution_route: "yeonjang",
        selected_executor_id: "node:missing",
        selected_connection_path: [],
      })),
    })

    expect(result.ok).toBe(false)
    expect(result.fallbackReason).toBe("missing_executor")
    expect(result.validation?.delegation.issues).toEqual([
      expect.objectContaining({
        code: "missing_executor",
        executor_id: "node:missing",
      }),
    ])
  })

  it("falls back when the selected executor is visible but unavailable", async () => {
    const result = await runAgentExecutionHarness({
      context: createContext(),
      callModel: async () => JSON.stringify(createDecision({
        selected_executor_id: "node:offline",
        selected_connection_path: ["node:intake", "node:offline"],
      })),
    })

    expect(result.ok).toBe(false)
    expect(result.fallbackReason).toBe("executor_unavailable")
    expect(result.decision.execution_route).toBe("ask_parent")
    expect(result.decision.selected_executor_id).toBe("node:lead")
  })

  it("does not implicitly select the first child when model output is invalid", async () => {
    const result = await runAgentExecutionHarness({
      context: createContext(),
      callModel: async () => JSON.stringify({
        contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
        current_executor_id: "node:intake",
        action: "delegate",
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.fallbackReason).toBe("schema_invalid")
    expect(result.decision.execution_route).toBe("ask_parent")
    expect(result.decision.selected_executor_id).toBe("node:lead")
    expect(result.decision.selected_executor_id).not.toBe("node:planner")
  })

  it("accepts partial V2 decisions that use legacy route names or scalar executor ids", async () => {
    const result = await runAgentExecutionHarness({
      context: createContext(),
      callModel: async () => JSON.stringify({
        contract_version: "agent-execution-decision:v2",
        current_executor_id: "node:intake",
        action: "delegate_to_child",
        selected_executor_ids: "node:planner",
        selected_connection_path: ["node:planner"],
        reason: "The planner direct child can own the structured planning work.",
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.decision.execution_route).toBe("delegate_to_child")
    expect(result.decision.selected_executor_id).toBe("node:planner")
    expect(result.decision.selected_connection_path).toEqual(["node:planner"])
    expect(result.decisionTrace.selected_executor_id).toBe("node:planner")
  })

  it("normalizes exact direct-child display names and partial task split objects", async () => {
    const result = await runAgentExecutionHarness({
      context: createContext(),
      callModel: async () => JSON.stringify({
        contract_version: "agent-execution-decision:v2",
        current_executor_id: "node:intake",
        action: "delegate",
        selected_executor_ids: ["계획"],
        selected_connection_path: ["node:planner"],
        task_split: [{
          executor: { display_name: "계획" },
          goal: "요청을 실행 가능한 계획으로 나눈다.",
        }],
        reason: "The exact direct-child display name resolves to a visible executor id.",
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.decision.selected_executor_id).toBe("node:planner")
    expect(result.decision.task_profile.task_units[0]?.preferred_executor_id).toBe("node:planner")
  })

  it("accepts explicit targets only when the harness allows the policy boundary", async () => {
    const context = createContext({
      explicit_target_executor_id: "node:external",
    })
    const explicitDecision = createDecision({
      execution_route: "yeonjang",
      selected_executor_id: "node:external",
      selected_connection_path: [],
      reason: "사용자가 명시한 외부 실행 대상이다.",
    })

    const blocked = await runAgentExecutionHarness({
      context,
      callModel: async () => JSON.stringify(explicitDecision),
    })
    const allowed = await runAgentExecutionHarness({
      context,
      allowExplicitTarget: true,
      callModel: async () => JSON.stringify(explicitDecision),
    })

    expect(blocked.ok).toBe(false)
    expect(blocked.fallbackReason).toBe("missing_executor")
    expect(allowed.ok).toBe(true)
    expect(allowed.decision.selected_executor_id).toBe("node:external")
  })

  it("falls back when the selected path is disconnected from the visible graph", async () => {
    const result = await runAgentExecutionHarness({
      context: createContext(),
      callModel: async () => JSON.stringify(createDecision({
        selected_executor_id: "node:planner",
        selected_connection_path: ["node:intake", "node:lead", "node:planner"],
      })),
    })

    expect(result.ok).toBe(false)
    expect(result.fallbackReason).toBe("inaccessible_connection_path")
    expect(result.validation?.delegation.issues).toEqual([
      expect.objectContaining({
        code: "inaccessible_connection_path",
        connection_path: ["node:intake", "node:lead"],
      }),
      expect.objectContaining({
        code: "inaccessible_connection_path",
        connection_path: ["node:lead", "node:planner"],
      }),
    ])
  })

  it("falls back when no model caller is available", async () => {
    const result = await runAgentExecutionHarness({
      context: createContext(),
    })

    expect(result.ok).toBe(false)
    expect(result.fallbackReason).toBe("model_unavailable")
    expect(result.decision.execution_route).toBe("ask_parent")
    expect(result.trace.at(-1)).toEqual(expect.objectContaining({
      phase: "fallback",
      status: "fallback",
    }))
  })

  it("falls back when the model call times out", async () => {
    const result = await runAgentExecutionHarness({
      context: createContext(),
      timeoutMs: 1,
      callModel: async () => new Promise<string>((resolve) => {
        setTimeout(() => resolve(JSON.stringify(createDecision())), 20)
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.fallbackReason).toBe("model_timeout")
    expect(result.decision.execution_route).toBe("ask_parent")
  })

  it("routes risk boundary violations to parent or user confirmation", () => {
    const context = createContext()
    const validation = validateAgentExecutionDecisionAgainstContext({
      context,
      decision: createDecision({
        risk_boundary: {
          requires_user_approval: true,
          reason: "권한 경계가 있다.",
          boundary_kind: "permission",
        },
      }),
    })

    expect(validation.ok).toBe(false)
    expect(validation.status).toBe("risk_boundary_requires_approval")
    expect(validation.fallback_if_invalid).toBe("ask_parent")
  })
})
