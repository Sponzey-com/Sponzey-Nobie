import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
  type AgentExecutionDecision,
} from "../packages/core/src/orchestration/execution-decision-contract.ts"
import {
  runAgentExecutionHarness,
} from "../packages/core/src/orchestration/execution-harness.ts"
import {
  buildExampleEnterpriseTopology,
  createEnterpriseTopologyRegistry,
} from "../packages/core/src/index.ts"
import { reloadConfig } from "../packages/core/src/config/index.ts"
import { closeDb } from "../packages/core/src/db/index.js"
import { runIntakeBridgePass } from "../packages/core/src/runs/intake-bridge-pass.ts"

const now = Date.UTC(2026, 4, 7, 12, 0, 0)
const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

function useTempState(overrides: Record<string, unknown> = {}): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-no-provider-direct-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json")
  writeFileSync(process.env.NOBIE_CONFIG, JSON.stringify({
    orchestration: {
      maxDelegationTurns: 5,
      mode: "orchestration",
      featureFlagEnabled: true,
      subAgents: [],
      teams: [],
      ...overrides,
    },
    ai: {
      connection: {
        provider: "openai",
        model: "gpt-test",
      },
    },
  }, null, 2))
  reloadConfig()
}

afterEach(() => {
  closeDb()
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  if (previousStateDir === undefined) delete process.env.NOBIE_STATE_DIR
  else process.env.NOBIE_STATE_DIR = previousStateDir
  if (previousConfig === undefined) delete process.env.NOBIE_CONFIG
  else process.env.NOBIE_CONFIG = previousConfig
  reloadConfig()
})

function createDependencies() {
  return {
    appendRunEvent: vi.fn(),
    updateRunSummary: vi.fn(),
    incrementDelegationTurnCount: vi.fn(),
    emitScheduleCreated: vi.fn(),
    emitScheduleCancelled: vi.fn(),
    scheduleDelayedRun: vi.fn(),
    startDelegatedRun: vi.fn(),
    normalizeTaskProfile: vi.fn((taskProfile: string | undefined) => taskProfile ?? "general_chat"),
    logInfo: vi.fn(),
  }
}

function taskIntakeResult(actionPayload: Record<string, unknown> = {}) {
  return {
    intent: {
      category: "task_intake" as const,
      summary: "후속 실행이 필요합니다.",
      confidence: 0.9,
    },
    user_message: {
      mode: "accepted_receipt" as const,
      text: "후속 실행을 시작합니다.",
    },
    action_items: [{
      id: "run-task-1",
      type: "run_task" as const,
      title: "채널 요청 후속 실행",
      priority: "normal" as const,
      reason: "needs follow-up",
      payload: {
        goal: "Process the channel request.",
        ...actionPayload,
      },
    }],
    structured_request: {
      source_language: "ko" as const,
      normalized_english: "Process the channel request.",
      target: "channel request",
      to: "channel",
      context: ["channel request accepted"],
      complete_condition: ["deliver result"],
    },
    intent_envelope: {
      intent_type: "task_intake" as const,
      source_language: "ko" as const,
      normalized_english: "Process the channel request.",
      target: "channel request",
      destination: "channel",
      context: ["channel request accepted"],
      complete_condition: ["deliver result"],
      schedule_spec: {
        detected: false,
        kind: "none" as const,
        status: "not_applicable" as const,
        schedule_text: "",
      },
      execution_semantics: {
        filesystemEffect: "none" as const,
        privilegedOperation: "none" as const,
        artifactDelivery: "none" as const,
        approvalRequired: false,
        approvalTool: "external_action" as const,
      },
      delivery_mode: "none" as const,
      requires_approval: false,
      approval_tool: "external_action" as const,
      preferred_target: "auto",
      needs_tools: false,
      needs_web: false,
    },
    scheduling: {
      detected: false,
      kind: "none" as const,
      status: "not_applicable" as const,
      schedule_text: "",
    },
    execution: {
      requires_run: true,
      requires_delegation: false,
      suggested_target: "auto",
      max_delegation_turns: 3,
      needs_tools: false,
      needs_web: false,
      execution_semantics: {
        filesystemEffect: "none" as const,
        privilegedOperation: "none" as const,
        artifactDelivery: "none" as const,
        approvalRequired: false,
        approvalTool: "external_action" as const,
      },
    },
    notes: [],
  }
}

