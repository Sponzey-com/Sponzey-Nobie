import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import type {
  AgentPromptBundle,
  CapabilityPolicy,
  CommandRequest,
  ExpectedOutputContract,
  ModelExecutionSnapshot,
  OrchestrationPlan,
  RuntimeIdentity,
  StructuredTaskScope,
  SubSessionContract,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import { closeDb, getRunSubSession, insertRunSubSession } from "../packages/core/src/db/index.js"
import {
  applyNestedSpawnBudget,
  buildNestedDelegationPlan,
  validateNestedCommandRequest,
} from "../packages/core/src/orchestration/nested-delegation.ts"
import type {
  AgentRegistryEntry,
  OrchestrationRegistrySnapshot,
} from "../packages/core/src/orchestration/registry.ts"
import {
  controlSubSession,
  spawnSubSessionAck,
} from "../packages/core/src/orchestration/sub-session-control.ts"
import { buildSubSessionContract } from "../packages/core/src/orchestration/sub-session-runner.ts"
import { evaluateAgentToolCapabilityPolicy } from "../packages/core/src/security/capability-isolation.ts"
import { buildRunRuntimeInspectorProjection } from "../packages/core/src/runs/runtime-inspector-projection.ts"
import type { RootRun } from "../packages/core/src/runs/types.ts"
import type { ToolContext } from "../packages/core/src/tools/types.ts"

const now = Date.UTC(2026, 3, 24, 0, 0, 0)
const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task027-nested-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = undefined
  reloadConfig()
}

function restoreState(): void {
  closeDb()
  if (previousStateDir === undefined) process.env.NOBIE_STATE_DIR = undefined
  else process.env.NOBIE_STATE_DIR = previousStateDir
  if (previousConfig === undefined) process.env.NOBIE_CONFIG = undefined
  else process.env.NOBIE_CONFIG = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
}

const expectedOutput: ExpectedOutputContract = {
  outputId: "answer",
  kind: "text",
  description: "Answer",
  required: true,
  acceptance: { requiredEvidenceKinds: [], artifactRequired: false, reasonCodes: ["done"] },
}

function taskScope(goal: string): StructuredTaskScope {
  return {
    goal,
    intentType: "test",
    actionType: "nested_delegation",
    constraints: [],
    expectedOutputs: [expectedOutput],
    reasonCodes: ["task027_scope"],
  }
}

function policy(): CapabilityPolicy {
  return {
    permissionProfile: {
      profileId: "profile:task027",
      riskCeiling: "dangerous",
      approvalRequiredFrom: "dangerous",
      allowExternalNetwork: true,
      allowFilesystemWrite: true,
      allowShellExecution: true,
      allowScreenControl: false,
      allowedPaths: [],
    },
    skillMcpAllowlist: {
      enabledSkillIds: [],
      enabledMcpServerIds: [],
      enabledToolNames: ["file_write", "web_search", "shell_exec"],
      disabledToolNames: [],
    },
    rateLimit: { maxConcurrentCalls: 2 },
  }
}

