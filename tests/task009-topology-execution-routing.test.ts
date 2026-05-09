import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { registerStatusRoute } from "../packages/core/src/api/routes/status.js"
import { reloadConfig } from "../packages/core/src/config/index.js"
import type { OrchestrationConfig } from "../packages/core/src/config/types.ts"
import {
  buildExampleEnterpriseTopology,
  createEnterpriseTopologyRegistry,
} from "../packages/core/src/index.ts"
import {
  resolveOrchestrationModeSnapshotSync,
} from "../packages/core/src/orchestration/mode.ts"
import {
  buildOrchestrationPlan,
} from "../packages/core/src/orchestration/planner.ts"
import {
  buildOrchestrationRegistrySnapshot,
} from "../packages/core/src/orchestration/registry.ts"
import {
  buildStartPlan,
  defaultStartPlanDependencies,
} from "../packages/core/src/runs/start-plan.ts"
import {
  runIntakeBridgePass,
} from "../packages/core/src/runs/intake-bridge-pass.ts"
import {
  resolveTopologyRootRunRouting,
  runTopologyRootRun,
  type TopologyRootRunRoutingDecision,
} from "../packages/core/src/topology-runtime/harness.ts"
import {
  AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
  type AgentExecutionDecision,
} from "../packages/core/src/orchestration/execution-decision-contract.ts"
import {
  runAgentExecutionHarness,
} from "../packages/core/src/orchestration/execution-harness.ts"
import {
  insertSession,
  closeDb,
} from "../packages/core/src/db/index.js"
import {
  bindActiveRunController,
  cancelRootRun,
  createRootRun,
  getRootRun,
} from "../packages/core/src/runs/store.ts"
import {
  buildRunRuntimeInspectorProjection,
} from "../packages/core/src/runs/runtime-inspector-projection.ts"
import {
  resolveStartContextPlan,
} from "../packages/core/src/runs/preflight.ts"

const now = Date.UTC(2026, 4, 4, 9, 0, 0)
const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task009-topology-routing-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
}

function orchestrationConfig(overrides: Partial<OrchestrationConfig> = {}): OrchestrationConfig {
  return {
    maxDelegationTurns: 5,
    mode: "orchestration",
    featureFlagEnabled: true,
    subAgents: [],
    teams: [],
    ...overrides,
  }
}

function runtimeConfig() {
  return {
    orchestration: orchestrationConfig(),
    ai: {
      connection: {
        provider: "openai" as const,
        model: "gpt-test",
      },
    },
  }
}

function writeRuntimeConfig(overrides: Partial<OrchestrationConfig> = {}): void {
  if (!process.env.NOBIE_CONFIG) throw new Error("NOBIE_CONFIG is not set")
  writeFileSync(process.env.NOBIE_CONFIG, JSON.stringify({
    orchestration: orchestrationConfig(overrides),
    ai: {
      connection: {
        provider: "openai",
        model: "gpt-test",
      },
    },
  }, null, 2))
  reloadConfig()
}

function executionDecisionForTopology(input: {
  selectedExecutorId: string
  selectedConnectionPath: string[]
  title?: string
}): AgentExecutionDecision {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    current_executor_id: "agent:nobie",
    domain: "topology-runtime",
    behavior_pattern: "delegate",
    execution_route: "delegate_to_child",
    selected_executor_id: input.selectedExecutorId,
    selected_connection_path: input.selectedConnectionPath,
    task_profile: {
      title: input.title ?? "토폴로지 실행 판단 통합",
      summary: "선택된 실행자가 연결된 다음 실행자에게 작업을 위임하고 결과를 취합한다.",
      goals: ["선택 실행자에서 시작", "연결선 기반 위임", "부모 실행자 검증과 취합"],
      task_units: [{
        id: "unit:topology-runtime",
        title: "연결선 기반 위임 실행",
        goal: "선택된 실행자가 자신의 하위 실행자에게 업무를 나누고 결과를 취합한다.",
        preferred_executor_id: input.selectedExecutorId,
      }],
      success_criteria: ["선택 실행자와 연결선이 trace에 남는다."],
    },
    required_outputs: [{
      id: "answer",
      label: "최종 답변",
      acceptance_criteria: ["부모 실행자가 위임 결과를 검증하고 취합한다."],
    }],
    risk_boundary: {
      requires_user_approval: false,
      reason: "테스트용 토폴로지 런타임 위임이며 외부 작업을 수행하지 않는다.",
    },
    confidence: 0.92,
    fallback_if_unavailable: "self_solve",
    reason: "토폴로지 연결선으로 접근 가능한 실행자에게 위임한다.",
  }
}

