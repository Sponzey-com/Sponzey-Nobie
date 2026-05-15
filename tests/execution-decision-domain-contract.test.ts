import { execFileSync } from "node:child_process"
import { describe, expect, it, vi } from "vitest"
import {
  DECIDE_EXECUTION_ROUTE_KINDS,
  decideExecutionRoute,
  isExplicitProviderExecutionTarget,
  normalizeExplicitExecutionTarget,
} from "../packages/core/src/orchestration/decide-execution-route.ts"
import {
  AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
  AGENT_EXECUTION_DECISION_V2_CONTRACT_VERSION,
  AgentExecutionFallbackReason,
  type AgentExecutionContext,
  type AgentExecutionDecision,
  type AgentExecutionDecisionV2,
  type AgentExecutionTaskProfile,
  validateAgentExecutionDecisionShape,
} from "../packages/core/src/orchestration/execution-decision-contract.ts"
import {
  runAgentExecutionHarness,
  validateAgentExecutionDecisionAgainstContext,
} from "../packages/core/src/orchestration/execution-harness.ts"
import {
  EXECUTION_GRAPH_ROOT_AGENT_ID,
  type ExecutionGraphSnapshot,
} from "../packages/core/src/orchestration/execution-graph-snapshot.ts"

const now = Date.UTC(2026, 4, 9, 9, 0, 0)
const rootExecutorId = EXECUTION_GRAPH_ROOT_AGENT_ID
const financeExecutorId = "workspace:draft:node:finance"
const leadExecutorId = "workspace:draft:node:lead"
const backendExecutorId = "workspace:draft:node:backend"

const taskProfile: AgentExecutionTaskProfile = {
  title: "실행 결정 도메인 계약",
  summary: "현재 실행자의 직속 하위 실행자 후보만 실행 결정으로 승격한다.",
  goals: ["명시 provider target 분리", "직속 하위 실행자 검증", "trace 후보 보존"],
  task_units: [],
  success_criteria: ["실행 결정은 공통 유스케이스를 통과한다."],
}

function graph(): ExecutionGraphSnapshot {
  return {
    graphId: "execution-graph:domain-contract",
    graphSource: "workspace_draft",
    generatedAt: now,
    rootAgentId: rootExecutorId,
    currentExecutorId: rootExecutorId,
    topologyId: "workspace:draft",
    topologyVersion: 5,
    agentsById: {
      [rootExecutorId]: {
        agentId: rootExecutorId,
        displayName: "노비",
        source: "config",
        status: "active",
        delegationEnabled: true,
        executionCandidate: true,
        role: "root",
        specialtyTags: [],
        reasonCodes: [],
      },
      [financeExecutorId]: {
        agentId: financeExecutorId,
        displayName: "행랑아범",
        source: "topology",
        status: "active",
        delegationEnabled: false,
        executionCandidate: true,
        role: "재무 담당",
        specialtyTags: ["finance", "market"],
        reasonCodes: [],
      },
      [leadExecutorId]: {
        agentId: leadExecutorId,
        displayName: "마당쇠",
        source: "topology",
        status: "active",
        delegationEnabled: true,
        executionCandidate: true,
        role: "개발 리드",
        specialtyTags: ["development"],
        reasonCodes: [],
      },
      [backendExecutorId]: {
        agentId: backendExecutorId,
        displayName: "삼식이",
        source: "topology",
        status: "active",
        delegationEnabled: false,
        executionCandidate: true,
        role: "백엔드",
        specialtyTags: ["backend"],
        reasonCodes: [],
      },
    },
    directChildAgentIdsByParent: {
      [rootExecutorId]: [financeExecutorId, leadExecutorId],
      [leadExecutorId]: [backendExecutorId],
    },
    edgeIndex: {
      [rootExecutorId]: {
        [financeExecutorId]: {
          edgeId: "edge:root-finance",
          parentAgentId: rootExecutorId,
          childAgentId: financeExecutorId,
          source: "topology_relation",
          executionCandidate: true,
          reasonCodes: [],
        },
        [leadExecutorId]: {
          edgeId: "edge:root-lead",
          parentAgentId: rootExecutorId,
          childAgentId: leadExecutorId,
          source: "topology_relation",
          executionCandidate: true,
          reasonCodes: [],
        },
      },
      [leadExecutorId]: {
        [backendExecutorId]: {
          edgeId: "edge:lead-backend",
          parentAgentId: leadExecutorId,
          childAgentId: backendExecutorId,
          source: "topology_relation",
          executionCandidate: true,
          reasonCodes: [],
        },
      },
    },
    edges: [
      {
        edgeId: "edge:root-finance",
        parentAgentId: rootExecutorId,
        childAgentId: financeExecutorId,
        source: "topology_relation",
        executionCandidate: true,
        reasonCodes: [],
      },
      {
        edgeId: "edge:root-lead",
        parentAgentId: rootExecutorId,
        childAgentId: leadExecutorId,
        source: "topology_relation",
        executionCandidate: true,
        reasonCodes: [],
      },
      {
        edgeId: "edge:lead-backend",
        parentAgentId: leadExecutorId,
        childAgentId: backendExecutorId,
        source: "topology_relation",
        executionCandidate: true,
        reasonCodes: [],
      },
    ],
    rootDirectChildAgentIds: [financeExecutorId, leadExecutorId],
    allRegisteredExecutorIds: [rootExecutorId, financeExecutorId, leadExecutorId, backendExecutorId],
    allActiveExecutorIds: [rootExecutorId, financeExecutorId, leadExecutorId, backendExecutorId],
    availableExecutorIds: [financeExecutorId, leadExecutorId],
    validationIssues: [],
    trace: {
      execution_graph_id: "execution-graph:domain-contract",
      graph_source: "workspace_draft",
      current_executor_id: rootExecutorId,
      available_executor_ids: [financeExecutorId, leadExecutorId],
    },
  }
}

