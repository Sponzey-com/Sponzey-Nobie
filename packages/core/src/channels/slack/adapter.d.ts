import type { SlackConfig } from "../../config/types.js";
import { type ChannelAdapter, type ChannelCapabilities, type ChannelHealthCheck, type DeliveryReceipt, type InboundEnvelope, type InteractionEnvelope, type OutboundMessage } from "../contracts.js";
export type SlackConnectionMode = "socket" | "events_api";
export interface SlackConnectionPolicy {
    mode: SlackConnectionMode;
    supported: boolean;
    canStart: boolean;
    healthStatus: ChannelHealthCheck["status"];
    reason: "ready" | "missing_bot_token" | "missing_app_token" | "duplicate_socket" | "missing_scope";
    message: string;
}
export interface SlackAdapterTransport {
    start?(): Promise<void>;
    stop?(): Promise<void> | void;
    healthCheck?(): Promise<ChannelHealthCheck>;
    sendMessage?(message: OutboundMessage): Promise<{
        messageId: string | number;
        threadId?: string | number;
        providerResponse?: unknown;
    }>;
}
export interface SlackChannelAdapterOptions {
    config?: SlackConfig | undefined;
    channelId?: string;
    connectionId?: string;
    connectionMode?: SlackConnectionMode;
    transport?: SlackAdapterTransport;
    now?: () => number;
    botUserId?: string;
    botDisplayName?: string;
    dedupeWindowMs?: number;
}
export interface SlackContinuationLookupCandidate {
    provider: "slack";
    channelId: string;
    threadTs: string;
    messageTs: string;
    senderId: string;
    timestamp: number;
    lookupWindowMs: number;
    teamId?: string;
}
export declare function buildSlackCapabilityManifest(): ChannelCapabilities;
export declare function resolveSlackConnectionPolicy(input: {
    config?: SlackConfig | undefined;
    mode?: SlackConnectionMode;
    activeSocket?: boolean;
    lastError?: string | null;
}): SlackConnectionPolicy;
export declare function normalizeSlackInboundEvent(rawPayload: unknown, options?: {
    channelId?: string;
    connectionId?: string;
    now?: () => number;
    botUserId?: string;
    botDisplayName?: string;
}): InboundEnvelope[];
export declare function normalizeSlackInteractionPayload(rawPayload: unknown, options?: {
    channelId?: string;
    connectionId?: string;
    now?: () => number;
}): InteractionEnvelope[];
export declare function buildSlackContinuationLookupCandidate(envelope: InboundEnvelope, options?: {
    lookupWindowMs?: number;
    teamId?: string;
}): SlackContinuationLookupCandidate | null;
export declare class SlackChannelAdapter implements ChannelAdapter {
    readonly channelId: string;
    readonly provider: "slack";
    readonly connectionId: string;
    private readonly config;
    private readonly connectionMode;
    private readonly transport;
    private readonly now;
    private readonly botUserId;
    private readonly botDisplayName;
    private readonly dedupeWindowMs;
    private channel;
    private seenInboundEvents;
    constructor(options?: SlackChannelAdapterOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    healthCheck(): Promise<ChannelHealthCheck>;
    getCapabilities(): ChannelCapabilities;
    normalizeInbound(rawPayload: unknown): Promise<InboundEnvelope[]>;
    normalizeInteraction(rawPayload: unknown): Promise<InteractionEnvelope[]>;
    sendMessage(message: OutboundMessage): Promise<DeliveryReceipt>;
    handleInteraction(interaction: InteractionEnvelope): Promise<DeliveryReceipt>;
    private markInboundEventSeen;
}
export declare function createSlackChannelAdapter(options?: SlackChannelAdapterOptions): ChannelAdapter;
//# sourceMappingURL=adapter.d.ts.map