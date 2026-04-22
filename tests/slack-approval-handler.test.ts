import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { eventBus } from "../packages/core/src/events/index.js"
import { listLatencyMetrics, resetLatencyMetrics } from "../packages/core/src/observability/latency.js"

const getRootRunMock = vi.fn()

vi.mock("../packages/core/src/runs/store.js", () => ({
  getRootRun: (...args: unknown[]) => getRootRunMock(...args),
}))

const {
  registerSlackApprovalHandler,
  setActiveSlackConversationForSession,
  clearActiveSlackConversationForSession,
  handleSlackApprovalAction,
} = await import("../packages/core/src/channels/slack/approval-handler.ts")

describe("slack approval handler", () => {
  beforeEach(() => {
    resetLatencyMetrics()
    vi.useRealTimers()
  })

  afterEach(() => {
    resetLatencyMetrics()
    vi.useRealTimers()
  })

  it("replaces the previous approval listener instead of stacking duplicate listeners", async () => {
    const firstMessenger = { sendApprovalRequest: vi.fn(async () => undefined) }
    const secondMessenger = { sendApprovalRequest: vi.fn(async () => undefined) }
    const resolve = vi.fn()

    getRootRunMock.mockReturnValue({
      source: "slack",
      sessionId: "session-slack-approval",
    })

    registerSlackApprovalHandler(firstMessenger)
    registerSlackApprovalHandler(secondMessenger)
    setActiveSlackConversationForSession(
      "session-slack-approval",
      "C_APPROVAL",
      "U_APPROVER",
      "thread-123",
    )

    eventBus.emit("approval.request", {
      runId: "run-slack-approval-replace",
      toolName: "screen_capture",
      params: { extensionId: "yeonjang-main" },
      kind: "approval",
      resolve,
    })

    await new Promise((resolveTick) => setTimeout(resolveTick, 0))

    expect(firstMessenger.sendApprovalRequest).not.toHaveBeenCalled()
    expect(secondMessenger.sendApprovalRequest).toHaveBeenCalledTimes(1)

    clearActiveSlackConversationForSession("session-slack-approval")
  })

  it("sends button approval requests and resolves from block actions", async () => {
    const sendApprovalRequest = vi.fn(async () => undefined)
    const reply = vi.fn(async () => undefined)
    const resolve = vi.fn()
    const approvalResolved = vi.fn()

    getRootRunMock.mockReturnValue({
      source: "slack",
      sessionId: "session-slack-approval",
    })

    const off = eventBus.on("approval.resolved", approvalResolved)
    registerSlackApprovalHandler({ sendApprovalRequest })
    setActiveSlackConversationForSession(
      "session-slack-approval",
      "C_APPROVAL",
      "U_APPROVER",
      "thread-123",
    )

    eventBus.emit("approval.request", {
      runId: "run-slack-approval",
      toolName: "screen_capture",
      params: { extensionId: "yeonjang-main" },
      kind: "approval",
      resolve,
    })

    await new Promise((resolveTick) => setTimeout(resolveTick, 0))

    expect(sendApprovalRequest).toHaveBeenCalledWith({
      channelId: "C_APPROVAL",
      threadTs: "thread-123",
      runId: "run-slack-approval",
      text: expect.stringContaining("도구 실행 승인이 필요합니다."),
    })

    await expect(handleSlackApprovalAction({
      runId: "run-slack-approval",
      decision: "allow_once",
      channelId: "C_APPROVAL",
      threadTs: "thread-123",
      userId: "U_APPROVER",
      reply,
    })).resolves.toBe(true)

    expect(resolve).toHaveBeenCalledWith("allow_once", "user")
    expect(reply).toHaveBeenCalledWith("이번 단계만 승인했습니다.")
    expect(approvalResolved).toHaveBeenCalledWith({
      runId: "run-slack-approval",
      decision: "allow_once",
      toolName: "screen_capture",
      kind: "approval",
      reason: "user",
    })

    clearActiveSlackConversationForSession("session-slack-approval")
    off()
  })

  it("falls back to the latest active Slack conversation when the session mapping was cleared before a child approval request", async () => {
    const sendApprovalRequest = vi.fn(async () => undefined)
    const resolve = vi.fn()

    getRootRunMock.mockReturnValue({
      source: "slack",
      sessionId: "session-slack-child",
    })

    registerSlackApprovalHandler({ sendApprovalRequest })
    setActiveSlackConversationForSession(
      "session-slack-root",
      "C_APPROVAL",
      "U_APPROVER",
      "thread-123",
    )
    clearActiveSlackConversationForSession("session-slack-root")

    eventBus.emit("approval.request", {
      runId: "run-slack-child",
      toolName: "screen_capture",
      params: { extensionId: "yeonjang-main" },
      kind: "approval",
      resolve,
    })

    await new Promise((resolveTick) => setTimeout(resolveTick, 0))

    expect(sendApprovalRequest).toHaveBeenCalledWith({
      channelId: "C_APPROVAL",
      threadTs: "thread-123",
      runId: "run-slack-child",
      text: expect.stringContaining("도구 실행 승인이 필요합니다."),
    })
    expect(resolve).not.toHaveBeenCalled()
  })

  it("records approval aggregation latency when a later approval is merged into the same pending request", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-21T00:00:00.000Z"))

    const sendApprovalRequest = vi.fn(async () => undefined)
    const updateApprovalRequest = vi.fn(async () => undefined)
    const firstResolve = vi.fn()
    const secondResolve = vi.fn()

    getRootRunMock.mockReturnValue({
      source: "slack",
      sessionId: "session-slack-aggregate",
    })

    registerSlackApprovalHandler({ sendApprovalRequest, updateApprovalRequest })
    setActiveSlackConversationForSession(
      "session-slack-aggregate",
      "C_APPROVAL",
      "U_APPROVER",
      "thread-aggregate",
    )

    eventBus.emit("approval.request", {
      runId: "run-slack-aggregate",
      toolName: "screen_capture",
      params: { extensionId: "yeonjang-main" },
      kind: "approval",
      resolve: firstResolve,
    })
    await Promise.resolve()
    await Promise.resolve()

    await vi.advanceTimersByTimeAsync(450)
    eventBus.emit("approval.request", {
      runId: "run-slack-aggregate",
      toolName: "web_fetch",
      params: { url: "https://example.test" },
      kind: "approval",
      resolve: secondResolve,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(sendApprovalRequest).toHaveBeenCalledTimes(1)
    expect(updateApprovalRequest).toHaveBeenCalledTimes(1)
    expect(updateApprovalRequest).toHaveBeenCalledWith({
      channelId: "C_APPROVAL",
      threadTs: "thread-aggregate",
      runId: "run-slack-aggregate",
      text: expect.stringContaining("승인 항목: 2개"),
    })
    expect(listLatencyMetrics()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "approval_aggregation_latency_ms",
        durationMs: 450,
        runId: "run-slack-aggregate",
        sessionId: "session-slack-aggregate",
        detail: expect.objectContaining({
          channel: "slack",
          approvalCount: 2,
        }),
      }),
    ]))

    clearActiveSlackConversationForSession("session-slack-aggregate")
  })
})