function registryAgent(agentId: string): AgentRegistryEntry {
  const capabilityPolicy = policy()
  return {
    agentId,
    displayName: agentId,
    status: "enabled",
    role: "worker",
    specialtyTags: ["test"],
    avoidTasks: [],
    teamIds: [],
    delegationEnabled: true,
    retryBudget: 2,
    source: "db",
    config: {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      agentType: "sub_agent",
      agentId,
      displayName: agentId,
      status: "enabled",
      role: "worker",
      personality: "precise",
      specialtyTags: ["test"],
      avoidTasks: [],
      memoryPolicy: {
        owner: { ownerType: "sub_agent", ownerId: agentId },
        visibility: "private",
        readScopes: [{ ownerType: "sub_agent", ownerId: agentId }],
        writeScope: { ownerType: "sub_agent", ownerId: agentId },
        retentionPolicy: "short_term",
        writebackReviewRequired: true,
      },
      capabilityPolicy,
      delegationPolicy: { enabled: true, maxParallelSessions: 2, retryBudget: 2 },
      teamIds: [],
      delegation: { enabled: true, maxParallelSessions: 2, retryBudget: 2 },
      profileVersion: 1,
      createdAt: now,
      updatedAt: now,
    },
    permissionProfile: capabilityPolicy.permissionProfile,
    capabilityPolicy,
    skillMcpSummary: {
      enabledSkillIds: [],
      enabledMcpServerIds: [],
      enabledToolNames: capabilityPolicy.skillMcpAllowlist.enabledToolNames,
      disabledToolNames: [],
    },
    capabilitySummary: {
      agentId,
      available: true,
      availability: "available",
      enabledSkillIds: [],
      disabledSkillIds: [],
      enabledMcpServerIds: [],
      disabledMcpServerIds: [],
      enabledToolNames: capabilityPolicy.skillMcpAllowlist.enabledToolNames,
      disabledToolNames: [],
      secretScopes: [],
      skillBindings: [],
      mcpServerBindings: [],
      diagnostics: [],
      diagnosticReasonCodes: [],
    },
    modelSummary: {
      agentId,
      configured: true,
      available: true,
      availability: "available",
      providerId: "provider:test",
      modelId: "model:test",
      retryCount: 1,
      costBudget: 1,
      diagnostics: [],
      diagnosticReasonCodes: [],
    },
    degradedReasonCodes: [],
    currentLoad: {
      activeSubSessions: 0,
      queuedSubSessions: 0,
      failedSubSessions: 0,
      completedSubSessions: 0,
      maxParallelSessions: 2,
      utilization: 0,
    },
    failureRate: { windowMs: 1, consideredSubSessions: 0, failedSubSessions: 0, value: 0 },
  }
}

function registry(): OrchestrationRegistrySnapshot {
  const directChildrenByParent = {
    "agent:nobie": ["agent:a"],
    "agent:a": ["agent:b"],
    "agent:b": ["agent:c"],
  }
  return {
    status: "ready",
    generatedAt: now,
    agents: ["agent:a", "agent:b", "agent:c"].map(registryAgent),
    teams: [],
    hierarchy: {
      rootAgentId: "agent:nobie",
      fallbackActive: false,
      directChildrenByParent,
      topLevelSubAgentIds: ["agent:a"],
      directChildren: [],
      diagnostics: [],
    },
    capabilityIndex: {
      generatedAt: now,
      cacheKey: "task027",
      rootAgentId: "agent:nobie",
      topLevelCandidateAgentIds: ["agent:a"],
      directChildAgentIdsByParent: directChildrenByParent,
      candidateAgentIdsByParent: directChildrenByParent,
      excludedCandidatesByParent: {},
      candidatesByAgentId: {},
      diagnostics: [],
      metrics: { buildLatencyMs: 0, targetP95Ms: 150 },
    },
    invalidation: { cacheKey: "task027", configHash: "hash", tables: {} },
    metrics: { buildLatencyMs: 0, coldSnapshotTargetP95Ms: 500, hotIndexTargetP95Ms: 150 },
    membershipEdges: [],
    diagnostics: [],
  }
}

const modeSnapshot = {
  mode: "orchestration",
  status: "ready",
  featureFlagEnabled: true,
  requestedMode: "orchestration",
  activeSubAgentCount: 3,
  totalSubAgentCount: 3,
  disabledSubAgentCount: 0,
  activeSubAgents: [],
  reasonCode: "orchestration_ready",
  reason: "ready",
  generatedAt: now,
} as const

function identity(
  entityType: RuntimeIdentity["entityType"],
  entityId: string,
  ownerId: string,
  parentSubSessionId?: string,
): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType,
    entityId,
    owner: { ownerType: ownerId === "agent:nobie" ? "nobie" : "sub_agent", ownerId },
    idempotencyKey: `idem:${entityId}`,
    parent: {
      parentRunId: "run:task027",
      parentSessionId: "session:task027",
      parentRequestId: "request:task027",
      ...(parentSubSessionId ? { parentSubSessionId } : {}),
    },
  }
}

