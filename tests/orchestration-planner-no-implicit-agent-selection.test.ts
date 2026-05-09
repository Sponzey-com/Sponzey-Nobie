import { describe, expect, it } from "vitest"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import { validateOrchestrationPlan } from "../packages/core/src/contracts/sub-agent-orchestration.js"
import type {
  CapabilityRiskLevel,
  MemoryPolicy,
  OrchestrationPlan,
  PermissionProfile,
  SkillMcpAllowlist,
  SubAgentConfig,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import {
  AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
  type AgentExecutionDecision,
} from "../packages/core/src/orchestration/execution-decision-contract.ts"
import { resolveAgentCapabilityModelSummary } from "../packages/core/src/orchestration/capability-model.ts"
import type { OrchestrationModeSnapshot } from "../packages/core/src/orchestration/mode.ts"
import { buildOrchestrationPlan } from "../packages/core/src/orchestration/planner.ts"
import type {
  AgentRegistryEntry,
  OrchestrationRegistrySnapshot,
} from "../packages/core/src/orchestration/registry.ts"

const now = Date.UTC(2026, 4, 7, 0, 0, 0)
const rootExecutorId = "agent:nobie"

const allowlist: SkillMcpAllowlist = {
  enabledSkillIds: ["skill:general"],
  enabledMcpServerIds: [],
  enabledToolNames: [],
  disabledToolNames: [],
}

function permissionProfile(overrides: Partial<PermissionProfile> = {}): PermissionProfile {
  return {
    profileId: "profile:safe",
    riskCeiling: "moderate",
    approvalRequiredFrom: "sensitive",
    allowExternalNetwork: false,
    allowFilesystemWrite: false,
    allowShellExecution: false,
    allowScreenControl: false,
    allowedPaths: [],
    ...overrides,
  }
}

function memoryPolicy(agentId: string): MemoryPolicy {
  return {
    owner: { ownerType: "sub_agent", ownerId: agentId },
    visibility: "private",
    readScopes: [{ ownerType: "sub_agent", ownerId: agentId }],
    writeScope: { ownerType: "sub_agent", ownerId: agentId },
    retentionPolicy: "long_term",
    writebackReviewRequired: true,
  }
}

function subAgent(input: {
  agentId: string
  displayName?: string
  role?: string
  specialtyTags?: string[]
  riskCeiling?: CapabilityRiskLevel
  activeSubSessions?: number
}): SubAgentConfig {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    agentType: "sub_agent",
    agentId: input.agentId,
    displayName: input.displayName ?? input.agentId,
    nickname: input.displayName ?? input.agentId,
    status: "enabled",
    role: input.role ?? "worker",
    personality: "구조화된 실행자",
    specialtyTags: input.specialtyTags ?? [],
    avoidTasks: [],
    modelProfile: {
      providerId: "openai",
      modelId: "gpt-5.4",
      timeoutMs: 30_000,
      retryCount: 2,
      costBudget: 5,
    },
    memoryPolicy: memoryPolicy(input.agentId),
    capabilityPolicy: {
      permissionProfile: permissionProfile({
        ...(input.riskCeiling ? { riskCeiling: input.riskCeiling } : {}),
      }),
      skillMcpAllowlist: allowlist,
      rateLimit: { maxConcurrentCalls: 8 },
    },
    profileVersion: 1,
    createdAt: now,
    updatedAt: now,
    teamIds: [],
    delegation: {
      enabled: true,
      maxParallelSessions: 8,
    },
  }
}

