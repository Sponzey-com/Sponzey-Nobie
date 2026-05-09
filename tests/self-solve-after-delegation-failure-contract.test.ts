import { describe, expect, it } from "vitest"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import type { OrchestrationPlan } from "../packages/core/src/contracts/sub-agent-orchestration.js"
import type { DelegatedTaskDispatchResult } from "../packages/core/src/runs/orchestration-dispatch.js"
import { resolveTopologyDispatchFollowupDecision } from "../packages/core/src/runs/topology-dispatch-fallback.ts"

const agentId = "workspace:draft:node:executor"

function plan(): OrchestrationPlan {
  return {
    identity: {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      entityType: "session",
      entityId: "session:test",
      owner: { ownerType: "nobie", ownerId: "agent:nobie" },
      idempotencyKey: "plan:test",
    },
    planId: "plan:test",
    parentRunId: "run:test",
    parentRequestId: "request:test",
    directNobieTasks: [],
    delegatedTasks: [{
      taskId: "task:executor",
      executionKind: "delegated_sub_agent",
      assignedAgentId: agentId,
      scope: {
        goal: "Handle delegated request.",
        intentType: "task_intake",
        actionType: "run_task",
        constraints: [],
        expectedOutputs: [{
          outputId: "answer",
          kind: "text",
          description: "Final answer.",
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

function dispatchResult(reasonCode = "sub_agent_dispatch_failed"): DelegatedTaskDispatchResult {
  return {
    attempted: 1,
    completed: 0,
    failed: 1,
    skipped: 0,
    outcomes: [{
      taskId: "task:executor",
      agentId,
      agentDisplayName: "실행자",
      agentSource: "topology",
      topologyId: "workspace:draft",
      topologyExecutorId: "node:executor",
      status: "failed",
      reasonCode,
      summary: "Delegation failed.",
    }],
  }
}

describe("self-solve after delegation failure contract", () => {
  it("uses the explicit self-solve reason instead of the legacy direct-current-agent fallback reason", () => {
    const decision = resolveTopologyDispatchFollowupDecision({
      dispatchResult: dispatchResult(),
      plan: plan(),
      currentExecutorId: "agent:nobie",
      availableDirectChildExecutorIds: ["workspace:draft:node:executor"],
    })

    expect(decision?.action).toBe("self_solve")
    expect(decision?.reasonCode).toBe("self_solve_after_delegation_failure")
    expect(decision?.reasonCode).not.toBe("delegated_executor_runtime_failure_direct_current_agent")
  })

  it("fails structurally when neither redelegation nor current-agent self solve is available", () => {
    const decision = resolveTopologyDispatchFollowupDecision({
      dispatchResult: dispatchResult("prompt_bundle_preflight_failed"),
      plan: plan(),
      currentExecutorId: "",
      availableDirectChildExecutorIds: ["workspace:draft:node:executor"],
    })

    expect(decision).toMatchObject({
      action: "fail_with_reason",
      reasonCode: "final_failure_after_exhaustion",
      blockedByPreflight: true,
      rootLoopContinuation: "blocked",
    })
  })
})
