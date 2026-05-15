import { type ChannelAdapter, type ChannelCapabilities, type ChannelHealthCheck, type ChannelProviderId, type DeliveryReceipt, type InboundEnvelope, type OutboundMessage } from "../contracts.js";
export type LocalBridgeProvider = "imessage" | "kakaotalk";
export type LocalBridgeMode = "outgoing_only" | "manual_confirm" | "official" | "local_bridge";
export type LocalBridgeDoctorSeverity = "error" | "warning";
export interface LocalBridgeDoctorIssue {
    code: string;
    severity: LocalBridgeDoctorSeverity;
    message: string;
}
export interface LocalBridgeDoctor {
    ok: boolean;
    mode: LocalBridgeMode;
    provider: LocalBridgeProvider;
    issues: LocalBridgeDoctorIssue[];
    localBridgeEnabled: boolean;
    yeonjangBridgeEnabled: boolean;
    appAvailable: boolean;
    userSessionActive: boolean;
    automationPermissionGranted: boolean;
    allowedRecipientCount: number;
    manualConfirmationRequired: boolean;
}
export interface LocalBridgeConfig {
    enabled: boolean;
    mode: LocalBridgeMode;
    localBridgeEnabled: boolean;
    yeonjangBridgeEnabled?: boolean;
    riskAcknowledged?: boolean;
    appAvailable?: boolean;
    userSessionActive?: boolean;
    automationPermissionGranted?: boolean;
    allowedRecipientIds?: string[];
    allowedRoomIds?: string[];
    manualConfirmationRequired?: boolean;
    rateLimitPerMinute?: number;
}
export interface LocalBridgeSendResult {
    messageId?: string | number;
    providerResponse?: unknown;
}
export interface LocalBridgeManualConfirmationResult {
    confirmed: boolean;
    confirmationId?: string;
    reason?: string;
}
export interface LocalBridgeTransport {
    start?(): Promise<void>;
    stop?(): Promise<void> | void;
    healthCheck?(): Promise<ChannelHealthCheck>;
    requestManualConfirmation?(message: OutboundMessage): Promise<LocalBridgeManualConfirmationResult>;
    sendMessage?(message: OutboundMessage): Promise<LocalBridgeSendResult>;
}
export interface LocalBridgeChannelAdapterOptions {
    provider: LocalBridgeProvider;
    channelId: string;
    connectionId: string;
    config?: LocalBridgeConfig;
    transport?: LocalBridgeTransport;
    now?: () => number;
    displayName?: string;
}
export declare function buildLocalBridgeCapabilityManifest(input: {
    provider: LocalBridgeProvider;
    manualConfirmationRequired?: boolean;
    supportsFiles?: boolean;
    maxMessageLength?: number;
    rateLimitPerMinute?: number;
}): ChannelCapabilities;
export declare function buildLocalBridgeDoctor(input: {
    provider: LocalBridgeProvider;
    config?: LocalBridgeConfig;
    appName: string;
    automationName: string;
}): LocalBridgeDoctor;
export declare class LocalBridgeChannelAdapter implements ChannelAdapter {
    readonly channelId: string;
    readonly provider: ChannelProviderId;
    readonly connectionId: string;
    private readonly localProvider;
    private readonly config;
    private readonly transport;
    private readonly now;
    private readonly displayName;
    constructor(options: LocalBridgeChannelAdapterOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    healthCheck(): Promise<ChannelHealthCheck>;
    getCapabilities(): ChannelCapabilities;
    normalizeInbound(_rawPayload: unknown): Promise<InboundEnvelope[]>;
    sendMessage(message: OutboundMessage): Promise<DeliveryReceipt>;
    private buildDoctor;
    private isAllowedRecipient;
    private blocked;
    private failed;
}
export declare function createLocalBridgeChannelAdapter(options: LocalBridgeChannelAdapterOptions): ChannelAdapter;
//# sourceMappingURL=adapter.d.ts.map