import { describe, expect, it } from "vitest"
import {
  AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
  type AgentExecutionContext,
  type AgentExecutionDecision,
  type AgentExecutionExecutorProfile,
  type AgentExecutionTaskProfile,
} from "../packages/core/src/orchestration/execution-decision-contract.ts"
import {
  runAgentExecutionHarness,
  type AgentExecutionModelCaller,
} from "../packages/core/src/orchestration/execution-harness.ts"

const financeExecutor: AgentExecutionExecutorProfile = {
  executor_id: "node:finance",
  display_name: "행랑아범",
  role_name: "Financial market analyst",
  definition: [
    "Reads market context, public company facts, portfolio suitability, and investment risk.",
    "Produces a cautious market review without executing trades or promising returns.",
  ].join(" "),
  can_delegate: false,
  available: true,
}

const generalExecutor: AgentExecutionExecutorProfile = {
  executor_id: "node:general",
  display_name: "일반 정리 담당",
  role_name: "General answerer",
  definition: "Handles ordinary answers when no specialized executor definition fits.",
  can_delegate: false,
  available: true,
}

function taskProfileFor(title: string): AgentExecutionTaskProfile {
  return {
    title,
    summary: "사용자 요청을 실행자 정의와 위험 경계에 맞춰 처리한다.",
    goals: ["요청 영역 판단", "실행자 선택", "위험 경계 확인"],
    task_units: [{
      id: "unit:market-review",
      title: "시장과 기업 검토",
      goal: "시장 상황과 기업 투자 판단에 필요한 근거를 정리한다.",
      preferred_executor_id: financeExecutor.executor_id,
    }],
    success_criteria: ["선택한 실행자와 판단 근거가 구조화 결정에 남는다."],
  }
}

function contextFor(message: string, overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    request: {
      kind: "user_message",
      latest_user_message: message,
      structured_goal: "요청을 가장 적합한 실행자에게 맡긴다.",
      required_outputs: [{
        id: "output:answer",
        label: "사용자 답변",
      }],
    },
    current_executor: {
      executor_id: "agent:nobie",
      display_name: "노비",
      role_name: "Root agent",
      definition: "Receives channel requests and delegates to visible executor profiles when useful.",
      can_delegate: true,
      available: true,
    },
    requester: {
      requester_id: "channel:telegram",
      requester_type: "channel",
    },
    accessible_executors: [financeExecutor, generalExecutor],
    accessible_connections: [
      {
        from_executor_id: "agent:nobie",
        to_executor_id: financeExecutor.executor_id,
        relation: "delegates_to",
        label: "financial market review",
      },
      {
        from_executor_id: "agent:nobie",
        to_executor_id: generalExecutor.executor_id,
        relation: "delegates_to",
        label: "general fallback",
      },
    ],
    available_tools: [],
    permission_policy: {
      allowed_tool_ids: [],
    },
    risk_policy: {
      approval_required_for: ["privacy", "permission", "delete", "payment", "external_transfer", "local_system_control"],
    },
    ...overrides,
  }
}

function decisionForFinance(message: string): AgentExecutionDecision {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    current_executor_id: "agent:nobie",
    domain: "public_market_review",
    behavior_pattern: "delegate",
    execution_route: "delegate_to_child",
    selected_executor_id: financeExecutor.executor_id,
    selected_connection_path: ["agent:nobie", financeExecutor.executor_id],
    task_profile: taskProfileFor(message),
    required_outputs: [{
      id: "output:market-review",
      label: "시장과 투자 판단 검토",
      acceptance_criteria: ["거래 실행 없이 공개 정보 기반의 신중한 검토를 제공한다."],
    }],
    risk_boundary: {
      requires_user_approval: false,
      reason: "공개 시장 정보 검토이며 거래 실행이나 개인정보 접근이 없다.",
    },
    confidence: 0.84,
    fallback_if_unavailable: "self_solve",
    reason: "The financial executor profile explicitly covers market context, company facts, suitability, and risk.",
  }
}

const profileDrivenModel: AgentExecutionModelCaller = async ({ context }) => {
  const financialProfile = context.accessible_executors.find(
    (executor) => executor.role_name === "Financial market analyst",
  )
  if (!financialProfile) throw new Error("financial profile missing")
  return JSON.stringify(decisionForFinance(context.request.latest_user_message ?? "market review"))
}

