import type { TelegramConfig } from "../../config/types.js";
import { type ChannelAdapter, type ChannelCapabilities, type ChannelHealthCheck, type DeliveryReceipt, type InboundEnvelope, type InteractionEnvelope, type OutboundMessage } from "../contracts.js";
export type TelegramConnectionMode = "polling" | "webhook";
export interface TelegramConnectionPolicy {
    mode: TelegramConnectionMode;
    supported: boolean;
    canStart: boolean;
    healthStatus: ChannelHealthCheck["status"];
    reason: "ready" | "missing_token" | "duplicate_polling" | "webhook_unsupported";
    message: string;
}
export interface TelegramWebhookSecretValidation {
    valid: boolean;
    reason: "matched" | "missing_configured_secret" | "missing_received_secret" | "mismatch";
}
export interface TelegramAdapterTransport {
    start?(): Promise<void>;
    stop?(): Promise<void> | void;
    healthCheck?(): Promise<ChannelHealthCheck>;
    sendMessage?(message: OutboundMessage): Promise<{
        messageId: string | number;
        threadId?: string | number;
        providerResponse?: unknown;
    }>;
}
export interface TelegramChannelAdapterOptions {
    config?: TelegramConfig | undefined;
    channelId?: string;
    connectionId?: string;
    connectionMode?: TelegramConnectionMode;
    transport?: TelegramAdapterTransport;
    now?: () => number;
}
export interface TelegramContinuationLookupCandidate {
    provider: "telegram";
    chatId: string;
    messageId: string;
    senderId: string;
    timestamp: number;
    lookupWindowMs: number;
    threadId?: string;
}
export declare function buildTelegramCapabilityManifest(): ChannelCapabilities;
export declare function resolveTelegramConnectionPolicy(input: {
    config?: TelegramConfig | undefined;
    mode?: TelegramConnectionMode;
    activePolling?: boolean;
}): TelegramConnectionPolicy;
export declare function validateTelegramWebhookSecretToken(input: {
    configuredSecret?: string | null;
    receivedSecret?: string | null;
}): TelegramWebhookSecretValidation;
export declare function normalizeTelegramInboundUpdate(rawPayload: unknown, options?: {
    channelId?: string;
    connectionId?: string;
    now?: () => number;
}): InboundEnvelope[];
export declare function normalizeTelegramInteractionUpdate(rawPayload: unknown, options?: {
    channelId?: string;
    connectionId?: string;
    now?: () => number;
}): InteractionEnvelope[];
export declare function buildTelegramContinuationLookupCandidate(envelope: InboundEnvelope, options?: {
    lookupWindowMs?: number;
}): TelegramContinuationLookupCandidate | null;
export declare class TelegramChannelAdapter implements ChannelAdapter {
    readonly channelId: string;
    readonly provider: "telegram";
    readonly connectionId: string;
    private readonly config;
    private readonly connectionMode;
    private readonly transport;
    private readonly now;
    private channel;
    constructor(options?: TelegramChannelAdapterOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    healthCheck(): Promise<ChannelHealthCheck>;
    getCapabilities(): ChannelCapabilities;
    normalizeInbound(rawPayload: unknown): Promise<InboundEnvelope[]>;
    normalizeInteraction(rawPayload: unknown): Promise<InteractionEnvelope[]>;
    sendMessage(message: OutboundMessage): Promise<DeliveryReceipt>;
    handleInteraction(interaction: InteractionEnvelope): Promise<DeliveryReceipt>;
}
export declare function createTelegramChannelAdapter(options?: TelegramChannelAdapterOptions): ChannelAdapter;
//# sourceMappingURL=adapter.d.ts.map