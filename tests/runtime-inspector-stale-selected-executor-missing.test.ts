import { describe, expect, it } from "vitest"
import { buildRunRuntimeInspectorProjection } from "../packages/core/src/runs/runtime-inspector-projection.ts"
import type { RootRun } from "../packages/core/src/runs/types.ts"

function runWithStaleMissingFallback(): RootRun {
  const now = Date.UTC(2026, 4, 8, 8, 0, 0)
  return {
    id: "run:stale-routing",
    sessionId: "session:telegram",
    requestGroupId: "run:stale-routing",
    lineageRootRunId: "run:stale-routing",
    runScope: "root",
    title: "오늘 코스피 시작은 얼마로 시작했고 지금은 얼마지?",
    prompt: "오늘 코스피 시작은 얼마로 시작했고 지금은 얼마지?",
    source: "telegram",
    status: "completed",
    taskProfile: "research",
    contextMode: "isolated",
    orchestrationMode: "orchestration",
    orchestrationPlanSnapshot: {
      identity: {
        schemaVersion: 1,
        entityType: "session",
        entityId: "plan:stale-routing",
        owner: { ownerType: "nobie", ownerId: "agent:nobie" },
        idempotencyKey: "plan:stale-routing",
        parent: {
          parentRunId: "run:stale-routing",
          parentRequestId: "run:stale-routing",
        },
      },
      planId: "plan:stale-routing",
      parentRunId: "run:stale-routing",
      parentRequestId: "run:stale-routing",
      directNobieTasks: [
        {
          taskId: "plan:stale-routing:direct:0",
          executionKind: "direct_nobie",
          scope: {
            goal: "오늘 코스피 시작은 얼마로 시작했고 지금은 얼마지?",
            intentType: "user_request",
            actionType: "answer",
            constraints: [],
            expectedOutputs: [
              {
                outputId: "answer",
                kind: "text",
                description: "시장 정보 답변",
                required: true,
                acceptance: {
                  requiredEvidenceKinds: [],
                  artifactRequired: false,
                  reasonCodes: ["answer_ready"],
                },
              },
            ],
            reasonCodes: ["stale_direct_snapshot"],
          },
          requiredCapabilities: [],
          resourceLockIds: [],
        },
      ],
      delegatedTasks: [],
      dependencyEdges: [],
      resourceLocks: [],
      parallelGroups: [],
      approvalRequirements: [],
      fallbackStrategy: {
        mode: "direct_current_agent",
        reasonCode: "execution_decision_required",
      },
      plannerMetadata: {
        status: "planned",
        plannerVersion: "test",
        timedOut: false,
        semanticComparisonUsed: false,
        reasonCodes: ["execution_decision_required"],
        candidateScores: [],
        directReasonCodes: ["execution_decision_required"],
        fallbackReasonCodes: ["execution_decision_required"],
      },
      createdAt: now,
    },
    promptSourceSnapshot: {
      topologyRouting: {
        mode: "fallback",
        reasonCode: "selected_executor_missing",
        activeTopologyCount: 1,
        issues: ["selected_executor_missing"],
      },
      agentExecutionDecision: {
        contract_version: "agent-execution-decision:v1",
        current_executor_id: "agent:nobie",
        domain: "market_lookup",
        behavior_pattern: "delegate",
        execution_route: "delegate_to_child",
        selected_executor_id: "workspace:draft:node:finance",
        selected_connection_path: ["agent:nobie", "workspace:draft:node:finance"],
        task_profile: {
          title: "시장 확인",
          summary: "재무 담당 실행자에게 위임한다.",
          goals: ["시세 확인"],
          task_units: [],
          success_criteria: ["선택된 실행자가 남는다."],
        },
        required_outputs: [{ id: "answer", label: "답변" }],
        risk_boundary: {
          requires_user_approval: false,
          reason: "공개 시장 정보 확인",
        },
        confidence: 0.86,
        fallback_if_unavailable: "self_solve",
        reason: "재무 담당 실행자 정의가 요청과 맞습니다.",
      },
      executionDecisionTrace: {
        decision_source: "nobie_harness",
        graph_id: "execution-graph:test",
        graph_source: "active_topology",
        current_executor_id: "agent:nobie",
        available_executor_ids: [
          "workspace:draft:node:general",
          "workspace:draft:node:finance",
        ],
        selected_executor_id: "workspace:draft:node:finance",
        selected_connection_path: ["agent:nobie", "workspace:draft:node:finance"],
        normalized_connection_path: ["agent:nobie", "workspace:draft:node:finance"],
        resolved_selected_executor_id: "workspace:draft:node:finance",
        execution_route: "delegate_to_child",
        fallback_reason: "delegate_to_child",
      },
    },
    delegationTurnCount: 0,
    maxDelegationTurns: 0,
    currentStepKey: "completed",
    currentStepIndex: 1,
    totalSteps: 1,
    summary: "후속 실행으로 전달되었습니다.",
    canCancel: false,
    createdAt: now,
    updatedAt: now,
    steps: [
      {
        key: "completed",
        title: "completed",
        index: 1,
        status: "completed",
        summary: "completed",
      },
    ],
    recentEvents: [
      {
        id: "event:stale",
        at: now,
        label: "topology_routing:fallback:selected_executor_missing",
      },
      {
        id: "event:decision",
        at: now + 1,
        label:
          "execution_decision_source:nobie_harness; selected_executor=workspace:draft:node:finance; resolved_route=delegate_to_child",
      },
    ],
  }
}

describe("runtime inspector stale selected executor fallback", () => {
  it("does not expose stale selected_executor_missing after a delegated execution decision exists", () => {
    const projection = buildRunRuntimeInspectorProjection(runWithStaleMissingFallback(), {
      now: Date.UTC(2026, 4, 8, 8, 0, 1),
    })

    expect(projection.topologyRouting.mode).toBe("route")
    expect(projection.topologyRouting.reasonCode).toBe("execution_decision_selected_executor")
    expect(projection.topologyRouting.executionDecisionSelectedExecutorId).toBe(
      "workspace:draft:node:finance",
    )
    expect(projection.topologyRouting.selectedExecutorIds).toContain("node:finance")
    expect(projection.topologyRouting.issues).not.toContain("selected_executor_missing")
    expect(projection.topologyRouting.providerFallback).toBe(false)
    expect(projection.plan.directTaskCount).toBe(0)
    expect(projection.plan.delegatedTaskCount).toBe(1)
    expect(projection.plan.taskSummaries[0]).toEqual(expect.objectContaining({
      executionKind: "delegated_sub_agent",
      assignedAgentId: "workspace:draft:node:finance",
    }))
    expect(projection.plan.fallbackWarnings).toContain(
      "plan_snapshot_reconciled_with_execution_decision_trace",
    )
  })
})
