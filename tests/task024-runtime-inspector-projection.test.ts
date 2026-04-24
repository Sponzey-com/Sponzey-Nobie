import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import type {
  AgentPromptBundle,
  DataExchangePackage,
  ExpectedOutputContract,
  ModelExecutionSnapshot,
  OrchestrationPlan,
  RuntimeIdentity,
  StructuredTaskScope,
  SubSessionContract,
  SubSessionStatus,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import {
  closeDb,
  getDb,
  insertAgentDataExchange,
  insertRunSubSession,
  insertSession,
} from "../packages/core/src/db/index.js"
import { recordOrchestrationEvent } from "../packages/core/src/orchestration/event-ledger.ts"
import { recordMessageLedgerEvent } from "../packages/core/src/runs/message-ledger.ts"
import { buildRunRuntimeInspectorProjection } from "../packages/core/src/runs/runtime-inspector-projection.ts"
import { createRootRun, getRootRun } from "../packages/core/src/runs/store.ts"

const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG
const now = Date.UTC(2026, 3, 24, 1, 0, 0)

const expectedOutput: ExpectedOutputContract = {
  outputId: "answer",
  kind: "text",
  description: "Evidence-backed answer for parent synthesis.",
  required: true,
  acceptance: {
    requiredEvidenceKinds: ["source"],
    artifactRequired: false,
    reasonCodes: ["source_backed_answer"],
  },
}

const taskScope: StructuredTaskScope = {
  goal: "Inspect runtime projection without exposing raw child payloads.",
  intentType: "runtime_test",
  actionType: "runtime_inspector",
  constraints: ["Do not expose private memory."],
  expectedOutputs: [expectedOutput],
  reasonCodes: ["task024"],
}

function identity(
  entityType: RuntimeIdentity["entityType"],
  entityId: string,
  ownerId = "agent:researcher",
): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType,
    entityId,
    owner: { ownerType: "sub_agent", ownerId },
    idempotencyKey: `idem:${entityId}`,
    auditCorrelationId: `audit:${entityId}`,
    parent: {
      parentRunId: "run:task024",
      parentRequestId: "request:task024",
    },
  }
}

function modelSnapshot(overrides: Partial<ModelExecutionSnapshot> = {}): ModelExecutionSnapshot {
  return {
    providerId: "openai",
    modelId: "gpt-5.4-mini",
    effort: "low",
    fallbackApplied: false,
    retryCount: 1,
    estimatedInputTokens: 120,
    estimatedOutputTokens: 64,
    estimatedCost: 0.002,
    latencyMs: 350,
    reasonCodes: ["default_model"],
    ...overrides,
  }
}

