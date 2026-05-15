import type { DiscordConfig } from "../../config/types.js";
import { type ChannelAdapter, type ChannelCapabilities, type ChannelHealthCheck, type DeliveryReceipt, type InboundEnvelope, type InteractionEnvelope, type OutboundMessage } from "../contracts.js";
export type DiscordConnectionMode = "gateway" | "interactions_endpoint";
export type DiscordDoctorSeverity = "error" | "warning";
export interface DiscordDoctorIssue {
    code: string;
    severity: DiscordDoctorSeverity;
    message: string;
}
export interface DiscordPermissionDoctor {
    ok: boolean;
    issues: DiscordDoctorIssue[];
    requiredIntents: string[];
    grantedIntents: string[];
    requiredPermissions: string[];
    botPermissions: string[];
    interactionPublicKeyConfigured: boolean;
    largeGuildMode: boolean;
}
export interface DiscordConnectionPolicy {
    mode: DiscordConnectionMode;
    supported: boolean;
    canStart: boolean;
    healthStatus: ChannelHealthCheck["status"];
    reason: "ready" | "missing_bot_token" | "missing_application_id" | "missing_public_key" | "missing_intent" | "missing_permission" | "guild_not_installed" | "gateway_transport_unavailable";
    message: string;
    doctor: DiscordPermissionDoctor;
}
export interface DiscordInteractionSignatureValidation {
    valid: boolean;
    reason: "verified" | "missing_public_key" | "missing_signature" | "missing_timestamp" | "missing_body" | "invalid_public_key" | "invalid_signature" | "verification_failed";
}
export interface DiscordAdapterTransport {
    start?(): Promise<void>;
    stop?(): Promise<void> | void;
    healthCheck?(): Promise<ChannelHealthCheck>;
    sendMessage?(message: OutboundMessage): Promise<{
        messageId: string | number;
        threadId?: string | number;
        providerResponse?: unknown;
        retryAfterMs?: number;
    }>;
}
export interface DiscordChannelAdapterOptions {
    config?: DiscordConfig | undefined;
    channelId?: string;
    connectionId?: string;
    connectionMode?: DiscordConnectionMode;
    transport?: DiscordAdapterTransport;
    now?: () => number;
    botUserId?: string;
    botDisplayName?: string;
    dedupeWindowMs?: number;
}
export interface DiscordContinuationLookupCandidate {
    provider: "discord";
    guildId?: string;
    channelId: string;
    messageId: string;
    senderId: string;
    timestamp: number;
    lookupWindowMs: number;
    threadId?: string;
}
export declare function buildDiscordCapabilityManifest(): ChannelCapabilities;
export declare function buildDiscordPermissionDoctor(config?: DiscordConfig | undefined): DiscordPermissionDoctor;
export declare function resolveDiscordConnectionPolicy(input: {
    config?: DiscordConfig | undefined;
    mode?: DiscordConnectionMode;
    activeGateway?: boolean;
    transportAvailable?: boolean;
}): DiscordConnectionPolicy;
export declare function validateDiscordInteractionSignature(input: {
    publicKey?: string | null;
    signature?: string | null;
    timestamp?: string | null;
    body?: string | Buffer | null;
}): DiscordInteractionSignatureValidation;
export declare function normalizeDiscordInboundEvent(rawPayload: unknown, options?: {
    channelId?: string;
    connectionId?: string;
    now?: () => number;
    botUserId?: string;
    botDisplayName?: string;
}): InboundEnvelope[];
export declare function normalizeDiscordInteractionRequest(rawPayload: unknown, options?: {
    channelId?: string;
    connectionId?: string;
    now?: () => number;
    publicKey?: string;
}): InboundEnvelope[];
export declare function normalizeDiscordComponentInteraction(rawPayload: unknown, options?: {
    channelId?: string;
    connectionId?: string;
    now?: () => number;
    publicKey?: string;
}): InteractionEnvelope[];
export declare function buildDiscordContinuationLookupCandidate(envelope: InboundEnvelope, options?: {
    lookupWindowMs?: number;
}): DiscordContinuationLookupCandidate | null;
export declare class DiscordChannelAdapter implements ChannelAdapter {
    readonly channelId: string;
    readonly provider: "discord";
    readonly connectionId: string;
    private readonly config;
    private readonly connectionMode;
    private readonly transport;
    private readonly now;
    private readonly botUserId;
    private readonly botDisplayName;
    private readonly dedupeWindowMs;
    private seenInboundEvents;
    constructor(options?: DiscordChannelAdapterOptions);
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
export declare function createDiscordChannelAdapter(options?: DiscordChannelAdapterOptions): ChannelAdapter;
//# sourceMappingURL=adapter.d.ts.map