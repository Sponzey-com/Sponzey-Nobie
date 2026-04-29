import { describe, expect, it } from "vitest"
import {
  buildUnsupportedCapabilityReceipt,
  createRawPayloadRef,
  defineChannelAdapter,
  defineChannelCapabilities,
  isBuiltInChannelProvider,
  isExternalChannelProvider,
  isInternalChannelSurface,
  normalizeChannelSource,
  resolveChannelSurface,
  resolveDeliveryReceiptStatus,
  sanitizeChannelContractValue,
  type ChannelAdapter,
  type ChannelCapabilities,
  type DeliveryReceipt,
  type InboundEnvelope,
  type InteractionEnvelope,
  type OutboundMessage,
} from "../packages/core/src/channels/contracts.ts"

function telegramCapabilities(): ChannelCapabilities {
  return defineChannelCapabilities({
    provider: "telegram",
    connectionKind: "bot_api",
    supportsThreads: true,
    supportsReplies: true,
    supportsEdits: true,
    supportsDeletes: false,
    supportsReactions: false,
    supportsButtons: true,
    supportsModals: false,
    supportsFiles: true,
    supportsImages: true,
    supportsTypingIndicator: true,
    maxMessageLength: 4096,
    maxAttachmentSizeBytes: 50 * 1024 * 1024,
    rateLimitPolicy: { strategy: "provider_default" },
    requiresWebhook: false,
    requiresLocalBridge: false,
    requiresUserSession: false,
    riskLevel: "low",
    deliveryStates: {
      supportsAccepted: true,
      supportsSent: true,
      supportsDelivered: false,
      supportsReadReceipt: false,
    },
  })
}

function slackCapabilities(): ChannelCapabilities {
  return defineChannelCapabilities({
    provider: "slack",
    connectionKind: "socket",
    supportsThreads: true,
    supportsReplies: true,
    supportsEdits: true,
    supportsDeletes: true,
    supportsReactions: true,
    supportsButtons: true,
    supportsModals: true,
    supportsFiles: true,
    supportsImages: true,
    supportsTypingIndicator: false,
    maxMessageLength: 3000,
    maxAttachmentSizeBytes: 1024 * 1024 * 1024,
    rateLimitPolicy: { strategy: "provider_default" },
    requiresWebhook: false,
    requiresLocalBridge: false,
    requiresUserSession: false,
    riskLevel: "low",
    deliveryStates: {
      supportsAccepted: true,
      supportsSent: true,
      supportsDelivered: false,
      supportsReadReceipt: false,
    },
  })
}

