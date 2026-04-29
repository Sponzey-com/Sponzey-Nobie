import { describe, expect, it } from "vitest"
import {
  buildDiscordContinuationLookupCandidate,
  createDiscordChannelAdapter,
  normalizeDiscordComponentInteraction,
  normalizeDiscordInboundEvent,
  resolveDiscordConnectionPolicy,
  validateDiscordInteractionSignature,
  type DiscordAdapterTransport,
} from "../packages/core/src/channels/discord/adapter.ts"
import type { DiscordConfig } from "../packages/core/src/config/types.ts"
import { runChannelAdapterContractTests } from "./fixtures/channel-adapter-contract-runner.ts"
import {
  buildDiscordOutboundMessage,
  DISCORD_PUBLIC_KEY,
  discordComponentPayload,
  discordInboundFixtures,
  discordInteractionFixtures,
} from "./fixtures/channel-provider-fixtures.ts"

const DISCORD_NOW = 1_710_000_200_000

const discordConfig: DiscordConfig = {
  enabled: true,
  botToken: "discord-bot-secret-token",
  applicationId: "APP1",
  publicKey: DISCORD_PUBLIC_KEY,
  allowedUserIds: ["USER1"],
  allowedGuildIds: ["GUILD1"],
  allowedChannelIds: ["CHANNEL1"],
  grantedIntents: ["GuildMessages", "MessageContent", "DirectMessages"],
  botPermissions: ["SendMessages", "ReadMessageHistory", "UseApplicationCommands", "AttachFiles"],
  installedGuildIds: ["GUILD1"],
  largeGuildMode: false,
}

function transport(sentMessages: Parameters<NonNullable<DiscordAdapterTransport["sendMessage"]>>[0][] = []): DiscordAdapterTransport {
  return {
    async start() {},
    async stop() {},
    async healthCheck() {
      return { status: "healthy", checkedAt: DISCORD_NOW, message: "fixture transport is healthy." }
    },
    async sendMessage(message) {
      sentMessages.push(message)
      return {
        messageId: "discord-message-1",
        ...(message.target.threadId ? { threadId: message.target.threadId } : {}),
        providerResponse: {
          ok: true,
          authorization: `Bot ${discordConfig.botToken}`,
          id: "discord-message-1",
        },
      }
    },
  }
}

runChannelAdapterContractTests({
  name: "Discord production channel adapter facade contract",
  adapterFactory: () => createDiscordChannelAdapter({
    config: discordConfig,
    transport: transport(),
    now: () => DISCORD_NOW,
    botUserId: "BOT1",
    botDisplayName: "Nobie",
  }),
  inboundFixtures: discordInboundFixtures,
  interactionFixtures: discordInteractionFixtures,
  outboundMessage: buildDiscordOutboundMessage(),
})

