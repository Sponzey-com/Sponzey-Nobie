import { describe, expect, it, vi } from "vitest"
import { eventBus } from "../packages/core/src/events/index.js"

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
})