describe("channel contract", () => {
  it("redacts provider raw payload previews instead of exposing raw secrets", () => {
    const ref = createRawPayloadRef({
      provider: "telegram",
      createdAt: 1,
      payload: {
        message_id: 42,
        botToken: "123456789:abcdefghijklmnopqrstuvwxyz",
        nested: {
          Authorization: "Bearer abcdefghijklmnopqrstuvwxyz",
          text: "safe text",
        },
      },
    })

    expect(ref).toMatchObject({
      storage: "redacted_inline",
      redactionState: "redacted",
      provider: "telegram",
      createdAt: 1,
    })
    expect(JSON.stringify(ref.preview)).not.toContain("abcdefghijklmnopqrstuvwxyz")
    expect(JSON.stringify(ref.preview)).not.toContain("Bearer abc")
    expect(JSON.stringify(ref.preview)).toContain("[redacted]")
    expect(JSON.stringify(ref.preview)).toContain("safe text")
  })

  it("uses external raw payload refs when a provider event is persisted elsewhere", () => {
    expect(createRawPayloadRef({
      provider: "slack",
      ref: "channel_raw_payloads:evt-123",
      createdAt: 2,
    })).toEqual({
      storage: "external_ref",
      redactionState: "externalized",
      provider: "slack",
      createdAt: 2,
      ref: "channel_raw_payloads:evt-123",
    })
  })

  it("does not promote sent messages to delivered when the provider lacks delivered state", () => {
    expect(resolveDeliveryReceiptStatus({
      sent: true,
      delivered: true,
      providerSupportsDelivered: false,
    })).toBe("sent")
    expect(resolveDeliveryReceiptStatus({
      sent: true,
      delivered: true,
      providerSupportsDelivered: true,
    })).toBe("delivered")
    expect(resolveDeliveryReceiptStatus({ unsupportedCapability: true, sent: true })).toBe(
      "unsupported_capability",
    )
  })

  it("separates internal surfaces from external channel providers", () => {
    expect(isInternalChannelSurface("webui")).toBe(true)
    expect(isInternalChannelSurface("telegram")).toBe(false)
    expect(isBuiltInChannelProvider("telegram")).toBe(true)
    expect(isBuiltInChannelProvider("webui")).toBe(false)
    expect(isExternalChannelProvider("discord")).toBe(true)
    expect(resolveChannelSurface("cli")).toBe("cli")
    expect(resolveChannelSurface("google_chat")).toBe("external_provider")
    expect(normalizeChannelSource("  kakaotalk  ")).toBe("kakaotalk")
    expect(normalizeChannelSource("")).toBe("webui")
  })

  it("creates unsupported capability receipts instead of throwing for missing features", () => {
    const receipt = buildUnsupportedCapabilityReceipt({
      channelId: "imessage:local",
      provider: "imessage",
      connectionId: "macos-local",
      target: { userId: "user-1" },
      capability: "supportsButtons",
      idempotencyKey: "test:unsupported:buttons",
      timestamp: 3,
    })

    expect(receipt).toMatchObject({
      status: "unsupported_capability",
      capability: "supportsButtons",
      idempotencyKey: "test:unsupported:buttons",
    })
  })

  it("can express Telegram and Slack adapter facades without provider raw types", async () => {
    const telegram = defineChannelAdapter({
      channelId: "telegram:primary",
      provider: "telegram",
      connectionId: "telegram-main",
      async start() {},
      async stop() {},
      async healthCheck() {
        return { status: "healthy", checkedAt: 1 }
      },
      getCapabilities: telegramCapabilities,
      async normalizeInbound(rawPayload: unknown): Promise<InboundEnvelope[]> {
        return [{
          channelId: "telegram:primary",
          provider: "telegram",
          connectionId: "telegram-main",
          messageId: "313",
          threadId: "topic-7",
          replyToMessageId: "300",
          sender: { id: "42120565", displayName: "Tester", providerType: "user" },
          room: { id: "42120565", type: "direct" },
          text: "hello",
          attachments: [],
          mentions: [],
          timestamp: 1,
          rawPayloadRef: createRawPayloadRef({ provider: "telegram", payload: rawPayload, createdAt: 1 }),
          continuationContext: { parentMessageId: "300", source: "reply" },
          dedupeKey: "telegram:42120565:topic-7:313",
        }]
      },
      async sendMessage(message: OutboundMessage): Promise<DeliveryReceipt> {
        return {
          channelId: message.channelId,
          provider: message.provider,
          connectionId: message.connectionId,
          target: message.target,
          status: resolveDeliveryReceiptStatus({
            sent: true,
            providerSupportsDelivered: telegramCapabilities().deliveryStates.supportsDelivered,
          }),
          timestamp: 2,
          idempotencyKey: message.idempotencyKey,
          messageId: "314",
          ...(message.target.threadId ? { threadId: message.target.threadId } : {}),
        }
      },
      async sendTypingIndicator(indicator) {
        return {
          channelId: "telegram:primary",
          provider: "telegram",
          connectionId: "telegram-main",
          target: indicator.target,
          status: "sent",
          timestamp: 2,
          idempotencyKey: "typing:telegram:primary",
        }
      },
    } satisfies ChannelAdapter)

    const slack = defineChannelAdapter({
      channelId: "slack:workspace",
      provider: "slack",
      connectionId: "slack-main",
      async start() {},
      async stop() {},
      async healthCheck() {
        return { status: "healthy", checkedAt: 1 }
      },
      getCapabilities: slackCapabilities,
      async normalizeInbound(rawPayload: unknown): Promise<InboundEnvelope[]> {
        return [{
          channelId: "slack:workspace",
          provider: "slack",
          connectionId: "slack-main",
          messageId: "1710000000.000100",
          threadId: "1710000000.000100",
          sender: { id: "U_APPROVER", displayName: "Tester", providerType: "user" },
          room: { id: "C_APPROVAL", type: "channel" },
          text: "run it",
          attachments: [],
          mentions: [{ id: "U_NOBIE", kind: "agent", displayName: "Nobie" }],
          timestamp: 1,
          rawPayloadRef: createRawPayloadRef({ provider: "slack", payload: rawPayload, createdAt: 1 }),
          dedupeKey: "slack:C_APPROVAL:1710000000.000100",
        }]
      },
      async normalizeInteraction(rawPayload: unknown): Promise<InteractionEnvelope[]> {
        return [{
          channelId: "slack:workspace",
          provider: "slack",
          connectionId: "slack-main",
          interactionId: "action-1",
          kind: "approval",
          actionId: "allow_once",
          approvalDecision: "allow_once",
          sender: { id: "U_APPROVER", providerType: "user" },
          room: { id: "C_APPROVAL", type: "channel" },
          threadId: "1710000000.000100",
          timestamp: 1,
          rawPayloadRef: createRawPayloadRef({ provider: "slack", payload: rawPayload, createdAt: 1 }),
          correlationId: "run-slack-approval",
        }]
      },
      async sendMessage(message: OutboundMessage): Promise<DeliveryReceipt> {
        return {
          channelId: message.channelId,
          provider: message.provider,
          connectionId: message.connectionId,
          target: message.target,
          status: "sent",
          timestamp: 2,
          idempotencyKey: message.idempotencyKey,
          messageId: "1710000001.000200",
          ...(message.target.threadId ? { threadId: message.target.threadId } : {}),
        }
      },
      async uploadAttachment(target, attachment, options) {
        return {
          channelId: "slack:workspace",
          provider: "slack",
          connectionId: "slack-main",
          target,
          status: "sent",
          timestamp: 2,
          idempotencyKey: options.idempotencyKey,
          messageId: attachment.id ?? "file-1",
        }
      },
      async handleInteraction(interaction) {
        const target = {
          ...(interaction.room?.id ? { roomId: interaction.room.id } : {}),
          ...(interaction.threadId ? { threadId: interaction.threadId } : {}),
          ...(interaction.messageId ? { messageId: interaction.messageId } : {}),
        }
        return {
          channelId: interaction.channelId,
          provider: interaction.provider,
          connectionId: interaction.connectionId,
          target,
          status: "accepted",
          timestamp: 2,
          idempotencyKey: `interaction:${interaction.interactionId}`,
        }
      },
    } satisfies ChannelAdapter)

    await expect(telegram.normalizeInbound({ message_id: 313 })).resolves.toHaveLength(1)
    await expect(slack.normalizeInteraction?.({ type: "block_actions" })).resolves.toHaveLength(1)
  })

  it("keeps generic sanitizer bounded for diagnostics", () => {
    const sanitized = sanitizeChannelContractValue(
      { deep: { nested: { value: "xoxb-secret-token" } }, list: [1, 2, 3] },
      { maxDepth: 2, maxArrayItems: 2 },
    )

    expect(JSON.stringify(sanitized)).not.toContain("xoxb-secret-token")
    expect(JSON.stringify(sanitized)).toContain("[truncated-depth]")
    expect(JSON.stringify(sanitized)).toContain("[1,2]")
  })
})
