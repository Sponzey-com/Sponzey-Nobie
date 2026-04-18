import { describe, expect, it, vi } from "vitest"
import { buildIncomingIntentContract } from "../packages/core/src/runs/active-run-projection.ts"
import { buildStartPlan } from "../packages/core/src/runs/start-plan.ts"
import { createInboundMessageRecord } from "../packages/core/src/runs/request-isolation.ts"

function createDependencies(overrides?: Partial<Parameters<typeof buildStartPlan>[1]>) {
  const reconnectRun = {
    id: "run-prev",
    requestGroupId: "group-prev",
    lineageRootRunId: "group-prev",
    title: "이전 나스닥 조회",
    prompt: "지금 나스닥 지수 알려줘",
    summary: "NASDAQ lookup running",
    updatedAt: 100,
    status: "running",
    source: "telegram",
    sessionId: "session-1",
  } as any
  return {
    analyzeRequestEntrySemantics: vi.fn(() => ({ reuse_conversation_context: false, active_queue_cancellation_mode: null })),
    isReusableRequestGroup: vi.fn(() => false),
    listActiveSessionRequestGroups: vi.fn(() => [reconnectRun]),
    compareRequestContinuation: vi.fn(async () => ({
      kind: "same_run",
      requestGroupId: "group-prev",
      runId: "run-prev",
      decisionSource: "contract_ai",
      reason: "would incorrectly reuse without isolation",
    } as const)),
    getRequestGroupDelegationTurnCount: vi.fn(() => 1),
    buildWorkerSessionId: vi.fn(() => undefined),
    normalizeTaskProfile: vi.fn((taskProfile) => taskProfile ?? "general_chat"),
    findLatestWorkerSessionRun: vi.fn(() => undefined),
    ...overrides,
  }
}

describe("task006 request isolation", () => {
  it("creates separate inbound records for separate Telegram messages in the same thread", () => {
    const first = createInboundMessageRecord({
      source: "telegram",
      sessionId: "session-tg",
      channelEventId: "chat-1:main:101",
      externalChatId: "chat-1",
      externalThreadId: "main",
      externalMessageId: 101,
      userId: 7,
      rawText: "지금 코스피 지수 얼마야",
      receivedAt: 1,
    })
    const second = createInboundMessageRecord({
      source: "telegram",
      sessionId: "session-tg",
      channelEventId: "chat-1:main:102",
      externalChatId: "chat-1",
      externalThreadId: "main",
      externalMessageId: 102,
      userId: 7,
      rawText: "지금 나스닥 지수 얼마야",
      receivedAt: 2,
    })

    expect(first.messageKey).not.toBe(second.messageKey)
    expect(first.rootIsolation).toBe("new_root_by_default")
    expect(second.rootIsolation).toBe("new_root_by_default")
  })

  it("starts a new root run for a separate Telegram finance message even with an active run", async () => {
    const dependencies = createDependencies()
    const result = await buildStartPlan({
      message: "지금 코스피 지수 얼마야",
      sessionId: "session-1",
      runId: "run-kospi",
      source: "telegram",
      incomingIntentContract: buildIncomingIntentContract({ sessionId: "session-1", source: "telegram", targetId: "finance:kospi" }),
    }, dependencies)

    expect(dependencies.listActiveSessionRequestGroups).not.toHaveBeenCalled()
    expect(dependencies.compareRequestContinuation).not.toHaveBeenCalled()
    expect(result.requestGroupId).toBe("run-kospi")
    expect(result.isRootRequest).toBe(true)
  })

  it("starts a new root run for a Slack message with a different timestamp in the same thread", async () => {
    const dependencies = createDependencies()
    const result = await buildStartPlan({
      message: "오늘 나스닥 지수 얼마야?",
      sessionId: "slack:C1:1700000000.000100",
      runId: "run-slack-next",
      source: "slack",
      incomingIntentContract: buildIncomingIntentContract({ sessionId: "slack:C1:1700000000.000100", source: "slack", targetId: "finance:nasdaq" }),
    }, dependencies)

    expect(dependencies.listActiveSessionRequestGroups).not.toHaveBeenCalled()
    expect(dependencies.compareRequestContinuation).not.toHaveBeenCalled()
    expect(result.requestGroupId).toBe("run-slack-next")
    expect(result.isRootRequest).toBe(true)
  })
})

