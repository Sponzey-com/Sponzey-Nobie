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

const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG
const tempDirs: string[] = []

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-topology-decision-trace-"))
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
      entityId: "session:trace",
      owner: { ownerType: "nobie", ownerId: "agent:nobie" },
      idempotencyKey: "plan:trace",
    },
    planId: "plan:trace",
    parentRunId: "run:trace",
    parentRequestId: "request:trace",
    directNobieTasks: [],
    delegatedTasks: [{
      taskId: "task:finance",
      executionKind: "delegated_sub_agent",
      assignedAgentId: "workspace:draft:node:finance",
      scope: {
        goal: "Answer finance request.",
        intentType: "task_intake",
        actionType: "run_task",
        constraints: [],
        expectedOutputs: [{
          outputId: "answer",
          kind: "text",
          description: "Finance answer.",
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
      taskId: "task:finance",
      subSessionId: "sub-session:finance",
      agentId: "workspace:draft:node:finance",
      agentDisplayName: "행랑아범",
      agentSource: "topology",
      topologyId: "workspace:draft",
      topologyExecutorId: "node:finance",
      status: "failed",
      reasonCode: "prompt_bundle_preflight_failed",
      summary: "Prompt bundle preflight failed.",
    }],
  }
}

describe("topology dispatch decision trace persistence", () => {
  beforeEach(useTempState)
  afterEach(restoreState)

  it("persists a structured dispatch follow-up decision in decision_traces", () => {
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
      runId: "run:trace",
      requestGroupId: "request-group:trace",
      sessionId: "session:trace",
      source: "telegram",
      topologyId: "workspace:draft",
      entryNodeId: "node:finance",
      now: () => 1_800_000_000_000,
    })

    const row = getDb()
      .prepare<[string], {
        decision_kind: string
        reason_code: string
        source: string | null
        channel: string | null
        sanitized_detail_json: string
      }>(
        `SELECT decision_kind, reason_code, source, channel, sanitized_detail_json
         FROM decision_traces
         WHERE id = ?`,
      )
      .get(trace.decisionTraceId)

    expect(row?.decision_kind).toBe("topology_dispatch_followup")
    expect(row?.reason_code).toBe("self_solve_after_delegation_failure")
    expect(row?.source).toBe("telegram")
    expect(row?.channel).toBe("telegram")
    const detail = JSON.parse(row?.sanitized_detail_json ?? "{}") as {
      topologyRunId?: string
      decision?: { action?: string; blockedByPreflight?: boolean }
      outcomes?: Array<{ reasonCode?: string }>
    }
    expect(detail.topologyRunId).toBe("topology-dispatch:run:trace")
    expect(detail.decision).toMatchObject({
      action: "self_solve",
      blockedByPreflight: true,
    })
    expect(detail.outcomes?.[0]?.reasonCode).toBe("prompt_bundle_preflight_failed")
  })
})
