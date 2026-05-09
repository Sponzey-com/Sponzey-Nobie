import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import type { OrchestrationPlan } from "../packages/core/src/contracts/sub-agent-orchestration.js"
import {
  closeDb,
  getDb,
} from "../packages/core/src/db/index.js"
import type { DelegatedTaskDispatchResult } from "../packages/core/src/runs/orchestration-dispatch.js"
import {
  recordTopologyDispatchFollowupTrace,
  resolveTopologyDispatchFollowupDecision,
} from "../packages/core/src/runs/topology-dispatch-fallback.ts"
import { getTopologyRunTraceProjection } from "../packages/core/src/topology-runtime/trace.ts"

const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG
const tempDirs: string[] = []

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-topology-run-trace-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
}

function restoreState(): void {
  closeDb()
  if (previousStateDir === undefined) Reflect.deleteProperty(process.env, "NOBIE_STATE_DIR")
  else process.env.NOBIE_STATE_DIR = previousStateDir
  if (previousConfig === undefined) Reflect.deleteProperty(process.env, "NOBIE_CONFIG")
  else process.env.NOBIE_CONFIG = previousConfig
  reloadConfig()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
}

function plan(): OrchestrationPlan {
  return {
    identity: {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      entityType: "session",
      entityId: "session:run-trace",
      owner: { ownerType: "nobie", ownerId: "agent:nobie" },
      idempotencyKey: "plan:run-trace",
    },
    planId: "plan:run-trace",
    parentRunId: "run:run-trace",
    parentRequestId: "request:run-trace",
    directNobieTasks: [],
    delegatedTasks: [{
      taskId: "task:review",
      executionKind: "delegated_sub_agent",
      assignedAgentId: "workspace:draft:node:review",
      scope: {
        goal: "Review delegated request.",
        intentType: "task_intake",
        actionType: "run_task",
        constraints: [],
        expectedOutputs: [{
          outputId: "answer",
          kind: "text",
          description: "Review answer.",
          required: true,
          acceptance: {
            requiredEvidenceKinds: [],
            artifactRequired: false,
            reasonCodes: [],
          },
        }],
        reasonCodes: [],
      },
      requiredCapabilities: [],
      resourceLockIds: [],
    }],
    dependencyEdges: [],
    resourceLocks: [],
    parallelGroups: [],
    approvalRequirements: [],
    fallbackStrategy: {
      mode: "self_solve",
      reasonCode: "fallback_self_solve",
      currentExecutorId: "agent:nobie",
    },
    createdAt: 1,
  } as OrchestrationPlan
}

function dispatchResult(): DelegatedTaskDispatchResult {
  return {
    attempted: 1,
    completed: 0,
    failed: 1,
    skipped: 0,
    outcomes: [{
      taskId: "task:review",
      subSessionId: "sub-session:review",
      agentId: "workspace:draft:node:review",
      agentDisplayName: "검토자",
      agentSource: "topology",
      topologyId: "workspace:draft",
      topologyExecutorId: "node:review",
      status: "failed",
      reasonCode: "prompt_bundle_preflight_failed",
      summary: "Prompt bundle preflight failed.",
    }],
  }
}

describe("topology run trace persistence", () => {
  beforeEach(useTempState)
  afterEach(restoreState)

  it("records topology run, node run, work order, failure report, and trace events for dispatch failures", () => {
    const activePlan = plan()
    const result = dispatchResult()
    const decision = resolveTopologyDispatchFollowupDecision({
      dispatchResult: result,
      plan: activePlan,
      currentExecutorId: "agent:nobie",
      availableDirectChildExecutorIds: ["workspace:draft:node:finance"],
    })
    expect(decision).toBeDefined()

    const trace = recordTopologyDispatchFollowupTrace({
      decision: decision!,
      dispatchResult: result,
      plan: activePlan,
      runId: "run:run-trace",
      requestGroupId: "request-group:run-trace",
      sessionId: "session:run-trace",
      source: "web",
      topologyId: "workspace:draft",
      entryNodeId: "node:review",
      now: () => 1_800_000_000_100,
    })

    const projection = getTopologyRunTraceProjection(trace.topologyRunId, { db: getDb() })
    expect(projection?.run).toMatchObject({
      topologyRunId: "topology-dispatch:run:run-trace",
      topologyId: "workspace:draft",
      rootRunId: "run:run-trace",
      status: "completed",
      entryNodeId: "node:review",
    })
    expect(projection?.nodeRuns).toHaveLength(1)
    expect(projection?.workOrders).toHaveLength(1)
    expect(projection?.failureReports).toHaveLength(1)
    expect(projection?.failureReports[0]).toMatchObject({
      nodeId: "node:review",
      failurePhase: "permission",
    })
    expect(projection?.traceEvents.map((event) => event.reasonCode)).toEqual([
      "topology_dispatch_started",
      "sub_agent_dispatch_started",
      "prompt_bundle_preflight_failed",
      "self_solve_after_delegation_failure",
    ])
    expect(projection?.traceEvents.at(-1)).toMatchObject({
      phase: "self_execution",
      component: "dispatch-fallback-state-machine",
    })
  })
})
