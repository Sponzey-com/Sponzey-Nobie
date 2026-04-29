import { describe, expect, it } from "vitest"
import {
  buildIMessageCapabilityManifest,
  buildIMessageLocalBridgeDoctor,
  buildKakaoTalkLocalBridgeCapabilityManifest,
  buildKakaoTalkLocalBridgeDoctor,
  buildKakaoTalkOfficialCapabilityManifest,
  buildKakaoTalkOfficialDoctor,
  createIMessageChannelAdapter,
  createKakaoTalkLocalBridgeChannelAdapter,
  type LocalBridgeTransport,
} from "../packages/core/src/channels/index.ts"
import type { IMessageConfig, KakaoTalkConfig } from "../packages/core/src/config/types.ts"
import type { OutboundMessage } from "../packages/core/src/channels/contracts.ts"

function imessageConfig(patch: Partial<IMessageConfig> = {}): IMessageConfig {
  return {
    enabled: true,
    mode: "manual_confirm",
    localBridgeEnabled: true,
    yeonjangBridgeEnabled: false,
    riskAcknowledged: true,
    messagesAppAvailable: true,
    userSessionActive: true,
    automationPermissionGranted: true,
    allowedRecipientIds: ["+15551234567"],
    manualConfirmationRequired: true,
    ...patch,
  }
}

function kakaoTalkConfig(patch: Partial<KakaoTalkConfig> = {}): KakaoTalkConfig {
  return {
    enabled: true,
    mode: "local_bridge",
    businessApiEnabled: false,
    businessApiKey: "",
    channelId: "",
    localBridgeEnabled: true,
    yeonjangBridgeEnabled: false,
    riskAcknowledged: true,
    kakaoTalkAppAvailable: true,
    userSessionActive: true,
    automationPermissionGranted: true,
    allowedUserIds: ["user-1"],
    allowedRoomIds: ["room-1"],
    manualConfirmationRequired: true,
    rateLimitPerMinute: 3,
    ...patch,
  }
}

function outbound(patch: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    channelId: "imessage:local",
    provider: "imessage",
    connectionId: "imessage:local",
    target: { userId: "+15551234567" },
    deliveryMode: "final",
    text: "hello",
    threadPolicy: { mode: "none" },
    chunkPolicy: { mode: "none" },
    priority: "normal",
    idempotencyKey: "local-bridge-test",
    redactionPolicy: "default",
    ...patch,
  }
}

