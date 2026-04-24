import { mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { reviewSubAgentResult } from "../packages/core/src/agent/sub-agent-result-review.ts"
import { registerSubSessionRoutes } from "../packages/core/src/api/routes/subsessions.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.ts"
import type {
  AgentPromptBundle,
  CommandRequest,
  ExpectedOutputContract,
  MemoryPolicy,
  PermissionProfile,
  ResultReport,
  RuntimeIdentity,
  SkillMcpAllowlist,
  StructuredTaskScope,
  SubSessionContract,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import {
  closeDb,
  getAgentDataExchange,
  getRunSubSession,
  listRunSubSessionsForParentRun,
  updateRunSubSession,
  upsertAgentRelationship,
} from "../packages/core/src/db/index.js"
import {
  buildFeedbackLoopPackage,
  decideFeedbackLoopContinuation,
  validateRedelegationTarget,
} from "../packages/core/src/orchestration/feedback-loop.ts"
import type { RunSubSessionInput } from "../packages/core/src/orchestration/sub-session-runner.ts"

const require = createRequire(import.meta.url)
const Fastify = require("../packages/core/node_modules/fastify") as (options: {
  logger: boolean
}) => {
  ready(): Promise<void>
  close(): Promise<void>
  inject(options: {
    method: string
    url: string
    payload?: unknown
    headers?: Record<string, string>
    remoteAddress?: string
  }): Promise<{ statusCode: number; json(): Record<string, unknown> }>
}

const now = Date.UTC(2026, 3, 24, 0, 0, 0)
const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG

const evidenceOutput: ExpectedOutputContract = {
  outputId: "answer",
  kind: "text",
  description: "Source-backed answer.",
  required: true,
  acceptance: {
    requiredEvidenceKinds: ["source"],
    artifactRequired: false,
    reasonCodes: ["source_backed_answer"],
  },
}

const taskScope: StructuredTaskScope = {
  goal: "Revise a sub-session result.",
  intentType: "review",
  actionType: "feedback_loop",
  constraints: ["Do not deliver directly to the user."],
  expectedOutputs: [evidenceOutput],
  reasonCodes: ["feedback_loop_required"],
}

const allowlist: SkillMcpAllowlist = {
  enabledSkillIds: ["research"],
  enabledMcpServerIds: ["browser"],
  enabledToolNames: ["web_search"],
  disabledToolNames: [],
}

const permissionProfile: PermissionProfile = {
  profileId: "profile:safe",
  riskCeiling: "moderate",
  approvalRequiredFrom: "moderate",
  allowExternalNetwork: true,
  allowFilesystemWrite: false,
  allowShellExecution: false,
  allowScreenControl: false,
  allowedPaths: [],
}

const memoryPolicy: MemoryPolicy = {
  owner: { ownerType: "sub_agent", ownerId: "agent:researcher" },
  visibility: "private",
  readScopes: [{ ownerType: "sub_agent", ownerId: "agent:researcher" }],
  writeScope: { ownerType: "sub_agent", ownerId: "agent:researcher" },
  retentionPolicy: "short_term",
  writebackReviewRequired: true,
}

function useTempState(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task017-feedback-"))
  tempDirs.push(stateDir)
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = join(stateDir, "config.json5")
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

function identity(entityType: RuntimeIdentity["entityType"], entityId: string): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType,
    entityId,
    owner: { ownerType: "sub_agent", ownerId: "agent:researcher" },
    idempotencyKey: `idem:${entityId}`,
    auditCorrelationId: `audit:${entityId}`,
    parent: {
      parentRunId: "run:task017",
      parentRequestId: "request:task017",
    },
  }
}

function resultReport(overrides: Partial<ResultReport> = {}): ResultReport {
  return {
    identity: identity("sub_session", "sub:feedback"),
    resultReportId: "result:feedback",
    parentRunId: "run:task017",
    subSessionId: "sub:feedback",
    status: "completed",
    outputs: [
      { outputId: "answer", status: "satisfied", value: "42" },
      { outputId: "draft", status: "partial", value: "needs citation" },
    ],
    evidence: [],
    artifacts: [],
    risksOrGaps: [],
    ...overrides,
  }
}

function command(id = "feedback", targetAgentId = "agent:researcher"): CommandRequest {
  return {
    identity: {
      ...identity("sub_session", `command:${id}`),
      entityId: `sub:${id}`,
      owner: { ownerType: "sub_agent", ownerId: targetAgentId },
      idempotencyKey: `idem:${id}`,
    },
    commandRequestId: `command:${id}`,
    parentRunId: "run:task017",
    subSessionId: `sub:${id}`,
    targetAgentId,
    targetNicknameSnapshot: targetAgentId === "agent:researcher" ? "Res" : "Alt",
    taskScope,
    contextPackageIds: [],
    expectedOutputs: [evidenceOutput],
    retryBudget: 2,
  }
}

function promptBundle(agentId = "agent:researcher", nickname = "Res"): AgentPromptBundle {
  return {
    identity: identity("capability", `prompt-bundle:${agentId}`),
    bundleId: `prompt-bundle:${agentId}`,
    agentId,
    agentType: "sub_agent",
    role: "feedback worker",
    displayNameSnapshot: nickname,
    nicknameSnapshot: nickname,
    personalitySnapshot: "Precise",
    teamContext: [],
    memoryPolicy: {
      ...memoryPolicy,
      owner: { ownerType: "sub_agent", ownerId: agentId },
      readScopes: [{ ownerType: "sub_agent", ownerId: agentId }],
      writeScope: { ownerType: "sub_agent", ownerId: agentId },
    },
    capabilityPolicy: {
      permissionProfile,
      skillMcpAllowlist: allowlist,
      rateLimit: { maxConcurrentCalls: 1 },
    },
    taskScope,
    safetyRules: ["Sub-session result is parent synthesis only."],
    sourceProvenance: [{ sourceId: `profile:${agentId}`, version: "1" }],
    completionCriteria: [evidenceOutput],
    createdAt: now,
  }
}

function runInput(id = "feedback"): RunSubSessionInput {
  return {
    command: command(id),
    parentAgent: {
      agentId: "agent:nobie",
      displayName: "Nobie",
      nickname: "노비",
    },
    agent: {
      agentId: "agent:researcher",
      displayName: "Researcher",
      nickname: "Res",
    },
    parentSessionId: "session:task017",
    promptBundle: promptBundle(),
  }
}

function parseSubSession(id: string): SubSessionContract {
  const row = getRunSubSession(id)
  if (!row) throw new Error(`missing sub-session ${id}`)
  return JSON.parse(row.contract_json) as SubSessionContract
}

function markNeedsRevision(id = "sub:feedback", retryBudgetRemaining = 2): void {
  const subSession = parseSubSession(id)
  subSession.status = "needs_revision"
  subSession.retryBudgetRemaining = retryBudgetRemaining
  updateRunSubSession(subSession)
}

async function withApp(run: (app: ReturnType<typeof Fastify>) => Promise<void>): Promise<void> {
  const app = Fastify({ logger: false })
  registerSubSessionRoutes(app)
  await app.ready()
  try {
    await run(app)
  } finally {
    await app.close()
  }
}

beforeEach(() => {
  useTempState()
})

afterEach(() => {
  restoreState()
})

describe("task017 feedback request and redelegation loop", () => {
  it("creates structured feedback context without replaying the raw result", () => {
    const review = reviewSubAgentResult({
      resultReport: resultReport(),
      expectedOutputs: [evidenceOutput],
      retryBudgetRemaining: 2,
      idProvider: () => "feedback-inner",
      now: () => now,
    })
    const pkg = buildFeedbackLoopPackage({
      resultReports: [resultReport()],
      review,
      expectedOutputs: [evidenceOutput],
      targetAgentPolicy: "same_agent",
      targetAgentId: "agent:researcher",
      requestingAgentId: "agent:nobie",
      parentRunId: "run:task017",
      parentSessionId: "session:task017",
      additionalConstraints: ["Add one cited source."],
      conflictItems: ["draft_without_source"],
      persistSynthesizedContext: false,
      idProvider: () => "feedback-1",
      now: () => now,
    })

    expect(pkg.feedbackRequest).toMatchObject({
      feedbackRequestId: "feedback-1",
      targetAgentPolicy: "same_agent",
      targetAgentId: "agent:researcher",
      missingItems: ["missing_evidence:answer:source"],
      conflictItems: ["draft_without_source"],
      retryBudgetRemaining: 1,
      synthesizedContextExchangeId: "exchange:feedback:feedback-1",
    })
    expect(pkg.feedbackRequest.carryForwardOutputs).toEqual([
      { outputId: "answer", status: "satisfied", value: "42" },
      { outputId: "draft", status: "partial", value: "needs citation" },
    ])
    expect(pkg.synthesizedContext.payload).toMatchObject({
      kind: "sub_session_feedback_context",
      sourceResultReportIds: ["result:feedback"],
      previousSubSessionIds: ["sub:feedback"],
      missingItems: ["missing_evidence:answer:source"],
    })
    expect(pkg.synthesizedContext.payload).not.toHaveProperty("resultReport")
    expect(pkg.directive.followupPrompt).toContain("Missing items")
  })

  it("guards repeated failures, exhausted budget, and limited success", () => {
    const missingEvidence = reviewSubAgentResult({
      resultReport: resultReport(),
      expectedOutputs: [evidenceOutput],
      retryBudgetRemaining: 1,
    })
    const limited = reviewSubAgentResult({
      resultReport: resultReport({
        evidence: [{ evidenceId: "e-1", kind: "source", sourceRef: "source:1" }],
        risksOrGaps: ["source is stale"],
      }),
      expectedOutputs: [evidenceOutput],
      retryBudgetRemaining: 1,
    })

    expect(
      decideFeedbackLoopContinuation({
        review: missingEvidence,
        retryBudgetRemaining: 1,
        previousFailureKeys: [missingEvidence.normalizedFailureKey ?? ""],
      }),
    ).toMatchObject({ action: "blocked_repeated_failure" })
    expect(
      decideFeedbackLoopContinuation({
        review: missingEvidence,
        retryBudgetRemaining: 0,
      }),
    ).toMatchObject({ action: "blocked_retry_budget_exhausted" })
    expect(
      decideFeedbackLoopContinuation({
        review: limited,
        retryBudgetRemaining: 1,
      }),
    ).toMatchObject({ action: "limited_success_finalized" })
  })

  it("validates alternative redelegation target boundaries and runtime checks", () => {
    expect(
      validateRedelegationTarget({
        policy: "alternative_direct_child",
        parentAgentId: "agent:nobie",
        currentAgentId: "agent:researcher",
        targetAgentId: "agent:alternate",
        directChildAgentIds: ["agent:researcher", "agent:alternate"],
      }),
    ).toEqual({ ok: true, reasonCodes: [] })

    expect(
      validateRedelegationTarget({
        policy: "alternative_direct_child",
        parentAgentId: "agent:nobie",
        currentAgentId: "agent:researcher",
        targetAgentId: "agent:external",
        directChildAgentIds: ["agent:researcher"],
        permissionAllowed: false,
      }),
    ).toMatchObject({
      ok: false,
      reasonCodes: ["redelegation_target_not_direct_child", "redelegation_permission_blocked"],
    })
  })

  it("connects control API feedback to FeedbackRequest and persisted DataExchangePackage", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "POST",
        url: "/api/subsessions/spawn",
        payload: { input: runInput() },
      })
      markNeedsRevision()

      const response = await app.inject({
        method: "POST",
        url: "/api/subsessions/sub:feedback/feedback",
        payload: {
          parentRunId: "run:task017",
          message: "needs one source",
          resultReport: resultReport(),
          feedbackRequestId: "api-feedback",
        },
      })

      expect(response.statusCode).toBe(202)
      expect(response.json()).toMatchObject({
        reasonCode: "feedback_request_created",
        feedbackRequest: {
          feedbackRequestId: "api-feedback",
          targetAgentPolicy: "same_agent",
          missingItems: ["missing_evidence:answer:source"],
          retryBudgetRemaining: 1,
        },
        synthesizedContextExchangeId: "exchange:feedback:api-feedback",
      })
      const exchange = getAgentDataExchange("exchange:feedback:api-feedback")
      expect(exchange?.allowed_use).toBe("temporary_context")
      expect(listRunSubSessionsForParentRun("run:task017")).toHaveLength(1)
    })
  })

  it("connects control API redelegate to alternative direct child queueing", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "POST",
        url: "/api/subsessions/spawn",
        payload: { input: runInput() },
      })
      markNeedsRevision()
      upsertAgentRelationship({
        edgeId: "relationship:agent:nobie->agent:alternate",
        parentAgentId: "agent:nobie",
        childAgentId: "agent:alternate",
        relationshipType: "parent_child",
        status: "active",
        sortOrder: 2,
        createdAt: now,
        updatedAt: now,
      })

      const response = await app.inject({
        method: "POST",
        url: "/api/subsessions/sub:feedback/redelegate",
        payload: {
          parentRunId: "run:task017",
          message: "delegate to alternate",
          resultReport: resultReport(),
          feedbackRequestId: "api-redelegate",
          targetAgentId: "agent:alternate",
          targetAgentDisplayName: "Alternate",
          targetAgentNickname: "Alt",
          redelegatedSubSessionId: "sub:redelegated",
        },
      })

      expect(response.statusCode).toBe(202)
      expect(response.json()).toMatchObject({
        reasonCode: "redelegation_queued",
        redelegatedSubSessionId: "sub:redelegated",
        feedbackRequest: {
          targetAgentPolicy: "alternative_direct_child",
          targetAgentId: "agent:alternate",
        },
      })
      const redelegated = parseSubSession("sub:redelegated")
      expect(redelegated).toMatchObject({
        status: "queued",
        agentId: "agent:alternate",
        retryBudgetRemaining: 1,
      })
      expect(redelegated.promptBundleSnapshot?.completionCriteria?.[0]?.outputId).toBe("answer")
      expect(listRunSubSessionsForParentRun("run:task017")).toHaveLength(2)
    })
  })

  it("blocks control API redelegation outside direct child scope", async () => {
    await withApp(async (app) => {
      await app.inject({
        method: "POST",
        url: "/api/subsessions/spawn",
        payload: { input: runInput() },
      })
      markNeedsRevision()

      const response = await app.inject({
        method: "POST",
        url: "/api/subsessions/sub:feedback/redelegate",
        payload: {
          parentRunId: "run:task017",
          resultReport: resultReport(),
          targetAgentId: "agent:not-child",
        },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json().reasonCode).toBe("redelegation_target_not_direct_child")
      expect(listRunSubSessionsForParentRun("run:task017")).toHaveLength(1)
    })
  })
})
