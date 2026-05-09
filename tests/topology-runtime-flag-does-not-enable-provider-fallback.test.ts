import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AgentExecutionContext } from "../packages/core/src/orchestration/execution-decision-contract.ts"
import { runAgentExecutionHarness } from "../packages/core/src/orchestration/execution-harness.ts"
import {
  buildExampleEnterpriseTopology,
  createEnterpriseTopologyRegistry,
} from "../packages/core/src/index.ts"
import { reloadConfig } from "../packages/core/src/config/index.ts"
import { closeDb } from "../packages/core/src/db/index.js"
import { runIntakeBridgePass } from "../packages/core/src/runs/intake-bridge-pass.ts"

const now = Date.UTC(2026, 4, 7, 13, 0, 0)
const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-topology-flag-provider-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json")
  writeFileSync(process.env.NOBIE_CONFIG, JSON.stringify({
    orchestration: {
      maxDelegationTurns: 5,
      mode: "orchestration",
      featureFlagEnabled: false,
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

function taskIntakeResult() {
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

describe("topology runtime flag provider fallback guard", () => {
  it("keeps direct child candidates and does not call provider routing when topology runtime is off", async () => {
    useTempState()
    const topology = buildExampleEnterpriseTopology(now)
    const registry = createEnterpriseTopologyRegistry({ now: () => now })
    const appended = registry.appendTopologyVersion({
      topology,
      createdBy: "topology-runtime-flag-provider-test",
    })
    registry.activateTopologyVersion(topology.id, appended.version.version)
    const dependencies = createDependencies()
    const resolveRunRoute = vi.fn()
    let capturedContext: AgentExecutionContext | undefined

    const result = await runIntakeBridgePass({
      message: "저장된 실행자 기준으로 판단해줘",
      originalRequest: "저장된 실행자 기준으로 판단해줘",
      sessionId: "session:flag-off",
      requestGroupId: "run:flag-off",
      model: "gpt-test",
      workDir: "/tmp",
      source: "telegram",
      runId: "run:flag-off",
      onChunk: undefined,
      reuseConversationContext: false,
    }, dependencies, {
      analyzeTaskIntake: vi.fn().mockResolvedValue(taskIntakeResult()),
      resolveRunRoute,
      executeScheduleActions: vi.fn(),
      createDefaultScheduleActionDependencies: vi.fn(),
      inferDelegatedTaskProfile: vi.fn().mockReturnValue("general_chat"),
      buildFollowupPrompt: vi.fn().mockReturnValue("[Task Intake Bridge]\nflag off"),
      runAgentExecutionHarness: (input) => {
        capturedContext = input.context
        return runAgentExecutionHarness(input)
      },
    })

    expect(result).toEqual(expect.objectContaining({
      kind: "awaiting_user",
      eventLabel: "execution decision 사용자 확인 대기",
      reason: "No execution decision model caller was provided.",
    }))
    expect(resolveRunRoute).not.toHaveBeenCalled()
    expect(dependencies.startDelegatedRun).not.toHaveBeenCalled()
    expect(capturedContext?.execution_graph?.available_executor_ids).toEqual([
      `${topology.id}:node:intake`,
    ])
    expect(capturedContext?.accessible_executors.map((executor) => executor.executor_id)).toEqual([
      `${topology.id}:node:intake`,
    ])
  })
})
