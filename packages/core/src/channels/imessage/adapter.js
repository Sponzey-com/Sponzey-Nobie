import { buildLocalBridgeCapabilityManifest, buildLocalBridgeDoctor, createLocalBridgeChannelAdapter, } from "../local-bridge/adapter.js";
const DEFAULT_CHANNEL_ID = "imessage:local";
const DEFAULT_CONNECTION_ID = "imessage:local";
export function buildIMessageLocalBridgeConfig(config) {
    return {
        enabled: config?.enabled === true,
        mode: config?.mode ?? "manual_confirm",
        localBridgeEnabled: config?.localBridgeEnabled === true,
        yeonjangBridgeEnabled: config?.yeonjangBridgeEnabled === true,
        riskAcknowledged: config?.riskAcknowledged === true,
        appAvailable: config?.messagesAppAvailable === true,
        userSessionActive: config?.userSessionActive === true,
        automationPermissionGranted: config?.automationPermissionGranted === true,
        allowedRecipientIds: config?.allowedRecipientIds ?? [],
        manualConfirmationRequired: config?.manualConfirmationRequired !== false,
    };
}
export function buildIMessageCapabilityManifest(config) {
    return buildLocalBridgeCapabilityManifest({
        provider: "imessage",
        manualConfirmationRequired: config?.manualConfirmationRequired !== false,
        supportsFiles: false,
        maxMessageLength: 2000,
    });
}
export function buildIMessageLocalBridgeDoctor(config) {
    return buildLocalBridgeDoctor({
        provider: "imessage",
        config: buildIMessageLocalBridgeConfig(config),
        appName: "Messages.app",
        automationName: "Messages.app Apple Events",
    });
}
export function createIMessageChannelAdapter(options = {}) {
    return createLocalBridgeChannelAdapter({
        provider: "imessage",
        channelId: DEFAULT_CHANNEL_ID,
        connectionId: DEFAULT_CONNECTION_ID,
        config: buildIMessageLocalBridgeConfig(options.config),
        ...(options.transport ? { transport: options.transport } : {}),
        ...(options.now ? { now: options.now } : {}),
        displayName: "iMessage",
    });
}
//# sourceMappingURL=adapter.js.map