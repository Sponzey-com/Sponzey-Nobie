import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { listAuditEvents } from "../packages/core/src/api/routes/audit.ts"
import {
  type ApprovalAggregateContext,
  appendApprovalAggregateItem,
  buildApprovalAggregateText,
  resolveApprovalAggregate,
} from "../packages/core/src/channels/approval-aggregation.ts"
import { createTelegramChunkDeliveryHandler } from "../packages/core/src/channels/telegram/chunk-delivery.ts"
import { reloadConfig } from "../packages/core/src/config/index.js"
import { CONTRACT_SCHEMA_VERSION } from "../packages/core/src/contracts/index.ts"
import type { SubSessionContract } from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import type {
  AgentPromptBundle,
  CommandRequest,
  ExpectedOutputContract,
  RuntimeIdentity,
} from "../packages/core/src/contracts/sub-agent-orchestration.ts"
import { closeDb, insertSession, listMessageLedgerEvents } from "../packages/core/src/db/index.js"
import { createSubSessionProgressAggregator } from "../packages/core/src/orchestration/sub-session-progress-aggregation.ts"
import {
  type RunSubSessionInput,
  SubSessionRunner,
  type SubSessionRuntimeDependencies,
  createTextResultReport,
} from "../packages/core/src/orchestration/sub-session-runner.ts"
import { buildActiveRunProjection } from "../packages/core/src/runs/active-run-projection.ts"
import { emitAssistantTextDelivery } from "../packages/core/src/runs/delivery.ts"
import {
  type MessageLedgerEventInput,
  recordMessageLedgerEvent,
} from "../packages/core/src/runs/message-ledger.ts"
import { createRootRun } from "../packages/core/src/runs/store.ts"
import type { RootRun } from "../packages/core/src/runs/types.ts"

const previousStateDir = process.env.NOBIE_STATE_DIR
const previousConfig = process.env.NOBIE_CONFIG
const tempDirs: string[] = []

function useTempConfig(): void {
  closeDb()
  const stateDir = mkdtempSync(join(tmpdir(), "nobie-task013-channel-delivery-"))
  tempDirs.push(stateDir)
  const configPath = join(stateDir, "config.json5")
  writeFileSync(
    configPath,
    `{
    ai: { connection: { provider: "ollama", endpoint: "http://127.0.0.1:11434", model: "llama3.2" } },
    webui: { enabled: true, host: "127.0.0.1", port: 18181, auth: { enabled: false } },
    security: { approvalMode: "off" },
    memory: { searchMode: "fts", sessionRetentionDays: 30 },
    scheduler: { enabled: false, timezone: "Asia/Seoul" }
  }`,
    "utf-8",
  )
  process.env.NOBIE_STATE_DIR = stateDir
  process.env.NOBIE_CONFIG = configPath
  reloadConfig()
}

function restoreEnv(): void {
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
}

function seedRun(): RootRun {
  const now = Date.now()
  insertSession({
    id: "session-task013-delivery",
    source: "telegram",
    source_id: "chat-task013",
    created_at: now,
    updated_at: now,
    summary: null,
  })
  return createRootRun({
    id: "run-task013-delivery",
    sessionId: "session-task013-delivery",
    requestGroupId: "group-task013-delivery",
    prompt: "전달 중복 방지",
    source: "telegram",
  })
}

function subSession(overrides: Partial<SubSessionContract> = {}): SubSessionContract {
  return {
    identity: {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      entityType: "sub_session",
      entityId: "sub-session-1",
      owner: { ownerType: "sub_agent", ownerId: "agent-weather" },
      idempotencyKey: "sub-session-idem-1",
      parent: {
        parentRunId: "run-1",
        parentSessionId: "session-1",
        parentRequestId: "group-1",
      },
    },
    subSessionId: "sub-session-1",
    parentSessionId: "session-1",
    parentRunId: "run-1",
    agentId: "agent-weather",
    agentDisplayName: "Weather Agent",
    agentNickname: "weather",
    commandRequestId: "command-1",
    status: "running",
    retryBudgetRemaining: 2,
    promptBundleId: "bundle-1",
    ...overrides,
  }
}

const expectedOutput: ExpectedOutputContract = {
  outputId: "answer",
  kind: "text",
  description: "reviewable answer",
  required: true,
  acceptance: {
    requiredEvidenceKinds: [],
    artifactRequired: false,
    reasonCodes: ["reviewable_text"],
  },
}

