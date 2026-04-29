import { describe, expect, it } from "vitest"
import {
  buildGoogleChatContinuationLookupCandidate,
  createGoogleChatChannelAdapter,
  normalizeGoogleChatCardAction,
  normalizeGoogleChatInboundEvent,
  resolveGoogleChatConnectionPolicy,
  validateGoogleChatRequestAuth,
  type GoogleChatAdapterTransport,
} from "../packages/core/src/channels/google-chat/adapter.ts"
import type { GoogleChatConfig } from "../packages/core/src/config/types.ts"
import { runChannelAdapterContractTests } from "./fixtures/channel-adapter-contract-runner.ts"
import {
  buildGoogleChatOutboundMessage,
  googleChatInboundFixtures,
  googleChatInteractionFixtures,
} from "./fixtures/channel-provider-fixtures.ts"

const GOOGLE_CHAT_NOW = 1_710_000_300_000

const googleChatConfig: GoogleChatConfig = {
  enabled: true,
  projectId: "project-1",
  appCredentialJson: "{\"type\":\"service_account\"}",
  serviceAccountEmail: "nobie@project-1.iam.gserviceaccount.com",
  webhookUrl: "https://example.com/api/channels/google-chat/events",
  verificationToken: "google-chat-verification-token",
  allowedUserIds: ["USER1"],
  allowedSpaceIds: ["SPACE1"],
  deployedSpaceIds: ["SPACE1"],
  grantedScopes: ["chat.bot"],
  appPublished: true,
  domainWideDelegation: false,
}

function transport(sentMessages: Parameters<NonNullable<GoogleChatAdapterTransport["sendMessage"]>>[0][] = []): GoogleChatAdapterTransport {
  return {
    async start() {},
    async stop() {},
    async healthCheck() {
      return { status: "healthy", checkedAt: GOOGLE_CHAT_NOW, message: "fixture transport is healthy." }
    },
    async sendMessage(message) {
      sentMessages.push(message)
      return {
        messageId: "google-chat-message-1",
        ...(message.target.threadId ? { threadId: message.target.threadId } : {}),
        providerResponse: {
          ok: true,
          token: googleChatConfig.verificationToken,
          name: "spaces/SPACE1/messages/google-chat-message-1",
        },
      }
    },
  }
}

runChannelAdapterContractTests({
  name: "Google Chat production channel adapter facade contract",
  adapterFactory: () => createGoogleChatChannelAdapter({
    config: googleChatConfig,
    transport: transport(),
    now: () => GOOGLE_CHAT_NOW,
    botUserId: "NOBIE_BOT",
  }),
  inboundFixtures: googleChatInboundFixtures,
  interactionFixtures: googleChatInteractionFixtures,
  outboundMessage: buildGoogleChatOutboundMessage(),
})

