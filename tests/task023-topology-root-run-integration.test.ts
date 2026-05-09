import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import {
  closeDb,
  insertSession,
  listMessageLedgerEvents,
} from "../packages/core/src/db/index.js"
import {
  TOPOLOGY_RUNTIME_FEATURE_KEY,
  AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
  buildExampleEnterpriseTopology,
  createEnterpriseTopologyRegistry,
  listTopologyRuns,
  resolveTopologyRootRunRouting,
  runTopologyRootRun,
  setFeatureFlagMode,
  type EnterpriseTopology,
  type AgentExecutionDecision,
  type TopologyRootRunRoutingDecision,
} from "../packages/core/src/index.ts"
import {
  buildStartPlan,
  defaultStartPlanDependencies,
} from "../packages/core/src/runs/start-plan.ts"
import { buildStartRootRunDriverDependencies } from "../packages/core/src/runs/start-driver-dependencies.ts"
import { executeRootRunDriver } from "../packages/core/src/runs/root-run-driver.ts"
import {
  bindActiveRunController,
  clearActiveRunController,
  createRootRun,
  getRootRun,
} from "../packages/core/src/runs/store.ts"

const now = Date.UTC(2026, 3, 30, 13, 0, 0)
const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task023-topology-root-run-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
}

function topologyFixture(): EnterpriseTopology {
  return structuredClone(buildExampleEnterpriseTopology(now))
}

function enableTopologyRuntime(): void {
  setFeatureFlagMode({
    featureKey: TOPOLOGY_RUNTIME_FEATURE_KEY,
    mode: "enforced",
    compatibilityMode: false,
    updatedBy: "task023-test",
    now,
  })
}

function activateTopology(topology: EnterpriseTopology = topologyFixture()) {
  const registry = createEnterpriseTopologyRegistry({ now: () => now })
  const appended = registry.appendTopologyVersion({
    topology,
    createdBy: "task023-test",
  })
  const activation = registry.activateTopologyVersion(topology.id, appended.version.version)
  expect(activation.ok).toBe(true)
  return { registry, topology, appended, activation }
}

