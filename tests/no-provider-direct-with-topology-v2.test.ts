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
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-no-provider-direct-v2-"))
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

function activateExampleTopology(): void {
  const topology = buildExampleEnterpriseTopology(now)
  const registry = createEnterpriseTopologyRegistry({ now: () => now })
  const appended = registry.appendTopologyVersion({
    topology,
    createdBy: "no-provider-direct-with-topology-v2-test",
  })
  registry.activateTopologyVersion(topology.id, appended.version.version)
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

function taskIntakeResult(actionPayload: Record<string, unknown> = {}) {
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
      reason: "후속 실행",
      payload: {
        goal: "채널 요청을 처리한다.",
        ...actionPayload,
      },
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

function selfSolveDecision(context: AgentExecutionContext): AgentExecutionDecisionV2 {
  return {
    contract_version: AGENT_EXECUTION_DECISION_V2_CONTRACT_VERSION,
    current_executor_id: context.current_executor.executor_id,
    domain: "channel_request",
    behavior_pattern: "execute",
    action: "self_solve",
    selected_executor_ids: [],
    selected_connection_path: [],
    task_profile: {
      title: "직접 처리",
      summary: "적절한 direct child 후보가 없어 현재 실행자가 처리한다.",
      goals: ["provider direct fallback 금지"],
      task_units: [],
      success_criteria: ["후속 provider run을 만들지 않는다."],
    },
    required_outputs: [{ id: "answer", label: "최종 답변" }],
    risk_boundary: {
      requires_user_approval: false,
      reason: "테스트 요청이다.",
    },
    confidence: 0.44,
    reason: "명시 provider target이 없으므로 provider direct를 사용하지 않는다.",
  }
}

function moduleDependencies(input: {
  analyzeTaskIntake: () => unknown
  resolveRunRoute: ReturnType<typeof vi.fn>
  runAgentExecutionHarness?: ReturnType<typeof vi.fn>
}) {
  return {
    analyzeTaskIntake: vi.fn().mockResolvedValue(input.analyzeTaskIntake()),
    resolveRunRoute: input.resolveRunRoute,
    executeScheduleActions: vi.fn(),
    createDefaultScheduleActionDependencies: vi.fn(),
    inferDelegatedTaskProfile: vi.fn().mockReturnValue("general_chat"),
    buildFollowupPrompt: vi.fn().mockReturnValue("followup prompt"),
    buildExecutionGraphSnapshot,
    runAgentExecutionHarness: input.runAgentExecutionHarness ?? vi.fn((harnessInput) => runAgentExecutionHarness({
      ...harnessInput,
      callModel: async ({ context }) => JSON.stringify(selfSolveDecision(context)),
    })),
  }
}

describe("provider direct with topology v2", () => {
  it("does not create provider child runs for ordinary channel requests without an explicit provider target", async () => {
    useTempState()
    activateExampleTopology()
    const dependencies = createDependencies()
    const resolveRunRoute = vi.fn()

    const result = await runIntakeBridgePass({
      message: "일반 요청을 처리해줘",
      originalRequest: "일반 요청을 처리해줘",
      sessionId: "session:no-provider-v2",
      requestGroupId: "run:no-provider-v2",
      model: "gpt-test",
      workDir: "/tmp",
      source: "telegram",
      runId: "run:no-provider-v2",
      onChunk: undefined,
      reuseConversationContext: false,
    }, dependencies, moduleDependencies({
      analyzeTaskIntake: () => taskIntakeResult(),
      resolveRunRoute,
    }))

    expect(result).toBeNull()
    expect(resolveRunRoute).not.toHaveBeenCalled()
    expect(dependencies.startDelegatedRun).not.toHaveBeenCalled()
    expect(dependencies.appendRunEvent).toHaveBeenCalledWith(
      "run:no-provider-v2",
      "execution_decision_fallback:self_solve; provider_direct_blocked_without_explicit_target",
    )
  })

  it("allows provider routing only when the channel request carries an explicit provider target", async () => {
    useTempState()
    activateExampleTopology()
    const dependencies = createDependencies()
    const resolveRunRoute = vi.fn().mockReturnValue({
      targetId: "provider:openai",
      targetLabel: "OpenAI",
      providerId: "openai",
      model: "gpt-test",
      reason: "explicit provider target",
    })
    const decisionHarness = vi.fn()

    const result = await runIntakeBridgePass({
      message: "openai로 처리해줘",
      originalRequest: "openai로 처리해줘",
      sessionId: "session:explicit-provider-v2",
      requestGroupId: "run:explicit-provider-v2",
      model: "gpt-test",
      workDir: "/tmp",
      source: "telegram",
      runId: "run:explicit-provider-v2",
      onChunk: undefined,
      reuseConversationContext: false,
    }, dependencies, moduleDependencies({
      analyzeTaskIntake: () => taskIntakeResult({ preferred_target: "provider:openai" }),
      resolveRunRoute,
      runAgentExecutionHarness: decisionHarness,
    }))

    expect(result?.kind).toBe("complete_silent")
    expect(resolveRunRoute).toHaveBeenCalledWith(expect.objectContaining({
      preferredTarget: "provider:openai",
    }))
    expect(decisionHarness).not.toHaveBeenCalled()
    expect(dependencies.startDelegatedRun).toHaveBeenCalledWith(expect.objectContaining({
      targetId: "provider:openai",
      targetLabel: "OpenAI",
      providerId: "openai",
    }))
  })
})