function command(
  subSessionId: string,
  targetAgentId: string,
  parentSubSessionId?: string,
): CommandRequest {
  return {
    identity: identity("sub_session", subSessionId, targetAgentId, parentSubSessionId),
    commandRequestId: `command:${subSessionId}`,
    parentRunId: "run:task027",
    subSessionId,
    targetAgentId,
    taskScope: taskScope(`run ${subSessionId}`),
    contextPackageIds: [],
    expectedOutputs: [expectedOutput],
    retryBudget: 1,
  }
}

function promptBundle(agentId: string): AgentPromptBundle {
  const capabilityPolicy = policy()
  return {
    identity: identity("sub_session", `prompt:${agentId}`, agentId),
    bundleId: `bundle:${agentId}`,
    agentId,
    agentType: "sub_agent",
    role: "worker",
    displayNameSnapshot: agentId,
    personalitySnapshot: "precise",
    teamContext: [],
    memoryPolicy: {
      owner: { ownerType: "sub_agent", ownerId: agentId },
      visibility: "private",
      readScopes: [{ ownerType: "sub_agent", ownerId: agentId }],
      writeScope: { ownerType: "sub_agent", ownerId: agentId },
      retentionPolicy: "short_term",
      writebackReviewRequired: true,
    },
    capabilityPolicy,
    modelProfileSnapshot: {
      providerId: "provider:test",
      modelId: "model:test",
      timeoutMs: 1000,
      retryCount: 1,
      costBudget: 0.5,
    },
    taskScope: taskScope(`prompt ${agentId}`),
    safetyRules: [],
    sourceProvenance: [],
    completionCriteria: [expectedOutput],
    createdAt: now,
  }
}

function runInput(
  subSessionId: string,
  parentAgentId: string,
  targetAgentId: string,
  parentSubSessionId?: string,
  modelExecutionPolicy?: ModelExecutionSnapshot,
) {
  return {
    command: command(subSessionId, targetAgentId, parentSubSessionId),
    parentAgent: { agentId: parentAgentId, displayName: parentAgentId },
    agent: { agentId: targetAgentId, displayName: targetAgentId },
    parentSessionId: "session:task027",
    promptBundle: promptBundle(targetAgentId),
    ...(modelExecutionPolicy ? { modelExecutionPolicy } : {}),
  }
}

function subSession(
  subSessionId: string,
  agentId: string,
  parentAgentId: string,
  parentSubSessionId?: string,
  status: SubSessionContract["status"] = "running",
): SubSessionContract {
  return {
    ...buildSubSessionContract(runInput(subSessionId, parentAgentId, agentId, parentSubSessionId)),
    status,
  }
}

function rootRun(subSessionsSnapshot: SubSessionContract[]): RootRun {
  return {
    id: "run:task027",
    sessionId: "session:task027",
    requestGroupId: "run:task027",
    lineageRootRunId: "run:task027",
    runScope: "root",
    title: "task027",
    prompt: "task027",
    source: "webui",
    status: "running",
    taskProfile: "planning",
    contextMode: "full",
    orchestrationMode: "orchestration",
    orchestrationPlanSnapshot: {
      identity: identity("session", "plan:task027", "agent:nobie"),
      planId: "plan:task027",
      parentRunId: "run:task027",
      parentRequestId: "request:task027",
      directNobieTasks: [],
      delegatedTasks: [],
      dependencyEdges: [],
      resourceLocks: [],
      parallelGroups: [],
      approvalRequirements: [],
      fallbackStrategy: { mode: "single_nobie", reasonCode: "fallback" },
      createdAt: now,
    } satisfies OrchestrationPlan,
    subSessionsSnapshot,
    delegationTurnCount: 0,
    maxDelegationTurns: 5,
    currentStepKey: "executing",
    currentStepIndex: 4,
    totalSteps: 9,
    summary: "running",
    canCancel: true,
    createdAt: now,
    updatedAt: now,
    steps: [],
    recentEvents: [],
  }
}

beforeEach(() => {
  useTempState()
})

afterEach(() => {
  restoreState()
})

