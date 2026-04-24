import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.js"
import type {
  AgentPromptBundle,
  CommandRequest,
  ExpectedOutputContract,
  RuntimeIdentity,
  StructuredTaskScope,
  SubSessionContract,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import {
  closeDb,
  getDb,
  insertSession,
  listMessageLedgerEvents,
} from "../packages/core/src/db/index.js"
import { listOrchestrationEventLedger } from "../packages/core/src/orchestration/event-ledger.ts"
import {
  type RunSubSessionInput,
  SubSessionRunner,
  type SubSessionRuntimeDependencies,
  createTextResultReport,
} from "../packages/core/src/orchestration/sub-session-runner.ts"
import {
  buildNobieFinalAnswer,
  commitFinalDelivery,
  listPendingFinalizers,
  recordApprovalAggregation,
} from "../packages/core/src/runs/channel-finalizer.ts"
import { emitAssistantTextDelivery } from "../packages/core/src/runs/delivery.ts"
import { createRootRun } from "../packages/core/src/runs/store.ts"

const tempDirs: string[] = []
const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG
const now = Date.UTC(2026, 3, 24, 0, 0, 0)

const expectedOutput: ExpectedOutputContract = {
  outputId: "answer",
  kind: "text",
  description: "Finalizer input answer.",
  required: true,
  acceptance: {
    requiredEvidenceKinds: [],
    artifactRequired: false,
    reasonCodes: ["task023"],
  },
}

const taskScope: StructuredTaskScope = {
  goal: "Validate channel finalizer.",
  intentType: "runtime_test",
  actionType: "channel_finalizer",
  constraints: ["Sub-session results are parent synthesis only."],
  expectedOutputs: [expectedOutput],
  reasonCodes: ["task023"],
}

function identity(
  entityType: RuntimeIdentity["entityType"],
  entityId: string,
  idempotencyKey = `idem:${entityId}`,
): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType,
    entityId,
    owner: { ownerType: "sub_agent", ownerId: "agent:researcher" },
    idempotencyKey,
    parent: {
      parentRunId: "run:task023",
      parentRequestId: "request:task023",
    },
  }
}

function command(id = "researcher"): CommandRequest {
  return {
    identity: identity("sub_session", `sub:${id}`),
    commandRequestId: `command:${id}`,
    parentRunId: "run:task023",
    subSessionId: `sub:${id}`,
    targetAgentId: "agent:researcher",
    targetNicknameSnapshot: "Researcher",
    taskScope,
    contextPackageIds: [],
    expectedOutputs: [expectedOutput],
    retryBudget: 1,
  }
}