function decisionForExecutor(selectedExecutorId: string): AgentExecutionDecision {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    current_executor_id: "agent:nobie",
    domain: "channel_intake",
    behavior_pattern: "delegate",
    execution_route: "delegate_to_child",
    selected_executor_id: selectedExecutorId,
    selected_connection_path: [selectedExecutorId],
    task_profile: {
      title: "채널 요청 후속 실행",
      summary: "현재 요청을 연결된 실행자에게 위임한다.",
      goals: ["직속 실행자에게 위임", "결과를 사용자에게 전달"],
      task_units: [{
        id: "unit:delegate",
        title: "위임 실행",
        goal: "선택된 실행자가 요청을 처리한다.",
        preferred_executor_id: selectedExecutorId,
      }],
      success_criteria: ["선택된 실행자와 연결 경로가 trace에 남는다."],
    },
    required_outputs: [{
      id: "answer",
      label: "최종 답변",
    }],
    risk_boundary: {
      requires_user_approval: false,
      reason: "테스트 요청은 추가 승인이 필요하지 않다.",
    },
    confidence: 0.88,
    fallback_if_unavailable: "self_solve",
    reason: "저장된 그래프의 직속 실행자를 선택한다.",
  }
}

function fallbackDecision(route: "ask_user" | "return_to_parent"): AgentExecutionDecision {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    current_executor_id: "agent:nobie",
    domain: "channel_intake",
    behavior_pattern: route === "ask_user" ? "clarify" : "recover",
    execution_route: route,
    selected_connection_path: [],
    task_profile: {
      title: "채널 요청 fallback",
      summary: "후속 실행을 만들지 않고 안전한 fallback으로 전환한다.",
      goals: ["provider direct 우회 금지", "fallback 사유 기록"],
      task_units: [],
      success_criteria: ["fallback 상태가 명확하다"],
    },
    required_outputs: [{
      id: "fallback",
      label: "fallback 사유",
    }],
    risk_boundary: {
      requires_user_approval: route === "ask_user",
      reason: "fallback state test",
    },
    confidence: 0.42,
    fallback_if_unavailable: route,
    unresolved_reason: `${route} fallback requested`,
    reason: `${route} fallback requested`,
  }
}

