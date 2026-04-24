import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { registerAgentRoutes } from "../packages/core/src/api/routes/agent.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import type {
  CapabilityPolicy,
  OwnerScope,
  StructuredTaskScope,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import { closeDb } from "../packages/core/src/db/index.js"
import {
  buildHistoryVersion,
  dryRunRestoreHistoryVersion,
  evaluateLearningPolicy,
  listAgentLearningEvents,
  listHistoryVersions,
  listLearningReviewQueue,
  listRestoreEvents,
  recordHistoryVersion,
  recordLearningEvent,
  restoreHistoryVersion,
} from "../packages/core/src/index.ts"
import { listOrchestrationEventLedger } from "../packages/core/src/orchestration/event-ledger.ts"
import { buildOrchestrationPlan } from "../packages/core/src/orchestration/planner.ts"
import type {
  AgentRegistryEntry,
  OrchestrationRegistrySnapshot,
} from "../packages/core/src/orchestration/registry.ts"

const require = createRequire(import.meta.url)
const Fastify = require("../packages/core/node_modules/fastify") as (options: {
  logger: boolean
}) => {
  ready(): Promise<void>
  close(): Promise<void>
  inject(options: { method: string; url: string; payload?: unknown }): Promise<{
    statusCode: number
    json(): Record<string, unknown>
  }>
}

const now = Date.UTC(2026, 3, 24, 0, 0, 0)
const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task028-learning-"))
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

function owner(ownerType: OwnerScope["ownerType"], ownerId: string): OwnerScope {
  return { ownerType, ownerId }
}

function capabilityPolicy(): CapabilityPolicy {
  return {
    permissionProfile: {
      profileId: "profile:task028",
      riskCeiling: "safe",
      approvalRequiredFrom: "moderate",
      allowExternalNetwork: false,
      allowFilesystemWrite: false,
      allowShellExecution: false,
      allowScreenControl: false,
      allowedPaths: [],
    },
    skillMcpAllowlist: {
      enabledSkillIds: [],
      enabledMcpServerIds: [],
      enabledToolNames: [],
      disabledToolNames: [],
    },
    rateLimit: { maxConcurrentCalls: 1 },
  }
}

function registryAgent(agentId: string, specialtyTags: string[]): AgentRegistryEntry {
  const policy = capabilityPolicy()
  return {
    agentId,
    displayName: agentId,
    status: "enabled",
    role: "researcher",
    specialtyTags,
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
      role: "researcher",
      personality: "precise",
      specialtyTags,
      avoidTasks: [],
      memoryPolicy: {
        owner: owner("sub_agent", agentId),
        visibility: "private",
        readScopes: [owner("sub_agent", agentId)],
        writeScope: owner("sub_agent", agentId),
        retentionPolicy: "long_term",
        writebackReviewRequired: true,
      },
      capabilityPolicy: policy,
      delegationPolicy: { enabled: true, maxParallelSessions: 1, retryBudget: 2 },
      teamIds: [],
      delegation: { enabled: true, maxParallelSessions: 1, retryBudget: 2 },
      profileVersion: 1,
      createdAt: now,
      updatedAt: now,
    },
    permissionProfile: policy.permissionProfile,
    capabilityPolicy: policy,
    skillMcpSummary: {
      enabledSkillIds: [],
      enabledMcpServerIds: [],
      enabledToolNames: [],
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
      enabledToolNames: [],
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
      providerId: "provider:task028",
      modelId: "model:task028",
      retryCount: 1,
      costBudget: 1,
      diagnostics: [],
      diagnosticReasonCodes: [],
    },
    degradedReasonCodes: [],
    currentLoad: {
      activeSubSessions: 0,
      queuedSubSessions: 0,
      completedSubSessions: 0,
      failedSubSessions: 0,
      maxParallelSessions: 1,
      utilization: 0,
    },
    failureRate: { windowMs: 60_000, consideredSubSessions: 0, failedSubSessions: 0, value: 0 },
  }
}

function registry(): OrchestrationRegistrySnapshot {
  const directChildrenByParent = {
    "agent:nobie": ["agent:a"],
    "agent:a": ["agent:b"],
  }
  return {
    status: "ready",
    generatedAt: now,
    agents: [registryAgent("agent:a", ["research"]), registryAgent("agent:b", ["research"])],
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
      cacheKey: "task028",
      rootAgentId: "agent:nobie",
      topLevelCandidateAgentIds: ["agent:a"],
      directChildAgentIdsByParent: directChildrenByParent,
      candidateAgentIdsByParent: directChildrenByParent,
      excludedCandidatesByParent: {},
      candidatesByAgentId: {},
      diagnostics: [],
      metrics: { buildLatencyMs: 0, targetP95Ms: 150 },
    },
    invalidation: { cacheKey: "task028", configHash: "hash", tables: {} },
    metrics: { buildLatencyMs: 0, coldSnapshotTargetP95Ms: 500, hotIndexTargetP95Ms: 150 },
    membershipEdges: [],
    diagnostics: [],
  }
}

