import { describe, expect, it } from "vitest"
import {
  validateOrchestrationPlan,
  type OrchestrationPlan,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import {
  AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
  AgentExecutionFallbackReason,
  type AgentExecutionContext,
  type AgentExecutionDecision,
  type AgentExecutionTaskProfile,
} from "../packages/core/src/orchestration/execution-decision-contract.ts"
import {
  buildOrchestrationPlan,
} from "../packages/core/src/orchestration/planner.ts"
import {
  runAgentExecutionHarness,
  validateAgentExecutionDecisionAgainstContext,
} from "../packages/core/src/orchestration/execution-harness.ts"
import type { OrchestrationModeSnapshot } from "../packages/core/src/orchestration/mode.ts"

const now = Date.UTC(2026, 4, 7, 3, 0, 0)

const taskProfile: AgentExecutionTaskProfile = {
  title: "Fallback contract validation",
  summary: "Validate current-agent fallback behavior.",
  goals: ["Choose a valid fallback route"],
  task_units: [],
  success_criteria: ["Fallback is valid for the current executor context."],
}

function contextFor(overrides: Partial<AgentExecutionContext> = {}): AgentExecutionContext {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    request: {
      kind: "user_message",
      latest_user_message: "처리해줘",
      structured_goal: "현재 실행자가 처리 또는 fallback을 선택한다.",
    },
    current_executor: {
      executor_id: "node:worker",
      display_name: "작업자",
      role_name: "Worker",
      can_delegate: false,
      available: true,
    },
    parent_executor: {
      executor_id: "agent:nobie",
      display_name: "노비",
      role_name: "Root",
      can_delegate: true,
      available: true,
    },
    requester: {
      requester_id: "user:1",
      requester_type: "user",
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
    ...overrides,
  }
}

function decision(overrides: Partial<AgentExecutionDecision> = {}): AgentExecutionDecision {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    current_executor_id: "node:worker",
    parent_executor_id: "agent:nobie",
    domain: "general",
    behavior_pattern: "recover",
    execution_route: "self_solve",
    selected_connection_path: [],
    task_profile: taskProfile,
    required_outputs: [],
    risk_boundary: {
      requires_user_approval: false,
      reason: "No policy boundary crossed.",
    },
    confidence: 0.7,
    fallback_if_unavailable: AgentExecutionFallbackReason.SelfSolve,
    reason: "Fallback contract test decision.",
    ...overrides,
  }
}

function modeSnapshot(mode: OrchestrationModeSnapshot["mode"]): OrchestrationModeSnapshot {
  return {
    mode,
    status: "ready",
    featureFlagEnabled: mode === "orchestration",
    requestedMode: mode,
    activeSubAgentCount: 0,
    totalSubAgentCount: 0,
    disabledSubAgentCount: 0,
    activeSubAgents: [],
    reasonCode: mode === "orchestration" ? "no_active_sub_agents" : "mode_single_nobie",
    reason: "test mode",
    generatedAt: now,
  }
}

describe("current-agent fallback contract", () => {
  it("accepts new fallback and execution route names in the decision contract", () => {
    expect(AgentExecutionFallbackReason).toEqual(expect.objectContaining({
      SelfSolve: "self_solve",
      DirectCurrentAgent: "direct_current_agent",
      ReturnToParent: "return_to_parent",
      AskParent: "ask_parent",
      AskUser: "ask_user",
      RootNobieDirect: "root_nobie_direct",
      ExplicitProvider: "explicit_provider",
    }))

    for (const fallback of [
      "self_solve",
      "direct_current_agent",
      "return_to_parent",
      "ask_parent",
      "ask_user",
      "root_nobie_direct",
      "explicit_provider",
    ] as const) {
      const target = decision({
        execution_route: fallback,
        fallback_if_unavailable: fallback,
        ...(fallback === "explicit_provider" ? { selected_connection_path: [] } : {}),
      })
      const shape = validateAgentExecutionDecisionAgainstContext({
        context: contextFor({
          ...(fallback === "explicit_provider" ? { explicit_provider_target_id: "provider:openai" } : {}),
          ...(fallback === "root_nobie_direct"
            ? {
                current_executor: {
                  executor_id: "agent:nobie",
                  display_name: "노비",
                  can_delegate: true,
                  available: true,
                },
                parent_executor: undefined,
              }
            : {}),
        }),
        decision: fallback === "root_nobie_direct"
          ? { ...target, current_executor_id: "agent:nobie", parent_executor_id: undefined }
          : target,
      })
      expect(shape.ok, fallback).toBe(true)
    }
  })

  it("rejects root_nobie_direct when the current executor is not root Nobie", () => {
    const validation = validateAgentExecutionDecisionAgainstContext({
      context: contextFor(),
      decision: decision({
        execution_route: "root_nobie_direct",
        fallback_if_unavailable: AgentExecutionFallbackReason.RootNobieDirect,
      }),
    })

    expect(validation.ok).toBe(false)
    expect(validation.status).toBe("fallback_not_allowed")
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "fallback_not_allowed" }),
    ]))
  })

  it("rejects explicit_provider without an explicit provider target", () => {
    const validation = validateAgentExecutionDecisionAgainstContext({
      context: contextFor(),
      decision: decision({
        execution_route: "explicit_provider",
        fallback_if_unavailable: AgentExecutionFallbackReason.ExplicitProvider,
      }),
    })

    expect(validation.ok).toBe(false)
    expect(validation.status).toBe("provider_target_missing")
  })

  it("turns ask_parent into ask_user when no parent executor or executor requester exists", async () => {
    const result = await runAgentExecutionHarness({
      context: contextFor({
        current_executor: {
          executor_id: "agent:nobie",
          display_name: "노비",
          can_delegate: true,
          available: true,
        },
        parent_executor: undefined,
      }),
      callModel: async () => JSON.stringify(decision({
        current_executor_id: "agent:nobie",
        parent_executor_id: undefined,
        execution_route: "ask_parent",
        fallback_if_unavailable: AgentExecutionFallbackReason.AskParent,
      })),
    })

    expect(result.ok).toBe(false)
    expect(result.validation?.delegation.status).toBe("parent_executor_missing")
    expect(result.decision.execution_route).toBe("ask_user")
  })

  it("keeps legacy single_nobie readable while new planner output avoids it", () => {
    const result = buildOrchestrationPlan({
      parentRunId: "run:1",
      parentRequestId: "request:1",
      userRequest: "직접 처리",
      modeSnapshot: modeSnapshot("single_nobie"),
      now: () => now,
      idProvider: () => "plan:current-agent-fallback",
    })

    expect(result.plan.fallbackStrategy.mode).toBe("direct_current_agent")
    expect(validateOrchestrationPlan(result.plan).ok).toBe(true)

    const legacyPlan: OrchestrationPlan = {
      ...result.plan,
      fallbackStrategy: {
        mode: "single_nobie",
        reasonCode: "legacy_single_nobie_fixture",
        legacyWarning: "legacy_single_nobie_fallback_mode_deprecated",
      },
    }
    expect(validateOrchestrationPlan(legacyPlan).ok).toBe(true)
  })
})