function context(): AgentExecutionContext {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    request: {
      kind: "user_message",
      latest_user_message: "코스피 지수와 테슬라 가격 확인",
      structured_goal: "증시 질문을 적합한 실행자에게 맡긴다.",
    },
    current_executor: {
      executor_id: rootExecutorId,
      display_name: "노비",
      can_delegate: true,
      available: true,
    },
    accessible_executors: [
      {
        executor_id: financeExecutorId,
        display_name: "행랑아범",
        role_name: "재무 담당",
        can_delegate: false,
        available: true,
      },
      {
        executor_id: leadExecutorId,
        display_name: "마당쇠",
        role_name: "개발 리드",
        can_delegate: true,
        available: true,
      },
    ],
    diagnostic_executors: [{
      executor_id: backendExecutorId,
      display_name: "삼식이",
      role_name: "백엔드",
      can_delegate: false,
      available: true,
      visibility: "indirect",
      parent_executor_ids: [leadExecutorId],
    }],
    accessible_connections: [
      { from_executor_id: rootExecutorId, to_executor_id: financeExecutorId, relation: "delegates_to" },
      { from_executor_id: rootExecutorId, to_executor_id: leadExecutorId, relation: "delegates_to" },
      { from_executor_id: leadExecutorId, to_executor_id: backendExecutorId, relation: "delegates_to" },
    ],
    available_tools: [],
    permission_policy: { allowed_tool_ids: [] },
    risk_policy: { approval_required_for: [] },
    execution_graph: {
      graph_id: "execution-graph:domain-contract",
      graph_source: "workspace_draft",
      root_executor_id: rootExecutorId,
      current_executor_id: rootExecutorId,
      available_executor_ids: [financeExecutorId, leadExecutorId],
      diagnostic_executor_ids: [backendExecutorId],
      all_active_executor_ids: [rootExecutorId, financeExecutorId, leadExecutorId, backendExecutorId],
      all_registered_executor_ids: [rootExecutorId, financeExecutorId, leadExecutorId, backendExecutorId],
      allowed_connections: [
        { from_executor_id: rootExecutorId, to_executor_id: financeExecutorId, relation: "delegates_to" },
        { from_executor_id: rootExecutorId, to_executor_id: leadExecutorId, relation: "delegates_to" },
        { from_executor_id: leadExecutorId, to_executor_id: backendExecutorId, relation: "delegates_to" },
      ],
      validation_issue_codes: [],
      topology_id: "workspace:draft",
      topology_version: 5,
    },
  }
}

function decision(overrides: Partial<AgentExecutionDecision> = {}): AgentExecutionDecision {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    current_executor_id: rootExecutorId,
    domain: "finance",
    behavior_pattern: "delegate",
    execution_route: "delegate_to_child",
    selected_executor_id: financeExecutorId,
    selected_connection_path: [financeExecutorId],
    task_profile: taskProfile,
    required_outputs: [{ id: "answer", label: "최종 답변" }],
    risk_boundary: {
      requires_user_approval: false,
      reason: "공개 시장 데이터 확인이다.",
    },
    confidence: 0.83,
    fallback_if_unavailable: "self_solve",
    reason: "재무 담당 직속 실행자가 증시 질문을 맡는다.",
    ...overrides,
  }
}