const modelProfile = {
  providerId: "openai",
  modelId: "gpt-5.4-mini",
  effort: "low",
  maxOutputTokens: 512,
  timeoutMs: 1000,
  retryCount: 0,
  costBudget: 1,
}

function runtimeIdentity(entityId: string): RuntimeIdentity {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    entityType: "sub_session",
    entityId,
    owner: { ownerType: "sub_agent", ownerId: "agent-progress" },
    idempotencyKey: `idem:${entityId}`,
    parent: {
      parentRunId: "run-task013-progress",
      parentSessionId: "session-task013-progress",
      parentRequestId: "group-task013-progress",
    },
  }
}

function runInputForProgress(subSessionId: string): RunSubSessionInput {
  const command: CommandRequest = {
    identity: runtimeIdentity(subSessionId),
    commandRequestId: `command:${subSessionId}`,
    parentRunId: "run-task013-progress",
    subSessionId,
    targetAgentId: "agent-progress",
    taskScope: {
      goal: "collect progress safely",
      intentType: "task013_progress_test",
      actionType: "sub_session",
      constraints: ["Do not deliver directly to the user."],
      expectedOutputs: [expectedOutput],
      reasonCodes: ["test"],
    },
    contextPackageIds: [],
    expectedOutputs: [expectedOutput],
    retryBudget: 1,
  }
  const promptBundle = {
    identity: runtimeIdentity(`bundle:${subSessionId}`),
    bundleId: `bundle:${subSessionId}`,
    agentId: "agent-progress",
    agentType: "sub_agent",
    role: "progress test",
    displayNameSnapshot: "Progress Agent",
    teamContext: [],
    memoryPolicy: {},
    capabilityPolicy: {},
    modelProfileSnapshot: modelProfile,
    taskScope: command.taskScope,
    safetyRules: [],
    sourceProvenance: [],
    createdAt: 1,
  } as AgentPromptBundle
  return {
    command,
    agent: { agentId: "agent-progress", displayName: "Progress Agent" },
    parentSessionId: "session-task013-progress",
    promptBundle,
  }
}

beforeEach(() => {
  useTempConfig()
})

afterEach(() => {
  restoreEnv()
})