describe("task025 multilingual execution decision", () => {
  it.each([
    ["ko", "오늘 코스피 확인하고 하이닉스 투자처로 어떤지 봐줘"],
    ["en", "Review whether SK Hynix is an attractive investment after checking the Korean market today"],
    ["ja", "今日の韓国市場を確認してSKハイニックスへの投資判断を整理して"],
  ])("selects the same finance executor for %s through executor profile context", async (_locale, message) => {
    const result = await runAgentExecutionHarness({
      context: contextFor(message),
      callModel: profileDrivenModel,
    })

    expect(result.ok).toBe(true)
    expect(result.decision.selected_executor_id).toBe(financeExecutor.executor_id)
    expect(result.decision.execution_route).toBe("delegate_to_child")
    expect(result.decision.reason).toContain("financial executor profile")
    expect(result.rawModelOutput).toContain("public_market_review")
  })

  it("self-solves an undefined request when the current executor can handle safe generic work", async () => {
    const result = await runAgentExecutionHarness({
      context: contextFor("이상한 주제로 짧게 농담해줘"),
      callModel: async ({ context }) => JSON.stringify({
        contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
        current_executor_id: context.current_executor.executor_id,
        domain: "undefined_safe_chat",
        behavior_pattern: "answer",
        execution_route: "self_solve",
        selected_connection_path: [],
        task_profile: {
          title: "짧은 답변",
          summary: "전문 실행자 정의에 속하지 않는 안전한 일반 요청이다.",
          goals: ["짧게 답한다"],
          task_units: [],
          success_criteria: ["위임 없이 안전하게 답한다"],
        },
        required_outputs: [{ id: "output:answer", label: "짧은 답변" }],
        risk_boundary: {
          requires_user_approval: false,
          reason: "안전한 일반 답변이다.",
        },
        confidence: 0.63,
        fallback_if_unavailable: "direct_current_agent",
        unresolved_reason: "No available direct child executor profile is needed for a safe, brief generic reply.",
        reason: "No specialized executor definition is needed for this safe generic request.",
      } satisfies AgentExecutionDecision),
    })

    expect(result.ok).toBe(true)
    expect(result.decision.execution_route).toBe("self_solve")
    expect(result.decision.selected_executor_id).toBeUndefined()
  })

  it("rejects unexplained self-solve without implicitly selecting a child executor", async () => {
    const result = await runAgentExecutionHarness({
      context: contextFor("정확한 외부 확인이 필요한 요청"),
      callModel: async ({ context }) => JSON.stringify({
        contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
        current_executor_id: context.current_executor.executor_id,
        domain: "unexplained_self_solve",
        behavior_pattern: "answer",
        execution_route: "self_solve",
        selected_connection_path: [],
        task_profile: {
          title: "직접 처리",
          summary: "직속 실행자 검토 없이 직접 처리한다.",
          goals: ["답변"],
          task_units: [],
          success_criteria: ["답변"],
        },
        required_outputs: [{ id: "output:answer", label: "답변" }],
        risk_boundary: {
          requires_user_approval: false,
          reason: "테스트",
        },
        confidence: 0.62,
        fallback_if_unavailable: "self_solve",
        reason: "직접 처리할 수 있다고 판단했습니다.",
      } satisfies AgentExecutionDecision),
    })

    expect(result.ok).toBe(false)
    expect(result.fallbackReason).toBe("fallback_not_allowed")
    expect(result.decision.execution_route).toBe("ask_user")
    expect(result.decision.selected_executor_id).toBeUndefined()
    expect(result.decision.selected_executor_id).not.toBe(financeExecutor.executor_id)
    expect(result.validation?.delegation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "fallback_not_allowed",
        message: expect.stringContaining("Self-solve with available direct child executors"),
      }),
    ]))
  })

  it("falls back to root Nobie direct handling when no entry executor or child profile is available", async () => {
    const result = await runAgentExecutionHarness({
      context: contextFor("정의되지 않은 요청", {
        current_executor: {
          executor_id: "agent:nobie",
          display_name: "노비",
          can_delegate: true,
          available: false,
        },
        accessible_executors: [],
        accessible_connections: [],
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.fallbackReason).toBe("model_unavailable")
    expect(result.decision.execution_route).toBe("root_nobie_direct")
    expect(result.decision.selected_executor_id).toBe("agent:nobie")
  })
})