describe("Discord adapter facade policies", () => {
  it("requires a valid Ed25519 interaction signature before normalizing components", () => {
    expect(normalizeDiscordComponentInteraction(discordComponentPayload, {
      publicKey: DISCORD_PUBLIC_KEY,
      now: () => DISCORD_NOW,
    })).toHaveLength(1)

    const forged = structuredClone(discordComponentPayload)
    forged.headers["x-signature-ed25519"] = "00".repeat(64)

    expect(normalizeDiscordComponentInteraction(forged, {
      publicKey: DISCORD_PUBLIC_KEY,
      now: () => DISCORD_NOW,
    })).toEqual([])
    expect(validateDiscordInteractionSignature({
      publicKey: DISCORD_PUBLIC_KEY,
      signature: forged.headers["x-signature-ed25519"],
      timestamp: forged.headers["x-signature-timestamp"],
      body: forged.rawBody,
    })).toEqual({ valid: false, reason: "verification_failed" })
  })

  it("deduplicates repeated inbound events and ignores bot or self messages", async () => {
    const adapter = createDiscordChannelAdapter({
      config: discordConfig,
      botUserId: "BOT1",
      botDisplayName: "Nobie",
      now: () => DISCORD_NOW,
    })
    const first = await adapter.normalizeInbound(discordInboundFixtures[0]!.rawPayload)
    const second = await adapter.normalizeInbound(discordInboundFixtures[0]!.rawPayload)
    const selfMessage = await normalizeDiscordInboundEvent({
      t: "MESSAGE_CREATE",
      d: {
        id: "self-1",
        guild_id: "GUILD1",
        channel_id: "CHANNEL1",
        author: { id: "BOT1", username: "Nobie", bot: false },
        content: "self echo",
      },
    }, { botUserId: "BOT1" })
    const botMessage = await normalizeDiscordInboundEvent({
      t: "MESSAGE_CREATE",
      d: {
        id: "bot-1",
        guild_id: "GUILD1",
        channel_id: "CHANNEL1",
        author: { id: "BOT2", username: "OtherBot", bot: true },
        content: "bot echo",
      },
    }, { botUserId: "BOT1" })

    expect(first).toHaveLength(1)
    expect(second).toEqual([])
    expect(selfMessage).toEqual([])
    expect(botMessage).toEqual([])
  })

  it("builds continuation lookup candidates from Discord reply metadata", async () => {
    const [reply] = await createDiscordChannelAdapter({
      config: discordConfig,
      botUserId: "BOT1",
      botDisplayName: "Nobie",
    }).normalizeInbound(discordInboundFixtures.find((fixture) => fixture.name === "thread reply")!.rawPayload)

    expect(reply?.continuationContext).toEqual({
      parentMessageId: "9001",
      source: "reply",
    })
    expect(buildDiscordContinuationLookupCandidate(reply!, { lookupWindowMs: 30_000 })).toEqual({
      provider: "discord",
      guildId: "GUILD1",
      channelId: "THREAD1",
      threadId: "THREAD1",
      messageId: "9001",
      senderId: "USER1",
      timestamp: 1_710_000_140_000,
      lookupWindowMs: 30_000,
    })
  })

  it("expresses token, application id, public key, intent, permission, and guild policy explicitly", () => {
    expect(resolveDiscordConnectionPolicy({
      config: discordConfig,
      transportAvailable: true,
    })).toMatchObject({
      mode: "gateway",
      supported: true,
      canStart: true,
      reason: "ready",
      healthStatus: "healthy",
    })
    expect(resolveDiscordConnectionPolicy({
      config: discordConfig,
      transportAvailable: false,
    })).toMatchObject({
      supported: true,
      canStart: false,
      reason: "gateway_transport_unavailable",
      healthStatus: "stopped",
    })
    expect(resolveDiscordConnectionPolicy({
      config: { ...discordConfig, botToken: "" },
      transportAvailable: true,
    })).toMatchObject({
      supported: true,
      canStart: false,
      reason: "missing_bot_token",
      healthStatus: "failed",
    })
    expect(resolveDiscordConnectionPolicy({
      config: { ...discordConfig, applicationId: "" },
      transportAvailable: true,
    })).toMatchObject({
      supported: true,
      canStart: false,
      reason: "missing_application_id",
      healthStatus: "failed",
    })
    expect(resolveDiscordConnectionPolicy({
      config: { ...discordConfig, publicKey: "" },
      transportAvailable: true,
    })).toMatchObject({
      supported: true,
      canStart: true,
      reason: "missing_public_key",
      healthStatus: "degraded",
    })

    const policy = resolveDiscordConnectionPolicy({
      config: {
        ...discordConfig,
        grantedIntents: ["GuildMessages"],
        botPermissions: ["SendMessages"],
        installedGuildIds: [],
        largeGuildMode: true,
      },
      transportAvailable: true,
    })
    expect(policy.canStart).toBe(true)
    expect(policy.doctor.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "discord_intent_missing:MessageContent",
      "discord_intent_missing:DirectMessages",
      "discord_permission_missing:ReadMessageHistory",
      "discord_permission_missing:UseApplicationCommands",
      "discord_permission_missing:AttachFiles",
      "discord_large_guild_conservative_mode",
    ]))
  })

  it("applies Discord thread policy before outbound transport delivery", async () => {
    const sentMessages: Parameters<NonNullable<DiscordAdapterTransport["sendMessage"]>>[0][] = []
    const adapter = createDiscordChannelAdapter({
      config: discordConfig,
      now: () => DISCORD_NOW,
      transport: transport(sentMessages),
    })

    const receipt = await adapter.sendMessage({
      ...buildDiscordOutboundMessage(),
      target: { roomId: "CHANNEL1" },
      threadPolicy: { mode: "reuse_thread", threadId: "THREAD1" },
      idempotencyKey: "discord:thread-policy",
    })

    expect(sentMessages[0]?.target).toEqual({
      roomId: "CHANNEL1",
      threadId: "THREAD1",
    })
    expect(receipt).toMatchObject({
      provider: "discord",
      status: "sent",
      messageId: "discord-message-1",
      threadId: "THREAD1",
      target: {
        roomId: "CHANNEL1",
        threadId: "THREAD1",
      },
      idempotencyKey: "discord:thread-policy",
    })
  })
})