function registryEntry(config: SubAgentConfig, activeSubSessions = 0): AgentRegistryEntry {
  const capabilityModelSummary = resolveAgentCapabilityModelSummary(config)
  return {
    agentId: config.agentId,
    displayName: config.displayName,
    ...(config.nickname ? { nickname: config.nickname } : {}),
    status: config.status,
    role: config.role,
    specialtyTags: config.specialtyTags,
    avoidTasks: config.avoidTasks,
    teamIds: config.teamIds,
    delegationEnabled: config.delegation.enabled,
    source: "topology",
    config,
    permissionProfile: config.capabilityPolicy.permissionProfile,
    capabilityPolicy: config.capabilityPolicy,
    skillMcpSummary: capabilityModelSummary.skillMcpSummary,
    capabilitySummary: capabilityModelSummary.capabilitySummary,
    modelSummary: capabilityModelSummary.modelSummary,
    degradedReasonCodes: capabilityModelSummary.degradedReasonCodes,
    currentLoad: {
      activeSubSessions,
      queuedSubSessions: 0,
      failedSubSessions: 0,
      completedSubSessions: 0,
      maxParallelSessions: config.delegation.maxParallelSessions,
      utilization: activeSubSessions / config.delegation.maxParallelSessions,
    },
    failureRate: {
      windowMs: 1,
      consideredSubSessions: 0,
      failedSubSessions: 0,
      value: 0,
    },
  }
}

function registry(input: {
  agents: Array<{ config: SubAgentConfig; activeSubSessions?: number }>
  directChildrenByParent: Record<string, string[]>
}): OrchestrationRegistrySnapshot {
  return {
    generatedAt: now,
    agents: input.agents.map((agent) => registryEntry(agent.config, agent.activeSubSessions ?? 0)),
    teams: [],
    hierarchy: {
      rootAgentId: rootExecutorId,
      fallbackActive: false,
      directChildrenByParent: input.directChildrenByParent,
      topLevelSubAgentIds: input.directChildrenByParent[rootExecutorId] ?? [],
      directChildren: Object.entries(input.directChildrenByParent).flatMap(([parentAgentId, childIds]) =>
        childIds.map((childAgentId, index) => ({
          parentAgentId,
          childAgentId,
          edgeId: `${parentAgentId}->${childAgentId}:${index}`,
          relationshipStatus: "active" as const,
          source: "agent_relationship" as const,
          executionCandidate: true,
          reasonCodes: ["test_direct_child"],
        })),
      ),
      diagnostics: [],
    },
    membershipEdges: [],
    diagnostics: [],
  }
}

function modeSnapshot(activeSubAgentCount: number): OrchestrationModeSnapshot {
  return {
    mode: "orchestration",
    status: "ready",
    featureFlagEnabled: true,
    requestedMode: "orchestration",
    activeSubAgentCount,
    totalSubAgentCount: activeSubAgentCount,
    disabledSubAgentCount: 0,
    activeSubAgents: Array.from({ length: activeSubAgentCount }, (_, index) => ({
      agentId: `workspace:draft:node:executor-${index + 1}`,
      displayName: `실행자 ${index + 1}`,
      source: "topology" as const,
    })),
    reasonCode: "orchestration_ready",
    reason: "test",
    generatedAt: now,
  }
}

function decision(selectedExecutorId: string): AgentExecutionDecision {
  return {
    contract_version: AGENT_EXECUTION_DECISION_CONTRACT_VERSION,
    current_executor_id: rootExecutorId,
    domain: "planner_contract_test",
    behavior_pattern: "delegate",
    execution_route: "delegate_to_child",
    selected_executor_id: selectedExecutorId,
    selected_connection_path: [rootExecutorId, selectedExecutorId],
    task_profile: {
      title: "검증된 위임",
      summary: "노비가 프롬프트 판단으로 선택한 실행자를 planner가 그대로 계획으로 변환한다.",
      goals: ["선택된 실행자에게만 위임한다."],
      task_units: [
        {
          id: "unit:1",
          title: "처리",
          goal: "요청을 처리한다.",
          preferred_executor_id: selectedExecutorId,
        },
      ],
      success_criteria: ["임의 대체 없이 같은 실행자에게 배정한다."],
    },
    required_outputs: [
      {
        id: "answer",
        label: "처리 결과",
      },
    ],
    risk_boundary: {
      requires_user_approval: false,
      reason: "테스트 범위의 안전 작업",
    },
    confidence: 0.94,
    fallback_if_unavailable: "direct_current_agent",
    reason: "검증된 실행 결정 테스트입니다.",
  }
}

