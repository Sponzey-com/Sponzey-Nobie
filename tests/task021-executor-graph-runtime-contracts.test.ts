import { createRequire } from "node:module"
import { describe, expect, it } from "vitest"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.ts"
import type {
  CommandRequest,
  ExpectedOutputContract,
  StructuredTaskScope,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import {
  createExecutorDraftFromInference,
  inferExecutorTaskAnalysis,
} from "../packages/core/src/topology/executor-inference.ts"
import {
  createExecutorConnectionDraft,
} from "../packages/core/src/topology/executor-relation-inference.ts"
import {
  EXECUTOR_GRAPH_SOURCE_OF_TRUTH,
  type ExecutorConnectionDraft,
  type ExecutorDraft,
  type ExecutorGraphWorkspace,
} from "../packages/core/src/topology/executor-graph.ts"
import { buildNodeTaskAnalysis } from "../packages/core/src/topology/executor-task-analysis.ts"
import {
  type DelegationCandidate,
  delegationCandidatesFromRegistry,
  resolveNodeDelegation,
  validateDelegationPath,
} from "../packages/core/src/topology/executor-delegation-resolution.ts"
import { buildGraphExecutionPlan } from "../packages/core/src/topology/graph-execution-plan.ts"
import {
  assertVisibleUserWorkOrder,
  buildWorkOrderFromNodeExecutionPlan,
  readGraphWorkOrderMetadata,
  simulateGraphExecutionPlan,
} from "../packages/core/src/topology/graph-execution-runner.ts"
import {
  getGraphExecutionPlan,
  persistGraphExecutionEvents,
  persistGraphExecutionPlan,
  persistRecoveryStrategyAttempt,
} from "../packages/core/src/topology/graph-execution-store.ts"
import { createGraphCancellationController } from "../packages/core/src/topology/graph-cancellation.ts"
import {
  createDefaultExecutionPolicySnapshot,
  normalizeFailureReason,
} from "../packages/core/src/runs/execution-policy.ts"
import {
  chooseRecoveryAlternative,
} from "../packages/core/src/runs/recovery-controller.ts"
import {
  RECOVERY_STRATEGY_CHANGE_AXES,
  createRecoveryStrategyLedger,
  recordRecoveryStrategyAttempt,
  type RecoveryStrategyKey,
} from "../packages/core/src/runs/recovery-strategy-ledger.ts"
import { guardTerminalFailure } from "../packages/core/src/runs/terminal-failure-guard.ts"
import { validateVisibleTopologySubSessionCommand } from "../packages/core/src/orchestration/sub-session-runner.ts"
import { runMigrations } from "../packages/core/src/db/migrations.ts"
import { verifyMigrationState } from "../packages/core/src/db/migration-safety.ts"

type SqliteStatement = {
  run(...args: unknown[]): unknown
  all(...args: unknown[]): unknown[]
  get(...args: unknown[]): unknown
}

type SqliteDatabase = {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  transaction<T extends (...args: never[]) => unknown>(fn: T): T
  close(): void
}

type BetterSqlite3Factory = new (filename: string) => SqliteDatabase

const require = createRequire(import.meta.url)
const BetterSqlite3 = require("../packages/core/node_modules/better-sqlite3") as BetterSqlite3Factory

const now = "2026-05-04T10:00:00.000Z"

describe("phase021 executor graph runtime contracts", () => {
  it("builds NodeTaskAnalysis with goals, task units, completion condition, and safe alternatives", () => {
    const executor = createExecutor("node:frontend", "프론트엔드 엔지니어", "React 화면을 구현하고 테스트 결과를 정리한다.")
    const analysis = buildNodeTaskAnalysis({ executor, now })

    expect(analysis.executorId).toBe("node:frontend")
    expect(analysis.purpose).toContain("React")
    expect(analysis.goals.length).toBeGreaterThanOrEqual(2)
    expect(analysis.taskUnits.length).toBeGreaterThanOrEqual(2)
    expect(analysis.completionCondition).toBeTruthy()
    expect(analysis.safeAlternatives.map((alternative) => alternative.changedDimension)).toEqual(
      expect.arrayContaining(["task_split", "fallback_route"]),
    )
  })

  it("extends executor inference into task analysis with connection context", () => {
    const source = createExecutor("node:intake", "접수 담당자", "사용자 요청을 정리한다.")
    const target = createExecutor("node:frontend", "프론트엔드 엔지니어", "React 화면을 구현하고 테스트한다.")
    const connection = createExecutorConnectionDraft({ source, target })
    const analysis = inferExecutorTaskAnalysis({
      executor: target,
      incomingConnections: [connection],
      now,
      source: "rule_based",
    })

    expect(analysis.executorId).toBe("node:frontend")
    expect(analysis.inputNeeds).toEqual(expect.arrayContaining([
      expect.stringContaining("node:intake"),
    ]))
    expect(analysis.requiredCapabilities.length).toBeGreaterThan(0)
    expect(analysis.requiredTools).toEqual(target.inferredTools)
  })

  it("resolves node delegation to matching visible sub-agent candidates and preserves busy candidates as fallback input", () => {
    const executor = createExecutor("node:frontend", "프론트엔드 엔지니어", "프론트엔드 구현을 담당한다.")
    const analysis = buildNodeTaskAnalysis({ executor, now })
    const candidates: DelegationCandidate[] = [
      {
        targetId: "agent:busy-frontend",
        targetLabel: "바쁜 프론트엔드 에이전트",
        targetType: "agent",
        matchedCapabilities: ["업무 처리"],
        missingCapabilities: [],
        confidence: 0.98,
        availability: "busy",
      },
      {
        targetId: "agent:frontend",
        targetLabel: "프론트엔드 에이전트",
        targetType: "agent",
        matchedCapabilities: ["업무 처리"],
        missingCapabilities: [],
        confidence: 0.84,
        availability: "available",
      },
    ]
    const resolution = resolveNodeDelegation({
      executorId: executor.id,
      taskAnalysis: analysis,
      candidates,
      now,
    })

    expect(resolution.selectedRoute).toBe("sub_agent")
    expect(resolution.selectedTargetId).toBe("agent:frontend")
    expect(resolution.visibility).toBe("visible_node")
    expect(resolution.candidateTargets.map((candidate) => candidate.availability)).toContain("busy")
  })

  it("validates selected delegation paths against the execution graph snapshot", () => {
    const executor = createExecutor("node:backend", "백엔드 엔지니어", "백엔드 구현을 담당한다.")
    const analysis = buildNodeTaskAnalysis({ executor, now })
    const graphSnapshot = {
      currentExecutorId: "agent:nobie",
      agentsById: {
        "agent:nobie": {},
        "node:finance": {},
        "node:backend": {},
        "node:reviewer": {},
      },
      directChildAgentIdsByParent: {
        "agent:nobie": ["node:finance"],
        "node:finance": ["node:backend"],
      },
      edgeIndex: {
        "agent:nobie": {
          "node:finance": { edgeId: "edge:nobie-finance" },
        },
        "node:finance": {
          "node:backend": { edgeId: "edge:finance-backend" },
        },
      },
      allActiveExecutorIds: ["agent:nobie", "node:finance", "node:backend", "node:reviewer"],
      allRegisteredExecutorIds: ["agent:nobie", "node:finance", "node:backend", "node:reviewer"],
    } as never

    expect(validateDelegationPath({
      currentExecutorId: "agent:nobie",
      executionGraphSnapshot: graphSnapshot,
      executionDecision: {
        selected_executor_id: "node:backend",
        selected_connection_path: ["node:finance", "node:backend"],
      },
    })).toEqual(expect.objectContaining({
      ok: true,
      status: "valid",
      normalizedConnectionPath: ["agent:nobie", "node:finance", "node:backend"],
    }))

    const resolution = resolveNodeDelegation({
      executorId: "agent:nobie",
      taskAnalysis: analysis,
      candidates: [{
        targetId: "node:backend",
        targetLabel: "백엔드 엔지니어",
        targetType: "agent",
        matchedCapabilities: ["업무 처리"],
        missingCapabilities: [],
        confidence: 0.9,
        availability: "available",
      }],
      executionGraphSnapshot: graphSnapshot,
      executionDecision: {
        selected_executor_id: "node:backend",
        selected_connection_path: ["node:finance", "node:reviewer", "node:backend"],
        execution_route: "delegate_to_child",
        reason: "테스트용 경로 검증",
      },
      now,
    })

    expect(resolution.pathValidation).toEqual(expect.objectContaining({
      ok: false,
      status: "selected_connection_path_invalid",
      issues: expect.arrayContaining(["missing_graph_edge:node:finance->node:reviewer"]),
    }))
    expect(resolution.selectedRoute).toBe("nobie_direct")
    expect(resolution.selectedTargetId).toBe("nobie_direct")
  })

  it("builds delegation candidates from agent and team registry snapshots", () => {
    const executor = createExecutor("node:frontend", "프론트엔드 엔지니어", "프론트엔드 구현을 담당한다.")
    const analysis = buildNodeTaskAnalysis({ executor, now })
    const candidates = delegationCandidatesFromRegistry({
      taskAnalysis: analysis,
      registry: {
        agents: [
          {
            agentId: "agent:frontend",
            displayName: "Frontend Agent",
            status: "enabled",
            role: "프론트엔드 엔지니어",
            specialtyTags: ["업무 처리", "React"],
            avoidTasks: [],
            teamIds: ["team:product"],
            delegationEnabled: true,
            source: "db",
            capabilitySummary: {
              available: true,
              availability: "available",
              enabledSkillIds: [],
              disabledSkillIds: [],
              enabledMcpServerIds: [],
              disabledMcpServerIds: [],
              enabledToolNames: [],
              disabledToolNames: [],
              secretScopes: [],
              skillBindings: [],
              mcpServerBindings: [],
              diagnostics: [],
              diagnosticReasonCodes: [],
            },
            modelSummary: {
              available: true,
              availability: "available",
            },
            currentLoad: {
              activeSubSessions: 0,
              queuedSubSessions: 0,
              failedSubSessions: 0,
              completedSubSessions: 0,
              maxParallelSessions: 1,
              utilization: 0,
            },
          },
        ] as never,
        teams: [
          {
            teamId: "team:product",
            displayName: "Product Team",
            status: "enabled",
            purpose: "프론트엔드와 백엔드 제품 구현",
            roleHints: ["프론트엔드"],
            memberAgentIds: ["agent:frontend"],
            activeMemberAgentIds: ["agent:frontend"],
            unresolvedMemberAgentIds: [],
            source: "db",
          },
        ] as never,
      },
    })

    expect(candidates.map((candidate) => candidate.targetId)).toEqual(expect.arrayContaining([
      "agent:frontend",
      "team:product",
    ]))
    expect(candidates.find((candidate) => candidate.targetId === "agent:frontend")?.availability).toBe("available")
  })

  it("turns an executor graph into a graph execution plan with visible nodes and edge delegation", () => {
    const source = createExecutor("node:planner", "기획자", "사용자 요청을 분석하고 프론트엔드에게 넘긴다.")
    const target = createExecutor("node:frontend", "프론트엔드 엔지니어", "React 화면을 구현한다.")
    const connection = createExecutorConnectionDraft({ source, target })
    const plan = buildGraphExecutionPlan({
      workspaceId: "workspace:phase021",
      graph: graph([source, target], [connection]),
      now,
    })

    expect(plan.entryExecutorIds).toEqual(["node:planner"])
    expect(plan.nodePlans.map((node) => node.executorId)).toEqual(["node:planner", "node:frontend"])
    expect(plan.nodePlans.every((node) => node.delegationResolution.visibility === "visible_node")).toBe(true)
    expect(plan.edgePlans).toEqual([
      expect.objectContaining({
        edgeId: connection.id,
        sourceExecutorId: "node:planner",
        targetExecutorId: "node:frontend",
        executionBehavior: "handoff",
      }),
    ])
    expect(plan.validationWarnings).toEqual([])
  })

  it("emits graph, node, and edge events that WebUI can use for active animation", () => {
    const source = createExecutor("node:planner", "기획자", "요청을 분석한다.")
    const target = createExecutor("node:reviewer", "리뷰어", "결과를 검토한다.")
    const connection = createExecutorConnectionDraft({ source, target })
    const plan = buildGraphExecutionPlan({
      workspaceId: "workspace:phase021",
      graph: graph([source, target], [connection]),
      now,
    })
    const result = simulateGraphExecutionPlan({ plan, now })

    expect(result.status).toBe("completed")
    expect(result.events.map((event) => event.type)).toEqual(expect.arrayContaining([
      "graph_plan_created",
      "node_execution_started",
      "edge_handoff_started",
      "edge_handoff_completed",
      "graph_execution_completed",
    ]))
    expect(result.events.some((event) => event.executorId === "node:planner")).toBe(true)
    expect(result.events.some((event) => event.edgeId === connection.id)).toBe(true)
    expect(result.events.some((event) => event.activeExecutorIds.includes("node:planner"))).toBe(true)
    expect(result.events.some((event) => event.activeEdgeIds.includes(connection.id))).toBe(true)
  })

  it("converts node execution plans to graph-traceable WorkOrders and blocks invisible user work", () => {
    const source = createExecutor("node:planner", "기획자", "요청을 분석한다.")
    const target = createExecutor("node:reviewer", "리뷰어", "결과를 검토한다.")
    const connection = createExecutorConnectionDraft({ source, target })
    const plan = buildGraphExecutionPlan({
      workspaceId: "workspace:phase021-workorder",
      graph: graph([source, target], [connection]),
      now,
    })
    const nodePlan = plan.nodePlans[0]!
    const workOrder = buildWorkOrderFromNodeExecutionPlan({
      plan,
      nodePlan,
      edgeId: connection.id,
      topologyRunId: "topology-run:phase021",
      createdAt: now,
    })
    const metadata = readGraphWorkOrderMetadata(workOrder)

    expect(metadata).toMatchObject({
      graphExecutionPlanId: plan.graphExecutionPlanId,
      executorId: nodePlan.executorId,
      edgeId: connection.id,
      delegationResolutionId: nodePlan.delegationResolution.resolutionId,
      taskAnalysisId: nodePlan.taskAnalysis.analysisId,
    })
    expect(assertVisibleUserWorkOrder(workOrder)).toMatchObject({ ok: true })
    const systemPreparation = buildWorkOrderFromNodeExecutionPlan({
      plan,
      nodePlan,
      systemPreparation: true,
      createdAt: now,
    })
    expect(assertVisibleUserWorkOrder(systemPreparation)).toMatchObject({
      ok: false,
      reasonCode: "system_preparation_user_result_blocked",
    })
  })

  it("blocks topology sub-session user work without a visible executor id", () => {
    expect(validateVisibleTopologySubSessionCommand(commandRequest({
      topologyExecutor: { graphExecutionPlanId: "graph-execution-plan:phase021" },
    }))).toEqual({
      ok: false,
      reasonCode: "topology_executor_id_required",
    })
    expect(validateVisibleTopologySubSessionCommand(commandRequest({
      topologyExecutor: {
        graphExecutionPlanId: "graph-execution-plan:phase021",
        executorId: "node:frontend",
      },
    }))).toEqual({ ok: true })
    expect(validateVisibleTopologySubSessionCommand(commandRequest({
      topologyExecutor: {
        graphExecutionPlanId: "graph-execution-plan:phase021",
        systemPreparation: true,
      },
    }))).toEqual({
      ok: false,
      reasonCode: "system_preparation_user_result_blocked",
    })
  })

  it("persists graph plans, events, analyses, delegation resolutions, and recovery strategy ledger with DB guards", () => {
    const db = new BetterSqlite3(":memory:")
    runMigrations(db as Parameters<typeof runMigrations>[0])
    expect(verifyMigrationState(db as Parameters<typeof verifyMigrationState>[0]).ok).toBe(true)

    const source = createExecutor("node:planner", "기획자", "요청을 분석한다.")
    const target = createExecutor("node:reviewer", "리뷰어", "결과를 검토한다.")
    const connection = createExecutorConnectionDraft({ source, target })
    const plan = buildGraphExecutionPlan({
      workspaceId: "workspace:phase021-db",
      graph: graph([source, target], [connection]),
      now,
    })
    const simulated = simulateGraphExecutionPlan({ plan, now })
    const record = persistGraphExecutionPlan({
      db: db as Parameters<typeof persistGraphExecutionPlan>[0]["db"],
      plan,
      now: Date.parse(now),
    })
    const eventRecords = persistGraphExecutionEvents({
      db: db as Parameters<typeof persistGraphExecutionEvents>[0]["db"],
      graphExecutionPlanId: plan.graphExecutionPlanId,
      events: simulated.events,
    })
    const stored = getGraphExecutionPlan(plan.graphExecutionPlanId, {
      db: db as Parameters<typeof getGraphExecutionPlan>[1]["db"],
    })

    expect(record.graphExecutionPlanId).toBe(plan.graphExecutionPlanId)
    expect(stored?.plan.nodePlans.length).toBe(2)
    expect(eventRecords.map((event) => event.eventType)).toContain("node_execution_started")
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM node_task_analyses").get() as { count: number },
    ).toEqual({ count: 2 })
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM node_delegation_resolutions WHERE visibility = 'visible_node'").get() as { count: number },
    ).toEqual({ count: 2 })

    expect(() =>
      db.prepare(
        `INSERT INTO graph_execution_events
         (event_id, graph_execution_plan_id, event_type, terminal_reason, user_work, event_json, at, sequence)
         VALUES ('bad-terminal', ?, 'node_execution_failed', 'retry_exhausted', 0, '{}', ?, 999)`,
      ).run(plan.graphExecutionPlanId, Date.parse(now)),
    ).toThrow()
    expect(() =>
      db.prepare(
        `INSERT INTO graph_execution_events
         (event_id, graph_execution_plan_id, event_type, user_work, event_json, at, sequence)
         VALUES ('missing-executor', ?, 'node_execution_started', 1, '{}', ?, 1000)`,
      ).run(plan.graphExecutionPlanId, Date.parse(now)),
    ).toThrow()

    const key = strategyKey({ toolIds: ["tool:shell"], inputShapeHash: "input:db" })
    persistRecoveryStrategyAttempt({
      db: db as Parameters<typeof persistRecoveryStrategyAttempt>[0]["db"],
      graphExecutionPlanId: plan.graphExecutionPlanId,
      scopeId: "node:planner",
      key,
      reason: "tool_failed",
      now: Date.parse(now),
    })
    expect(() =>
      persistRecoveryStrategyAttempt({
        db: db as Parameters<typeof persistRecoveryStrategyAttempt>[0]["db"],
        graphExecutionPlanId: plan.graphExecutionPlanId,
        scopeId: "node:planner",
        key,
        reason: "tool_failed",
        now: Date.parse(now) + 1,
      }),
    ).toThrow()

    db.close()
  })

  it("treats count-based failure reasons as recovery signals, not terminal failures", () => {
    expect(normalizeFailureReason({ reason: "retry_exhausted" })).toEqual({
      kind: "recovery_signal",
      reason: "count_signal_observed",
      originalReason: "retry_exhausted",
    })
    expect(guardTerminalFailure({ reason: "retry_exhausted" })).toEqual({
      ok: false,
      recoverySignal: {
        kind: "recovery_signal",
        reason: "count_signal_observed",
        originalReason: "retry_exhausted",
      },
    })
    expect(guardTerminalFailure({ reason: "retry_exhausted", explicitUserLimit: true })).toEqual({
      ok: true,
      terminalReason: "explicit_user_limit_reached",
    })
  })

  it("rejects repeating the same recovery strategy key and allows changed strategy keys", () => {
    expect(RECOVERY_STRATEGY_CHANGE_AXES).toEqual([
      "executor",
      "tool_or_source",
      "decomposition",
      "prompt_context",
      "verification_method",
      "permission_or_user_confirmation",
    ])

    const ledger = createRecoveryStrategyLedger()
    const key = strategyKey({ toolIds: ["tool:shell"], inputShapeHash: "input:a" })
    const first = recordRecoveryStrategyAttempt({
      ledger,
      scopeId: "node:frontend",
      key,
      reason: "tool_failed",
      now: 1,
    })
    const duplicate = recordRecoveryStrategyAttempt({
      ledger: first.ledger,
      scopeId: "node:frontend",
      key,
      reason: "tool_failed",
      now: 2,
    })
    const changed = recordRecoveryStrategyAttempt({
      ledger: first.ledger,
      scopeId: "node:frontend",
      key: strategyKey({ toolIds: ["tool:file-search"], inputShapeHash: "input:b" }),
      reason: "strategy_change_required",
      now: 3,
    })

    expect(first.accepted).toBe(true)
    expect(duplicate).toMatchObject({ accepted: false, rejectionReason: "same_strategy_rejected" })
    expect(changed.accepted).toBe(true)
  })

  it("chooses a changed safe alternative and only fails when no alternative remains", () => {
    const executor = createExecutor("node:frontend", "프론트엔드 엔지니어", "화면 구현을 담당한다.")
    const analysis = buildNodeTaskAnalysis({ executor, now })
    const key = strategyKey({ toolIds: ["tool:shell"], inputShapeHash: "input:a" })
    const selected = chooseRecoveryAlternative({
      taskAnalysis: analysis,
      ledger: createRecoveryStrategyLedger(),
      scopeId: executor.id,
      failureReason: "max_attempts_reached",
      baseStrategyKey: key,
      now: 1,
    })

    expect(selected.decision).toMatchObject({
      status: "strategy_selected",
      recoveryReason: "count_signal_observed",
    })

    let ledger = selected.ledger
    for (const alternative of analysis.safeAlternatives.slice(1)) {
      const next = chooseRecoveryAlternative({
        taskAnalysis: { ...analysis, safeAlternatives: [alternative] },
        ledger,
        scopeId: executor.id,
        failureReason: "tool_failed",
        baseStrategyKey: key,
        now: 2,
      })
      ledger = next.ledger
    }
    const exhausted = chooseRecoveryAlternative({
      taskAnalysis: analysis,
      ledger,
      scopeId: executor.id,
      failureReason: "tool_failed",
      baseStrategyKey: key,
      now: 3,
    })
    expect(exhausted.decision).toMatchObject({
      status: "no_safe_alternative",
      terminalReason: "no_safe_alternative",
    })

    const permission = chooseRecoveryAlternative({
      taskAnalysis: analysis,
      ledger: createRecoveryStrategyLedger(),
      scopeId: executor.id,
      failureReason: "permission_required",
      baseStrategyKey: key,
      now: 4,
    })
    expect(permission.decision).toMatchObject({
      status: "waiting_for_user",
      terminalReason: "permission_required",
    })
  })

  it("uses unbounded count limits by default in execution policy snapshots", () => {
    expect(createDefaultExecutionPolicySnapshot().countLimits).toEqual({
      retryAttempts: "unbounded",
      delegationTurns: "unbounded",
    })
  })

  it("shares cancellation state across graph and node tokens", () => {
    const controller = createGraphCancellationController({
      graphExecutionPlanId: "graph-execution-plan:cancel",
      executorIds: ["node:planner", "node:reviewer"],
    })

    expect(controller.isNodeCancelled("node:planner")).toBe(false)
    controller.cancelNode("node:planner", "node_cancelled", now)
    expect(controller.isNodeCancelled("node:planner")).toBe(true)
    expect(controller.isNodeCancelled("node:reviewer")).toBe(false)

    controller.cancelGraph("user_cancelled", now)
    expect(controller.isGraphCancelled()).toBe(true)
    expect(controller.isNodeCancelled("node:reviewer")).toBe(true)
  })
})