function promptBundle(): AgentPromptBundle {
  return {
    identity: identity("sub_session", "bundle:task023"),
    bundleId: "bundle:task023",
    agentId: "agent:researcher",
    agentType: "sub_agent",
    role: "researcher",
    displayNameSnapshot: "Researcher",
    nicknameSnapshot: "Researcher",
    personalitySnapshot: "precise",
    teamContext: [],
    memoryPolicy: {
      owner: { ownerType: "sub_agent", ownerId: "agent:researcher" },
      visibility: "private",
      readScopes: [{ ownerType: "sub_agent", ownerId: "agent:researcher" }],
      writeScope: { ownerType: "sub_agent", ownerId: "agent:researcher" },
      retentionPolicy: "short_term",
      writebackReviewRequired: true,
    },
    capabilityPolicy: {
      permissionProfile: {
        profileId: "profile:task023",
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
      retryCount: 0,
      timeoutMs: 1000,
      costBudget: 1,
    },
    taskScope,
    safetyRules: ["Do not send sub-session results directly to the user."],
    sourceProvenance: [],
    createdAt: now,
  }
}

function runInput(id = "researcher"): RunSubSessionInput {
  return {
    command: command(id),
    agent: {
      agentId: "agent:researcher",
      displayName: "Researcher",
      nickname: "Researcher",
    },
    parentAgent: {
      agentId: "agent:nobie",
      displayName: "Nobie",
      nickname: "노비",
    },
    parentSessionId: "session:task023",
    promptBundle: promptBundle(),
  }
}

function makeMemoryDependencies(input: { isParentFinalized?: () => boolean } = {}) {
  const sessions = new Map<string, SubSessionContract>()
  const events: Array<{ parentRunId: string; label: string }> = []
  let time = now
  const clone = <T>(value: T): T => structuredClone(value)
  const dependencies: SubSessionRuntimeDependencies = {
    now: () => {
      time += 1
      return time
    },
    idProvider: () => {
      time += 1
      return `id-${time}`
    },
    loadSubSessionByIdempotencyKey: (idempotencyKey) =>
      clone(
        [...sessions.values()].find(
          (session) => session.identity.idempotencyKey === idempotencyKey,
        ),
      ),
    persistSubSession: (subSession) => {
      if (
        [...sessions.values()].some(
          (session) => session.identity.idempotencyKey === subSession.identity.idempotencyKey,
        )
      ) {
        return false
      }
      sessions.set(subSession.subSessionId, clone(subSession))
      return true
    },
    updateSubSession: (subSession) => {
      sessions.set(subSession.subSessionId, clone(subSession))
    },
    appendParentEvent: (parentRunId, label) => {
      events.push({ parentRunId, label })
    },
    isParentCancelled: () => false,
    isParentFinalized: () => input.isParentFinalized?.() ?? false,
  }
  return { dependencies, events }
}

function setupRun(): void {
  insertSession({
    id: "session:task023",
    source: "webui",
    source_id: "task023",
    created_at: now,
    updated_at: now,
    summary: "task023",
  })
  createRootRun({
    id: "run:task023",
    sessionId: "session:task023",
    requestGroupId: "group:task023",
    prompt: "task023 finalizer",
    source: "webui",
  })
}

beforeEach(() => {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task023-state-"))
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

describe("task023 channel delivery finalizer and late result policy", () => {
  it("commits one parent final answer, dedupes restart delivery, and records attribution events", async () => {
    const resultReport = createTextResultReport({
      command: command(),
      idProvider: () => "result:task023",
      text: "evidence from child",
    })
    const firstChunks: string[] = []
    const first = await commitFinalDelivery({
      parentRunId: "run:task023",
      sessionId: "session:task023",
      source: "webui",
      text: "final answer",
      resultReports: [resultReport],
      deliveryDependencies: { writeReplyLog: () => undefined },
      onChunk: async (chunk) => {
        if (chunk.type === "text") firstChunks.push(chunk.delta)
      },
    })
    const secondOnChunk = vi.fn()
    const second = await commitFinalDelivery({
      parentRunId: "run:task023",
      sessionId: "session:task023",
      source: "webui",
      text: "different final answer after restart",
      resultReports: [resultReport],
      deliveryDependencies: { writeReplyLog: () => undefined },
      onChunk: secondOnChunk,
    })

    expect(first.status).toBe("delivered")
    expect(first.idempotencyKey).toBe("final-delivery:run:task023")
    expect(firstChunks.join("\n")).toContain("Researcher")
    expect(second.status).toBe("duplicate_suppressed")
    expect(secondOnChunk).not.toHaveBeenCalled()
    const ledger = listMessageLedgerEvents({ runId: "run:task023", limit: 100 })
    expect(ledger.filter((event) => event.event_kind === "final_answer_delivered")).toHaveLength(1)
    expect(ledger.filter((event) => event.event_kind === "final_answer_suppressed")).toHaveLength(1)
    expect(listPendingFinalizers({ runId: "run:task023" })).toHaveLength(0)
    expect(listOrchestrationEventLedger({ runId: "run:task023" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventKind: "final_delivery_completed" }),
        expect.objectContaining({ eventKind: "named_delivery_attributed" }),
      ]),
    )
  })

  it("blocks child direct final delivery and stores it as a suppressed delivery ledger event", async () => {
    const onChunk = vi.fn()
    const receipt = await emitAssistantTextDelivery({
      runId: "run:task023",
      parentRunId: "run:task023",
      subSessionId: "sub:child",
      agentId: "agent:researcher",
      sessionId: "session:task023",
      source: "webui",
      text: "child final result",
      deliveryKind: "final",
      onChunk,
    })

    expect(onChunk).not.toHaveBeenCalled()
    expect(receipt).toEqual({ persisted: false, textDelivered: false, doneDelivered: false })
    expect(listMessageLedgerEvents({ runId: "run:task023" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_kind: "text_delivery_suppressed",
          status: "suppressed",
        }),
      ]),
    )
  })

  it("aggregates approvals and blocks finalizer delivery when approval or review state is unsafe", async () => {
    const aggregate = recordApprovalAggregation({
      parentRunId: "run:task023",
      sessionId: "session:task023",
      source: "webui",
      approvals: [
        { approvalId: "approval:one", status: "requested", summary: "Need filesystem access" },
        { approvalId: "approval:two", status: "denied", reasonCode: "permission_denied" },
      ],
    })
    expect(aggregate.text).toContain("approval:one")
    expect(aggregate.pendingApprovalIds).toEqual(["approval:one"])
    expect(aggregate.blockedApprovalIds).toEqual(["approval:two"])

    const onChunk = vi.fn()
    const approvalBlocked = await commitFinalDelivery({
      parentRunId: "run:task023",
      sessionId: "session:task023",
      source: "webui",
      text: "unsafe final",
      onChunk,
      deliveryDependencies: { writeReplyLog: () => undefined },
      approvals: [{ approvalId: "approval:two", status: "denied" }],
    })
    const reviewBlocked = await commitFinalDelivery({
      parentRunId: "run:task023",
      sessionId: "session:task023",
      source: "webui",
      text: "insufficient final",
      onChunk,
      deliveryDependencies: { writeReplyLog: () => undefined },
      reviews: [
        {
          subSessionId: "sub:bad",
          review: {
            accepted: false,
            verdict: "insufficient_evidence",
            parentIntegrationStatus: "blocked_insufficient_evidence",
            normalizedFailureKey: "sub_agent_result_review:missing_evidence",
          },
        },
      ],
    })

    expect(onChunk).not.toHaveBeenCalled()
    expect(approvalBlocked).toMatchObject({ status: "blocked" })
    expect(approvalBlocked.reasonCodes).toEqual(["approval_denied:approval:two"])
    expect(reviewBlocked).toMatchObject({ status: "blocked" })
    expect(reviewBlocked.reasonCodes).toEqual(["sub_agent_result_review:missing_evidence"])
    expect(listMessageLedgerEvents({ runId: "run:task023" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_kind: "approval_aggregated" }),
        expect.objectContaining({ event_kind: "final_answer_suppressed" }),
      ]),
    )
  })

  it("keeps generated but undelivered finalizers pending after restart without auto-delivery", () => {
    getDb()
      .prepare(
        `INSERT INTO message_ledger
         (id, run_id, request_group_id, session_key, thread_key, channel, event_kind,
          delivery_key, idempotency_key, status, summary, detail_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "ledger:pending",
        "run:task023",
        "group:task023",
        "session:task023",
        "group:task023",
        "webui",
        "final_answer_generated",
        "final:run:task023",
        "final-answer:run:task023",
        "generated",
        "generated before restart",
        "{}",
        now,
      )

    expect(listPendingFinalizers({ runId: "run:task023" })).toEqual([
      expect.objectContaining({
        parentRunId: "run:task023",
        deliveryKey: "final:run:task023",
        safeToAutoDeliver: false,
        duplicateRisk: true,
      }),
    ])
  })

  it("records late child result as no-reply after parent finalizer has committed", async () => {
    let parentFinalized = false
    const { dependencies, events } = makeMemoryDependencies({
      isParentFinalized: () => parentFinalized,
    })
    const runner = new SubSessionRunner(dependencies)

    const result = await runner.runSubSession(runInput("late"), async (input) => {
      parentFinalized = true
      return createTextResultReport({
        command: input.command,
        idProvider: () => "result:late",
        text: "late child result",
      })
    })

    expect(result).toMatchObject({
      status: "completed",
      integrationSuppressed: true,
      suppressionReasonCode: "parent_finalized",
    })
    expect(events.map((event) => event.label)).toEqual(
      expect.arrayContaining(["sub_session_late_result_suppressed:sub:late:parent_finalized"]),
    )
    const event = listOrchestrationEventLedger({
      runId: "run:task023",
      eventKind: "result_reported",
    })[0]
    expect(event?.payload).toMatchObject({
      resultReportId: "result:late",
      lateResultPolicy: "no_reply",
    })
  })

  it("preserves source nicknames when Nobie synthesizes a final answer from sub-agent reports", () => {
    const resultReport = createTextResultReport({
      command: command(),
      idProvider: () => "result:nickname",
      text: "source-backed detail",
    })
    const answer = buildNobieFinalAnswer({
      text: "parent synthesis",
      resultReports: [resultReport],
    })

    expect(answer.text).toContain("Researcher")
    expect(answer.attributions).toEqual([
      expect.objectContaining({
        resultReportId: "result:nickname",
        source: expect.objectContaining({ nicknameSnapshot: "Researcher" }),
      }),
    ])
  })
})