describe("task007 planner without implicit agent selection", () => {
  it("does not pick the first agent from activeSubAgents when no execution decision exists", () => {
    const snapshot = registry({
      agents: Array.from({ length: 5 }, (_, index) => ({
        config: subAgent({
          agentId: `workspace:draft:node:executor-${index + 1}`,
          displayName: `실행자 ${index + 1}`,
          activeSubSessions: index === 0 ? 5 : 0,
        }),
      })),
      directChildrenByParent: {
        [rootExecutorId]: [
          "workspace:draft:node:executor-1",
          "workspace:draft:node:executor-2",
          "workspace:draft:node:executor-3",
          "workspace:draft:node:executor-4",
          "workspace:draft:node:executor-5",
        ],
      },
    })

    const result = buildOrchestrationPlan({
      parentRunId: "run:no-decision",
      parentRequestId: "request:no-decision",
      userRequest: "코스피 투자 질문을 분석해줘",
      modeSnapshot: modeSnapshot(5),
      registrySnapshot: snapshot,
      now: () => now,
      idProvider: () => "plan:no-decision",
    })

    expect(result.plan.delegatedTasks).toHaveLength(0)
    expect(result.plan.directNobieTasks).toHaveLength(1)
    expect(result.plan.fallbackStrategy).toMatchObject({
      mode: "direct_current_agent",
      reasonCode: "execution_decision_required",
    })
    expect(result.plan.plannerMetadata?.candidateScores?.some((candidate) => candidate.selected)).toBe(
      false,
    )
    expect(result.plan.plannerMetadata?.fallbackReasonCodes?.[0]).not.toBe(
      "delegate_failure_single_nobie",
    )
    expect(validateOrchestrationPlan(result.plan).ok).toBe(true)
  })

  it("does not create a delegated plan from explicit planner intent without execution decision", () => {
    const snapshot = registry({
      agents: [
        {
          config: subAgent({
            agentId: "workspace:draft:node:executor-1",
            displayName: "명시 실행자",
          }),
        },
      ],
      directChildrenByParent: {
        [rootExecutorId]: ["workspace:draft:node:executor-1"],
      },
    })

    const result = buildOrchestrationPlan({
      parentRunId: "run:intent-only",
      parentRequestId: "request:intent-only",
      userRequest: "명시 실행자에게 맡겨줘",
      modeSnapshot: modeSnapshot(1),
      registrySnapshot: snapshot,
      intent: { explicitAgentId: "workspace:draft:node:executor-1" },
      now: () => now,
      idProvider: () => "plan:intent-only",
    })

    expect(result.plan.delegatedTasks).toHaveLength(0)
    expect(result.plan.directNobieTasks).toHaveLength(1)
    expect(result.plan.fallbackStrategy).toMatchObject({
      mode: "direct_current_agent",
      reasonCode: "execution_decision_required",
      currentExecutorId: rootExecutorId,
      unresolvedReasonCode: "execution_decision_missing",
    })
    expect(result.plan.plannerMetadata).toMatchObject({
      rejectedExecutorId: "workspace:draft:node:executor-1",
      rejectedReasonCodes: ["explicit_target_requires_execution_decision"],
      fallbackMode: "direct_current_agent",
    })
    expect(validateOrchestrationPlan(result.plan).ok).toBe(true)
  })

  it("converts a validated decision selecting 행랑아범 into the same planner assignedAgentId", () => {
    const snapshot = registry({
      agents: [
        { config: subAgent({ agentId: "workspace:draft:node:executor-1", displayName: "삼식이" }) },
        {
          config: subAgent({
            agentId: "workspace:draft:node:executor-5",
            displayName: "행랑아범",
          }),
        },
      ],
      directChildrenByParent: {
        [rootExecutorId]: [
          "workspace:draft:node:executor-1",
          "workspace:draft:node:executor-5",
        ],
      },
    })

    const result = buildOrchestrationPlan({
      parentRunId: "run:decision",
      parentRequestId: "request:decision",
      userRequest: "코스피 질문을 재무 담당에게 맡겨줘",
      modeSnapshot: modeSnapshot(2),
      registrySnapshot: snapshot,
      agentExecutionDecision: decision("workspace:draft:node:executor-5"),
      now: () => now,
      idProvider: () => "plan:decision",
    })

    expect(result.plan.directNobieTasks).toHaveLength(0)
    expect(result.plan.delegatedTasks).toHaveLength(1)
    expect(result.plan.delegatedTasks[0]?.assignedAgentId).toBe(
      "workspace:draft:node:executor-5",
    )
    expect(result.plan.delegatedTasks[0]?.planningTrace.reasonCodes).toContain(
      "execution_decision_selected_executor",
    )
    expect(result.plan.delegatedTasks[0]?.planningTrace.selectedSource).toBe(
      "execution_decision",
    )
    expect(result.plan.plannerMetadata?.selectedExecutorSource).toBe("execution_decision")
    expect(result.plan.plannerMetadata?.selectedExecutorId).toBe(
      "workspace:draft:node:executor-5",
    )
    expect(result.plan.plannerMetadata?.reasonCodes).toContain(
      "execution_decision_selected_executor",
    )
    expect(validateOrchestrationPlan(result.plan).ok).toBe(true)
  })

  it("does not replace a selected executor that is not the current executor's direct child", () => {
    const snapshot = registry({
      agents: [
        { config: subAgent({ agentId: "workspace:draft:node:executor-1", displayName: "삼식이" }) },
        { config: subAgent({ agentId: "workspace:draft:node:executor-2", displayName: "영수" }) },
        {
          config: subAgent({
            agentId: "workspace:draft:node:executor-5",
            displayName: "행랑아범",
          }),
        },
      ],
      directChildrenByParent: {
        [rootExecutorId]: [
          "workspace:draft:node:executor-1",
          "workspace:draft:node:executor-5",
        ],
        "workspace:draft:node:executor-1": ["workspace:draft:node:executor-2"],
      },
    })

    const result = buildOrchestrationPlan({
      parentRunId: "run:indirect",
      parentRequestId: "request:indirect",
      userRequest: "간접 하위 실행자를 임의로 타면 안 된다",
      modeSnapshot: modeSnapshot(3),
      registrySnapshot: snapshot,
      agentExecutionDecision: decision("workspace:draft:node:executor-2"),
      now: () => now,
      idProvider: () => "plan:indirect",
    })

    expect(result.plan.delegatedTasks).toHaveLength(0)
    expect(result.plan.directNobieTasks).toHaveLength(1)
    expect(result.plan.fallbackStrategy).toMatchObject({
      mode: "ask_user",
      reasonCode: "explicit_agent_target_unavailable",
      currentExecutorId: rootExecutorId,
      unresolvedReasonCode: "selected_executor_rejected",
    })
    expect(result.reasonCodes).toContain("explicit_agent_not_direct_child")
    expect(result.plan.plannerMetadata?.rejectedExecutorId).toBe(
      "workspace:draft:node:executor-2",
    )
    expect(result.plan.plannerMetadata?.rejectedReasonCodes).toContain(
      "explicit_agent_not_direct_child",
    )
    expect(
      result.plan.plannerMetadata?.candidateScores?.filter((candidate) => candidate.selected),
    ).toEqual([])
    expect(result.plan.plannerMetadata?.fallbackReasonCodes?.[0]).not.toBe(
      "delegate_failure_single_nobie",
    )
    expect(validateOrchestrationPlan(result.plan).ok).toBe(true)
  })

  it("rejects root-only fallback plans emitted by a non-root executor", () => {
    const snapshot = registry({
      agents: [],
      directChildrenByParent: {
        [rootExecutorId]: [],
      },
    })
    const result = buildOrchestrationPlan({
      parentRunId: "run:root-only",
      parentRequestId: "request:root-only",
      userRequest: "직접 처리",
      modeSnapshot: modeSnapshot(0),
      registrySnapshot: snapshot,
      parentAgentId: "workspace:draft:node:worker",
      now: () => now,
      idProvider: () => "plan:root-only",
    })
    const invalidPlan: OrchestrationPlan = {
      ...result.plan,
      fallbackStrategy: {
        mode: "root_nobie_direct",
        reasonCode: "invalid_child_root_direct",
        currentExecutorId: "workspace:draft:node:worker",
      },
    }

    const validation = validateOrchestrationPlan(invalidPlan)

    expect(validation.ok).toBe(false)
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$.fallbackStrategy.currentExecutorId",
        }),
      ]),
    )
  })
})