function createExecutor(id: string, name: string, description: string): ExecutorDraft {
  return createExecutorDraftFromInference({
    id,
    sourceNodeId: id,
    name,
    description,
    now,
    userConfirmed: true,
  })
}

function graph(executors: ExecutorDraft[], connections: ExecutorConnectionDraft[]): ExecutorGraphWorkspace {
  return {
    schemaVersion: 1,
    graphId: "executor-graph:phase021",
    topologyId: "topology:phase021",
    name: "Phase021 graph",
    mode: "simple",
    executors,
    sections: [],
    connections,
    selectedId: executors[0]?.id ?? null,
    inference: {
      source: "executor_graph_compile",
      confidence: 0.9,
      executorCount: executors.length,
      connectionCount: connections.length,
      issueCount: 0,
      generatedAt: now,
    },
    compiledPreview: null,
    latestRun: null,
    issues: [],
    sourceOfTruth: EXECUTOR_GRAPH_SOURCE_OF_TRUTH,
  }
}

function strategyKey(overrides: Partial<RecoveryStrategyKey> = {}): RecoveryStrategyKey {
  return {
    targetRoute: "sub_agent",
    targetAgentId: "agent:frontend",
    toolIds: [],
    inputShapeHash: "input",
    normalizedTaskHash: "task",
    workingDirectory: "/workspace",
    fileTargets: [],
    permissionProfile: "default",
    executionOrderHash: "order",
    verificationMethod: "test",
    ...overrides,
  }
}