describe("task027 nested delegation and depth scoped policy", () => {
  it("plans only direct children for nested delegation and carries parentSubSessionId", () => {
    const result = buildNestedDelegationPlan({
      parentRunId: "run:task027",
      parentRequestId: "request:task027",
      parentAgentId: "agent:a",
      parentSubSessionId: "sub:a",
      parentSubSessionDepth: 1,
      userRequest: "delegate nested work",
      modeSnapshot,
      registrySnapshot: registry(),
      taskScopes: [taskScope("child task")],
      maxDepth: 3,
      now: () => now,
      idProvider: () => "plan:nested",
    })
    expect(result.ok).toBe(true)
    expect(result.plan?.identity.parent?.parentSubSessionId).toBe("sub:a")
    expect(result.plan?.delegatedTasks).toEqual([
      expect.objectContaining({ assignedAgentId: "agent:b" }),
    ])

    const crossTree = buildNestedDelegationPlan({
      parentRunId: "run:task027",
      parentRequestId: "request:task027",
      parentAgentId: "agent:a",
      parentSubSessionId: "sub:a",
      parentSubSessionDepth: 1,
      userRequest: "delegate nested explicit target",
      modeSnapshot,
      registrySnapshot: registry(),
      intent: { explicitAgentId: "agent:c" },
      taskScopes: [taskScope("cross tree")],
      maxDepth: 3,
      now: () => now,
      idProvider: () => "plan:cross-tree",
    })
    expect(crossTree.ok).toBe(false)
    expect(crossTree.reasonCodes).toEqual(
      expect.arrayContaining(["nested_delegation_no_direct_child_candidate"]),
    )
    expect(crossTree.reasonCodes).toEqual(
      expect.arrayContaining(["explicit_agent_not_direct_child"]),
    )

    const rootToGrandchild = buildNestedDelegationPlan({
      parentRunId: "run:task027",
      parentRequestId: "request:task027",
      parentAgentId: "agent:nobie",
      parentSubSessionDepth: 0,
      userRequest: "delegate explicit descendant",
      modeSnapshot,
      registrySnapshot: registry(),
      intent: { explicitAgentId: "agent:c" },
      taskScopes: [taskScope("root cannot target grandchild")],
      maxDepth: 3,
      now: () => now,
      idProvider: () => "plan:root-grandchild",
    })
    expect(rootToGrandchild.ok).toBe(false)
    expect(rootToGrandchild.reasonCodes).toEqual(
      expect.arrayContaining(["explicit_agent_not_direct_child"]),
    )
  })

  it("blocks max depth and shrinks by max children plus nested spawn budget", () => {
    const tooDeep = buildNestedDelegationPlan({
      parentRunId: "run:task027",
      parentRequestId: "request:task027",
      parentAgentId: "agent:b",
      parentSubSessionId: "sub:b",
      parentSubSessionDepth: 2,
      userRequest: "too deep",
      modeSnapshot,
      registrySnapshot: registry(),
      maxDepth: 2,
    })
    expect(tooDeep).toMatchObject({
      ok: false,
      status: "blocked",
      reasonCodes: expect.arrayContaining(["max_depth_exceeded"]),
    })

    const budget = applyNestedSpawnBudget({
      taskScopes: [taskScope("one"), taskScope("two"), taskScope("three")],
      maxChildrenPerAgent: 2,
      nestedSpawnBudgetRemaining: 1,
    })
    expect(budget).toMatchObject({
      status: "shrunk",
      totals: { requestedChildren: 3, selectedChildren: 1, remainingBudget: 0 },
      reasonCodes: ["nested_spawn_budget_exhausted"],
    })
  })

  it("requires nested CommandRequest parentSubSessionId and stores it with model policy snapshot", () => {
    expect(
      validateNestedCommandRequest({
        command: command("sub:b", "agent:b"),
        parentAgentId: "agent:a",
      }),
    ).toMatchObject({ ok: false, reasonCodes: ["nested_parent_sub_session_required"] })

    const modelExecutionPolicy: ModelExecutionSnapshot = {
      providerId: "provider:test",
      modelId: "model:test",
      fallbackApplied: false,
      retryCount: 1,
      timeoutMs: 1000,
      costBudget: 0.25,
      estimatedInputTokens: 100,
      estimatedOutputTokens: 50,
      estimatedCost: 0.01,
      reasonCodes: ["nested_model_policy_snapshot"],
    }
    const ack = spawnSubSessionAck({
      input: runInput("sub:b", "agent:a", "agent:b", "sub:a", modelExecutionPolicy),
    })
    expect(ack).toMatchObject({ ok: true, status: "queued", subSessionId: "sub:b" })
    const row = getRunSubSession("sub:b")
    expect(row?.parent_sub_session_id).toBe("sub:a")
    const stored = JSON.parse(String(row?.contract_json)) as SubSessionContract
    expect(stored.modelExecutionSnapshot).toEqual(
      expect.objectContaining({ costBudget: 0.25, timeoutMs: 1000 }),
    )
  })

  it("denies tools outside the configured depth scoped tool policy", () => {
    const ctx: ToolContext = {
      sessionId: "session:task027",
      runId: "run:task027",
      workDir: process.cwd(),
      userMessage: "depth policy",
      source: "webui",
      allowWebAccess: true,
      onProgress: () => {},
      signal: new AbortController().signal,
      agentId: "agent:b",
      agentType: "sub_agent",
      capabilityPolicy: policy(),
      delegationDepth: 2,
      depthScopedToolPolicy: {
        maxDepthByToolKind: { filesystem: 1, network: 3 },
      },
    }
    expect(
      evaluateAgentToolCapabilityPolicy({ toolName: "file_write", riskLevel: "dangerous", ctx }),
    ).toMatchObject({
      allowed: false,
      reasonCode: "depth_scoped_tool_denied",
      diagnostic: expect.objectContaining({ toolKind: "filesystem", depth: 2, limit: 1 }),
    })
    expect(
      evaluateAgentToolCapabilityPolicy({ toolName: "web_search", riskLevel: "external", ctx }),
    ).toMatchObject({ allowed: true, reasonCode: "capability_allowed" })
  })

  it("projects the parentSubSession tree and routes nested result aggregation upward", () => {
    const parent = subSession("sub:a", "agent:a", "agent:nobie")
    const child = subSession("sub:b", "agent:b", "agent:a", "sub:a")
    const grandchild = subSession("sub:c", "agent:c", "agent:b", "sub:b")
    const projection = buildRunRuntimeInspectorProjection(rootRun([parent, child, grandchild]), {
      now,
    })
    const byId = new Map(projection.subSessions.map((item) => [item.subSessionId, item]))
    expect(byId.get("sub:a")).toEqual(
      expect.objectContaining({
        depth: 1,
        childSubSessionIds: ["sub:b"],
        resultAggregationStage: "nobie_finalization",
      }),
    )
    expect(byId.get("sub:c")).toEqual(
      expect.objectContaining({
        parentSubSessionId: "sub:b",
        depth: 3,
        resultAggregationStage: "parent_sub_agent_review",
        resultReturnTargetAgentId: "agent:b",
        resultReturnTargetSubSessionId: "sub:b",
      }),
    )
  })

  it("cascades sub-session kill to nested children", () => {
    const parent = subSession("sub:a", "agent:a", "agent:nobie")
    const child = subSession("sub:b", "agent:b", "agent:a", "sub:a")
    const grandchild = subSession("sub:c", "agent:c", "agent:b", "sub:b")
    insertRunSubSession(parent, { now })
    insertRunSubSession(child, { now })
    insertRunSubSession(grandchild, { now })

    const result = controlSubSession({ subSessionId: "sub:a", action: "kill" })
    expect(result).toMatchObject({
      ok: true,
      reasonCode: "sub_session_kill_accepted",
      affectedSubSessionIds: ["sub:a", "sub:b", "sub:c"],
    })
    expect(JSON.parse(String(getRunSubSession("sub:b")?.contract_json)).status).toBe("cancelled")
    expect(JSON.parse(String(getRunSubSession("sub:c")?.contract_json)).status).toBe("cancelled")
  })
})