describe("local bridge adapters", () => {
  it("requires explicit allowed recipients and manual confirmation before sending", async () => {
    const noConfirmation = createIMessageChannelAdapter({ config: imessageConfig(), now: () => 10 })
    await expect(noConfirmation.sendMessage(outbound())).resolves.toMatchObject({
      status: "blocked_by_policy",
      errorCode: "local_bridge_manual_confirmation_required",
    })

    const denied = createIMessageChannelAdapter({
      config: imessageConfig(),
      now: () => 11,
      transport: {
        async requestManualConfirmation() {
          return { confirmed: false, reason: "operator denied" }
        },
      },
    })
    await expect(denied.sendMessage(outbound())).resolves.toMatchObject({
      status: "blocked_by_policy",
      errorCode: "local_bridge_manual_confirmation_denied",
      errorMessage: "operator denied",
    })

    const sent = createIMessageChannelAdapter({
      config: imessageConfig(),
      now: () => 12,
      transport: {
        async requestManualConfirmation() {
          return { confirmed: true, confirmationId: "confirm-1" }
        },
        async sendMessage() {
          return { messageId: "msg-1", providerResponse: { id: "provider-msg-1" } }
        },
      },
    })
    await expect(sent.sendMessage(outbound())).resolves.toMatchObject({
      status: "sent",
      messageId: "msg-1",
      timestamp: 12,
    })

    await expect(sent.sendMessage(outbound({ target: { userId: "+15550000000" } }))).resolves.toMatchObject({
      status: "blocked_by_policy",
      errorCode: "local_bridge_recipient_not_allowed",
    })
  })

  it("classifies local bridge delivery failures as channel receipts instead of thrown execution failures", async () => {
    const transport: LocalBridgeTransport = {
      async requestManualConfirmation() {
        return { confirmed: true }
      },
      async sendMessage() {
        throw new Error("automation permission denied")
      },
    }
    const adapter = createIMessageChannelAdapter({ config: imessageConfig(), transport, now: () => 20 })

    await expect(adapter.sendMessage(outbound())).resolves.toMatchObject({
      status: "failed",
      errorCode: "local_bridge_delivery_failed",
      errorMessage: "automation permission denied",
    })
  })

  it("reports local bridge doctor issues for missing bridge, desktop session, permission, and recipients", () => {
    const doctor = buildIMessageLocalBridgeDoctor(imessageConfig({
      riskAcknowledged: false,
      localBridgeEnabled: false,
      yeonjangBridgeEnabled: false,
      messagesAppAvailable: false,
      userSessionActive: false,
      automationPermissionGranted: false,
      allowedRecipientIds: [],
    }))

    expect(doctor.ok).toBe(false)
    expect(doctor.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "local_bridge_risk_not_acknowledged",
      "local_bridge_not_available",
      "local_bridge_app_unavailable",
      "local_bridge_user_session_required",
      "local_bridge_automation_permission_missing",
      "local_bridge_allowed_recipient_required",
    ]))
  })

  it("splits KakaoTalk official/business mode from experimental local bridge mode", async () => {
    const officialCapabilities = buildKakaoTalkOfficialCapabilityManifest()
    expect(officialCapabilities.requiresWebhook).toBe(true)
    expect(officialCapabilities.requiresLocalBridge).toBe(false)
    expect(officialCapabilities.riskLevel).toBe("medium")

    const localCapabilities = buildKakaoTalkLocalBridgeCapabilityManifest(kakaoTalkConfig())
    expect(localCapabilities.requiresWebhook).toBe(false)
    expect(localCapabilities.requiresLocalBridge).toBe(true)
    expect(localCapabilities.manualConfirmationRequired).toBe(true)
    expect(localCapabilities.riskLevel).toBe("experimental")

    const officialDoctor = buildKakaoTalkOfficialDoctor(kakaoTalkConfig({
      mode: "official",
      businessApiEnabled: false,
      businessApiKey: "",
      channelId: "",
    }))
    expect(officialDoctor.ok).toBe(false)
    expect(officialDoctor.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "kakaotalk_business_api_disabled",
      "kakaotalk_channel_id_missing",
      "kakaotalk_business_api_key_missing",
    ]))

    const localDoctor = buildKakaoTalkLocalBridgeDoctor(kakaoTalkConfig())
    expect(localDoctor.ok).toBe(true)
    expect(localDoctor.manualConfirmationRequired).toBe(true)

    const adapter = createKakaoTalkLocalBridgeChannelAdapter({
      config: kakaoTalkConfig({ manualConfirmationRequired: false }),
      now: () => 30,
      transport: {
        async requestManualConfirmation() {
          return { confirmed: true }
        },
        async sendMessage() {
          return { messageId: "kakao-msg-1" }
        },
      },
    })
    await expect(adapter.sendMessage(outbound({
      channelId: "kakaotalk:local",
      provider: "kakaotalk",
      connectionId: "kakaotalk:local",
      target: { roomId: "room-1" },
    }))).resolves.toMatchObject({
      status: "sent",
      messageId: "kakao-msg-1",
    })
  })

  it("exposes manual confirmation in iMessage capability metadata", () => {
    expect(buildIMessageCapabilityManifest(imessageConfig()).manualConfirmationRequired).toBe(true)
    expect(buildIMessageCapabilityManifest(imessageConfig({ manualConfirmationRequired: false })).manualConfirmationRequired).toBe(false)
  })
})