const expectedOutput: ExpectedOutputContract = {
  outputId: "answer",
  kind: "text",
  description: "Answer returned through the visible executor node.",
  required: true,
  acceptance: {
    requiredEvidenceKinds: [],
    artifactRequired: false,
    reasonCodes: ["visible_executor_result"],
  },
}

const taskScope: StructuredTaskScope = {
  goal: "Return a graph-visible result.",
  intentType: "topology_executor",
  actionType: "sub_session_user_work",
  constraints: ["Must map to a visible executor node."],
  expectedOutputs: [expectedOutput],
  reasonCodes: ["topology_executor"],
}

function commandRequest(overrides: Partial<CommandRequest> = {}): CommandRequest {
  return {
    identity: {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      entityType: "sub_session",
      entityId: "sub-session:visible",
      owner: { ownerType: "sub_agent", ownerId: "agent:frontend" },
      idempotencyKey: "sub-session:visible",
      parent: { parentRunId: "run:visible", parentRequestId: "request:visible" },
    },
    commandRequestId: "command:visible",
    parentRunId: "run:visible",
    subSessionId: "sub-session:visible",
    targetAgentId: "agent:frontend",
    taskScope,
    contextPackageIds: [],
    expectedOutputs: [expectedOutput],
    ...overrides,
  }
}