describe("Google Chat adapter facade policies", () => {
  it("requires request verification before normalizing messages and card actions", () => {
    expect(normalizeGoogleChatInboundEvent(googleChatInboundFixtures[0]!.rawPayload, {
      verificationToken: googleChatConfig.verificationToken,
      now: () => GOOGLE_CHAT_NOW,
    })).toHaveLength(1)
    expect(normalizeGoogleChatCardAction(googleChatInteractionFixtures[0]!.rawPayload, {
      verificationToken: googleChatConfig.verificationToken,
      now: () => GOOGLE_CHAT_NOW,
    })).toHaveLength(1)

    expect(normalizeGoogleChatInboundEvent(googleChatInboundFixtures[0]!.rawPayload, {
      verificationToken: "wrong-token",
      now: () => GOOGLE_CHAT_NOW,
    })).toEqual([])
    expect(validateGoogleChatRequestAuth({
      verificationToken: googleChatConfig.verificationToken,
      receivedToken: "wrong-token",
    })).toEqual({ valid: false, reason: "mismatch" })
  })

  it("deduplicates repeated inbound events and ignores bot or self messages", async () => {
    const adapter = createGoogleChatChannelAdapter({
      config: googleChatConfig,
      botUserId: "NOBIE_BOT",
      now: () => GOOGLE_CHAT_NOW,
    })
    const first = await adapter.normalizeInbound(googleChatInboundFixtures[0]!.rawPayload)
    const second = await adapter.normalizeInbound(googleChatInboundFixtures[0]!.rawPayload)
    const selfMessage = normalizeGoogleChatInboundEvent({
      token: googleChatConfig.verificationToken,
      type: "MESSAGE",
      message: {
        name: "spaces/SPACE1/messages/self-1",
        text: "self echo",
        sender: { name: "users/NOBIE_BOT", displayName: "Nobie", type: "HUMAN" },
        space: { name: "spaces/SPACE1", type: "ROOM" },
      },
    }, { verificationToken: googleChatConfig.verificationToken, botUserId: "NOBIE_BOT" })
    const botMessage = normalizeGoogleChatInboundEvent({
      token: googleChatConfig.verificationToken,
      type: "MESSAGE",
      message: {
        name: "spaces/SPACE1/messages/bot-1",
        text: "bot echo",
        sender: { name: "users/BOT2", displayName: "Other Bot", type: "BOT" },
        space: { name: "spaces/SPACE1", type: "ROOM" },
      },
    }, { verificationToken: googleChatConfig.verificationToken, botUserId: "NOBIE_BOT" })

    expect(first).toHaveLength(1)
    expect(second).toEqual([])
    expect(selfMessage).toEqual([])
    expect(botMessage).toEqual([])
  })

  it("builds continuation lookup candidates from Google Chat thread metadata", async () => {
    const [message] = await createGoogleChatChannelAdapter({
      config: googleChatConfig,
      botUserId: "NOBIE_BOT",
    }).normalizeInbound(googleChatInboundFixtures[0]!.rawPayload)

    expect(message?.continuationContext).toEqual({
      parentMessageId: "THREAD1",
      source: "thread",
    })
    expect(buildGoogleChatContinuationLookupCandidate(message!, { lookupWindowMs: 30_000 })).toEqual({
      provider: "google_chat",
      spaceId: "SPACE1",
      threadId: "THREAD1",
      messageId: "MESSAGE1",
      senderId: "USER1",
      timestamp: GOOGLE_CHAT_NOW,
      lookupWindowMs: 30_000,
    })
  })

  it("expresses Workspace deployment, scope, and verification policy explicitly", () => {
    expect(resolveGoogleChatConnectionPolicy({
      config: googleChatConfig,
    })).toMatchObject({
      mode: "webhook",
      supported: true,
      canStart: true,
      reason: "ready",
      healthStatus: "healthy",
    })
    expect(resolveGoogleChatConnectionPolicy({
      config: { ...googleChatConfig, projectId: "", appCredentialJson: "", serviceAccountEmail: "" },
    })).toMatchObject({
      supported: true,
      canStart: false,
      reason: "missing_app_credential",
      healthStatus: "failed",
    })
    expect(resolveGoogleChatConnectionPolicy({
      config: { ...googleChatConfig, verificationToken: "" },
    })).toMatchObject({
      supported: true,
      canStart: false,
      reason: "missing_verification_token",
      healthStatus: "failed",
    })

    const policy = resolveGoogleChatConnectionPolicy({
      config: {
        ...googleChatConfig,
        grantedScopes: [],
        deployedSpaceIds: ["SPACE2"],
        appPublished: false,
      },
    })
    expect(policy.canStart).toBe(true)
    expect(policy.doctor.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "google_chat_app_not_published",
      "google_chat_space_not_deployed:SPACE1",
    ]))
  })

  it("applies Google Chat thread policy before outbound transport delivery", async () => {
    const sentMessages: Parameters<NonNullable<GoogleChatAdapterTransport["sendMessage"]>>[0][] = []
    const adapter = createGoogleChatChannelAdapter({
      config: googleChatConfig,
      now: () => GOOGLE_CHAT_NOW,
      transport: transport(sentMessages),
    })

    const receipt = await adapter.sendMessage({
      ...buildGoogleChatOutboundMessage(),
      target: { roomId: "SPACE1" },
      threadPolicy: { mode: "reuse_thread", threadId: "THREAD1" },
      idempotencyKey: "google_chat:thread-policy",
    })

    expect(sentMessages[0]?.target).toEqual({
      roomId: "SPACE1",
      threadId: "THREAD1",
    })
    expect(receipt).toMatchObject({
      provider: "google_chat",
      status: "sent",
      messageId: "google-chat-message-1",
      threadId: "THREAD1",
      target: {
        roomId: "SPACE1",
        threadId: "THREAD1",
      },
      idempotencyKey: "google_chat:thread-policy",
    })
  })
})