describe("run_task provider direct guard", () => {
  it("does not use provider direct when topology executors are available and the harness selects one", async () => {
    useTempState()
    const topology = buildExampleEnterpriseTopology(now)
    const registry = createEnterpriseTopologyRegistry({ now: () => now })
    const appended = registry.appendTopologyVersion({
      topology,
      createdBy: "no-provider-direct-test",
    })
    registry.activateTopologyVersion(topology.id, appended.version.version)
    const selectedExecutorId = `${topology.id}:node:intake`
    const dependencies = createDependencies()
    const resolveRunRoute = vi.fn().mockReturnValue({
      targetId: "provider:openai",
      targetLabel: "OpenAI",
      providerId: "openai",
      model: "gpt-test",
      reason: "routing:provider:openai",
    })

    const result = await runIntakeBridgePass({
      message: "코스피 관련 질문을 처리해줘",
      originalRequest: "코스피 관련 질문을 처리해줘",
      sessionId: "session:no-provider-direct",
      requestGroupId: "run:no-provider-direct",
      model: "gpt-test",
      workDir: "/tmp",
      source: "telegram",
      runId: "run:no-provider-direct",
      onChunk: undefined,
      reuseConversationContext: false,
    }, dependencies, {
      analyzeTaskIntake: vi.fn().mockResolvedValue(taskIntakeResult()),
      resolveRunRoute,
      executeScheduleActions: vi.fn(),
      createDefaultScheduleActionDependencies: vi.fn(),
      inferDelegatedTaskProfile: vi.fn().mockReturnValue("general_chat"),
      buildFollowupPrompt: vi.fn().mockReturnValue("[Task Intake Bridge]\n코스피 관련 질문을 처리해줘"),
      runAgentExecutionHarness: (input) => runAgentExecutionHarness({
        ...input,
        callModel: async () => JSON.stringify(decisionForExecutor(selectedExecutorId)),
      }),
    })

    expect(result).toEqual(expect.objectContaining({ kind: "complete_silent" }))
    expect(resolveRunRoute).not.toHaveBeenCalled()
    expect(dependencies.startDelegatedRun).toHaveBeenCalledWith(expect.objectContaining({
      targetId: selectedExecutorId,
      agentExecutionDecision: expect.objectContaining({
        selected_executor_id: selectedExecutorId,
        execution_route: "delegate_to_child",
      }),
    }))
  })

  it("allows provider direct only when the request carries an explicit provider target", async () => {
    useTempState()
    const dependencies = createDependencies()
    const runAgentExecutionHarnessMock = vi.fn()
    const resolveRunRoute = vi.fn().mockReturnValue({
      targetId: "provider:openai",
      targetLabel: "OpenAI",
      providerId: "openai",
      model: "gpt-test",
      reason: "routing:provider:openai",
    })

    await runIntakeBridgePass({
      message: "provider openai로 직접 처리해줘",
      originalRequest: "provider openai로 직접 처리해줘",
      sessionId: "session:explicit-provider",
      requestGroupId: "run:explicit-provider",
      model: "gpt-test",
      workDir: "/tmp",
      source: "telegram",
      runId: "run:explicit-provider",
      onChunk: undefined,
      reuseConversationContext: false,
    }, dependencies, {
      analyzeTaskIntake: vi.fn().mockResolvedValue(taskIntakeResult({
        preferred_target: "provider:openai",
      })),
      resolveRunRoute,
      executeScheduleActions: vi.fn(),
      createDefaultScheduleActionDependencies: vi.fn(),
      inferDelegatedTaskProfile: vi.fn().mockReturnValue("general_chat"),
      buildFollowupPrompt: vi.fn().mockReturnValue("[Task Intake Bridge]\nprovider direct"),
      runAgentExecutionHarness: runAgentExecutionHarnessMock,
    })

    expect(resolveRunRoute).toHaveBeenCalledWith(expect.objectContaining({
      preferredTarget: "provider:openai",
    }))
    expect(runAgentExecutionHarnessMock).not.toHaveBeenCalled()
    expect(dependencies.startDelegatedRun).toHaveBeenCalledWith(expect.objectContaining({
      targetId: "provider:openai",
      providerId: "openai",
    }))
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith(
      "run:explicit-provider",
      "execution_decision_fallback:explicit_provider; provider_direct_allowed_with_explicit_target; target=provider:openai",
    )
  })

  it("does not convert execution-decision fallback into provider direct", async () => {
    useTempState()
    const topology = buildExampleEnterpriseTopology(now)
    const registry = createEnterpriseTopologyRegistry({ now: () => now })
    const appended = registry.appendTopologyVersion({
      topology,
      createdBy: "no-provider-fallback-test",
    })
    registry.activateTopologyVersion(topology.id, appended.version.version)
    const dependencies = createDependencies()
    const resolveRunRoute = vi.fn().mockReturnValue({
      targetId: "provider:openai",
      targetLabel: "OpenAI",
      providerId: "openai",
      model: "gpt-test",
      reason: "routing:provider:openai",
    })

    const result = await runIntakeBridgePass({
      message: "실행자가 판단하지 못하면 노비가 직접 처리해줘",
      originalRequest: "실행자가 판단하지 못하면 노비가 직접 처리해줘",
      sessionId: "session:fallback",
      requestGroupId: "run:fallback",
      model: "gpt-test",
      workDir: "/tmp",
      source: "telegram",
      runId: "run:fallback",
      onChunk: undefined,
      reuseConversationContext: false,
    }, dependencies, {
      analyzeTaskIntake: vi.fn().mockResolvedValue(taskIntakeResult()),
      resolveRunRoute,
      executeScheduleActions: vi.fn(),
      createDefaultScheduleActionDependencies: vi.fn(),
      inferDelegatedTaskProfile: vi.fn().mockReturnValue("general_chat"),
      buildFollowupPrompt: vi.fn().mockReturnValue("[Task Intake Bridge]\nself solve"),
      runAgentExecutionHarness,
    })

    expect(result).toEqual(expect.objectContaining({
      kind: "awaiting_user",
      eventLabel: "execution decision 사용자 확인 대기",
      reason: "No execution decision model caller was provided.",
    }))
    expect(resolveRunRoute).not.toHaveBeenCalled()
    expect(dependencies.startDelegatedRun).not.toHaveBeenCalled()
    expect(dependencies.appendRunEvent).not.toHaveBeenCalledWith(
      "run:fallback",
      "execution_decision_fallback:self_solve; provider_direct_blocked_without_explicit_target",
    )
  })

  it("turns ask_user execution decisions into awaiting_user without provider direct", async () => {
    useTempState()
    const dependencies = createDependencies()
    const resolveRunRoute = vi.fn()

    const result = await runIntakeBridgePass({
      message: "실행 전 확인이 필요하면 물어봐",
      originalRequest: "실행 전 확인이 필요하면 물어봐",
      sessionId: "session:ask-user",
      requestGroupId: "run:ask-user",
      model: "gpt-test",
      workDir: "/tmp",
      source: "telegram",
      runId: "run:ask-user",
      onChunk: undefined,
      reuseConversationContext: false,
    }, dependencies, {
      analyzeTaskIntake: vi.fn().mockResolvedValue(taskIntakeResult()),
      resolveRunRoute,
      executeScheduleActions: vi.fn(),
      createDefaultScheduleActionDependencies: vi.fn(),
      inferDelegatedTaskProfile: vi.fn().mockReturnValue("general_chat"),
      buildFollowupPrompt: vi.fn().mockReturnValue("[Task Intake Bridge]\nask user"),
      runAgentExecutionHarness: (input) => runAgentExecutionHarness({
        ...input,
        callModel: async () => JSON.stringify(fallbackDecision("ask_user")),
      }),
    })

    expect(result).toEqual(expect.objectContaining({
      kind: "awaiting_user",
      eventLabel: "execution decision 사용자 확인 대기",
    }))
    expect(resolveRunRoute).not.toHaveBeenCalled()
    expect(dependencies.startDelegatedRun).not.toHaveBeenCalled()
  })

  it("keeps return_to_parent decisions out of provider direct and falls back to user confirmation at root intake", async () => {
    useTempState()
    const dependencies = createDependencies()
    const resolveRunRoute = vi.fn()

    const result = await runIntakeBridgePass({
      message: "상위로 돌려야 하면 이유를 남겨줘",
      originalRequest: "상위로 돌려야 하면 이유를 남겨줘",
      sessionId: "session:return-parent",
      requestGroupId: "run:return-parent",
      model: "gpt-test",
      workDir: "/tmp",
      source: "telegram",
      runId: "run:return-parent",
      onChunk: undefined,
      reuseConversationContext: false,
    }, dependencies, {
      analyzeTaskIntake: vi.fn().mockResolvedValue(taskIntakeResult()),
      resolveRunRoute,
      executeScheduleActions: vi.fn(),
      createDefaultScheduleActionDependencies: vi.fn(),
      inferDelegatedTaskProfile: vi.fn().mockReturnValue("general_chat"),
      buildFollowupPrompt: vi.fn().mockReturnValue("[Task Intake Bridge]\nreturn parent"),
      runAgentExecutionHarness: (input) => runAgentExecutionHarness({
        ...input,
        callModel: async () => JSON.stringify(fallbackDecision("return_to_parent")),
      }),
    })

    expect(result).toEqual(expect.objectContaining({
      kind: "awaiting_user",
      eventLabel: "execution decision 사용자 확인 대기",
      reason: "parent_executor_missing",
    }))
    expect(resolveRunRoute).not.toHaveBeenCalled()
    expect(dependencies.startDelegatedRun).not.toHaveBeenCalled()
  })
})