function promptBundle(agentId: string, nickname: string): AgentPromptBundle {
  return {
    identity: identity("capability", `bundle:${agentId}`, agentId),
    bundleId: `bundle:${agentId}`,
    agentId,
    agentType: "sub_agent",
    role: "runtime inspector worker",
    displayNameSnapshot: nickname,
    nicknameSnapshot: nickname,
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
    capabilityPolicy: {
      permissionProfile: {
        profileId: `profile:${agentId}`,
        riskCeiling: "moderate",
        approvalRequiredFrom: "moderate",
        allowExternalNetwork: true,
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
    },
    modelProfileSnapshot: {
      providerId: "openai",
      modelId: "gpt-5.4-mini",
      retryCount: 1,
      timeoutMs: 1000,
      costBudget: 1,
    },
    taskScope,
    safetyRules: ["Parent finalizer owns user-facing delivery."],
    sourceProvenance: [],
    completionCriteria: [expectedOutput],
    createdAt: now,
  }
}

function subSession(
  id: string,
  status: SubSessionStatus,
  retryBudgetRemaining: number,
  agentId = "agent:researcher",
  nickname = "Researcher",
): SubSessionContract {
  return {
    identity: identity("sub_session", id, agentId),
    subSessionId: id,
    parentSessionId: "session:task024",
    parentRunId: "run:task024",
    parentAgentId: "agent:nobie",
    parentAgentDisplayName: "Nobie",
    parentAgentNickname: "노비",
    agentId,
    agentDisplayName: nickname,
    agentNickname: nickname,
    commandRequestId: `command:${id}`,
    status,
    retryBudgetRemaining,
    promptBundleId: `bundle:${agentId}`,
    promptBundleSnapshot: promptBundle(agentId, nickname),
    modelExecutionSnapshot: modelSnapshot(),
    startedAt: now + 10,
    ...(status === "running" ? {} : { finishedAt: now + 100 }),
  }
}

function orchestrationPlan(): OrchestrationPlan {
  return {
    identity: identity("session", "plan:task024", "agent:nobie"),
    planId: "plan:task024",
    parentRunId: "run:task024",
    parentRequestId: "request:task024",
    directNobieTasks: [],
    delegatedTasks: [
      {
        taskId: "task:research",
        executionKind: "delegated_sub_agent",
        scope: taskScope,
        assignedAgentId: "agent:researcher",
        requiredCapabilities: ["research"],
        resourceLockIds: [],
      },
    ],
    dependencyEdges: [],
    resourceLocks: [],
    parallelGroups: [],
    approvalRequirements: [
      {
        approvalId: "approval:task024",
        taskId: "task:research",
        agentId: "agent:researcher",
        capability: "external_research",
        risk: "moderate",
        reasonCode: "external_source",
      },
    ],
    fallbackStrategy: {
      mode: "single_nobie",
      reasonCode: "fallback_if_agent_unavailable",
    },
    plannerMetadata: {
      status: "planned",
      plannerVersion: "test",
      timedOut: false,
      semanticComparisonUsed: false,
      reasonCodes: ["task024"],
      candidateScores: [],
      directReasonCodes: [],
      fallbackReasonCodes: [],
    },
    createdAt: now,
  }
}

function dataExchange(): DataExchangePackage {
  return {
    identity: identity("data_exchange", "exchange:task024", "agent:researcher"),
    exchangeId: "exchange:task024",
    sourceOwner: { ownerType: "sub_agent", ownerId: "agent:researcher" },
    recipientOwner: { ownerType: "sub_agent", ownerId: "agent:reviewer" },
    sourceNicknameSnapshot: "Researcher",
    recipientNicknameSnapshot: "Reviewer",
    purpose: "Share redacted research summary with reviewer.",
    allowedUse: "temporary_context",
    retentionPolicy: "session_only",
    redactionState: "redacted",
    provenanceRefs: ["source:1"],
    payload: {
      summary: "private raw memory sk-task024-secret-value should not escape",
      rawPayload: "sk-task024-secret-value",
    },
    createdAt: now + 30,
  }
}

function setupRun(): void {
  insertSession({
    id: "session:task024",
    source: "webui",
    source_id: "task024",
    created_at: now,
    updated_at: now,
    summary: "task024",
  })
  createRootRun({
    id: "run:task024",
    sessionId: "session:task024",
    requestGroupId: "group:task024",
    prompt: "task024 runtime inspector",
    source: "webui",
    orchestrationMode: "orchestration",
    promptSourceSnapshot: {
      orchestration: { mode: "orchestration" },
      orchestrationPlan: orchestrationPlan(),
    },
  })
}

beforeEach(() => {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task024-state-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
  reloadConfig()
  getDb()
  setupRun()
})

afterEach(() => {
  closeDb()
  if (previousStateDir === undefined) Reflect.deleteProperty(process.env, "NOBIE_STATE_DIR")
  else process.env.NOBIE_STATE_DIR = previousStateDir
  if (previousConfig === undefined) Reflect.deleteProperty(process.env, "NOBIE_CONFIG")
  else process.env.NOBIE_CONFIG = previousConfig
  reloadConfig()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe("task024 runtime inspector projection", () => {
  it("projects sub-sessions, reviews, approvals, data exchanges, model cost, and finalizer state without raw payloads", () => {
    insertRunSubSession(subSession("sub:running", "running", 2))
    insertRunSubSession(
      subSession("sub:revision", "needs_revision", 1, "agent:reviewer", "Reviewer"),
    )
    insertAgentDataExchange(dataExchange())

    recordMessageLedgerEvent({
      runId: "run:task024",
      requestGroupId: "group:task024",
      sessionKey: "session:task024",
      channel: "webui",
      eventKind: "sub_session_progress_summarized",
      status: "delivered",
      summary: "runtime progress",
      detail: {
        items: [
          {
            subSessionId: "sub:running",
            agentId: "agent:researcher",
            status: "running",
            summary: "private raw memory sk-task024-secret-value checked",
            at: now + 40,
          },
        ],
      },
      createdAt: now + 40,
    })
    recordOrchestrationEvent({
      eventKind: "result_reported",
      runId: "run:task024",
      requestGroupId: "group:task024",
      subSessionId: "sub:revision",
      agentId: "agent:reviewer",
      correlationId: "run:task024",
      source: "test",
      summary: "result reported",
      payload: {
        resultReportId: "result:revision",
        status: "needs_revision",
        outputs: [{ outputId: "answer", value: "sk-task024-secret-value" }],
        artifacts: [{ artifactId: "artifact:1" }],
        risksOrGaps: ["private raw memory sk-task024-secret-value evidence gap"],
      },
      createdAt: now + 50,
      emittedAt: now + 50,
    })
    recordOrchestrationEvent({
      eventKind: "result_reviewed",
      runId: "run:task024",
      requestGroupId: "group:task024",
      subSessionId: "sub:revision",
      agentId: "agent:reviewer",
      correlationId: "run:task024",
      source: "test",
      summary: "reviewed",
      payload: {
        resultReportId: "result:revision",
        status: "needs_revision",
        verdict: "insufficient_evidence",
        parentIntegrationStatus: "blocked_insufficient_evidence",
        accepted: false,
        issueCodes: ["missing_evidence"],
        normalizedFailureKey: "blocked_insufficient_evidence",
      },
      createdAt: now + 60,
      emittedAt: now + 60,
    })
    recordOrchestrationEvent({
      eventKind: "feedback_requested",
      runId: "run:task024",
      requestGroupId: "group:task024",
      subSessionId: "sub:revision",
      agentId: "agent:reviewer",
      correlationId: "run:task024",
      source: "test",
      summary: "feedback requested",
      payload: {
        feedbackRequestId: "feedback:revision",
        reasonCode: "blocked_insufficient_evidence",
        missingItems: ["source"],
        requiredChanges: ["add evidence"],
      },
      createdAt: now + 70,
      emittedAt: now + 70,
    })
    recordOrchestrationEvent({
      eventKind: "approval_requested",
      runId: "run:task024",
      requestGroupId: "group:task024",
      subSessionId: "sub:running",
      agentId: "agent:researcher",
      approvalId: "approval:task024",
      correlationId: "run:task024",
      source: "test",
      summary: "approval requested",
      payload: {
        approvals: [
          {
            approvalId: "approval:task024",
            status: "requested",
            subSessionId: "sub:running",
            agentId: "agent:researcher",
            summary: "needs external source",
          },
        ],
      },
      createdAt: now + 80,
      emittedAt: now + 80,
    })
    recordMessageLedgerEvent({
      runId: "run:task024",
      requestGroupId: "group:task024",
      sessionKey: "session:task024",
      channel: "webui",
      eventKind: "final_answer_delivered",
      deliveryKind: "final",
      deliveryKey: "webui:final:task024",
      idempotencyKey: "final-answer:task024",
      status: "delivered",
      summary: "parent finalizer delivered once",
      createdAt: now + 90,
    })

    const run = getRootRun("run:task024")
    expect(run).toBeDefined()
    if (!run) return
    const projection = buildRunRuntimeInspectorProjection(run, {
      now: now + 100,
    })
    const running = projection.subSessions.find((item) => item.subSessionId === "sub:running")
    const revision = projection.subSessions.find((item) => item.subSessionId === "sub:revision")
    const serialized = JSON.stringify(projection)

    expect(projection.orchestrationMode).toBe("orchestration")
    expect(projection.plan.delegatedTaskCount).toBe(1)
    expect(running?.allowedControlActions.map((item) => item.action)).toEqual(
      expect.arrayContaining(["send", "steer", "kill"]),
    )
    expect(running?.approvalState).toBe("pending")
    expect(running?.model?.estimatedCost).toBeGreaterThan(0)
    expect(revision?.review?.verdict).toBe("insufficient_evidence")
    expect(revision?.review?.parentIntegrationStatus).toBe("blocked_insufficient_evidence")
    expect(revision?.feedback.status).toBe("requested")
    expect(revision?.allowedControlActions.map((item) => item.action)).toEqual(
      expect.arrayContaining(["retry", "feedback", "redelegate"]),
    )
    expect(projection.dataExchanges).toEqual([
      expect.objectContaining({
        exchangeId: "exchange:task024",
        purpose: "Share redacted research summary with reviewer.",
        redactionState: "redacted",
        provenanceCount: 1,
      }),
    ])
    expect(projection.finalizer.status).toBe("delivered")
    expect(projection.timeline.some((event) => event.kind === "result_reviewed")).toBe(true)
    expect(serialized).not.toContain("sk-task024-secret-value")
    expect(serialized).not.toContain("private raw memory")
    expect(serialized).not.toContain('"rawPayload":')
  })
})