function scope(): StructuredTaskScope {
  return {
    goal: "Produce a research summary.",
    intentType: "research",
    actionType: "summarize",
    constraints: [],
    expectedOutputs: [
      {
        outputId: "summary",
        kind: "text",
        description: "Research summary",
        required: true,
        acceptance: { requiredEvidenceKinds: [], artifactRequired: false, reasonCodes: ["done"] },
      },
    ],
    reasonCodes: ["task028_scope"],
  }
}

beforeEach(() => {
  useTempState()
})

afterEach(() => {
  restoreState()
})

describe("task028 learning history restore", () => {
  it("records agent-scoped LearningEvent metadata and emits a learning_recorded ledger event", async () => {
    const researcher = owner("sub_agent", "agent:researcher")
    const result = await recordLearningEvent({
      agentId: "agent:researcher",
      agentType: "sub_agent",
      sourceRunId: "run:task028:learning",
      sourceSessionId: "session:task028",
      sourceSubSessionId: "sub:task028",
      actorOwner: researcher,
      targetOwner: researcher,
      learningTarget: "memory",
      before: {},
      after: { preference: "cite evidence refs" },
      beforeSummary: "",
      afterSummary: "Always cite evidence refs when reporting research.",
      evidenceRefs: ["result:task028:research"],
      confidence: 0.94,
      auditCorrelationId: "audit:task028:learning",
      now: () => now,
    })

    expect(result.policy.approvalState).toBe("auto_applied")
    expect(result.history?.targetEntityId).toBe("agent:researcher")
    expect(listAgentLearningEvents("agent:researcher")).toEqual([
      expect.objectContaining({
        agentId: "agent:researcher",
        sourceRunId: "run:task028:learning",
        sourceSubSessionId: "sub:task028",
        evidenceRefs: ["result:task028:research"],
        confidence: 0.94,
      }),
    ])
    expect(listHistoryVersions("memory", "agent:researcher")).toHaveLength(1)
    expect(listHistoryVersions("memory", "agent:writer")).toHaveLength(0)

    expect(listOrchestrationEventLedger({ runId: "run:task028:learning" })).toEqual([
      expect.objectContaining({
        eventKind: "learning_recorded",
        agentId: "agent:researcher",
        payload: expect.objectContaining({
          learningEventId: result.event.learningEventId,
          approvalState: "auto_applied",
          historyVersionId: result.history?.historyVersionId,
        }),
      }),
    ])
  })

  it("keeps missing-evidence and permission-expansion learning in the review queue", async () => {
    const researcher = owner("sub_agent", "agent:researcher")
    const missingEvidence = await recordLearningEvent({
      agentId: "agent:researcher",
      agentType: "sub_agent",
      sourceRunId: "run:task028:pending",
      actorOwner: researcher,
      targetOwner: researcher,
      learningTarget: "memory",
      before: {},
      after: { preference: "unproven preference" },
      beforeSummary: "",
      afterSummary: "Unproven preference.",
      evidenceRefs: [],
      confidence: 0.96,
      learningEventId: "learning:task028:missing-evidence",
      now: () => now,
    })
    expect(missingEvidence.policy).toMatchObject({
      approvalState: "pending_review",
      reasonCode: "pending_missing_evidence",
      autoApply: false,
    })

    const permissionExpansion = evaluateLearningPolicy({
      actorOwner: researcher,
      targetOwner: researcher,
      learningTarget: "memory",
      before: { enabledMcpServerIds: ["browser"] },
      after: {
        enabledMcpServerIds: ["browser", "filesystem"],
        catalogId: "mcp:filesystem",
        bindingId: "binding:expanded",
        secretScopeId: "secret:new",
      },
      evidenceRefs: ["review:task028"],
      confidence: 0.99,
    })
    expect(permissionExpansion).toMatchObject({
      approvalState: "pending_review",
      reasonCode: "pending_permission_or_capability_expansion",
      autoApply: false,
    })

    expect(listLearningReviewQueue({ agentId: "agent:researcher" })).toEqual([
      expect.objectContaining({
        learningEventId: "learning:task028:missing-evidence",
        approvalState: "pending_review",
      }),
    ])
    expect(listHistoryVersions("memory", "agent:researcher")).toHaveLength(0)

    const app = Fastify({ logger: false })
    registerAgentRoutes(app)
    await app.ready()
    try {
      const queue = await app.inject({ method: "GET", url: "/api/learning/review-queue" })
      expect(queue.statusCode).toBe(200)
      expect(queue.json().items).toEqual([
        expect.objectContaining({
          learningEventId: "learning:task028:missing-evidence",
          approvalState: "pending_review",
        }),
      ])
    } finally {
      await app.close()
    }
  })

  it("keeps profile history append-only and records restore dry-runs in the ledger", () => {
    const researcher = owner("sub_agent", "agent:researcher")
    const history = buildHistoryVersion({
      targetEntityType: "agent",
      targetEntityId: "agent:researcher",
      owner: researcher,
      before: { agentId: "agent:researcher", role: "before", profileVersion: 1 },
      after: { agentId: "agent:researcher", role: "after", profileVersion: 2 },
      reasonCode: "task028_profile_update",
      historyVersionId: "history:task028:profile",
      idempotencyKey: "history:task028:profile",
      auditCorrelationId: "audit:task028:history",
      now: () => now,
    })
    expect(recordHistoryVersion(history)).toBe(true)

    const dryRun = dryRunRestoreHistoryVersion({
      targetEntityType: "agent",
      targetEntityId: "agent:researcher",
      restoredHistoryVersionId: history.historyVersionId,
    })
    expect(dryRun).toMatchObject({
      ok: true,
      restorePayload: { agentId: "agent:researcher", role: "before", profileVersion: 1 },
    })
    expect(dryRun.effectSummary.join("\n")).toContain("role")

    const restored = restoreHistoryVersion({
      targetEntityType: "agent",
      targetEntityId: "agent:researcher",
      restoredHistoryVersionId: history.historyVersionId,
      owner: researcher,
      dryRun: true,
      restoreEventId: "restore:task028:profile",
      idempotencyKey: "restore:task028:profile",
      auditCorrelationId: "audit:task028:restore",
      parentRunId: "run:task028:restore",
      now: () => now + 1,
    })
    expect(restored).toMatchObject({ inserted: true, applied: false, ok: true })
    expect(listHistoryVersions("agent", "agent:researcher")).toHaveLength(1)
    expect(listRestoreEvents("agent", "agent:researcher")).toHaveLength(1)
    expect(listOrchestrationEventLedger({ runId: "run:task028:restore" })).toEqual([
      expect.objectContaining({
        eventKind: "history_restored",
        agentId: "agent:researcher",
        payload: expect.objectContaining({
          restoreEventId: "restore:task028:profile",
          restoredHistoryVersionId: history.historyVersionId,
          dryRun: true,
          applied: false,
        }),
      }),
    ])
  })

  it("does not let invalid learning hints bypass hierarchy and candidate validation", () => {
    const result = buildOrchestrationPlan({
      parentRunId: "run:task028:planner",
      parentRequestId: "request:task028:planner",
      userRequest:
        "Please delegate this detailed research task to the best available sub-agent and produce a concise synthesis.",
      modeSnapshot: {
        mode: "orchestration",
        status: "ready",
        featureFlagEnabled: true,
        requestedMode: "orchestration",
        activeSubAgentCount: 2,
        totalSubAgentCount: 2,
        disabledSubAgentCount: 0,
        activeSubAgents: [],
        reasonCode: "orchestration_ready",
        reason: "ready",
        generatedAt: now,
      },
      registrySnapshot: registry(),
      taskScopes: [scope()],
      intent: { specialtyTags: ["research"] },
      learningHints: [
        {
          hintId: "hint:task028:grandchild",
          suggestedAgentId: "agent:b",
          confidence: 0.99,
          evidenceRefs: [],
          reasonCode: "previous_success",
        },
      ],
      now: () => now,
      idProvider: () => "plan:task028",
    })

    expect(result.plan.delegatedTasks[0]?.assignedAgentId).toBe("agent:a")
    expect(
      result.candidateScores.find((candidate) => candidate.agentId === "agent:b")
        ?.excludedReasonCodes,
    ).toEqual(expect.arrayContaining(["not_direct_child_candidate"]))
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "learning_hint_ignored",
          severity: "invalid",
          agentId: "agent:b",
        }),
      ]),
    )
  })
})
