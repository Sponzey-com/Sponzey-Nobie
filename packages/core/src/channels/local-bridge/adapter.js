import { buildUnsupportedCapabilityReceipt, createRawPayloadRef, defineChannelAdapter, defineChannelCapabilities, resolveDeliveryReceiptStatus, } from "../contracts.js";
export function buildLocalBridgeCapabilityManifest(input) {
    return defineChannelCapabilities({
        provider: input.provider,
        connectionKind: "local_bridge",
        supportsThreads: false,
        supportsReplies: true,
        supportsEdits: false,
        supportsDeletes: false,
        supportsReactions: false,
        supportsButtons: false,
        supportsModals: false,
        supportsFiles: input.supportsFiles === true,
        supportsImages: input.supportsFiles === true,
        supportsTypingIndicator: false,
        maxMessageLength: input.maxMessageLength ?? 2000,
        rateLimitPolicy: {
            strategy: "manual",
            messagesPerMinute: input.rateLimitPerMinute ?? 6,
        },
        requiresWebhook: false,
        requiresLocalBridge: true,
        requiresUserSession: true,
        manualConfirmationRequired: input.manualConfirmationRequired === true,
        riskLevel: "experimental",
        deliveryStates: {
            supportsAccepted: true,
            supportsSent: true,
            supportsDelivered: false,
            supportsReadReceipt: false,
        },
    });
}
export function buildLocalBridgeDoctor(input) {
    const config = input.config;
    const issues = [];
    const enabled = config?.enabled === true;
    const manualConfirmationRequired = config?.manualConfirmationRequired === true || config?.mode === "manual_confirm" || config?.mode === "local_bridge";
    const allowedRecipientCount = [
        ...(config?.allowedRecipientIds ?? []),
        ...(config?.allowedRoomIds ?? []),
    ].map((value) => value.trim()).filter(Boolean).length;
    if (enabled && config?.riskAcknowledged !== true) {
        issues.push({
            code: "local_bridge_risk_not_acknowledged",
            severity: "error",
            message: "Local bridge channels require explicit user risk acknowledgement before enablement.",
        });
    }
    if (enabled && config?.localBridgeEnabled !== true && config?.yeonjangBridgeEnabled !== true) {
        issues.push({
            code: "local_bridge_not_available",
            severity: "error",
            message: "No local bridge or Yeonjang automation bridge is enabled.",
        });
    }
    if (enabled && config?.appAvailable !== true) {
        issues.push({
            code: "local_bridge_app_unavailable",
            severity: "error",
            message: `${input.appName} is not available to the local bridge.`,
        });
    }
    if (enabled && config?.userSessionActive !== true) {
        issues.push({
            code: "local_bridge_user_session_required",
            severity: "error",
            message: "A signed-in desktop user session is required for local automation.",
        });
    }
    if (enabled && config?.automationPermissionGranted !== true) {
        issues.push({
            code: "local_bridge_automation_permission_missing",
            severity: "error",
            message: `${input.automationName} automation permission has not been granted.`,
        });
    }
    if (enabled && allowedRecipientCount === 0) {
        issues.push({
            code: "local_bridge_allowed_recipient_required",
            severity: "error",
            message: "At least one allowed recipient or room id is required before local bridge delivery.",
        });
    }
    if (enabled && manualConfirmationRequired) {
        issues.push({
            code: "local_bridge_manual_confirmation_required",
            severity: "warning",
            message: "Manual confirmation is required before the local bridge sends a message.",
        });
    }
    return {
        ok: !issues.some((issue) => issue.severity === "error"),
        mode: config?.mode ?? "manual_confirm",
        provider: input.provider,
        issues,
        localBridgeEnabled: config?.localBridgeEnabled === true,
        yeonjangBridgeEnabled: config?.yeonjangBridgeEnabled === true,
        appAvailable: config?.appAvailable === true,
        userSessionActive: config?.userSessionActive === true,
        automationPermissionGranted: config?.automationPermissionGranted === true,
        allowedRecipientCount,
        manualConfirmationRequired,
    };
}
export class LocalBridgeChannelAdapter {
    channelId;
    provider;
    connectionId;
    localProvider;
    config;
    transport;
    now;
    displayName;
    constructor(options) {
        this.localProvider = options.provider;
        this.provider = options.provider;
        this.channelId = options.channelId;
        this.connectionId = options.connectionId;
        this.config = options.config;
        this.transport = options.transport;
        this.now = options.now ?? Date.now;
        this.displayName = options.displayName ?? options.provider;
    }
    async start() {
        const doctor = this.buildDoctor();
        if (!doctor.ok)
            throw new Error(doctor.issues[0]?.message ?? "Local bridge is not ready.");
        await this.transport?.start?.();
    }
    async stop() {
        await this.transport?.stop?.();
    }
    async healthCheck() {
        const doctor = this.buildDoctor();
        if (this.transport?.healthCheck && doctor.ok)
            return this.transport.healthCheck();
        if (this.config?.enabled !== true) {
            return {
                status: "stopped",
                checkedAt: this.now(),
                detail: localBridgeDoctorDetail(doctor),
            };
        }
        return {
            status: doctor.ok ? "degraded" : "failed",
            checkedAt: this.now(),
            message: doctor.issues[0]?.message ?? `${this.displayName} local bridge requires manual confirmation.`,
            detail: localBridgeDoctorDetail(doctor),
        };
    }
    getCapabilities() {
        return buildLocalBridgeCapabilityManifest({
            provider: this.localProvider,
            manualConfirmationRequired: this.buildDoctor().manualConfirmationRequired,
            ...(this.config?.rateLimitPerMinute !== undefined ? { rateLimitPerMinute: this.config.rateLimitPerMinute } : {}),
        });
    }
    async normalizeInbound(_rawPayload) {
        return [];
    }
    async sendMessage(message) {
        const unsupportedCapability = resolveUnsupportedMessageCapability(this.getCapabilities(), message);
        if (unsupportedCapability) {
            return buildUnsupportedCapabilityReceipt({
                channelId: message.channelId,
                provider: message.provider,
                connectionId: message.connectionId,
                target: message.target,
                capability: unsupportedCapability,
                idempotencyKey: message.idempotencyKey,
                timestamp: this.now(),
            });
        }
        const recipientId = message.target.userId ?? message.target.roomId;
        if (!recipientId) {
            return this.blocked(message, "local_bridge_recipient_required", "Local bridge delivery requires target.userId or target.roomId.");
        }
        if (!this.isAllowedRecipient(recipientId)) {
            return this.blocked(message, "local_bridge_recipient_not_allowed", "Local bridge delivery is blocked by the allowed recipient policy.");
        }
        const doctor = this.buildDoctor();
        if (!doctor.ok) {
            return this.failed(message, "local_bridge_not_ready", doctor.issues[0]?.message ?? "Local bridge is not ready.");
        }
        if (doctor.manualConfirmationRequired) {
            if (!this.transport?.requestManualConfirmation) {
                return this.blocked(message, "local_bridge_manual_confirmation_required", "Manual confirmation is required before local bridge delivery.");
            }
            const confirmation = await this.transport.requestManualConfirmation(message);
            if (!confirmation.confirmed) {
                return this.blocked(message, "local_bridge_manual_confirmation_denied", confirmation.reason ?? "Manual confirmation was not granted.");
            }
        }
        if (!this.transport?.sendMessage) {
            return this.failed(message, "local_bridge_transport_unavailable", "Local bridge transport is not available.");
        }
        try {
            const result = await this.transport.sendMessage(message);
            return {
                channelId: message.channelId,
                provider: message.provider,
                connectionId: message.connectionId,
                target: message.target,
                status: resolveDeliveryReceiptStatus({
                    sent: true,
                    providerSupportsDelivered: this.getCapabilities().deliveryStates.supportsDelivered,
                }),
                timestamp: this.now(),
                idempotencyKey: message.idempotencyKey,
                ...(result.messageId !== undefined ? { messageId: String(result.messageId) } : {}),
                ...(result.providerResponse !== undefined
                    ? {
                        providerResponseRef: createRawPayloadRef({
                            provider: message.provider,
                            payload: result.providerResponse,
                            createdAt: this.now(),
                        }),
                    }
                    : {}),
            };
        }
        catch (error) {
            return this.failed(message, "local_bridge_delivery_failed", error instanceof Error ? error.message : String(error));
        }
    }
    buildDoctor() {
        return buildLocalBridgeDoctor({
            provider: this.localProvider,
            ...(this.config ? { config: this.config } : {}),
            appName: this.localProvider === "imessage" ? "Messages.app" : "KakaoTalk desktop app",
            automationName: this.localProvider === "imessage" ? "Messages.app Apple Events" : "KakaoTalk local automation",
        });
    }
    isAllowedRecipient(recipientId) {
        const allowed = [
            ...(this.config?.allowedRecipientIds ?? []),
            ...(this.config?.allowedRoomIds ?? []),
        ].map((value) => value.trim()).filter(Boolean);
        return allowed.includes(recipientId);
    }
    blocked(message, errorCode, errorMessage) {
        return {
            channelId: message.channelId,
            provider: message.provider,
            connectionId: message.connectionId,
            target: message.target,
            status: "blocked_by_policy",
            timestamp: this.now(),
            idempotencyKey: message.idempotencyKey,
            errorCode,
            errorMessage,
        };
    }
    failed(message, errorCode, errorMessage) {
        return {
            channelId: message.channelId,
            provider: message.provider,
            connectionId: message.connectionId,
            target: message.target,
            status: "failed",
            timestamp: this.now(),
            idempotencyKey: message.idempotencyKey,
            errorCode,
            errorMessage,
        };
    }
}
export function createLocalBridgeChannelAdapter(options) {
    return defineChannelAdapter(new LocalBridgeChannelAdapter(options));
}
function resolveUnsupportedMessageCapability(capabilities, message) {
    if ((message.actions?.length ?? 0) > 0 && !capabilities.supportsButtons)
        return "supportsButtons";
    if ((message.attachments?.length ?? 0) > 0 && !capabilities.supportsFiles)
        return "supportsFiles";
    return null;
}
function localBridgeDoctorDetail(doctor) {
    return JSON.parse(JSON.stringify({ doctor }));
}
//# sourceMappingURL=adapter.js.map