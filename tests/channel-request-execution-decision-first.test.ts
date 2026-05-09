import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.ts"
import { closeDb } from "../packages/core/src/db/index.js"
import type { AIProvider } from "../packages/core/src/ai/index.ts"
import {
  ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
  type EnterpriseRelation,
  type EnterpriseTopology,
  type NodeContract,
} from "../packages/core/src/contracts/enterprise-topology.ts"
import {
  AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
  type AgentExecutionContext,
  type AgentExecutionDecision,
} from "../packages/core/src/orchestration/execution-decision-contract.ts"
import {
  buildExecutionGraphSnapshot,
  EXECUTION_GRAPH_ROOT_AGENT_ID,
  WORKSPACE_DRAFT_TOPOLOGY_ID,
  type BuildExecutionGraphSnapshotInput,
} from "../packages/core/src/orchestration/execution-graph-snapshot.ts"
import { runAgentExecutionHarness } from "../packages/core/src/orchestration/execution-harness.ts"
import { createEnterpriseTopologyRegistry } from "../packages/core/src/topology/registry.ts"
import { runIntakeBridgePass } from "../packages/core/src/runs/intake-bridge-pass.ts"

const now = Date.UTC(2026, 4, 7, 12, 0, 0)
const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

const rootExecutorId = EXECUTION_GRAPH_ROOT_AGENT_ID
const madangsoeId = `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:executor-1`
const samsigiId = `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:executor-2`
const haengrangId = `${WORKSPACE_DRAFT_TOPOLOGY_ID}:node:executor-5`

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-channel-decision-first-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json")
  writeFileSync(process.env.NOBIE_CONFIG, JSON.stringify({
    orchestration: {
      mode: "orchestration",
      featureFlagEnabled: true,
      subAgents: [],
      teams: [],
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

function node(input: {
  id: string
  name: string
  roleName: string
  description: string
  tags: string[]
  children?: string[]
}): NodeContract {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "node",
    id: input.id,
    name: input.name,
    displayName: input.name,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    nodeType: "function",
    description: input.description,
    tags: input.tags,
    children: input.children ?? [],
    allowedToolIds: [],
    allowedSystemIds: [],
    metadata: {
      roleName: input.roleName,
      capabilityHints: input.tags,
      executorProfile: {
        roleName: input.roleName,
        definition: input.description,
        does: [input.description],
        delegationScope: input.tags,
        expectedOutputs: ["처리 결과"],
        handoffStyle: "structured_handoff",
      },
    },
  }
}

function delegatesTo(id: string, fromNodeId: string, toNodeId: string): EnterpriseRelation {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "relation",
    id,
    name: `${fromNodeId} delegates to ${toNodeId}`,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    relationType: "delegates_to",
    from: { entityType: "node", id: fromNodeId },
    to: { entityType: "node", id: toNodeId },
  }
}

function buildInvestmentTopology(): EnterpriseTopology {
  return {
    schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
    entityType: "topology",
    id: WORKSPACE_DRAFT_TOPOLOGY_ID,
    name: "Workspace Draft Decision Fixture",
    status: "draft",
    createdAt: now,
    updatedAt: now,
    nodes: [
      node({
        id: "node:executor-1",
        name: "마당쇠",
        roleName: "개발 리드",
        description: "개발 업무를 분석하고 하위 백엔드 실행자에게 필요한 구현 작업을 위임합니다.",
        tags: ["development", "planning", "delegation"],
        children: ["node:executor-2"],
      }),
      node({
        id: "node:executor-2",
        name: "삼식이",
        roleName: "백엔드 엔지니어",
        description: "마당쇠에게 위임받은 백엔드 구현과 검증 작업을 처리합니다.",
        tags: ["backend", "implementation"],
      }),
      node({
        id: "node:executor-5",
        name: "행랑아범",
        roleName: "재무 담당",
        description: "코스피와 하이닉스 같은 시장, 기업, 투자 질문을 분석하고 재무 관점의 검토 결과를 정리합니다.",
        tags: ["finance", "investment", "market", "analysis"],
      }),
    ],
    teams: [{
      schemaVersion: ENTERPRISE_TOPOLOGY_SCHEMA_VERSION,
      entityType: "team",
      id: "team:workspace-decision",
      name: "Workspace Decision Team",
      status: "draft",
      createdAt: now,
      updatedAt: now,
      nodeIds: ["node:executor-1", "node:executor-2", "node:executor-5"],
      tags: ["workspace"],
    }],
    orgUnits: [],
    positions: [],
    persons: [],
    memberships: [],
    authorityRules: [],
    responsibilities: [],
    systems: [],
    tools: [],
    processes: [],
    relations: [
      delegatesTo("relation:madangsoe-samsigi", "node:executor-1", "node:executor-2"),
    ],
  }
}

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
    recordExecutionDecisionTrace: vi.fn(),
    logInfo: vi.fn(),
  }
}

