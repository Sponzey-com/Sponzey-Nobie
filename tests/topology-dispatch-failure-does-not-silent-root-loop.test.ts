import { describe, expect, it } from "vitest"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import type { OrchestrationPlan } from "../packages/core/src/contracts/sub-agent-orchestration.js"
import type { AgentRegistryEntry } from "../packages/core/src/orchestration/registry.js"
import {
  type DelegatedTaskDispatchResult,
  validateDispatchToChildExecutorInput,
} from "../packages/core/src/runs/orchestration-dispatch.ts"
import { resolveTopologyDispatchFollowupDecision } from "../packages/core/src/runs/topology-dispatch-fallback.ts"

function orchestrationPlan(agentIds = ["workspace:draft:node:finance"]): OrchestrationPlan {
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
    delegatedTasks: agentIds.map((agentId, index) => ({
      taskId: `task:${index + 1}`,
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
      planningTrace: {
        selectedExecutorId: agentId,
        reasonCodes: ["execution_decision_selected_executor"],
      },
    })),
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

function failedDispatch(agentId = "workspace:draft:node:finance"): DelegatedTaskDispatchResult {
  return {
    attempted: 1,
    completed: 0,
    failed: 1,
    skipped: 0,
    outcomes: [{
      taskId: "task:1",
      subSessionId: "sub-session:1",
      agentId,
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

function topologyAgent(agentId = "workspace:draft:node:finance"): AgentRegistryEntry {
  return {
    agentId,
    displayName: "행랑아범",
    status: "enabled",
    role: "finance worker",
    specialtyTags: [],
    avoidTasks: [],
    teamIds: [],
    delegationEnabled: true,
    source: "topology",
  } as AgentRegistryEntry
}

describe("topology dispatch failure follow-up", () => {
  it("blocks topology child dispatch unless a validated executor decision selected the target", () => {
    const task = orchestrationPlan().delegatedTasks[0]
    const agent = topologyAgent()
    const taskWithoutDecision = { ...task }
    delete taskWithoutDecision.planningTrace

    const withoutDecision = validateDispatchToChildExecutorInput({
      task: taskWithoutDecision,
      agent,
    })
    expect(withoutDecision).toMatchObject({
      ok: false,
      reasonCode: "validated_execution_decision_required",
    })

    const mismatchedDecision = validateDispatchToChildExecutorInput({
      task: {
        ...task,
        planningTrace: {
          selectedExecutorId: "workspace:draft:node:research",
          reasonCodes: ["execution_decision_selected_executor"],
        },
      },
      agent,
    })
    expect(mismatchedDecision).toMatchObject({
      ok: false,
      reasonCode: "validated_execution_decision_executor_mismatch",
    })

    const validated = validateDispatchToChildExecutorInput({ task, agent })
    expect(validated).toMatchObject({
      ok: true,
      selectedExecutorId: "workspace:draft:node:finance",
    })
  })

  it("turns a failed topology dispatch into explicit self solve instead of silent root-loop fallback", () => {
    const decision = resolveTopologyDispatchFollowupDecision({
      dispatchResult: failedDispatch(),
      plan: orchestrationPlan(),
      currentExecutorId: "agent:nobie",
      availableDirectChildExecutorIds: ["workspace:draft:node:finance"],
    })

    expect(decision).toMatchObject({
      action: "self_solve",
      reasonCode: "self_solve_after_delegation_failure",
      blockedByPreflight: true,
      rootLoopContinuation: "allowed_with_trace",
    })
    expect(decision?.failedExecutorIds).toEqual(["workspace:draft:node:finance"])
  })

  it("blocks root-loop fallback when a direct child alternative can be evaluated for redelegation", () => {
    const decision = resolveTopologyDispatchFollowupDecision({
      dispatchResult: failedDispatch("workspace:draft:node:finance"),
      plan: orchestrationPlan(["workspace:draft:node:finance"]),
      currentExecutorId: "agent:nobie",
      availableDirectChildExecutorIds: [
        "workspace:draft:node:finance",
        "workspace:draft:node:research",
      ],
    })

    expect(decision).toMatchObject({
      action: "redelegate",
      reasonCode: "redelegate_after_delegation_failure",
      rootLoopContinuation: "blocked",
      alternativeExecutorIds: ["workspace:draft:node:research"],
    })
  })
})
