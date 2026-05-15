import { defineChannelCapabilities, } from "../contracts.js";
import { buildLocalBridgeCapabilityManifest, buildLocalBridgeDoctor, createLocalBridgeChannelAdapter, } from "../local-bridge/adapter.js";
const LOCAL_CHANNEL_ID = "kakaotalk:local";
const LOCAL_CONNECTION_ID = "kakaotalk:local";
export function buildKakaoTalkLocalBridgeConfig(config) {
    return {
        enabled: config?.enabled === true && config?.mode === "local_bridge",
        mode: "local_bridge",
        localBridgeEnabled: config?.localBridgeEnabled === true,
        yeonjangBridgeEnabled: config?.yeonjangBridgeEnabled === true,
        riskAcknowledged: config?.riskAcknowledged === true,
        appAvailable: config?.kakaoTalkAppAvailable === true,
        userSessionActive: config?.userSessionActive === true,
        automationPermissionGranted: config?.automationPermissionGranted === true,
        allowedRecipientIds: config?.allowedUserIds ?? [],
        allowedRoomIds: config?.allowedRoomIds ?? [],
        manualConfirmationRequired: config?.manualConfirmationRequired !== false,
        rateLimitPerMinute: config?.rateLimitPerMinute ?? 6,
    };
}
export function buildKakaoTalkLocalBridgeCapabilityManifest(config) {
    return buildLocalBridgeCapabilityManifest({
        provider: "kakaotalk",
        manualConfirmationRequired: config?.manualConfirmationRequired !== false,
        supportsFiles: false,
        maxMessageLength: 1000,
        rateLimitPerMinute: config?.rateLimitPerMinute ?? 6,
    });
}
export function buildKakaoTalkOfficialCapabilityManifest() {
    return defineChannelCapabilities({
        provider: "kakaotalk",
        connectionKind: "webhook",
        supportsThreads: false,
        supportsReplies: true,
        supportsEdits: false,
        supportsDeletes: false,
        supportsReactions: false,
        supportsButtons: true,
        supportsModals: false,
        supportsFiles: true,
        supportsImages: true,
        supportsTypingIndicator: false,
        maxMessageLength: 1000,
        rateLimitPolicy: { strategy: "provider_default" },
        requiresWebhook: true,
        requiresLocalBridge: false,
        requiresUserSession: false,
        manualConfirmationRequired: false,
        riskLevel: "medium",
        deliveryStates: {
            supportsAccepted: true,
            supportsSent: true,
            supportsDelivered: false,
            supportsReadReceipt: false,
        },
    });
}
export function buildKakaoTalkLocalBridgeDoctor(config) {
    return buildLocalBridgeDoctor({
        provider: "kakaotalk",
        config: buildKakaoTalkLocalBridgeConfig(config),
        appName: "KakaoTalk desktop app",
        automationName: "KakaoTalk local automation",
    });
}
export function buildKakaoTalkOfficialDoctor(config) {
    const issues = [];
    const enabled = config?.enabled === true && config?.mode === "official";
    if (enabled && config?.businessApiEnabled !== true) {
        issues.push({
            code: "kakaotalk_business_api_disabled",
            severity: "error",
            message: "KakaoTalk official/business API mode is selected but business API is not enabled.",
        });
    }
    if (enabled && !config?.channelId.trim()) {
        issues.push({
            code: "kakaotalk_channel_id_missing",
            severity: "error",
            message: "KakaoTalk official/business API mode requires a channel id.",
        });
    }
    if (enabled && !config?.businessApiKey.trim()) {
        issues.push({
            code: "kakaotalk_business_api_key_missing",
            severity: "error",
            message: "KakaoTalk official/business API mode requires an API key.",
        });
    }
    return {
        ok: !issues.some((issue) => issue.severity === "error"),
        issues,
        businessApiEnabled: config?.businessApiEnabled === true,
        channelIdConfigured: Boolean(config?.channelId.trim()),
    };
}
export function createKakaoTalkLocalBridgeChannelAdapter(options = {}) {
    return createLocalBridgeChannelAdapter({
        provider: "kakaotalk",
        channelId: LOCAL_CHANNEL_ID,
        connectionId: LOCAL_CONNECTION_ID,
        config: buildKakaoTalkLocalBridgeConfig(options.config),
        ...(options.transport ? { transport: options.transport } : {}),
        ...(options.now ? { now: options.now } : {}),
        displayName: "KakaoTalk Local Bridge",
    });
}
//# sourceMappingURL=adapter.js.map