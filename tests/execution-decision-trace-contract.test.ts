import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { closeDb, insertSession, updateRunPromptSourceSnapshot } from "../packages/core/src/db/index.js"
import {
  AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
  type AgentExecutionConnection,
  type AgentExecutionContext,
  type AgentExecutionDecision,
  type AgentExecutionTaskProfile,
} from "../packages/core/src/orchestration/execution-decision-contract.ts"
import {
  buildAgentExecutionDecisionTraceSnapshot,
  formatAgentExecutionDecisionTraceRunEvent,
  runAgentExecutionHarness,
  validateAgentExecutionDecisionAgainstContext,
} from "../packages/core/src/orchestration/execution-harness.ts"
import { buildRunRuntimeInspectorProjection } from "../packages/core/src/runs/runtime-inspector-projection.ts"
import { appendRunEvent, createRootRun, getRootRun } from "../packages/core/src/runs/store.ts"

const now = Date.UTC(2026, 4, 7, 6, 0, 0)
const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

beforeEach(() => {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-execution-decision-trace-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
})

afterEach(() => {
  closeDb()
  if (previousStateDir === undefined) delete process.env.NOBIE_STATE_DIR
  else process.env.NOBIE_STATE_DIR = previousStateDir
  if (previousConfig === undefined) delete process.env.NOBIE_CONFIG
  else process.env.NOBIE_CONFIG = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

const taskProfile: AgentExecutionTaskProfile = {
  title: "실행 결정 검증",
  summary: "LLM이 제안한 실행자를 그래프 기준으로 검증한다.",
  goals: ["실행자 존재 확인", "연결 경로 확인", "검증 실패 시 현재 실행자 fallback"],
  task_units: [],
  success_criteria: ["코드 검증 전에는 실행 결정으로 승격하지 않는다."],
}

const connections: AgentExecutionConnection[] = [
  {
    from_executor_id: "agent:nobie",
    to_executor_id: "node:finance",
    relation: "delegates_to",
  },
  {
    from_executor_id: "agent:nobie",
    to_executor_id: "node:lead",
    relation: "delegates_to",
  },
  {
    from_executor_id: "node:lead",
    to_executor_id: "node:backend",
    relation: "delegates_to",
  },
]

function context(): AgentExecutionContext {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    request: {
      kind: "user_message",
      latest_user_message: "코스피와 하이닉스 투자 검토",
      structured_goal: "적합한 실행자에게 요청을 맡긴다.",
    },
    current_executor: {
      executor_id: "agent:nobie",
      display_name: "노비",
      role_name: "root",
      can_delegate: true,
      available: true,
    },
    requester: {
      requester_id: "channel:telegram",
      requester_type: "channel",
    },
    accessible_executors: [
      {
        executor_id: "node:finance",
        display_name: "행랑아범",
        role_name: "재무 검토",
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
    diagnostic_executors: [
      {
        executor_id: "node:backend",
        display_name: "삼식이",
        role_name: "백엔드",
        can_delegate: false,
        available: true,
        visibility: "indirect",
        parent_executor_ids: ["node:lead"],
      },
    ],
    accessible_connections: connections,
    available_tools: [],
    permission_policy: {
      allowed_tool_ids: [],
    },
    risk_policy: {
      approval_required_for: [],
    },
    execution_graph: {
      graph_id: "execution-graph:test",
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

function decision(overrides: Partial<AgentExecutionDecision> = {}): AgentExecutionDecision {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    current_executor_id: "agent:nobie",
    domain: "finance",
    behavior_pattern: "delegate",
    execution_route: "delegate_to_child",
    selected_executor_id: "node:finance",
    selected_connection_path: ["node:finance"],
    task_profile: taskProfile,
    required_outputs: [{ id: "output:answer", label: "답변" }],
    risk_boundary: {
      requires_user_approval: false,
      reason: "공개 정보 검토이다.",
    },
    confidence: 0.41,
    fallback_if_unavailable: "self_solve",
    reason: "실행자 프로필이 요청과 맞다.",
    ...overrides,
  }
}

describe("execution decision trace contract", () => {
  it("rejects an executor id that does not exist in the execution graph", () => {
    const validation = validateAgentExecutionDecisionAgainstContext({
      context: context(),
      decision: decision({
        selected_executor_id: "node:missing",
        selected_connection_path: ["node:missing"],
      }),
    })

    expect(validation.ok).toBe(false)
    expect(validation.status).toBe("selected_executor_not_in_graph")
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "selected_executor_not_in_graph",
        executor_id: "node:missing",
      }),
    ]))
  })

  it("rejects an indirect executor when no connection path is provided", () => {
    const validation = validateAgentExecutionDecisionAgainstContext({
      context: context(),
      decision: decision({
        selected_executor_id: "node:backend",
        selected_connection_path: [],
      }),
    })

    expect(validation.ok).toBe(false)
    expect(validation.status).toBe("selected_executor_not_direct_child")
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "selected_executor_not_direct_child",
        executor_id: "node:backend",
      }),
    ]))
  })

  it("rejects a disconnected path without selecting an arbitrary replacement executor", async () => {
    const proposed = decision({
      selected_executor_id: "node:backend",
      selected_connection_path: ["node:finance", "node:backend"],
    })
    const result = await runAgentExecutionHarness({
      context: context(),
      callModel: async () => JSON.stringify(proposed),
    })

    expect(result.ok).toBe(false)
    expect(result.fallbackReason).toBe("selected_connection_path_invalid")
    expect(result.validation?.delegation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "selected_connection_path_invalid",
        connection_path: ["node:finance", "node:backend"],
      }),
    ]))
    expect(result.decision.execution_route).toBe("ask_user")
    expect(result.decision.selected_executor_id).toBeUndefined()
    expect(result.decision.execution_route).not.toBe("explicit_provider")
    expect(result.decision.selected_executor_id).not.toBe("node:finance")
    expect(result.decisionTrace.resolved_selected_executor_id).toBeUndefined()
    expect(result.decisionTrace.resolved_execution_route).toBe("ask_user")
  })

  it("normalizes an empty path for a direct child but not for an indirect child", () => {
    const directChild = validateAgentExecutionDecisionAgainstContext({
      context: context(),
      decision: decision({
        selected_executor_id: "node:finance",
        selected_connection_path: [],
      }),
    })
    const indirect = validateAgentExecutionDecisionAgainstContext({
      context: context(),
      decision: decision({
        selected_executor_id: "node:backend",
        selected_connection_path: [],
      }),
    })

    expect(directChild.ok).toBe(true)
    expect(indirect.ok).toBe(false)
    expect(indirect.status).toBe("selected_executor_not_direct_child")
  })

  it("stores decision trace in the root run snapshot and exposes it through Runtime Inspector", () => {
    const ctx = context()
    const accepted = decision()
    const validation = validateAgentExecutionDecisionAgainstContext({
      context: ctx,
      decision: accepted,
    })
    const trace = buildAgentExecutionDecisionTraceSnapshot({
      context: ctx,
      decision: accepted,
      validation,
      decisionSource: "nobie_harness",
    })

    insertSession({
      id: "session:trace",
      source: "telegram",
      source_id: "telegram:trace",
      created_at: now,
      updated_at: now,
      summary: "execution decision trace test",
    })
    createRootRun({
      id: "run:trace",
      sessionId: "session:trace",
      requestGroupId: "run:trace",
      prompt: "코스피와 하이닉스 투자 검토",
      source: "telegram",
      taskProfile: "research",
      orchestrationMode: "orchestration",
      promptSourceSnapshot: {
        agentExecutionDecision: accepted,
        executionDecisionSource: "nobie_harness",
        executionDecisionTrace: trace,
        topologyRouting: {
          mode: "route",
          reasonCode: "execution_decision_validated",
          topologyId: "workspace:draft",
          entryNodeId: "node:finance",
          issues: [],
        },
      },
    })
    appendRunEvent("run:trace", formatAgentExecutionDecisionTraceRunEvent(trace))

    const run = getRootRun("run:trace")
    expect(run?.promptSourceSnapshot?.executionDecisionTrace).toEqual(expect.objectContaining({
      decision_source: "nobie_harness",
      graph_id: "execution-graph:test",
      current_executor_id: "agent:nobie",
      selected_executor_id: "node:finance",
      validation_status: "valid",
    }))
    expect(run?.recentEvents.map((event) => event.label)).toContain(
      "execution_decision_source:nobie_harness; graph_id=execution-graph:test; graph_source=workspace_draft; current_executor=agent:nobie; available_executors=node:finance,node:lead; selected_executor=node:finance; resolved_selected_executor=none; resolved_route=delegate_to_child; fallback_reason=self_solve; validation_status=valid",
    )
    appendRunEvent(
      "run:trace",
      "execution_decision_fallback:self_solve; provider_direct_blocked_without_explicit_target",
    )

    const updatedRun = getRootRun("run:trace")
    if (!updatedRun) throw new Error("run:trace was not created")
    const projection = buildRunRuntimeInspectorProjection(updatedRun, { now })
    expect(projection.topologyRouting).toEqual(expect.objectContaining({
      executionDecisionSource: "nobie_harness",
      executionDecisionGraphId: "execution-graph:test",
      executionDecisionGraphSource: "workspace_draft",
      executionDecisionCurrentExecutorId: "agent:nobie",
      executionDecisionAvailableExecutorIds: ["node:finance", "node:lead"],
      executionDecisionDiagnosticExecutorIds: ["node:backend"],
      executionDecisionAllExecutorIds: ["agent:nobie", "node:finance", "node:lead", "node:backend"],
      executionDecisionSelectedExecutorId: "node:finance",
      executionDecisionSelectedConnectionPath: ["node:finance"],
      executionDecisionNormalizedConnectionPath: ["agent:nobie", "node:finance"],
      executionDecisionValidationStatus: "valid",
      providerFallbackBlocked: true,
      providerFallbackBlockedReasonCode: "provider_direct_blocked_without_explicit_target",
    }))

    updateRunPromptSourceSnapshot("run:trace", {
      assemblyVersion: 1,
      createdAt: now + 1,
      sources: [],
      diagnostics: [],
    })

    const refreshedRun = getRootRun("run:trace")
    expect(refreshedRun?.promptSourceSnapshot).toEqual(expect.objectContaining({
      assemblyVersion: 1,
      createdAt: now + 1,
      executionDecisionTrace: expect.objectContaining({
        selected_executor_id: "node:finance",
        validation_status: "valid",
      }),
      topologyRouting: expect.objectContaining({
        reasonCode: "execution_decision_validated",
      }),
    }))
  })
})