describe("execution decision domain contract", () => {
  it("defines the shared application route kinds", () => {
    expect(DECIDE_EXECUTION_ROUTE_KINDS).toEqual([
      "delegate_to_child",
      "self_solve",
      "ask_user",
      "boundary_failure",
      "explicit_provider_target",
    ])
    expect(AgentExecutionFallbackReason).toEqual(expect.objectContaining({
      BoundaryFailure: "boundary_failure",
      ExplicitProviderTarget: "explicit_provider_target",
    }))
    const boundaryDecision = decision({
      execution_route: "boundary_failure",
      selected_connection_path: [],
      fallback_if_unavailable: "boundary_failure",
    })
    delete boundaryDecision.selected_executor_id
    expect(validateAgentExecutionDecisionShape(boundaryDecision).ok).toBe(true)
  })

  it("requires delegate_to_child to include both selected executor and selected path", () => {
    const missingPath = validateAgentExecutionDecisionAgainstContext({
      context: context(),
      decision: decision({ selected_connection_path: [] }),
    })
    const missingExecutorDecision = decision()
    delete missingExecutorDecision.selected_executor_id
    const missingExecutor = validateAgentExecutionDecisionAgainstContext({
      context: context(),
      decision: missingExecutorDecision,
    })

    expect(missingPath.ok).toBe(false)
    expect(missingPath.status).toBe("empty_selected_path")
    expect(missingExecutor.ok).toBe(false)
    expect(missingExecutor.status).toBe("missing_executor")
  })

  it("keeps indirect executors diagnostic-only", () => {
    const validation = validateAgentExecutionDecisionAgainstContext({
      context: context(),
      decision: decision({
        selected_executor_id: backendExecutorId,
        selected_connection_path: [leadExecutorId, backendExecutorId],
      }),
    })

    expect(validation.ok).toBe(false)
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "selected_executor_not_direct_child",
        executor_id: backendExecutorId,
      }),
    ]))
  })

  it("returns explicit_provider_target only for explicit provider target requests", async () => {
    const runHarness = vi.fn<typeof runAgentExecutionHarness>()
    const resolveExplicitProviderTarget = vi.fn().mockReturnValue({
      targetId: "provider:openai",
      targetLabel: "OpenAI",
      providerId: "openai",
      model: "gpt-test",
      reason: "explicit_provider:provider:openai",
    })

    const result = await decideExecutionRoute({
      originalRequest: "openai로 바로 처리해줘",
      delegatedTitle: "명시 provider 처리",
      delegatedTaskProfile: "general_chat",
      sessionId: "session:test",
      source: "telegram",
      preferredTarget: "provider:openai",
      fallbackModel: "gpt-test",
      buildExecutionGraphSnapshot: () => graph(),
      runAgentExecutionHarness: runHarness,
      resolveExplicitProviderTarget,
    })

    expect(normalizeExplicitExecutionTarget("auto")).toBeUndefined()
    expect(isExplicitProviderExecutionTarget("provider:openai")).toBe(true)
    expect(result.kind).toBe("explicit_provider_target")
    expect(resolveExplicitProviderTarget).toHaveBeenCalled()
    expect(runHarness).not.toHaveBeenCalled()
  })

  it("routes through the harness and returns a direct child delegation", async () => {
    const result = await decideExecutionRoute({
      originalRequest: "코스피 지수와 테슬라 가격 확인",
      delegatedTitle: "증시 가격 확인",
      delegatedTaskProfile: "finance_research",
      sessionId: "session:test",
      source: "telegram",
      preferredTarget: "auto",
      buildExecutionGraphSnapshot: () => graph(),
      runAgentExecutionHarness: runAgentExecutionHarness,
      callModel: async () => JSON.stringify(decision()),
    })

    expect(result.kind).toBe("delegate_to_child")
    if (result.kind !== "delegate_to_child") throw new Error("Expected delegation")
    expect(result.route.targetId).toBe(financeExecutorId)
    expect(result.route.targetLabel).toBe("행랑아범")
    expect(result.decisionResult.decisionTrace.available_executor_ids).toEqual([
      financeExecutorId,
      leadExecutorId,
    ])
    expect(result.decisionResult.decisionTrace.diagnostic_executor_ids).toEqual([backendExecutorId])
  })

  it("maps V2 fail_with_reason to boundary_failure rather than user-confirmation routing", async () => {
    const v2Decision: AgentExecutionDecisionV2 = {
      contract_version: AGENT_EXECUTION_DECISION_V2_CONTRACT_VERSION,
      current_executor_id: rootExecutorId,
      domain: "policy",
      behavior_pattern: "recover",
      action: "fail_with_reason",
      selected_executor_ids: [],
      selected_connection_path: [],
      task_profile: taskProfile,
      required_outputs: [{ id: "reason", label: "실패 사유" }],
      risk_boundary: {
        requires_user_approval: false,
        reason: "정책 경계 밖이다.",
      },
      confidence: 0.77,
      reason: "허용된 실행 경계 안에서 더 이상 가능한 경로가 없다.",
    }
    const result = await runAgentExecutionHarness({
      context: context(),
      callModel: async () => JSON.stringify(v2Decision),
    })

    expect(result.ok).toBe(true)
    expect(result.decision.execution_route).toBe("boundary_failure")
    expect(result.decision.fallback_if_unavailable).toBe("boundary_failure")
  })

  it("does not synthesize compiled default execution decisions in run/orchestration sources", () => {
    expect(() => {
      execFileSync("rg", [
        "compiled_default_entry|compiled_default",
        "packages/core/src/runs",
        "packages/core/src/orchestration",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
      })
    }).toThrow()
  })
})
