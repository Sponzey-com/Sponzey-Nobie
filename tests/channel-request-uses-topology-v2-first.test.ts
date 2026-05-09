import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.ts"
import { closeDb } from "../packages/core/src/db/index.js"
import {
  AGENT_EXECUTION_DECISION_V2_CONTRACT_VERSION,
  type AgentExecutionContext,
  type AgentExecutionDecisionV2,
} from "../packages/core/src/orchestration/execution-decision-contract.ts"
import {
  buildExecutionGraphSnapshot,
} from "../packages/core/src/orchestration/execution-graph-snapshot.ts"
import { runAgentExecutionHarness } from "../packages/core/src/orchestration/execution-harness.ts"
import {
  buildExampleEnterpriseTopology,
  createEnterpriseTopologyRegistry,
} from "../packages/core/src/index.ts"
import { runIntakeBridgePass } from "../packages/core/src/runs/intake-bridge-pass.ts"

const now = Date.UTC(2026, 4, 8, 0, 0, 0)
const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-channel-topology-v2-first-"))
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

function activateExampleTopology(): { topologyId: string; selectedExecutorId: string } {
  const topology = buildExampleEnterpriseTopology(now)
  const registry = createEnterpriseTopologyRegistry({ now: () => now })
  const appended = registry.appendTopologyVersion({
    topology,
    createdBy: "channel-request-uses-topology-v2-first-test",
  })
  registry.activateTopologyVersion(topology.id, appended.version.version)
  return {
    topologyId: topology.id,
    selectedExecutorId: `${topology.id}:node:intake`,
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
      confidence: 0.9,
    },
    user_message: {
      mode: "accepted_receipt" as const,
      text: "요청을 접수했습니다.",
    },
    action_items: [{
      id: "run-task-1",
      type: "run_task" as const,
      title: "채널 요청 처리",
      priority: "normal" as const,
      reason: "위임 실행이 필요합니다.",
      payload: { goal: "채널 요청을 처리한다." },
    }],
    structured_request: {
      source_language: "ko" as const,
      normalized_english: "Handle the channel request.",
      target: "채널 요청",
      to: "channel",
      context: ["채널 요청"],
      complete_condition: ["결과 전달"],
    },
    intent_envelope: {
      intent_type: "task_intake" as const,
      source_language: "ko" as const,
      normalized_english: "Handle the channel request.",
      target: "채널 요청",
      destination: "channel",
      context: ["채널 요청"],
      complete_condition: ["결과 전달"],
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

function v2Decision(context: AgentExecutionContext, selectedExecutorId: string): AgentExecutionDecisionV2 {
  return {
    contract_version: AGENT_EXECUTION_DECISION_V2_CONTRACT_VERSION,
    current_executor_id: context.current_executor.executor_id,
    domain: "channel_request",
    behavior_pattern: "delegate",
    action: "delegate",
    selected_executor_ids: [selectedExecutorId],
    selected_connection_path: [selectedExecutorId],
    task_profile: {
      title: "채널 요청 처리",
      summary: "현재 채널 요청을 direct child 실행자에게 위임한다.",
      goals: ["위임 실행", "결과 반환"],
      task_units: [],
      success_criteria: ["direct child 실행자에게만 위임된다."],
    },
    task_split: [{
      executor_id: selectedExecutorId,
      objective: "채널 요청을 처리하고 결과를 반환한다.",
      expected_return: "처리 결과",
    }],
    required_outputs: [{ id: "answer", label: "최종 답변" }],
    risk_boundary: {
      requires_user_approval: false,
      reason: "테스트 요청이다.",
    },
    confidence: 0.9,
    reason: "선택된 실행자가 현재 노비의 direct child이다.",
  }
}

describe("channel request topology v2 first routing", () => {
  it("runs the topology execution decision before creating a child run", async () => {
    useTempState()
    const { selectedExecutorId } = activateExampleTopology()
    const dependencies = createDependencies()
    const resolveRunRoute = vi.fn()
    const buildGraph = vi.fn((input) => buildExecutionGraphSnapshot(input))
    const decisionHarness = vi.fn((input) => runAgentExecutionHarness({
      ...input,
      callModel: async ({ context }) => JSON.stringify(v2Decision(context, selectedExecutorId)),
    }))

    const result = await runIntakeBridgePass({
      message: "요청을 처리해줘",
      originalRequest: "요청을 처리해줘",
      sessionId: "session:topology-v2-first",
      requestGroupId: "run:topology-v2-first",
      model: "gpt-test",
      workDir: "/tmp",
      source: "telegram",
      runId: "run:topology-v2-first",
      onChunk: undefined,
      reuseConversationContext: false,
    }, dependencies, {
      analyzeTaskIntake: vi.fn().mockResolvedValue(taskIntakeResult()),
      resolveRunRoute,
      executeScheduleActions: vi.fn(),
      createDefaultScheduleActionDependencies: vi.fn(),
      inferDelegatedTaskProfile: vi.fn().mockReturnValue("general_chat"),
      buildFollowupPrompt: vi.fn().mockReturnValue("followup prompt"),
      buildExecutionGraphSnapshot: buildGraph,
      runAgentExecutionHarness: decisionHarness,
    })

    expect(result?.kind).toBe("complete_silent")
    expect(resolveRunRoute).not.toHaveBeenCalled()
    expect(buildGraph).toHaveBeenCalled()
    expect(decisionHarness).toHaveBeenCalled()
    expect(dependencies.startDelegatedRun).toHaveBeenCalledTimes(1)
    expect(buildGraph.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.startDelegatedRun.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
    expect(dependencies.startDelegatedRun).toHaveBeenCalledWith(expect.objectContaining({
      targetId: selectedExecutorId,
      agentExecutionDecision: expect.objectContaining({
        execution_route: "delegate_to_child",
        selected_executor_id: selectedExecutorId,
      }),
      agentExecutionDecisionTrace: expect.objectContaining({
        available_executor_ids: expect.arrayContaining([selectedExecutorId]),
        selected_executor_id: selectedExecutorId,
      }),
    }))
    expect(dependencies.recordExecutionDecisionTrace).toHaveBeenCalledWith(expect.objectContaining({
      agentExecutionDecision: expect.objectContaining({
        execution_route: "delegate_to_child",
        selected_executor_id: selectedExecutorId,
      }),
    }))
  })
})
