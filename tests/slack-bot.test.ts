import { beforeEach, describe, expect, it, vi } from "vitest"

const startIngressRunMock = vi.fn()
const sendReceiptMock = vi.fn(async () => "slack-message-1")

vi.mock("../packages/core/src/runs/ingress.js", () => ({
  startIngressRun: (...args: unknown[]) => startIngressRunMock(...args),
}))

vi.mock("../packages/core/src/channels/slack/chunk-delivery.js", () => ({
  createSlackChunkDeliveryHandler: () => vi.fn(),
}))

vi.mock("../packages/core/src/channels/slack/approval-handler.js", () => ({
  clearActiveSlackConversationForSession: vi.fn(),
  handleSlackApprovalAction: vi.fn(),
  handleSlackApprovalMessage: vi.fn(async () => false),
  registerSlackApprovalHandler: vi.fn(),
  setActiveSlackConversationForSession: vi.fn(),
}))

vi.mock("../packages/core/src/channels/slack/session.js", () => ({
  getOrCreateSlackSession: vi.fn(() => "session-slack-1"),
  newSlackSession: vi.fn(() => "session-slack-1"),
  resolveSlackSessionKey: vi.fn((channelId: string, threadTs: string) => `slack:${channelId}:${threadTs}`),
}))

vi.mock("../packages/core/src/channels/slack/responder.js", () => ({
  SlackResponder: vi.fn().mockImplementation(() => ({
    sendReceipt: sendReceiptMock,
    sendError: vi.fn(async () => "error-ts"),
    sendApprovalRequest: vi.fn(async () => "approval-ts"),
    sendToolStatus: vi.fn(async () => "tool-ts"),
    updateToolStatus: vi.fn(async () => undefined),
    sendFinalResponse: vi.fn(async () => ["final-ts"]),
    sendFile: vi.fn(async () => "file-ts"),
  })),
}))

vi.mock("../packages/core/src/db/index.js", () => ({
  findChannelMessageRef: vi.fn(() => null),
  insertChannelMessageRef: vi.fn(),
}))

vi.mock("../packages/core/src/runs/store.js", () => ({
  cancelRootRun: vi.fn(() => false),
  getRootRun: vi.fn(() => ({
    requestGroupId: "request-group-1",
  })),
}))

const { SlackChannel } = await import("../packages/core/src/channels/slack/bot.ts")

describe("slack channel", () => {
  beforeEach(() => {
    startIngressRunMock.mockReset()
    sendReceiptMock.mockClear()
    startIngressRunMock.mockReturnValue({
      started: {
        runId: "run-slack-1",
        finished: Promise.resolve(),
      },
      receipt: {
        language: "ko",
        text: "요청을 접수했습니다. 분석을 시작합니다.",
      },
    })
  })

  it("deduplicates the same inbound Slack message delivered as app_mention and message", async () => {
    const channel = new SlackChannel({
      enabled: true,
      botToken: "xoxb-test",
      appToken: "xapp-test",
      allowedUserIds: ["U_ALLOWED"],
      allowedChannelIds: ["C_ALLOWED"],
    }) as unknown as {
      socket: { send: ReturnType<typeof vi.fn> }
      handleSocketMessage: (raw: string) => Promise<void>
    }

    channel.socket = {
      send: vi.fn(),
    }

    const appMentionEnvelope = JSON.stringify({
      envelope_id: "env-1",
      payload: {
        event: {
          type: "app_mention",
          user: "U_ALLOWED",
          channel: "C_ALLOWED",
          text: "<@B_NOBIE> 메인화면 캡쳐해서 보여줘",
          ts: "1712570000.100000",
        },
      },
    })

    const messageEnvelope = JSON.stringify({
      envelope_id: "env-2",
      payload: {
        event: {
          type: "message",
          user: "U_ALLOWED",
          channel: "C_ALLOWED",
          text: "<@B_NOBIE> 메인화면 캡쳐해서 보여줘",
          ts: "1712570000.100000",
        },
      },
    })

    await channel.handleSocketMessage(appMentionEnvelope)
    await channel.handleSocketMessage(messageEnvelope)

    expect(startIngressRunMock).toHaveBeenCalledTimes(1)
    expect(sendReceiptMock).toHaveBeenCalledTimes(1)
  })
})
