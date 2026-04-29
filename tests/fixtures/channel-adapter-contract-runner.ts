import { describe, expect, it } from "vitest"
import type {
  ChannelAdapter,
  ChannelCapabilities,
  DeliveryReceipt,
  InboundEnvelope,
  InteractionEnvelope,
  OutboundMessage,
} from "../../packages/core/src/channels/contracts.ts"

export interface ChannelInboundFixture {
  name: string
  rawPayload: unknown
  expected: InboundEnvelope[]
  rawSecrets?: string[]
}

export interface ChannelInteractionFixture {
  name: string
  rawPayload: unknown
  expected: InteractionEnvelope[]
  rawSecrets?: string[]
}

export interface UnsupportedCapabilityFixture {
  name: string
  message: OutboundMessage
  capability: keyof ChannelCapabilities | string
}

export interface ChannelAdapterContractSuite {
  name: string
  adapterFactory: () => ChannelAdapter
  inboundFixtures?: ChannelInboundFixture[]
  interactionFixtures?: ChannelInteractionFixture[]
  outboundMessage: OutboundMessage
  unsupportedCapabilityFixture?: UnsupportedCapabilityFixture
}

const STRUCTURAL_SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/i,
  /xox[abpr]-[A-Za-z0-9-]+/i,
  /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/,
]

export function runChannelAdapterContractTests(suite: ChannelAdapterContractSuite): void {
  describe(suite.name, () => {
    it("exposes a structurally valid capability manifest", () => {
      const adapter = suite.adapterFactory()
      const capabilities = adapter.getCapabilities()

      expect(capabilities.provider).toBe(adapter.provider)
      expect(adapter.channelId).toContain(adapter.provider)
      expect(adapter.connectionId).toBeTruthy()
      expect(capabilities.maxMessageLength).toBeGreaterThan(0)
      expect(capabilities.rateLimitPolicy.strategy).toBeTruthy()
      expect(capabilities.deliveryStates.supportsAccepted).toBeTypeOf("boolean")
      expect(capabilities.deliveryStates.supportsSent).toBeTypeOf("boolean")
      expect(capabilities.deliveryStates.supportsDelivered).toBeTypeOf("boolean")
      expect(capabilities.deliveryStates.supportsReadReceipt).toBeTypeOf("boolean")
      expect(["low", "medium", "high", "experimental"]).toContain(capabilities.riskLevel)
    })

    for (const fixture of suite.inboundFixtures ?? []) {
      it(`normalizes inbound fixture: ${fixture.name}`, async () => {
        const adapter = suite.adapterFactory()
        const envelopes = await adapter.normalizeInbound(fixture.rawPayload)

        expect(envelopes).toEqual(fixture.expected)
        expect(envelopes).toHaveLength(fixture.expected.length)
        for (const envelope of envelopes) {
          expect(envelope.provider).toBe(adapter.provider)
          expect(envelope.channelId).toBe(adapter.channelId)
          expect(envelope.connectionId).toBe(adapter.connectionId)
          expect(envelope.messageId).toBeTruthy()
          expect(envelope.sender.id).toBeTruthy()
          expect(envelope.attachments).toBeInstanceOf(Array)
          expect(envelope.mentions).toBeInstanceOf(Array)
          expect(envelope.dedupeKey).toContain(adapter.provider)
          expect(envelope.rawPayloadRef.provider).toBe(adapter.provider)
          expect(envelope.rawPayloadRef.redactionState).not.toBe("not_stored")
        }
        expectNoRawSecrets(envelopes, fixture.rawSecrets)
      })
    }

    for (const fixture of suite.interactionFixtures ?? []) {
      it(`normalizes interaction fixture: ${fixture.name}`, async () => {
        const adapter = suite.adapterFactory()
        expect(adapter.normalizeInteraction).toBeTypeOf("function")

        const interactions = await adapter.normalizeInteraction?.(fixture.rawPayload)
        expect(interactions).toEqual(fixture.expected)
        expect(interactions).toHaveLength(fixture.expected.length)
        for (const interaction of interactions ?? []) {
          expect(interaction.provider).toBe(adapter.provider)
          expect(interaction.channelId).toBe(adapter.channelId)
          expect(interaction.connectionId).toBe(adapter.connectionId)
          expect(interaction.interactionId).toBeTruthy()
          expect(interaction.sender.id).toBeTruthy()
          expect(interaction.rawPayloadRef.provider).toBe(adapter.provider)
          expect(interaction.rawPayloadRef.redactionState).not.toBe("not_stored")
        }
        expectNoRawSecrets(interactions, fixture.rawSecrets)
      })
    }

    it("returns a sendMessage receipt without over-claiming delivered state", async () => {
      const adapter = suite.adapterFactory()
      const capabilities = adapter.getCapabilities()
      const receipt = await adapter.sendMessage(suite.outboundMessage)

      expect(receipt).toMatchObject({
        channelId: suite.outboundMessage.channelId,
        provider: suite.outboundMessage.provider,
        connectionId: suite.outboundMessage.connectionId,
        target: suite.outboundMessage.target,
        idempotencyKey: suite.outboundMessage.idempotencyKey,
      })
      expect(["accepted", "sent", "delivered", "partial"]).toContain(receipt.status)
      if (!capabilities.deliveryStates.supportsDelivered) {
        expect(receipt.status).toBe("sent")
      }
      expectNoRawSecrets(receipt)
    })

    if ((suite.interactionFixtures?.length ?? 0) > 0) {
      it("handles normalized interactions through the adapter boundary", async () => {
        const adapter = suite.adapterFactory()
        expect(adapter.handleInteraction).toBeTypeOf("function")

        const fixture = suite.interactionFixtures?.[0]
        const interaction = fixture?.expected[0]
        expect(interaction).toBeDefined()
        const receipt = await adapter.handleInteraction?.(interaction!)
        if (receipt !== undefined) {
          expectInteractionReceipt(receipt, interaction!)
        }
      })
    }

    if (suite.unsupportedCapabilityFixture) {
      it(`returns unsupported_capability fallback: ${suite.unsupportedCapabilityFixture.name}`, async () => {
        const adapter = suite.adapterFactory()
        const receipt = await adapter.sendMessage(suite.unsupportedCapabilityFixture!.message)

        expect(receipt).toMatchObject({
          status: "unsupported_capability",
          capability: suite.unsupportedCapabilityFixture!.capability,
          idempotencyKey: suite.unsupportedCapabilityFixture!.message.idempotencyKey,
        })
        expectNoRawSecrets(receipt)
      })
    }
  })
}

function expectInteractionReceipt(receipt: DeliveryReceipt, interaction: InteractionEnvelope): void {
  expect(["accepted", "sent", "delivered", "partial"]).toContain(receipt.status)
  expect(receipt.channelId).toBe(interaction.channelId)
  expect(receipt.provider).toBe(interaction.provider)
  expect(receipt.connectionId).toBe(interaction.connectionId)
  expect(receipt.idempotencyKey).toContain(interaction.interactionId)
}

function expectNoRawSecrets(value: unknown, explicitSecrets: string[] = []): void {
  const serialized = JSON.stringify(value)
  for (const secret of explicitSecrets) {
    expect(serialized).not.toContain(secret)
  }
  for (const pattern of STRUCTURAL_SECRET_PATTERNS) {
    expect(serialized).not.toMatch(pattern)
  }
}
