import { describe, expect, it } from "vitest"
import {
  buildSlackContinuationLookupCandidate,
  createSlackChannelAdapter,
  normalizeSlackInboundEvent,
  normalizeSlackInteractionPayload,
  resolveSlackConnectionPolicy,
  type SlackAdapterTransport,
} from "../packages/core/src/channels/slack/adapter.ts"
import { SlackRateLimitError } from "../packages/core/src/channels/slack/message-delivery.ts"
import type { SlackConfig } from "../packages/core/src/config/types.ts"
import { runChannelAdapterContractTests } from "./fixtures/channel-adapter-contract-runner.ts"
import {
  buildSlackOutboundMessage,
  slackInboundFixtures,
  slackInteractionFixtures,
} from "./fixtures/channel-provider-fixtures.ts"

const slackConfig: SlackConfig = {
  enabled: true,
  botToken: "xoxb-slack-secret-token",
  appToken: "xapp-slack-secret-token",
  allowedUserIds: [],
  allowedChannelIds: [],
}

function transport(): SlackAdapterTransport {
  return {
    async healthCheck() {
      return { status: "healthy", checkedAt: 1, message: "fixture transport is healthy." }
    },
    async sendMessage(message) {
      return {
        messageId: "1710000100.000900",
        ...(message.target.threadId ? { threadId: message.target.threadId } : {}),
        providerResponse: {
          ok: true,
          Authorization: `Bearer ${slackConfig.botToken}`,
          ts: "1710000100.000900",
        },
      }
    },
  }
}

runChannelAdapterContractTests({
  name: "Slack production channel adapter facade contract",
  adapterFactory: () => createSlackChannelAdapter({
    config: slackConfig,
    transport: transport(),
    now: () => 1_710_000_200_000,
    botUserId: "U_NOBIE",
    botDisplayName: "Nobie",
  }),
  inboundFixtures: slackInboundFixtures,
  interactionFixtures: slackInteractionFixtures,
  outboundMessage: buildSlackOutboundMessage(),
})

