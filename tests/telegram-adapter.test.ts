import { describe, expect, it } from "vitest"
import {
  buildTelegramContinuationLookupCandidate,
  createTelegramChannelAdapter,
  normalizeTelegramInboundUpdate,
  normalizeTelegramInteractionUpdate,
  resolveTelegramConnectionPolicy,
  validateTelegramWebhookSecretToken,
  type TelegramAdapterTransport,
} from "../packages/core/src/channels/telegram/adapter.ts"
import type { TelegramConfig } from "../packages/core/src/config/types.ts"
import { runChannelAdapterContractTests } from "./fixtures/channel-adapter-contract-runner.ts"
import {
  buildTelegramOutboundMessage,
  telegramInboundFixtures,
  telegramInteractionFixtures,
} from "./fixtures/channel-provider-fixtures.ts"

const telegramConfig: TelegramConfig = {
  enabled: true,
  botToken: "123456789:abcdefghijklmnopqrstuvwxyz123456",
  allowedUserIds: [42120565],
  allowedGroupIds: [-100100],
}

function transport(): TelegramAdapterTransport {
  return {
    async healthCheck() {
      return { status: "healthy", checkedAt: 1, message: "fixture transport is healthy." }
    },
    async sendMessage(message) {
      return {
        messageId: "telegram-message-700",
        ...(message.target.threadId ? { threadId: message.target.threadId } : {}),
        providerResponse: {
          ok: true,
          botToken: telegramConfig.botToken,
          message_id: 700,
        },
      }
    },
  }
}

runChannelAdapterContractTests({
  name: "Telegram production channel adapter facade contract",
  adapterFactory: () => createTelegramChannelAdapter({
    config: telegramConfig,
    transport: transport(),
    now: () => 1_710_000_200_000,
  }),
  inboundFixtures: telegramInboundFixtures,
  interactionFixtures: telegramInteractionFixtures,
  outboundMessage: buildTelegramOutboundMessage(),
})

describe("Telegram adapter facade policies", () => {
  it("keeps callback query out of inbound messages and message updates out of interactions", async () => {
    const inbound = await normalizeTelegramInboundUpdate(telegramInteractionFixtures[0]!.rawPayload)
    const interactions = await normalizeTelegramInteractionUpdate(telegramInboundFixtures[0]!.rawPayload)

    expect(inbound).toEqual([])
    expect(interactions).toEqual([])
  })

  it("normalizes inline approval keyboard callbacks to approval interaction decisions", async () => {
    const [allowOnce] = await normalizeTelegramInteractionUpdate({
      callback_query: {
        id: "callback-allow-once",
        data: "approve:run-telegram-1:once",
        from: { id: 42120565, first_name: "Tester" },
        message: {
          message_id: 700,
          date: 1710000200,
          chat: { id: 42120565, type: "private" },
        },
      },
    })
    const [allowRun] = await normalizeTelegramInteractionUpdate({
      callback_query: {
        id: "callback-allow-run",
        data: "approve:run-telegram-2:all",
        from: { id: 42120565, first_name: "Tester" },
        message: {
          message_id: 701,
          date: 1710000201,
          chat: { id: 42120565, type: "private" },
        },
      },
    })
    const [deny] = await normalizeTelegramInteractionUpdate({
      callback_query: {
        id: "callback-deny",
        data: "deny:run-telegram-3",
        from: { id: 42120565, first_name: "Tester" },
        message: {
          message_id: 702,
          date: 1710000202,
          chat: { id: 42120565, type: "private" },
        },
      },
    })

    expect(allowOnce).toMatchObject({
      interactionId: "callback-allow-once",
      kind: "approval",
      actionId: "allow_once",
      approvalDecision: "allow_once",
      correlationId: "run-telegram-1",
      value: "approve:run-telegram-1:once",
      messageId: "700",
    })
    expect(allowRun).toMatchObject({
      interactionId: "callback-allow-run",
      kind: "approval",
      actionId: "allow_run",
      approvalDecision: "allow_run",
      correlationId: "run-telegram-2",
    })
    expect(deny).toMatchObject({
      interactionId: "callback-deny",
      kind: "approval",
      actionId: "deny",
      approvalDecision: "deny",
      correlationId: "run-telegram-3",
    })
  })

  it("builds continuation lookup candidates from reply_to_message metadata", async () => {
    const [reply] = await createTelegramChannelAdapter({ config: telegramConfig })
      .normalizeInbound(telegramInboundFixtures.find((fixture) => fixture.name === "reply_to_message")!.rawPayload)

    expect(reply?.continuationContext).toEqual({
      parentMessageId: "300",
      source: "reply",
    })
    expect(buildTelegramContinuationLookupCandidate(reply!, { lookupWindowMs: 30_000 })).toEqual({
      provider: "telegram",
      chatId: "-100100",
      threadId: "7",
      messageId: "300",
      senderId: "77",
      timestamp: 1_710_000_030_000,
      lookupWindowMs: 30_000,
    })
  })

  it("expresses polling, duplicate polling, missing token, and webhook policy explicitly", () => {
    expect(resolveTelegramConnectionPolicy({ config: telegramConfig })).toMatchObject({
      mode: "polling",
      supported: true,
      canStart: true,
      reason: "ready",
    })
    expect(resolveTelegramConnectionPolicy({ config: telegramConfig, activePolling: true })).toMatchObject({
      supported: true,
      canStart: false,
      reason: "duplicate_polling",
      healthStatus: "degraded",
    })
    expect(resolveTelegramConnectionPolicy({
      config: { ...telegramConfig, botToken: "" },
    })).toMatchObject({
      supported: true,
      canStart: false,
      reason: "missing_token",
      healthStatus: "failed",
    })
    expect(resolveTelegramConnectionPolicy({ config: telegramConfig, mode: "webhook" })).toMatchObject({
      mode: "webhook",
      supported: false,
      canStart: false,
      reason: "webhook_unsupported",
      healthStatus: "failed",
    })
  })

  it("validates Telegram webhook secret tokens for the future webhook path", () => {
    expect(validateTelegramWebhookSecretToken({
      configuredSecret: "secret",
      receivedSecret: "secret",
    })).toEqual({ valid: true, reason: "matched" })
    expect(validateTelegramWebhookSecretToken({
      configuredSecret: "secret",
      receivedSecret: "wrong",
    })).toEqual({ valid: false, reason: "mismatch" })
    expect(validateTelegramWebhookSecretToken({ configuredSecret: "", receivedSecret: "secret" })).toEqual({
      valid: false,
      reason: "missing_configured_secret",
    })
    expect(validateTelegramWebhookSecretToken({ configuredSecret: "secret", receivedSecret: "" })).toEqual({
      valid: false,
      reason: "missing_received_secret",
    })
  })

  it("reports missing token as health failure without starting network transport", async () => {
    const adapter = createTelegramChannelAdapter({
      config: { ...telegramConfig, botToken: "" },
      now: () => 10,
    })

    await expect(adapter.healthCheck()).resolves.toEqual({
      status: "failed",
      checkedAt: 10,
      message: "Telegram bot token is missing.",
    })
    await expect(adapter.start()).rejects.toThrow("Telegram bot token is missing.")
  })
})