function taskIntakeResult() {
  return {
    intent: {
      category: "task_intake" as const,
      summary: "후속 실행이 필요합니다.",
      confidence: 0.92,
    },
    user_message: {
      mode: "accepted_receipt" as const,
      text: "요청을 분석해 실행자에게 전달합니다.",
    },
    action_items: [{
      id: "run-task-kospi",
      type: "run_task" as const,
      title: "코스피/하이닉스 투자 질문 검토",
      priority: "normal" as const,
      reason: "채널 요청을 적합한 실행자에게 위임해야 합니다.",
      payload: {
        goal: "코스피와 하이닉스 투자 질문을 검토한다.",
      },
    }],
    structured_request: {
      source_language: "ko" as const,
      normalized_english: "Review an investment question about KOSPI and SK Hynix.",
      target: "코스피/하이닉스 투자 질문",
      to: "channel",
      context: ["투자 질문", "시장 분석"],
      complete_condition: ["재무 관점의 검토 결과 전달"],
    },
    intent_envelope: {
      intent_type: "task_intake" as const,
      source_language: "ko" as const,
      normalized_english: "Review an investment question about KOSPI and SK Hynix.",
      target: "코스피/하이닉스 투자 질문",
      destination: "channel",
      context: ["투자 질문", "시장 분석"],
      complete_condition: ["재무 관점의 검토 결과 전달"],
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

function decisionFor(input: {
  selectedExecutorId: string
  selectedConnectionPath: string[]
  reason?: string
}): AgentExecutionDecision {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    current_executor_id: rootExecutorId,
    domain: "finance",
    behavior_pattern: "delegate",
    execution_route: "delegate_to_child",
    selected_executor_id: input.selectedExecutorId,
    selected_connection_path: input.selectedConnectionPath,
    task_profile: {
      title: "코스피/하이닉스 투자 질문 검토",
      summary: "현재 요청을 가장 적합한 직속 실행자에게 위임한다.",
      goals: ["직속 실행자 후보만 선택한다.", "provider direct 경로를 만들지 않는다."],
      task_units: [{
        id: "unit:investment-review",
        title: "투자 질문 검토",
        goal: "선택된 실행자가 재무 관점으로 요청을 처리한다.",
        preferred_executor_id: input.selectedExecutorId,
      }],
      success_criteria: ["선택된 실행자와 연결 경로가 trace에 남는다."],
    },
    required_outputs: [{
      id: "answer",
      label: "최종 답변",
    }],
    risk_boundary: {
      requires_user_approval: false,
      reason: "테스트 범위의 실행자 선택입니다.",
    },
    confidence: 0.91,
    fallback_if_unavailable: "self_solve",
    reason: input.reason ?? "재무 담당 실행자에게 맡기는 것이 적합합니다.",
  }
}

function buildModuleDependencies(input: {
  registry: ReturnType<typeof createEnterpriseTopologyRegistry>
  callModel: (context: AgentExecutionContext) => Promise<string>
  captureContext?: (context: AgentExecutionContext) => void
  resolveRunRoute?: ReturnType<typeof vi.fn>
}) {
  const buildGraph = vi.fn((graphInput: BuildExecutionGraphSnapshotInput = {}) =>
    buildExecutionGraphSnapshot({
      ...graphInput,
      mode: "workspace",
      topologyRegistry: input.registry,
      now: () => now,
    }),
  )
  return {
    analyzeTaskIntake: vi.fn().mockResolvedValue(taskIntakeResult()),
    resolveRunRoute: input.resolveRunRoute ?? vi.fn().mockReturnValue({
      targetId: "provider:openai",
      targetLabel: "OpenAI",
      providerId: "openai",
      model: "gpt-test",
      reason: "routing:provider:openai",
    }),
    executeScheduleActions: vi.fn(),
    createDefaultScheduleActionDependencies: vi.fn(),
    inferDelegatedTaskProfile: vi.fn().mockReturnValue("finance_research"),
    buildFollowupPrompt: vi.fn().mockReturnValue("[Task Intake Bridge]\n코스피와 하이닉스 투자 질문"),
    buildExecutionGraphSnapshot: buildGraph,
    runAgentExecutionHarness: (harnessInput: { context: AgentExecutionContext }) => {
      input.captureContext?.(harnessInput.context)
      return runAgentExecutionHarness({
        ...harnessInput,
        callModel: async () => input.callModel(harnessInput.context),
      })
    },
  }
}

function createWorkspaceRegistry() {
  const registry = createEnterpriseTopologyRegistry({ now: () => now })
  registry.appendTopologyVersion({
    topology: buildInvestmentTopology(),
    createdBy: "task012-channel-decision-first",
  })
  return registry
}

function requestParams() {
  return {
    message: "코스피와 하이닉스 투자 관점으로 어떻게 봐야 하는지 알려줘",
    originalRequest: "코스피와 하이닉스 투자 관점으로 어떻게 봐야 하는지 알려줘",
    sessionId: "session:telegram-kospi",
    requestGroupId: "run:telegram-kospi",
    model: "gpt-test",
    workDir: "/tmp",
    source: "telegram" as const,
    runId: "run:telegram-kospi",
    onChunk: undefined,
    reuseConversationContext: false,
  }
}

describe("channel request execution decision first", () => {
  it("builds a decision context where 행랑아범 is selectable and creates no provider-direct run", async () => {
    useTempState()
    const registry = createWorkspaceRegistry()
    const dependencies = createDependencies()
    const resolveRunRoute = vi.fn().mockReturnValue({
      targetId: "provider:openai",
      targetLabel: "OpenAI",
      providerId: "openai",
      model: "gpt-test",
      reason: "routing:provider:openai",
    })
    let capturedContext: AgentExecutionContext | undefined

    const result = await runIntakeBridgePass(requestParams(), dependencies, buildModuleDependencies({
      registry,
      resolveRunRoute,
      captureContext: (context) => {
        capturedContext = context
      },
      callModel: async () => JSON.stringify(decisionFor({
        selectedExecutorId: haengrangId,
        selectedConnectionPath: [haengrangId],
      })),
    }))

    expect(result).toEqual(expect.objectContaining({ kind: "complete_silent" }))
    expect(resolveRunRoute).not.toHaveBeenCalled()
    expect(capturedContext?.execution_graph).toEqual(expect.objectContaining({
      graph_source: "workspace_draft",
      current_executor_id: rootExecutorId,
      available_executor_ids: [madangsoeId, haengrangId],
      diagnostic_executor_ids: [samsigiId],
      topology_id: WORKSPACE_DRAFT_TOPOLOGY_ID,
    }))
    expect(capturedContext?.accessible_executors).toEqual([
      expect.objectContaining({
        executor_id: madangsoeId,
        display_name: "마당쇠",
        role_name: "개발 리드",
      }),
      expect.objectContaining({
        executor_id: haengrangId,
        display_name: "행랑아범",
        role_name: "재무 담당",
      }),
    ])
    expect(capturedContext?.diagnostic_executors).toEqual([
      expect.objectContaining({
        executor_id: samsigiId,
        display_name: "삼식이",
        visibility: "indirect",
        parent_executor_ids: [madangsoeId],
      }),
    ])
    expect(dependencies.startDelegatedRun).toHaveBeenCalledWith(expect.objectContaining({
      targetId: haengrangId,
      targetLabel: "행랑아범",
      agentExecutionDecision: expect.objectContaining({
        selected_executor_id: haengrangId,
        execution_route: "delegate_to_child",
      }),
      agentExecutionDecisionTrace: expect.objectContaining({
        decision_source: "nobie_harness",
        selected_executor_id: haengrangId,
        validation_status: "valid",
      }),
    }))
    expect(dependencies.recordExecutionDecisionTrace).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run:telegram-kospi",
      agentExecutionDecision: expect.objectContaining({
        selected_executor_id: haengrangId,
      }),
      executionDecisionTrace: expect.objectContaining({
        decision_source: "nobie_harness",
        selected_executor_id: haengrangId,
        validation_status: "valid",
      }),
    }))
    expect(dependencies.startDelegatedRun).not.toHaveBeenCalledWith(expect.objectContaining({
      targetId: "provider:openai",
    }))
    expect(dependencies.startDelegatedRun).not.toHaveBeenCalledWith(expect.objectContaining({
      targetId: samsigiId,
    }))
  })

  it("uses the active provider as the execution-decision model before falling back", async () => {
    useTempState()
    const registry = createWorkspaceRegistry()
    const dependencies = createDependencies()
    const resolveRunRoute = vi.fn().mockReturnValue({
      targetId: "provider:openai",
      targetLabel: "OpenAI",
      providerId: "openai",
      model: "gpt-test",
      reason: "routing:provider:openai",
    })
    let decisionPrompt = ""
    const provider: AIProvider = {
      id: "test-provider",
      supportedModels: ["gpt-test"],
      maxContextTokens: () => 16_000,
      async *chat(params) {
        decisionPrompt = String(params.messages[0]?.content ?? "")
        yield { type: "text_delta", delta: JSON.stringify(decisionFor({
          selectedExecutorId: haengrangId,
          selectedConnectionPath: [haengrangId],
        })) }
        yield { type: "message_stop", usage: { input_tokens: 1, output_tokens: 1 } }
      },
    }
    const buildGraph = vi.fn((graphInput: BuildExecutionGraphSnapshotInput = {}) =>
      buildExecutionGraphSnapshot({
        ...graphInput,
        mode: "workspace",
        topologyRegistry: registry,
        now: () => now,
      }),
    )

    await runIntakeBridgePass({
      ...requestParams(),
      providerId: provider.id,
      provider,
    }, dependencies, {
      analyzeTaskIntake: vi.fn().mockResolvedValue(taskIntakeResult()),
      resolveRunRoute,
      executeScheduleActions: vi.fn(),
      createDefaultScheduleActionDependencies: vi.fn(),
      inferDelegatedTaskProfile: vi.fn().mockReturnValue("finance_research"),
      buildFollowupPrompt: vi.fn().mockReturnValue("[Task Intake Bridge]\n코스피와 하이닉스 투자 질문"),
      buildExecutionGraphSnapshot: buildGraph,
    })

    expect(decisionPrompt).toContain("AgentExecutionDecisionV2")
    expect(decisionPrompt).toContain("행랑아범")
    expect(dependencies.startDelegatedRun).toHaveBeenCalledWith(expect.objectContaining({
      targetId: haengrangId,
      targetLabel: "행랑아범",
    }))
    expect(resolveRunRoute).not.toHaveBeenCalled()
    expect(dependencies.appendRunEvent).not.toHaveBeenCalledWith(
      "run:telegram-kospi",
      "execution_decision_fallback:self_solve; provider_direct_blocked_without_explicit_target",
    )
  })

  it("does not select 삼식이 from a channel root request when no valid path is provided", async () => {
    useTempState()
    const registry = createWorkspaceRegistry()
    const dependencies = createDependencies()
    const resolveRunRoute = vi.fn().mockReturnValue({
      targetId: "provider:openai",
      targetLabel: "OpenAI",
      providerId: "openai",
      model: "gpt-test",
      reason: "routing:provider:openai",
    })

    const result = await runIntakeBridgePass(requestParams(), dependencies, buildModuleDependencies({
      registry,
      resolveRunRoute,
      callModel: async () => JSON.stringify(decisionFor({
        selectedExecutorId: samsigiId,
        selectedConnectionPath: [],
        reason: "진단용 하위 실행자를 경로 없이 고른 잘못된 결정입니다.",
      })),
    }))

    expect(result).toEqual(expect.objectContaining({
      kind: "awaiting_user",
      eventLabel: "execution decision 사용자 확인 대기",
      reason: "selected_executor_not_direct_child",
    }))
    expect(resolveRunRoute).not.toHaveBeenCalled()
    expect(dependencies.startDelegatedRun).not.toHaveBeenCalled()
    expect(dependencies.recordExecutionDecisionTrace).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run:telegram-kospi",
      agentExecutionDecision: expect.objectContaining({
        execution_route: "ask_user",
      }),
      executionDecisionTrace: expect.objectContaining({
        selected_executor_id: samsigiId,
        resolved_execution_route: "ask_user",
        validation_status: "selected_executor_not_direct_child",
      }),
    }))
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith(
      "run:telegram-kospi",
      expect.stringContaining(`selected_executor=${samsigiId}`),
    )
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith(
      "run:telegram-kospi",
      expect.stringContaining("validation_status=selected_executor_not_direct_child"),
    )
    expect(dependencies.appendRunEvent).not.toHaveBeenCalledWith(
      "run:telegram-kospi",
      "execution_decision_fallback:self_solve; provider_direct_blocked_without_explicit_target",
    )
  })
})