describe("Slack adapter facade policies", () => {
  it("deduplicates repeated inbound events and ignores bot or self messages", async () => {
    const adapter = createSlackChannelAdapter({
      config: slackConfig,
      botUserId: "U_NOBIE",
      botDisplayName: "Nobie",
      now: () => 1_710_000_200_000,
    })
    const first = await adapter.normalizeInbound(slackInboundFixtures[0]!.rawPayload)
    const second = await adapter.normalizeInbound(slackInboundFixtures[0]!.rawPayload)
    const botEvent = await adapter.normalizeInbound({
      type: "event_callback",
      event: {
        type: "message",
        user: "U_NOBIE",
        text: "self echo",
        channel: "C_APPROVAL",
        ts: "1710000200.000100",
        event_ts: "1710000200.000100",
      },
    })
    const botMessage = await normalizeSlackInboundEvent({
      type: "event_callback",
      event: {
        type: "message",
        bot_id: "B_NOBIE",
        user: "U_OTHER_BOT",
        text: "bot echo",
        channel: "C_APPROVAL",
        ts: "1710000201.000100",
        event_ts: "1710000201.000100",
      },
    })

    expect(first).toHaveLength(1)
    expect(second).toEqual([])
    expect(botEvent).toEqual([])
    expect(botMessage).toEqual([])
  })

  it("builds continuation lookup candidates from Slack thread metadata", async () => {
    const [reply] = await createSlackChannelAdapter({
      config: slackConfig,
      botUserId: "U_NOBIE",
      botDisplayName: "Nobie",
    }).normalizeInbound(slackInboundFixtures.find((fixture) => fixture.name === "thread reply")!.rawPayload)

    expect(reply?.continuationContext).toEqual({
      parentMessageId: "1710000100.000100",
      source: "thread",
    })
    expect(buildSlackContinuationLookupCandidate(reply!, {
      lookupWindowMs: 30_000,
      teamId: "T123",
    })).toEqual({
      provider: "slack",
      teamId: "T123",
      channelId: "C_APPROVAL",
      threadTs: "1710000100.000100",
      messageTs: "1710000100.000100",
      senderId: "U_OPERATOR",
      timestamp: 1_710_000_120_000,
      lookupWindowMs: 30_000,
    })
  })

  it("normalizes Slack file share events as inbound attachments", async () => {
    const [fileMessage] = await normalizeSlackInboundEvent({
      team_id: "T123",
      event_id: "EvFILE",
      type: "event_callback",
      event: {
        type: "message",
        subtype: "file_share",
        user: "U_OPERATOR",
        text: "review this",
        channel: "C_APPROVAL",
        ts: "1710000130.000400",
        event_ts: "1710000130.000400",
        files: [{
          id: "F123",
          name: "report.png",
          mimetype: "image/png",
          size: 2048,
          url_private: "https://files.slack.com/report.png",
        }],
      },
    })

    expect(fileMessage).toMatchObject({
      provider: "slack",
      messageId: "1710000130.000400",
      room: { id: "C_APPROVAL", type: "channel" },
      text: "review this",
      attachments: [{
        id: "F123",
        name: "report.png",
        mimeType: "image/png",
        sizeBytes: 2048,
        kind: "image",
        url: "https://files.slack.com/report.png",
        contentRef: "slack:file:F123",
      }],
    })
  })

  it("keeps event payloads out of interactions and block actions out of inbound messages", async () => {
    const inbound = await normalizeSlackInboundEvent(slackInteractionFixtures[0]!.rawPayload)
    const interactions = await normalizeSlackInteractionPayload(slackInboundFixtures[0]!.rawPayload)

    expect(inbound).toEqual([])
    expect(interactions).toEqual([])
  })

  it("expresses token, duplicate socket, and missing scope health policy explicitly", () => {
    expect(resolveSlackConnectionPolicy({ config: slackConfig })).toMatchObject({
      mode: "socket",
      supported: true,
      canStart: true,
      reason: "ready",
    })
    expect(resolveSlackConnectionPolicy({ config: slackConfig, activeSocket: true })).toMatchObject({
      supported: true,
      canStart: false,
      reason: "duplicate_socket",
      healthStatus: "degraded",
    })
    expect(resolveSlackConnectionPolicy({
      config: { ...slackConfig, botToken: "" },
    })).toMatchObject({
      supported: true,
      canStart: false,
      reason: "missing_bot_token",
      healthStatus: "failed",
    })
    expect(resolveSlackConnectionPolicy({
      config: { ...slackConfig, appToken: "" },
    })).toMatchObject({
      supported: true,
      canStart: false,
      reason: "missing_app_token",
      healthStatus: "failed",
    })
    expect(resolveSlackConnectionPolicy({
      config: slackConfig,
      lastError: "missing_scope: chat:write",
    })).toMatchObject({
      supported: true,
      canStart: false,
      reason: "missing_scope",
      healthStatus: "failed",
    })
  })

  it("reports missing tokens as health failure without starting network transport", async () => {
    const adapter = createSlackChannelAdapter({
      config: { ...slackConfig, botToken: "" },
      now: () => 10,
    })

    await expect(adapter.healthCheck()).resolves.toEqual({
      status: "failed",
      checkedAt: 10,
      message: "Slack bot token is missing.",
    })
    await expect(adapter.start()).rejects.toThrow("Slack bot token is missing.")
  })

  it("applies Slack thread policy before outbound transport delivery", async () => {
    const sentMessages: Parameters<NonNullable<SlackAdapterTransport["sendMessage"]>>[0][] = []
    const adapter = createSlackChannelAdapter({
      config: slackConfig,
      now: () => 1_710_000_200_000,
      transport: {
        async sendMessage(message) {
          sentMessages.push(message)
          return {
            messageId: "1710000100.000901",
            threadId: message.target.threadId,
            providerResponse: { ok: true, ts: "1710000100.000901" },
          }
        },
      },
    })

    const receipt = await adapter.sendMessage({
      ...buildSlackOutboundMessage(),
      target: { roomId: "C_APPROVAL" },
      threadPolicy: { mode: "reuse_thread", threadId: "1710000100.000100" },
      idempotencyKey: "slack:thread-policy",
    })

    expect(sentMessages[0]?.target).toEqual({
      roomId: "C_APPROVAL",
      threadId: "1710000100.000100",
    })
    expect(receipt).toMatchObject({
      provider: "slack",
      status: "sent",
      messageId: "1710000100.000901",
      threadId: "1710000100.000100",
      target: {
        roomId: "C_APPROVAL",
        threadId: "1710000100.000100",
      },
      idempotencyKey: "slack:thread-policy",
    })
  })

  it("normalizes Slack rate limits into delivery receipts", async () => {
    const adapter = createSlackChannelAdapter({
      config: slackConfig,
      now: () => 1_710_000_200_000,
      transport: {
        async sendMessage() {
          throw new SlackRateLimitError({
            retryAfterMs: 3_000,
            method: "chat.postMessage",
          })
        },
      },
    })

    await expect(adapter.sendMessage({
      ...buildSlackOutboundMessage(),
      idempotencyKey: "slack:rate-limit",
    })).resolves.toMatchObject({
      provider: "slack",
      status: "rate_limited",
      retryAfterMs: 3_000,
      errorCode: "slack_rate_limited",
      idempotencyKey: "slack:rate-limit",
    })
  })

  it("normalizes Slack approval action aliases", async () => {
    const basePayload = {
      type: "block_actions",
      team: { id: "T123" },
      user: { id: "U_APPROVER", username: "approver", name: "approver" },
      channel: { id: "C_APPROVAL", name: "approval" },
      message: { ts: "1710000100.000100", thread_ts: "1710000100.000100" },
    }

    expect(normalizeSlackInteractionPayload({
      ...basePayload,
      actions: [{ action_id: "approve", value: "run-1", type: "button" }],
    })[0]).toMatchObject({
      kind: "approval",
      actionId: "allow_run",
      approvalDecision: "allow_run",
      correlationId: "run-1",
    })
    expect(normalizeSlackInteractionPayload({
      ...basePayload,
      actions: [{ action_id: "approve_once", value: "run-2", type: "button" }],
    })[0]).toMatchObject({
      kind: "approval",
      actionId: "allow_once",
      approvalDecision: "allow_once",
      correlationId: "run-2",
    })
  })
})