function intakeBridgeDependencies() {
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
      id: "delegate-1",
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

describe("task009 topology execution routing", () => {
  it("routes channel intake follow-up runs to topology executors before provider direct", async () => {
    useTempState()
    const topology = buildExampleEnterpriseTopology(now)
    const registry = createEnterpriseTopologyRegistry({ now: () => now })
    const appended = registry.appendTopologyVersion({
      topology,
      createdBy: "task009-intake-topology",
    })
    registry.activateTopologyVersion(topology.id, appended.version.version)
    const modeSnapshot = resolveOrchestrationModeSnapshotSync({
      getConfig: runtimeConfig,
      now: () => now,
    })
    const dependencies = intakeBridgeDependencies()
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
      sessionId: "session:task009-intake-topology",
      requestGroupId: "run:task009-intake-topology",
      model: "gpt-test",
      workDir: "/tmp",
      source: "telegram",
      runId: "run:task009-intake-topology",
      onChunk: undefined,
      reuseConversationContext: false,
    }, dependencies, {
      analyzeTaskIntake: vi.fn().mockResolvedValue(taskIntakeResult()),
      resolveRunRoute,
      resolveOrchestrationModeSnapshotSync: vi.fn(() => modeSnapshot),
      resolveTopologyRootRunRouting,
      executeScheduleActions: vi.fn(),
      createDefaultScheduleActionDependencies: vi.fn(),
      inferDelegatedTaskProfile: vi.fn().mockReturnValue("general_chat"),
      buildFollowupPrompt: vi.fn().mockReturnValue("[Task Intake Bridge]\n코스피 관련 질문을 처리해줘"),
      runAgentExecutionHarness: (input) => runAgentExecutionHarness({
        ...input,
        callModel: async () => JSON.stringify(executionDecisionForTopology({
          selectedExecutorId: `${topology.id}:node:intake`,
          selectedConnectionPath: [`${topology.id}:node:intake`],
        })),
      }),
    })

    expect(result).toEqual({
      kind: "complete_silent",
      summary: "후속 실행으로 전달되었습니다.",
      eventLabel: "intake 후속 실행 생성 완료",
    })
    expect(resolveRunRoute).not.toHaveBeenCalled()
    expect(dependencies.startDelegatedRun).toHaveBeenCalledWith(expect.objectContaining({
      source: "telegram",
      targetId: `${topology.id}:node:intake`,
      targetLabel: "Customer Request Intake",
      agentExecutionDecision: expect.objectContaining({
        current_executor_id: "agent:nobie",
        execution_route: "delegate_to_child",
        selected_executor_id: `${topology.id}:node:intake`,
        selected_connection_path: [`${topology.id}:node:intake`],
        fallback_if_unavailable: "self_solve",
      }),
    }))
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith(
      "run:task009-intake-topology",
      expect.stringContaining("execution_decision_source:nobie_harness"),
    )
  })

  it("keeps explicit provider targets on the channel intake provider-direct path", async () => {
    useTempState()
    const topology = buildExampleEnterpriseTopology(now)
    createEnterpriseTopologyRegistry({ now: () => now }).appendTopologyVersion({
      topology,
      createdBy: "task009-intake-provider",
    })
    const modeSnapshot = resolveOrchestrationModeSnapshotSync({
      getConfig: runtimeConfig,
      now: () => now,
    })
    const dependencies = intakeBridgeDependencies()
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
      sessionId: "session:task009-intake-provider",
      requestGroupId: "run:task009-intake-provider",
      model: "gpt-test",
      workDir: "/tmp",
      source: "telegram",
      runId: "run:task009-intake-provider",
      onChunk: undefined,
      reuseConversationContext: false,
    }, dependencies, {
      analyzeTaskIntake: vi.fn().mockResolvedValue(taskIntakeResult({
        preferred_target: "provider:openai",
      })),
      resolveRunRoute,
      resolveOrchestrationModeSnapshotSync: vi.fn(() => modeSnapshot),
      resolveTopologyRootRunRouting,
      executeScheduleActions: vi.fn(),
      createDefaultScheduleActionDependencies: vi.fn(),
      inferDelegatedTaskProfile: vi.fn().mockReturnValue("general_chat"),
      buildFollowupPrompt: vi.fn().mockReturnValue("[Task Intake Bridge]\nprovider direct"),
    })

    expect(resolveRunRoute).toHaveBeenCalledWith(expect.objectContaining({
      preferredTarget: "provider:openai",
    }))
    expect(dependencies.startDelegatedRun).toHaveBeenCalledWith(expect.objectContaining({
      targetId: "provider:openai",
      providerId: "openai",
    }))
    expect(dependencies.startDelegatedRun.mock.calls[0]?.[0]).not.toHaveProperty("agentExecutionDecision")
  })

  it("keeps /api/status active topology agents aligned with root-run routing candidates", async () => {
    useTempState()
    writeRuntimeConfig()
    const topology = buildExampleEnterpriseTopology(now)
    createEnterpriseTopologyRegistry({ now: () => now }).appendTopologyVersion({
      topology,
      createdBy: "task009-test",
    })
    const routes = new Map<string, () => unknown | Promise<unknown>>()
    registerStatusRoute({
      get(path: string, _options: unknown, handler: () => unknown | Promise<unknown>) {
        routes.set(path, handler)
      },
    } as never)

    const statusBody = await routes.get("/api/status")?.() as {
      orchestration: ReturnType<typeof resolveOrchestrationModeSnapshotSync>
    }

    const startPlan = await buildStartPlan({
      message: "지뢰 찾기 게임 만들어줘",
      sessionId: "session:task009-status",
      runId: "run:task009-status",
      source: "telegram",
      taskProfile: "coding",
      agentExecutionDecision: executionDecisionForTopology({
        selectedExecutorId: `${topology.id}:node:intake`,
        selectedConnectionPath: [`${topology.id}:node:intake`],
        title: "status route selected executor",
      }),
    }, {
      ...defaultStartPlanDependencies,
      resolveOrchestrationMode: async () => statusBody.orchestration,
      buildOrchestrationPlan: (input) => buildOrchestrationPlan({
        ...input,
        registrySnapshot: buildOrchestrationRegistrySnapshot({
          now: () => now,
        }),
        now: () => now,
        idProvider: () => "plan:task009-status",
      }),
    })

    expect(statusBody.orchestration.activeSubAgentCount).toBe(
      startPlan.orchestrationRegistrySnapshot.activeSubAgentCount,
    )
    expect(statusBody.orchestration.activeSubAgents.filter((agent) => agent.source === "topology"))
      .toHaveLength(startPlan.orchestrationRegistrySnapshot.activeSubAgents.filter((agent) => agent.source === "topology").length)
    expect(startPlan.topologyRouting).toEqual(expect.objectContaining({
      mode: "route",
      topologyId: topology.id,
      entryNodeId: "node:intake",
    }))
  })

  it("routes saved draft topology nodes without the hidden topology runtime flag", async () => {
    useTempState()
    const topology = buildExampleEnterpriseTopology(now)
    createEnterpriseTopologyRegistry({ now: () => now }).appendTopologyVersion({
      topology,
      createdBy: "task009-test",
    })
    const modeSnapshot = resolveOrchestrationModeSnapshotSync({
      getConfig: runtimeConfig,
      now: () => now,
    })

    const startPlan = await buildStartPlan({
      message: "다운로드 밑에 지뢰라는 폴더 만들고 지뢰 찾기 게임 만들어줘",
      sessionId: "session:task009",
      runId: "run:task009",
      source: "telegram",
      taskProfile: "coding",
      agentExecutionDecision: executionDecisionForTopology({
        selectedExecutorId: `${topology.id}:node:intake`,
        selectedConnectionPath: [`${topology.id}:node:intake`],
        title: "saved draft selected executor",
      }),
    }, {
      ...defaultStartPlanDependencies,
      resolveOrchestrationMode: async () => modeSnapshot,
      buildOrchestrationPlan: (input) => buildOrchestrationPlan({
        ...input,
        registrySnapshot: buildOrchestrationRegistrySnapshot({
          getConfig: runtimeConfig,
          now: () => now,
        }),
        now: () => now,
        idProvider: () => "plan:task009",
      }),
    })

    expect(startPlan.orchestrationRegistrySnapshot.activeSubAgents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "topology",
        topologyId: topology.id,
        executorId: "node:intake",
      }),
    ]))
    expect(startPlan.topologyRouting).toEqual(expect.objectContaining({
      mode: "route",
      topologyId: topology.id,
      topologyVersion: 1,
      entryNodeId: "node:intake",
    }))
    expect(startPlan.topologyRouting).not.toEqual(expect.objectContaining({
      reasonCode: "feature_flag_off",
    }))
    expect(startPlan.orchestrationPlanSnapshot.fallbackStrategy.reasonCode)
      .not.toBe("no_eligible_agent_candidate")
    expect(startPlan.orchestrationPlanSnapshot.delegatedTasks).toEqual([
      expect.objectContaining({
        assignedAgentId: `${topology.id}:node:intake`,
        executionKind: "delegated_sub_agent",
      }),
    ])
  })

  it("injects the execution decision through start-plan before topology routing", async () => {
    useTempState()
    const topology = buildExampleEnterpriseTopology(now)
    createEnterpriseTopologyRegistry({ now: () => now }).appendTopologyVersion({
      topology,
      createdBy: "task009-start-plan-decision",
    })
    const modeSnapshot = resolveOrchestrationModeSnapshotSync({
      getConfig: runtimeConfig,
      now: () => now,
    })
    const agentExecutionDecision = executionDecisionForTopology({
      selectedExecutorId: `${topology.id}:node:triage`,
      selectedConnectionPath: [`${topology.id}:node:intake`, `${topology.id}:node:triage`],
      title: "start-plan selected executor routing",
    })

    const startPlan = await buildStartPlan({
      message: "선택된 실행자가 바로 처리하게 해줘",
      sessionId: "session:task009-start-plan-decision",
      runId: "run:task009-start-plan-decision",
      source: "webui",
      taskProfile: "operations",
      agentExecutionDecision,
    }, {
      ...defaultStartPlanDependencies,
      resolveOrchestrationMode: async () => modeSnapshot,
      buildOrchestrationPlan: (input) => buildOrchestrationPlan({
        ...input,
        registrySnapshot: buildOrchestrationRegistrySnapshot({
          getConfig: runtimeConfig,
          now: () => now,
        }),
        now: () => now,
        idProvider: () => "plan:task009-start-plan-decision",
      }),
    })

    expect(startPlan.agentExecutionDecision).toBe(agentExecutionDecision)
    expect(startPlan.topologyRouting).toEqual(expect.objectContaining({
      mode: "route",
      reasonCode: "execution_decision_selected_executor",
      entryNodeId: "node:intake",
      selectedExecutorId: "node:triage",
      selectedConnectionPath: ["node:intake", "node:triage"],
    }))
  })

  it("routes the Telegram minesweeper reproduction prompt through saved topology instead of provider direct", async () => {
    useTempState()
    const topology = buildExampleEnterpriseTopology(now)
    const [entryNode, triageNode] = topology.nodes
    if (!entryNode || !triageNode) throw new Error("example topology fixture is missing base nodes")
    entryNode.name = "CTO"
    entryNode.displayName = "CTO"
    entryNode.description = "전체 요청을 분석하고 개발 업무를 위임하는 CTO 실행자"
    triageNode.name = "삼식이"
    triageNode.displayName = "삼식이"
    triageNode.description = "프론트엔드와 게임 UI 구현을 담당하는 실행자"
    topology.nodes.push(
      {
        ...structuredClone(triageNode),
        id: "node:executor-3",
        name: "마당쇠",
        displayName: "마당쇠",
        description: "파일 생성과 로컬 실행 조건을 점검하는 실행자",
        tags: ["coding", "filesystem"],
        children: [],
        allowedToolIds: [],
        allowedSystemIds: [],
      },
      {
        ...structuredClone(triageNode),
        id: "node:executor-4",
        name: "영수",
        displayName: "영수",
        description: "결과 검증과 사용자 응답 정리를 담당하는 실행자",
        tags: ["review", "verification"],
        children: [],
        allowedToolIds: [],
        allowedSystemIds: [],
      },
    )
    topology.teams[0]?.nodeIds.push("node:executor-3", "node:executor-4")
    createEnterpriseTopologyRegistry({ now: () => now }).appendTopologyVersion({
      topology,
      createdBy: "task009-telegram-repro",
    })
    const modeSnapshot = resolveOrchestrationModeSnapshotSync({
      getConfig: runtimeConfig,
      now: () => now,
    })

    const startPlan = await buildStartPlan({
      message: "다운도르 밑에 지뢰라는 폴더 만들고, 지뢰 찾기 게임 만들어줘",
      sessionId: "session:task009-telegram-repro",
      runId: "run:task009-telegram-repro",
      source: "telegram",
      taskProfile: "coding",
      agentExecutionDecision: executionDecisionForTopology({
        selectedExecutorId: `${topology.id}:node:intake`,
        selectedConnectionPath: [`${topology.id}:node:intake`],
        title: "telegram repro selected executor",
      }),
    }, {
      ...defaultStartPlanDependencies,
      resolveOrchestrationMode: async () => modeSnapshot,
      buildOrchestrationPlan: (input) => buildOrchestrationPlan({
        ...input,
        registrySnapshot: buildOrchestrationRegistrySnapshot({
          getConfig: runtimeConfig,
          now: () => now,
        }),
        now: () => now,
        idProvider: () => "plan:task009-telegram-repro",
      }),
    })

    expect(startPlan.orchestrationRegistrySnapshot.activeSubAgentCount).toBe(4)
    expect(startPlan.orchestrationRegistrySnapshot.activeSubAgents.map((agent) => ({
      displayName: agent.displayName,
      source: agent.source,
    }))).toEqual(expect.arrayContaining([
      { displayName: "CTO", source: "topology" },
      { displayName: "삼식이", source: "topology" },
      { displayName: "마당쇠", source: "topology" },
      { displayName: "영수", source: "topology" },
    ]))
    expect(startPlan.topologyRouting).toEqual(expect.objectContaining({
      mode: "route",
      topologyId: topology.id,
      entryNodeId: "node:intake",
    }))
    expect(startPlan.orchestrationPlanSnapshot.delegatedTasks).toHaveLength(1)
    expect(startPlan.orchestrationPlanSnapshot.delegatedTasks[0]?.assignedAgentId)
      .toMatch(new RegExp(`^${topology.id}:node:`))
    expect(startPlan.orchestrationPlanSnapshot.delegatedTasks.some((task) =>
      task.assignedAgentId?.startsWith("provider:"),
    )).toBe(false)
    expect(startPlan.orchestrationPlanSnapshot.fallbackStrategy.reasonCode)
      .not.toBe("no_eligible_agent_candidate")
  })

  it("projects the selected topology node and fallback explanation fields into Runtime Inspector", async () => {
    useTempState()
    const topology = buildExampleEnterpriseTopology(now)
    createEnterpriseTopologyRegistry({ now: () => now }).appendTopologyVersion({
      topology,
      createdBy: "task009-test",
    })
    const modeSnapshot = resolveOrchestrationModeSnapshotSync({
      getConfig: runtimeConfig,
      now: () => now,
    })
    const inspectorExecutionDecision = executionDecisionForTopology({
      selectedExecutorId: `${topology.id}:node:intake`,
      selectedConnectionPath: [`${topology.id}:node:intake`],
      title: "Runtime Inspector execution decision",
    })
    const startPlan = await buildStartPlan({
      message: "지뢰 찾기 게임 만들어줘",
      sessionId: "session:task009-inspector",
      runId: "run:task009-inspector",
      source: "telegram",
      taskProfile: "coding",
      agentExecutionDecision: inspectorExecutionDecision,
    }, {
      ...defaultStartPlanDependencies,
      resolveOrchestrationMode: async () => modeSnapshot,
      buildOrchestrationPlan: (input) => buildOrchestrationPlan({
        ...input,
        registrySnapshot: buildOrchestrationRegistrySnapshot({
          getConfig: runtimeConfig,
          now: () => now,
        }),
        now: () => now,
        idProvider: () => "plan:task009-inspector",
      }),
    })

    insertSession({
      id: "session:task009-inspector",
      source: "telegram",
      source_id: "telegram:task009",
      created_at: now,
      updated_at: now,
      summary: "task009 inspector",
    })
    createRootRun({
      id: "run:task009-inspector",
      sessionId: "session:task009-inspector",
      requestGroupId: "run:task009-inspector",
      prompt: "지뢰 찾기 게임 만들어줘",
      source: "telegram",
      taskProfile: "coding",
      orchestrationMode: "orchestration",
      promptSourceSnapshot: {
        orchestration: startPlan.orchestrationRegistrySnapshot,
        orchestrationPlan: startPlan.orchestrationPlanSnapshot,
        agentExecutionDecision: inspectorExecutionDecision,
        executionDecisionSource: "nobie_harness",
        topologyRouting: startPlan.topologyRouting,
      },
    })

    const run = getRootRun("run:task009-inspector")
    expect(run).toBeDefined()
    if (!run) return
    const projection = buildRunRuntimeInspectorProjection(run, { now })

    expect(projection.topologyRouting).toEqual(expect.objectContaining({
      mode: "route",
      topologyId: topology.id,
      entryNodeId: "node:intake",
      providerFallback: false,
      executionDecisionSource: "nobie_harness",
      executionDecisionSelectedExecutorId: `${topology.id}:node:intake`,
      executionDecisionRoute: "delegate_to_child",
      executionDecisionFallbackReason: "self_solve",
      riskBoundaryRequiresUserApproval: false,
      riskBoundaryReason: "테스트용 토폴로지 런타임 위임이며 외부 작업을 수행하지 않는다.",
    }))
    expect(projection.topologyRouting.selectedExecutorIds).toContain("node:intake")
    expect(projection.plan.taskSummaries).toEqual([
      expect.objectContaining({
        assignmentSource: "topology",
        assignedTopologyId: topology.id,
        assignedExecutorId: "node:intake",
      }),
    ])

    const delegatedTask = startPlan.orchestrationPlanSnapshot.delegatedTasks[0]
    expect(delegatedTask).toBeDefined()
    if (!delegatedTask) return
    const { assignedAgentId: _assignedAgentId, assignedTeamId: _assignedTeamId, ...directTask } = delegatedTask
    insertSession({
      id: "session:task009-fallback-inspector",
      source: "telegram",
      source_id: "telegram:task009-fallback",
      created_at: now,
      updated_at: now,
      summary: "task009 fallback inspector",
    })
    createRootRun({
      id: "run:task009-fallback-inspector",
      sessionId: "session:task009-fallback-inspector",
      requestGroupId: "run:task009-fallback-inspector",
      prompt: "토폴로지 없이 직접 실행해줘",
      source: "telegram",
      taskProfile: "coding",
      orchestrationMode: "orchestration",
      promptSourceSnapshot: {
        orchestration: startPlan.orchestrationRegistrySnapshot,
        orchestrationPlan: {
          ...startPlan.orchestrationPlanSnapshot,
          delegatedTasks: [],
          directNobieTasks: [{ ...directTask, executionKind: "direct_nobie" }],
          fallbackStrategy: {
            mode: "single_nobie",
            reasonCode: "active_topology_not_found",
          },
        },
        topologyRouting: {
          mode: "fallback",
          reasonCode: "active_topology_not_found",
          featureFlagMode: "off",
          activeTopologyCount: 0,
        },
      },
    })
    const fallbackRun = getRootRun("run:task009-fallback-inspector")
    expect(fallbackRun).toBeDefined()
    if (!fallbackRun) return
    const fallbackProjection = buildRunRuntimeInspectorProjection(fallbackRun, { now })
    expect(fallbackProjection.topologyRouting).toEqual(expect.objectContaining({
      mode: "fallback",
      reasonCode: "active_topology_not_found",
      providerFallback: true,
      providerFallbackReasonCode: "active_topology_not_found",
    }))
  })

  it("includes saved topology nodes in the planner registry with root direct-child hierarchy", () => {
    useTempState()
    const topology = buildExampleEnterpriseTopology(now)
    createEnterpriseTopologyRegistry({ now: () => now }).appendTopologyVersion({
      topology,
      createdBy: "task009-test",
    })

    const registry = buildOrchestrationRegistrySnapshot({
      getConfig: runtimeConfig,
      now: () => now,
    })

    expect(registry.agents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        agentId: `${topology.id}:node:intake`,
        source: "topology",
        status: "enabled",
        delegationEnabled: true,
      }),
      expect.objectContaining({
        agentId: `${topology.id}:node:triage`,
        source: "topology",
        status: "enabled",
        delegationEnabled: true,
      }),
    ]))
    expect(registry.hierarchy?.directChildrenByParent["agent:nobie"]).toEqual([
      `${topology.id}:node:intake`,
    ])
    expect(registry.hierarchy?.directChildrenByParent[`${topology.id}:node:intake`])
      .toEqual(expect.arrayContaining([`${topology.id}:node:triage`]))
  })

  it("still honors an explicit administrator topology runtime disable", () => {
    useTempState()
    const topology = buildExampleEnterpriseTopology(now)
    createEnterpriseTopologyRegistry({ now: () => now }).appendTopologyVersion({
      topology,
      createdBy: "task009-test",
    })
    const modeSnapshot = resolveOrchestrationModeSnapshotSync({
      getConfig: runtimeConfig,
      now: () => now,
    })

    const decision = resolveTopologyRootRunRouting({
      message: "지뢰 찾기 게임 만들어줘",
      runId: "run:task009-disabled",
      sessionId: "session:task009-disabled",
      source: "telegram",
      taskProfile: "coding",
      isRootRequest: true,
      orchestrationModeSnapshot: modeSnapshot,
      featureFlag: {
        featureKey: "topology_runtime_enabled",
        mode: "off",
        compatibilityMode: true,
        updatedAt: now,
        updatedBy: "admin",
        reason: "administrator disabled topology runtime",
        evidence: null,
        source: "db",
      },
    })

    expect(decision).toEqual(expect.objectContaining({
      mode: "fallback",
      reasonCode: "feature_flag_off",
    }))
  })

  it("keeps fallback paths explicit when topology is absent or the user picked a provider target", () => {
    useTempState()
    const modeSnapshot = resolveOrchestrationModeSnapshotSync({
      getConfig: runtimeConfig,
      now: () => now,
    })
    const enforcedFlag = {
      featureKey: "topology_runtime_enabled",
      mode: "enforced" as const,
      compatibilityMode: false,
      updatedAt: now,
      updatedBy: "task009-test",
      reason: "task009 fallback regression",
      evidence: null,
      source: "default" as const,
    }

    expect(resolveTopologyRootRunRouting({
      message: "지뢰 찾기 게임 만들어줘",
      runId: "run:task009-no-topology",
      sessionId: "session:task009-no-topology",
      source: "telegram",
      taskProfile: "coding",
      isRootRequest: true,
      orchestrationModeSnapshot: modeSnapshot,
      featureFlag: enforcedFlag,
    })).toEqual(expect.objectContaining({
      mode: "fallback",
      reasonCode: "active_topology_not_found",
    }))

    const topology = buildExampleEnterpriseTopology(now)
    createEnterpriseTopologyRegistry({ now: () => now }).appendTopologyVersion({
      topology,
      createdBy: "task009-test",
    })
    const topologyModeSnapshot = resolveOrchestrationModeSnapshotSync({
      getConfig: runtimeConfig,
      now: () => now,
    })
    expect(resolveTopologyRootRunRouting({
      message: "지뢰 찾기 게임 만들어줘",
      runId: "run:task009-provider-direct",
      sessionId: "session:task009-provider-direct",
      source: "telegram",
      targetId: "provider:openai",
      taskProfile: "coding",
      isRootRequest: true,
      orchestrationModeSnapshot: topologyModeSnapshot,
    })).toEqual(expect.objectContaining({
      mode: "fallback",
      reasonCode: "topology_routing_not_opted_in",
    }))
  })

  it("starts topology runtime from the execution decision and aggregates delegated child results", async () => {
    useTempState()
    const topology = buildExampleEnterpriseTopology(now)
    const triageNode = topology.nodes.find((node) => node.id === "node:triage")
    if (!triageNode) throw new Error("example topology fixture is missing node:triage")
    triageNode.children = ["node:review"]
    topology.nodes.push({
      ...structuredClone(triageNode),
      id: "node:review",
      name: "Result Review",
      displayName: "Result Review",
      description: "Reviews delegated output and returns a concise validation report.",
      tags: ["review", "aggregation"],
      children: [],
      allowedToolIds: [],
      allowedSystemIds: [],
    })
    topology.teams[0]?.nodeIds.push("node:review")
    topology.relations.push({
      schemaVersion: topology.schemaVersion,
      entityType: "relation",
      id: "relation:triage-review",
      name: "Triage delegates to review",
      status: "draft",
      createdAt: now,
      updatedAt: now,
      relationType: "delegates_to",
      from: { entityType: "node", id: "node:triage" },
      to: { entityType: "node", id: "node:review" },
    })
    const registry = createEnterpriseTopologyRegistry({ now: () => now })
    registry.appendTopologyVersion({
      topology,
      createdBy: "task009-execution-decision",
    })
    const modeSnapshot = resolveOrchestrationModeSnapshotSync({
      getConfig: runtimeConfig,
      now: () => now,
    })
    const executionDecision = executionDecisionForTopology({
      selectedExecutorId: "node:triage",
      selectedConnectionPath: ["node:intake", "node:triage"],
    })
    const routing = resolveTopologyRootRunRouting({
      message: "연결된 실행자에게 나눠서 처리해줘",
      runId: "run:task009-execution-decision",
      sessionId: "session:task009-execution-decision",
      source: "webui",
      taskProfile: "operations",
      isRootRequest: true,
      registry,
      orchestrationModeSnapshot: modeSnapshot,
      executionDecision,
    })

    expect(routing).toEqual(expect.objectContaining({
      mode: "route",
      reasonCode: "execution_decision_selected_executor",
      entryNodeId: "node:intake",
      selectedExecutorId: "node:triage",
      selectedConnectionPath: ["node:intake", "node:triage"],
    }))
    expect(routing).toEqual(expect.objectContaining({
      executionDecision,
    }))

    const result = await runTopologyRootRun({
      decision: routing as Extract<TopologyRootRunRoutingDecision, { mode: "route" }>,
      runId: "run:task009-execution-decision",
      sessionId: "session:task009-execution-decision",
      source: "webui",
      message: "연결된 실행자에게 나눠서 처리해줘",
      registry,
      now: () => now,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entryNodeId).toBe("node:intake")
    expect(result.runtimeResult.childDelegation?.results.map((entry) => entry.childNodeId))
      .toContain("node:triage")
    expect(result.runtimeResult.aggregation).toEqual(expect.objectContaining({
      workOrderId: `work-order:topology-run:run:task009-execution-decision:node:intake`,
    }))
    expect(result.runtimeResult.aggregation?.sources.map((source) => source.sourceId))
      .toEqual(expect.arrayContaining(["node:intake", "node:triage"]))
    expect(result.runtimeResult.validation).toEqual(expect.objectContaining({
      status: "partial_success",
    }))
    const tracePayloads = result.runtimeResult.traceEvents
      .map((event) => event.payload)
      .filter((payload): payload is NonNullable<typeof payload> => payload !== undefined)
    expect(tracePayloads).toEqual(expect.arrayContaining([
      expect.objectContaining({
        parent_run_id: "run:task009-execution-decision",
        delegating_executor_id: "node:triage",
        target_executor_id: "node:review",
        work_order_goal: "연결된 실행자에게 나눠서 처리해줘",
      }),
      expect.objectContaining({
        parent_run_id: "run:task009-execution-decision",
        delegating_executor_id: "node:intake",
        target_executor_id: "node:triage",
        validation_result: expect.objectContaining({
          status: "partial_success",
        }),
        aggregation_result: expect.objectContaining({
          source_executor_ids: expect.arrayContaining(["node:triage", "node:review"]),
        }),
      }),
    ]))
  })

  it("falls back when an execution decision selects a disconnected topology path", () => {
    useTempState()
    const topology = buildExampleEnterpriseTopology(now)
    const registry = createEnterpriseTopologyRegistry({ now: () => now })
    registry.appendTopologyVersion({
      topology,
      createdBy: "task009-disconnected-decision",
    })
    const modeSnapshot = resolveOrchestrationModeSnapshotSync({
      getConfig: runtimeConfig,
      now: () => now,
    })

    expect(resolveTopologyRootRunRouting({
      message: "연결되지 않은 실행자에게 보내줘",
      runId: "run:task009-disconnected-decision",
      sessionId: "session:task009-disconnected-decision",
      source: "webui",
      taskProfile: "operations",
      isRootRequest: true,
      registry,
      orchestrationModeSnapshot: modeSnapshot,
      executionDecision: executionDecisionForTopology({
        selectedExecutorId: "node:triage",
        selectedConnectionPath: ["node:triage"],
      }),
    })).toEqual(expect.objectContaining({
      mode: "fallback",
      reasonCode: "selected_executor_path_invalid",
      issues: expect.arrayContaining(["selected_path_must_start_at_root_child:node:intake"]),
    }))
  })

  it("cancels active child node runs when the parent topology run is cancelled", () => {
    useTempState()
    insertSession({
      id: "session:task009-cancel",
      source: "webui",
      source_id: "webui:task009-cancel",
      created_at: now,
      updated_at: now,
      summary: "task009 cancel",
    })
    createRootRun({
      id: "run:task009-cancel-root",
      sessionId: "session:task009-cancel",
      requestGroupId: "run:task009-cancel-root",
      prompt: "지뢰 찾기 게임 만들어줘",
      source: "webui",
      taskProfile: "coding",
    })
    createRootRun({
      id: "run:task009-cancel-child",
      sessionId: "session:task009-cancel",
      requestGroupId: "run:task009-cancel-root:sub-session:node-intake",
      lineageRootRunId: "run:task009-cancel-root",
      parentRunId: "run:task009-cancel-root",
      runScope: "child",
      targetId: "topology:example-enterprise:node:intake",
      targetLabel: "CTO",
      prompt: "delegated topology node task",
      source: "webui",
      taskProfile: "coding",
    })
    const parentController = new AbortController()
    const childController = new AbortController()
    bindActiveRunController("run:task009-cancel-root", parentController)
    bindActiveRunController("run:task009-cancel-child", childController)

    const cancelled = cancelRootRun("run:task009-cancel-root")

    expect(cancelled?.status).toBe("cancelled")
    expect(getRootRun("run:task009-cancel-child")?.status).toBe("cancelled")
    expect(parentController.signal.aborted).toBe(true)
    expect(childController.signal.aborted).toBe(true)
    expect(getRootRun("run:task009-cancel-child")?.recentEvents.map((event) => event.label))
      .toContain("취소 요청")
  })

  it("keeps permission and local runtime preflight ahead of topology execution", () => {
    useTempState()
    const topology = buildExampleEnterpriseTopology(now)
    createEnterpriseTopologyRegistry({ now: () => now }).appendTopologyVersion({
      topology,
      createdBy: "task009-test",
    })
    const modeSnapshot = resolveOrchestrationModeSnapshotSync({
      getConfig: runtimeConfig,
      now: () => now,
    })

    const routing = resolveTopologyRootRunRouting({
      message: "화면을 캡처해서 지금 상태를 확인해줘",
      runId: "run:task009-permission",
      sessionId: "session:task009-permission",
      source: "webui",
      taskProfile: "operations",
      isRootRequest: true,
      orchestrationModeSnapshot: modeSnapshot,
      executionDecision: executionDecisionForTopology({
        selectedExecutorId: `${topology.id}:node:intake`,
        selectedConnectionPath: [`${topology.id}:node:intake`],
        title: "permission preflight selected executor",
      }),
    })
    const contextPlan = resolveStartContextPlan({
      source: "webui",
      message: "화면을 캡처해서 지금 상태를 확인해줘",
      model: "gpt-test",
      providerId: "openai",
      toolsEnabled: true,
      executionSemantics: {
        filesystemEffect: "none",
        privilegedOperation: "required",
        artifactDelivery: "direct",
        approvalRequired: true,
        approvalTool: "screen_capture",
      },
    })

    expect(routing).toEqual(expect.objectContaining({
      mode: "route",
      topologyId: topology.id,
    }))
    expect(contextPlan.toolPolicy.requiresYeonjang).toBe(true)
    expect(contextPlan.preflightFailure).toEqual(expect.objectContaining({
      code: "yeonjang_unavailable",
    }))
  })
})