describe("task013 channel delivery and approval observability", () => {
  it("aggregates sub-session progress by time window and keeps the latest item per sub-session", () => {
    const aggregator = createSubSessionProgressAggregator({ now: () => 10_000, windowMs: 3_000 })

    expect(
      aggregator.push({
        parentRunId: "run-progress",
        subSessionId: "sub-a",
        agentId: "agent-a",
        agentDisplayName: "Alpha",
        status: "running",
        summary: "first draft",
        at: 1_000,
      }),
    ).toBeUndefined()
    expect(
      aggregator.push({
        parentRunId: "run-progress",
        subSessionId: "sub-a",
        agentId: "agent-a",
        agentDisplayName: "Alpha",
        status: "running",
        summary: "second draft",
        at: 2_000,
      }),
    ).toBeUndefined()
    const batch = aggregator.push({
      parentRunId: "run-progress",
      subSessionId: "sub-b",
      agentId: "agent-b",
      agentDisplayName: "Beta",
      status: "running",
      summary: "collecting evidence",
      at: 4_100,
    })

    expect(batch).toMatchObject({
      parentRunId: "run-progress",
      reason: "window_elapsed",
      windowMs: 3_100,
    })
    expect(batch?.items).toHaveLength(2)
    expect(batch?.items.find((item) => item.subSessionId === "sub-a")?.summary).toBe("second draft")
    expect(batch?.text).toContain("Alpha running: second draft")
    expect(batch?.text).toContain("Beta running: collecting evidence")
  })

  it("records summarized sub-session progress and suppresses direct result delivery", async () => {
    const sessions = new Map<string, SubSessionContract>()
    const parentEvents: string[] = []
    const ledgerEvents: MessageLedgerEventInput[] = []
    let time = 1_000
    const dependencies: SubSessionRuntimeDependencies = {
      now: () => {
        time += 1_000
        return time
      },
      idProvider: () => {
        time += 1
        return `id-${time}`
      },
      loadSubSessionByIdempotencyKey: (idempotencyKey) =>
        [...sessions.values()].find(
          (session) => session.identity.idempotencyKey === idempotencyKey,
        ),
      persistSubSession: (session) => {
        sessions.set(session.subSessionId, structuredClone(session))
        return true
      },
      updateSubSession: (session) => {
        sessions.set(session.subSessionId, structuredClone(session))
      },
      appendParentEvent: (_parentRunId, label) => {
        parentEvents.push(label)
      },
      isParentCancelled: () => false,
      progressAggregator: createSubSessionProgressAggregator({ now: () => time, windowMs: 3_000 }),
      recordLedgerEvent: (event) => {
        ledgerEvents.push(event)
        return `ledger-${ledgerEvents.length}`
      },
      deliverResultToUser: vi.fn(),
    }
    const runner = new SubSessionRunner(dependencies)
    const result = await runner.runSubSession(
      runInputForProgress("sub-progress"),
      async (input, controls) => {
        await controls.emitProgress("step one")
        await controls.emitProgress("step two")
        return createTextResultReport({ command: input.command, text: "sub result" })
      },
    )

    expect(result.status).toBe("completed")
    expect(dependencies.deliverResultToUser).not.toHaveBeenCalled()
    expect(parentEvents.some((event) => event.startsWith("sub_session_progress_summary:"))).toBe(
      true,
    )
    expect(
      ledgerEvents.some(
        (event) =>
          event.eventKind === "sub_session_progress_summarized" &&
          event.deliveryKind === "progress",
      ),
    ).toBe(true)
    expect(
      ledgerEvents.some(
        (event) =>
          event.eventKind === "sub_session_result_suppressed" && event.status === "suppressed",
      ),
    ).toBe(true)
  })

  it("carries progress delivery metadata through channel chunk receipts", async () => {
    const responder = {
      sendToolStatus: vi.fn(),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn(),
      sendFinalResponse: vi.fn().mockResolvedValue([606]),
      sendError: vi.fn(),
    }
    const onChunk = createTelegramChunkDeliveryHandler({
      responder,
      sessionId: "session-progress-channel",
      chatId: 42,
      getRunId: () => "run-progress-channel",
      deliveryKind: "progress",
      parentRunId: "run-parent-progress",
      subSessionId: "sub-progress-channel",
      agentId: "agent-progress",
      recordOutgoingMessageRef: vi.fn(),
      logError: vi.fn(),
    })

    await onChunk?.({ type: "text", delta: "서브 에이전트 진행 요약" })
    const receipt = await onChunk?.({ type: "done", totalTokens: 0 })

    expect(receipt?.textDeliveries?.[0]).toMatchObject({
      channel: "telegram",
      text: "서브 에이전트 진행 요약",
      deliveryKind: "progress",
      parentRunId: "run-parent-progress",
      subSessionId: "sub-progress-channel",
      agentId: "agent-progress",
    })
  })

  it("suppresses duplicate final assistant text before channel delivery", async () => {
    const run = seedRun()
    const firstChunk = vi.fn().mockResolvedValue(undefined)
    const secondChunk = vi.fn().mockResolvedValue(undefined)

    const first = await emitAssistantTextDelivery({
      runId: run.id,
      sessionId: run.sessionId,
      source: "telegram",
      text: "최종 답변입니다.",
      onChunk: firstChunk,
    })
    const second = await emitAssistantTextDelivery({
      runId: run.id,
      sessionId: run.sessionId,
      source: "telegram",
      text: "최종 답변입니다.",
      onChunk: secondChunk,
    })

    const events = listMessageLedgerEvents({ requestGroupId: run.requestGroupId })

    expect(first).toEqual({ persisted: true, textDelivered: true, doneDelivered: true })
    expect(second).toEqual({ persisted: false, textDelivered: true, doneDelivered: true })
    expect(firstChunk).toHaveBeenCalledTimes(2)
    expect(secondChunk).not.toHaveBeenCalled()
    expect(events.filter((event) => event.event_kind === "text_delivered")).toHaveLength(1)
    expect(
      events.some(
        (event) => event.event_kind === "text_delivery_suppressed" && event.status === "suppressed",
      ),
    ).toBe(true)
  })

  it("suppresses duplicate final text after a channel worker handler is recreated", async () => {
    const run = seedRun()
    const firstResponder = {
      sendToolStatus: vi.fn(),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn(),
      sendFinalResponse: vi.fn().mockResolvedValue([701]),
      sendError: vi.fn(),
    }
    const restartedResponder = {
      sendToolStatus: vi.fn(),
      updateToolStatus: vi.fn(),
      sendFile: vi.fn(),
      sendFinalResponse: vi.fn().mockResolvedValue([702]),
      sendError: vi.fn(),
    }
    const firstHandler = createTelegramChunkDeliveryHandler({
      responder: firstResponder,
      sessionId: run.sessionId,
      chatId: 42,
      getRunId: () => run.id,
      recordOutgoingMessageRef: vi.fn(),
      logError: vi.fn(),
    })
    const restartedHandler = createTelegramChunkDeliveryHandler({
      responder: restartedResponder,
      sessionId: run.sessionId,
      chatId: 42,
      getRunId: () => run.id,
      recordOutgoingMessageRef: vi.fn(),
      logError: vi.fn(),
    })

    await emitAssistantTextDelivery({
      runId: run.id,
      sessionId: run.sessionId,
      source: "telegram",
      text: "재시작 후에도 한 번만 가야 하는 최종 답변",
      onChunk: firstHandler,
    })
    await emitAssistantTextDelivery({
      runId: run.id,
      sessionId: run.sessionId,
      source: "telegram",
      text: "재시작 후에도 한 번만 가야 하는 최종 답변",
      onChunk: restartedHandler,
    })

    expect(firstResponder.sendFinalResponse).toHaveBeenCalledTimes(1)
    expect(restartedResponder.sendFinalResponse).not.toHaveBeenCalled()
    expect(
      listMessageLedgerEvents({ requestGroupId: run.requestGroupId }).some(
        (event) => event.event_kind === "text_delivery_suppressed" && event.status === "suppressed",
      ),
    ).toBe(true)
  })

  it("aggregates multiple approval items and resolves them with one decision", () => {
    const firstResolve = vi.fn()
    const secondResolve = vi.fn()
    let context: ApprovalAggregateContext | undefined

    context = appendApprovalAggregateItem(
      context,
      {
        approvalId: "approval-1",
        runId: "run-approval",
        parentRunId: "run-parent",
        subSessionId: "sub-1",
        agentId: "agent-a",
        toolName: "screen_capture",
        kind: "approval",
        riskSummary: "screen access",
        paramsPreview: "{}",
        resolve: firstResolve,
      },
      "user-1",
    ).context
    context = appendApprovalAggregateItem(
      context,
      {
        approvalId: "approval-2",
        runId: "run-approval",
        parentRunId: "run-parent",
        subSessionId: "sub-2",
        agentId: "agent-b",
        toolName: "web_fetch",
        kind: "approval",
        riskSummary: "external network",
        paramsPreview: '{"url":"https://example.test"}',
        resolve: secondResolve,
      },
      "user-1",
    ).context

    const text = buildApprovalAggregateText({ context, channel: "slack" })
    const resolved = resolveApprovalAggregate(context, "allow_once", "user")

    expect(text).toContain("승인 항목: 2개")
    expect(text).toContain("서브 세션: sub-1")
    expect(text).toContain("에이전트: agent-b")
    expect(resolved).toHaveLength(2)
    expect(firstResolve).toHaveBeenCalledWith("allow_once", "user")
    expect(secondResolve).toHaveBeenCalledWith("allow_once", "user")
  })

  it("keeps sub-session and agent keys in active-run projection and audit filters", () => {
    const projection = buildActiveRunProjection({
      id: "run-1",
      sessionId: "session-1",
      requestGroupId: "group-1",
      lineageRootRunId: "group-1",
      runScope: "root",
      title: "orchestration",
      prompt: "parallel work",
      source: "webui",
      status: "running",
      taskProfile: "general_chat",
      contextMode: "full",
      orchestrationMode: "orchestration",
      subSessionIds: ["sub-session-1"],
      subSessionsSnapshot: [subSession()],
      delegationTurnCount: 0,
      maxDelegationTurns: 5,
      currentStepKey: "executing",
      currentStepIndex: 4,
      totalSteps: 9,
      summary: "running",
      canCancel: true,
      createdAt: 1,
      updatedAt: 2,
      steps: [],
      recentEvents: [],
    })

    const run = seedRun()
    recordMessageLedgerEvent({
      runId: run.id,
      subSessionId: "sub-session-audit",
      agentId: "agent-audit",
      teamId: "team-audit",
      channel: "telegram",
      eventKind: "sub_session_progress_summarized",
      deliveryKind: "diagnostic",
      status: "delivered",
      summary: "sub-session progress",
    })
    const auditEvents = listAuditEvents({
      subSessionId: "sub-session-audit",
      agentId: "agent-audit",
      teamId: "team-audit",
    }).items

    expect(projection.orchestrationMode).toBe("orchestration")
    expect(projection.subSessions?.[0]).toEqual(
      expect.objectContaining({
        subSessionId: "sub-session-1",
        agentId: "agent-weather",
        status: "running",
      }),
    )
    expect(auditEvents.some((event) => event.summary === "sub-session progress")).toBe(true)
  })
})