function executionDecision(selectedExecutorId = "node:intake"): AgentExecutionDecision {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    current_executor_id: "agent:nobie",
    domain: "task023_topology_root_run",
    behavior_pattern: "delegate",
    execution_route: "delegate_to_child",
    selected_executor_id: selectedExecutorId,
    selected_connection_path: [selectedExecutorId],
    task_profile: {
      title: "토폴로지 루트 실행",
      summary: "검증된 실행자 선택만 토폴로지 루트 실행으로 승격한다.",
      goals: ["선택된 실행자가 사용자 요청을 처리한다."],
      task_units: [{
        id: "task023-entry",
        title: "선택된 실행자 처리",
        goal: "선택된 토폴로지 실행자가 결과를 만든다.",
        preferred_executor_id: selectedExecutorId,
      }],
      success_criteria: ["컴파일된 기본 엔트리에 의존하지 않는다."],
    },
    required_outputs: [{
      id: "answer",
      label: "사용자에게 전달할 처리 결과",
    }],
    risk_boundary: {
      requires_user_approval: false,
      reason: "테스트용 실행자 선택",
    },
    confidence: 0.99,
    fallback_if_unavailable: "direct_current_agent",
    reason: "테스트가 선택한 실행자를 토폴로지 런타임에 전달합니다.",
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

describe("task023 topology root-run opt-in integration", () => {
  it("keeps the existing path when the topology feature flag is off", () => {
    useTempState()
    const { topology } = activateTopology()
    const decision = resolveTopologyRootRunRouting({
      message: "topology:customer-success 고객 요청 업무 처리",
      runId: "run:flag-off",
      sessionId: "session:task023",
      source: "webui",
      targetId: topology.id,
      isRootRequest: true,
    })

    expect(decision).toEqual(expect.objectContaining({
      mode: "fallback",
      reasonCode: "feature_flag_off",
      explicitTopologyId: topology.id,
    }))
  })

  it("falls back when no active topology can be selected", async () => {
    useTempState()
    enableTopologyRuntime()
    const plan = await buildStartPlan({
      message: "고객 응대 workflow를 처리해줘",
      sessionId: "session:no-active",
      runId: "run:no-active",
      source: "webui",
      taskProfile: "operations",
    }, defaultStartPlanDependencies)

    expect(plan.topologyRouting).toEqual(expect.objectContaining({
      mode: "fallback",
      reasonCode: "active_topology_not_found",
    }))
    expect(plan.orchestrationMode).toBe("single_nobie")
  })

  it("does not route explicit topology targets without a selected executor", async () => {
    useTempState()
    enableTopologyRuntime()
    const { topology } = activateTopology()
    const plan = await buildStartPlan({
      message: "이 요청은 topology:customer-success 로 처리해줘",
      sessionId: "session:explicit",
      runId: "run:explicit",
      source: "webui",
      targetId: topology.id,
    }, defaultStartPlanDependencies)

    expect(plan.topologyRouting).toEqual(expect.objectContaining({
      mode: "fallback",
      reasonCode: "selected_executor_missing",
      explicitTopologyId: topology.id,
    }))
  })

  it("runs the active topology node contract without creating a temporary Role agent", async () => {
    useTempState()
    enableTopologyRuntime()
    const { topology } = activateTopology()
    const decision = resolveTopologyRootRunRouting({
      message: "topology:customer-success 고객 요청 triage",
      runId: "run:harness",
      sessionId: "session:harness",
      source: "webui",
      targetId: topology.id,
      isRootRequest: true,
      executionDecision: executionDecision("node:intake"),
    })
    expect(decision.mode).toBe("route")

    const result = await runTopologyRootRun({
      decision: decision as Extract<TopologyRootRunRoutingDecision, { mode: "route" }>,
      runId: "run:harness",
      sessionId: "session:harness",
      source: "webui",
      message: "고객 요청 triage",
      now: () => now,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entryNodeId).toBe("node:intake")
    expect(result.runtimeResult.envelope.subSessionCommandRequest.targetAgentId).toBe("node:intake")
    expect(result.runtimeResult.envelope.subSessionCommandRequest.targetAgentId).not.toMatch(/role|agent:role/i)
    expect(result.persistence.topologyRunId).toBe("topology-run:run:harness")
    expect(listTopologyRuns({ rootRunId: "run:harness" })).toEqual([
      expect.objectContaining({
        topologyRunId: "topology-run:run:harness",
        rootRunId: "run:harness",
        entryNodeId: "node:intake",
      }),
    ])
  })

  it("completes a root run through topology runtime and delivers a Nobie final answer", async () => {
    useTempState()
    enableTopologyRuntime()
    const { topology } = activateTopology()
    const decision = resolveTopologyRootRunRouting({
      message: "topology:customer-success 고객 요청 workflow를 처리해줘",
      runId: "run:topology-final",
      sessionId: "session:topology-final",
      source: "webui",
      targetId: topology.id,
      isRootRequest: true,
      executionDecision: executionDecision("node:intake"),
    })
    expect(decision.mode).toBe("route")
    insertSession({
      id: "session:topology-final",
      source: "webui",
      source_id: "task023",
      created_at: now,
      updated_at: now,
      summary: "task023 topology final",
    })
    createRootRun({
      id: "run:topology-final",
      sessionId: "session:topology-final",
      requestGroupId: "run:topology-final",
      prompt: "topology:customer-success 고객 요청 workflow를 처리해줘",
      source: "webui",
      targetId: topology.id,
      contextMode: "isolated",
      taskProfile: "operations",
      promptSourceSnapshot: { topologyRouting: decision },
      maxDelegationTurns: 3,
    })
    const chunks: Array<{ type?: string; delta?: string }> = []
    const controller = new AbortController()
    bindActiveRunController("run:topology-final", controller)
    const { driverDependencies, syntheticApprovalRuntimeDependencies } = buildStartRootRunDriverDependencies({
      runId: "run:topology-final",
      sessionId: "session:topology-final",
      requestGroupId: "run:topology-final",
      source: "webui",
      onChunk: (chunk) => {
        chunks.push(chunk)
        return undefined
      },
      message: "topology:customer-success 고객 요청 workflow를 처리해줘",
      model: undefined,
      workDir: process.cwd(),
      reuseConversationContext: false,
      activeQueueCancellationMode: null,
      startNestedRootRun: (() => ({ finished: Promise.resolve(undefined) })) as never,
      syntheticApprovalScopes: new Set(),
      logInfo: () => undefined,
      logWarn: () => undefined,
      logError: () => undefined,
    })
    await executeRootRunDriver({
      runId: "run:topology-final",
      sessionId: "session:topology-final",
      requestGroupId: "run:topology-final",
      source: "webui",
      onChunk: (chunk) => {
        chunks.push(chunk)
        return undefined
      },
      controller,
      message: "topology:customer-success 고객 요청 workflow를 처리해줘",
      currentModel: undefined,
      currentProviderId: undefined,
      currentProvider: undefined,
      currentTargetId: topology.id,
      currentTargetLabel: topology.name,
      workDir: process.cwd(),
      reconnectNeedsClarification: false,
      queuedBehindRequestGroupRun: false,
      activeWorkerRuntime: undefined,
      isRootRequest: true,
      contextMode: "isolated",
      taskProfile: "operations",
      topologyRouting: decision as Extract<TopologyRootRunRoutingDecision, { mode: "route" }>,
      syntheticApprovalRuntimeDependencies,
      defaultMaxDelegationTurns: 3,
    }, driverDependencies, {
      createExecutionLoopRuntimeState: ((input: { message: string }) => ({
        originalUserRequest: input.message,
        executionProfile: {
          structuredRequest: undefined,
          executionSemantics: undefined,
          wantsDirectArtifactDelivery: false,
        },
        requiresFilesystemMutation: false,
        requiresPrivilegedToolExecution: false,
        pendingToolParams: [],
        filesystemMutationPaths: [],
        seenFollowupPrompts: new Set(),
        seenCommandFailureRecoveryKeys: new Set(),
        seenExecutionRecoveryKeys: new Set(),
        seenDeliveryRecoveryKeys: new Set(),
        seenAiRecoveryKeys: new Set(),
        recoveryBudgetUsage: {},
        priorAssistantMessages: [],
        message: input.message,
      })) as never,
      prepareRootLoopLaunch: (() => ({
        rootLoopParams: {},
        rootLoopDependencies: {},
      })) as never,
      runRootLoop: vi.fn() as never,
      applyRootRunDriverFailure: vi.fn() as never,
      runTopologyRootRun,
    })
    clearActiveRunController("run:topology-final")
    const run = getRootRun("run:topology-final")
    const ledger = listMessageLedgerEvents({ runId: "run:topology-final", limit: 100 })

    expect(run).toEqual(expect.objectContaining({
      id: "run:topology-final",
      status: "completed",
      summary: expect.stringContaining("active Enterprise Topology"),
    }))
    expect(chunks.some((chunk) => chunk.type === "text" && chunk.delta?.includes("Nobie final answer"))).toBe(true)
    expect(ledger.map((event) => event.event_kind)).toContain("final_answer_delivered")
    expect(listTopologyRuns({ rootRunId: "run:topology-final" })).toEqual([
      expect.objectContaining({
        topologyId: "topology:customer-success",
        rootRunId: "run:topology-final",
      }),
    ])
  })

  it("falls back to the existing root loop when topology runtime fails", async () => {
    const runRootLoop = vi.fn(async () => undefined)
    const appendRunEvent = vi.fn()
    const updateRunSummary = vi.fn()
    const setRunStepStatus = vi.fn()
    await executeRootRunDriver({
      runId: "run:fallback",
      sessionId: "session:fallback",
      requestGroupId: "run:fallback",
      source: "webui",
      onChunk: undefined,
      controller: new AbortController(),
      message: "topology:customer-success 실패 fallback",
      currentModel: undefined,
      currentProviderId: undefined,
      currentProvider: undefined,
      currentTargetId: "topology:customer-success",
      currentTargetLabel: "Customer Success",
      workDir: process.cwd(),
      reconnectNeedsClarification: false,
      queuedBehindRequestGroupRun: false,
      activeWorkerRuntime: undefined,
      isRootRequest: true,
      contextMode: "isolated",
      taskProfile: "operations",
      topologyRouting: {
        mode: "route",
        reasonCode: "explicit_topology_target",
        featureFlagMode: "enforced",
        topologyId: "topology:customer-success",
        topologyName: "Customer Success Topology",
        topologyVersion: 1,
        topologyVersionId: "topology-version:customer-success:1",
        compiledTopologySnapshotId: "compiled:task023",
        entryNodeId: "node:intake",
        selectedExecutorId: "node:intake",
        selectedConnectionPath: ["node:intake"],
        availableDirectChildExecutorIds: ["topology:customer-success:node:intake"],
        entrySelection: "execution_decision",
        explicit: true,
      },
      syntheticApprovalRuntimeDependencies: {} as never,
      defaultMaxDelegationTurns: 3,
    }, {
      appendRunEvent,
      updateRunSummary,
      setRunStepStatus,
      updateRunStatus: vi.fn(),
      rememberRunFailure: vi.fn(),
      incrementDelegationTurnCount: vi.fn(),
      markAbortedRunCancelledIfActive: vi.fn(),
      getDelegationTurnState: () => ({ usedTurns: 0, maxTurns: 3 }),
      getFinalizationDependencies: vi.fn(),
      insertMessage: vi.fn(),
      writeReplyLog: vi.fn(),
      createId: () => "id",
      now: () => now,
      runVerificationSubtask: vi.fn(),
      rememberRunApprovalScope: vi.fn(),
      grantRunApprovalScope: vi.fn(),
      grantRunSingleApproval: vi.fn(),
      executeLoopDirective: vi.fn(),
      tryHandleActiveQueueCancellation: vi.fn(async () => null),
      tryHandleIntakeBridge: vi.fn(async () => null),
      getSyntheticApprovalAlreadyApproved: () => false,
    }, {
      createExecutionLoopRuntimeState: ((input: unknown) => ({
        originalUserRequest: "topology failure",
        executionProfile: {
          structuredRequest: undefined,
          executionSemantics: undefined,
          wantsDirectArtifactDelivery: false,
        },
        requiresFilesystemMutation: false,
        requiresPrivilegedToolExecution: false,
        pendingToolParams: [],
        filesystemMutationPaths: [],
        seenFollowupPrompts: new Set(),
        seenCommandFailureRecoveryKeys: new Set(),
        seenExecutionRecoveryKeys: new Set(),
        seenDeliveryRecoveryKeys: new Set(),
        seenAiRecoveryKeys: new Set(),
        recoveryBudgetUsage: {},
        priorAssistantMessages: [],
        message: (input as { message: string }).message,
      })) as never,
      prepareRootLoopLaunch: (() => ({
        rootLoopParams: {},
        rootLoopDependencies: {},
      })) as never,
      runRootLoop: runRootLoop as never,
      applyRootRunDriverFailure: vi.fn() as never,
      runTopologyRootRun: vi.fn(async () => ({
        ok: false,
        reasonCode: "topology_runtime_failed",
        fallbackSummary: "Topology failed; existing path should continue.",
        issues: ["forced_failure"],
      })) as never,
    })

    expect(appendRunEvent).toHaveBeenCalledWith("run:fallback", expect.stringContaining("topology_runtime_fallback"))
    expect(updateRunSummary).toHaveBeenCalledWith("run:fallback", "Topology failed; existing path should continue.")
    expect(runRootLoop).toHaveBeenCalledTimes(1)
  })
})
