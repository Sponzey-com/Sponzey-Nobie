import { describe, expect, it } from "vitest"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import type { OrchestrationPlan } from "../packages/core/src/contracts/sub-agent-orchestration.js"
import type { DelegatedTaskDispatchResult } from "../packages/core/src/runs/orchestration-dispatch.js"
import { resolveTopologyDispatchFollowupDecision } from "../packages/core/src/runs/topology-dispatch-fallback.ts"

function plan(): OrchestrationPlan {
  return {
    identity: {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      entityType: "session",
      entityId: "session:phase027",
      owner: { ownerType: "nobie", ownerId: "agent:nobie" },
      idempotencyKey: "plan:phase027",
    },
    planId: "plan:phase027",
    parentRunId: "run:phase027",
    parentRequestId: "request:phase027",
    directNobieTasks: [],
    delegatedTasks: [
      {
        taskId: "task:finance",
        executionKind: "delegated_sub_agent",
        assignedAgentId: "workspace:draft:node:madang",
        scope: {
          goal: "Handle the delegated request.",
          intentType: "task_intake",
          actionType: "run_task",
          constraints: [],
          expectedOutputs: [{
            outputId: "answer",
            kind: "text",
            description: "Answer.",
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
      },
    ],
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
  }
}

function dispatchResult(): DelegatedTaskDispatchResult {
  return {
    attempted: 1,
    completed: 0,
    failed: 1,
    skipped: 0,
    outcomes: [{
      taskId: "task:finance",
      subSessionId: "sub:madang",
      agentId: "workspace:draft:node:madang",
      agentDisplayName: "마당쇠",
      agentSource: "topology",
      topologyId: "workspace:draft",
      topologyExecutorId: "node:madang",
      status: "failed",
      reasonCode: "child_result_pending_signal",
      summary: "The child did not produce a usable result yet.",
    }],
  }
}

describe("phase027 topology redispatch after child timeout signal", () => {
  it("uses all current direct children, not only the failed plan executor, for alternatives", () => {
    const decision = resolveTopologyDispatchFollowupDecision({
      dispatchResult: dispatchResult(),
      plan: plan(),
      currentExecutorId: "agent:nobie",
      availableDirectChildExecutorIds: [
        "workspace:draft:node:madang",
        "workspace:draft:node:hangrang",
      ],
    })

    expect(decision).toMatchObject({
      action: "redelegate",
      reasonCode: "redelegate_after_delegation_failure",
      rootLoopContinuation: "blocked",
      alternativeExecutorIds: ["workspace:draft:node:hangrang"],
    })
    expect(decision?.failedReasonCodes).toEqual(["child_result_pending_signal"])
  })
})
