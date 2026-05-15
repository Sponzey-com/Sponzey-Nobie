import type { GoogleChatConfig } from "../../config/types.js";
import { type ChannelAdapter, type ChannelCapabilities, type ChannelHealthCheck, type DeliveryReceipt, type InboundEnvelope, type InteractionEnvelope, type OutboundMessage } from "../contracts.js";
export type GoogleChatConnectionMode = "webhook";
export type GoogleChatDoctorSeverity = "error" | "warning";
export interface GoogleChatDoctorIssue {
    code: string;
    severity: GoogleChatDoctorSeverity;
    message: string;
}
export interface GoogleChatWorkspaceDoctor {
    ok: boolean;
    issues: GoogleChatDoctorIssue[];
    requiredScopes: string[];
    grantedScopes: string[];
    workspaceAppPublished: boolean;
    webhookConfigured: boolean;
    requestVerificationConfigured: boolean;
    deployedSpaceIds: string[];
}
export interface GoogleChatConnectionPolicy {
    mode: GoogleChatConnectionMode;
    supported: boolean;
    canStart: boolean;
    healthStatus: ChannelHealthCheck["status"];
    reason: "ready" | "missing_app_credential" | "missing_verification_token" | "missing_scope" | "app_not_published";
    message: string;
    doctor: GoogleChatWorkspaceDoctor;
}
export interface GoogleChatRequestAuthValidation {
    valid: boolean;
    reason: "matched" | "missing_verification_token" | "missing_request_auth" | "mismatch";
}
export interface GoogleChatAdapterTransport {
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
export interface GoogleChatChannelAdapterOptions {
    config?: GoogleChatConfig | undefined;
    channelId?: string;
    connectionId?: string;
    transport?: GoogleChatAdapterTransport;
    now?: () => number;
    botUserId?: string;
    dedupeWindowMs?: number;
}
export interface GoogleChatContinuationLookupCandidate {
    provider: "google_chat";
    spaceId: string;
    threadId: string;
    messageId: string;
    senderId: string;
    timestamp: number;
    lookupWindowMs: number;
}
export declare function buildGoogleChatCapabilityManifest(): ChannelCapabilities;
export declare function buildGoogleChatWorkspaceDoctor(config?: GoogleChatConfig | undefined): GoogleChatWorkspaceDoctor;
export declare function resolveGoogleChatConnectionPolicy(input: {
    config?: GoogleChatConfig | undefined;
}): GoogleChatConnectionPolicy;
export declare function validateGoogleChatRequestAuth(input: {
    verificationToken?: string | null;
    receivedToken?: string | null;
    authorization?: string | null;
}): GoogleChatRequestAuthValidation;
export declare function normalizeGoogleChatInboundEvent(rawPayload: unknown, options?: {
    channelId?: string;
    connectionId?: string;
    now?: () => number;
    verificationToken?: string;
    botUserId?: string;
}): InboundEnvelope[];
export declare function normalizeGoogleChatCardAction(rawPayload: unknown, options?: {
    channelId?: string;
    connectionId?: string;
    now?: () => number;
    verificationToken?: string;
}): InteractionEnvelope[];
export declare function buildGoogleChatContinuationLookupCandidate(envelope: InboundEnvelope, options?: {
    lookupWindowMs?: number;
}): GoogleChatContinuationLookupCandidate | null;
export declare class GoogleChatChannelAdapter implements ChannelAdapter {
    readonly channelId: string;
    readonly provider: "google_chat";
    readonly connectionId: string;
    private readonly config;
    private readonly transport;
    private readonly now;
    private readonly botUserId;
    private readonly dedupeWindowMs;
    private seenInboundEvents;
    constructor(options?: GoogleChatChannelAdapterOptions);
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
export declare function createGoogleChatChannelAdapter(options?: GoogleChatChannelAdapterOptions): ChannelAdapter;
//# sourceMappingURL=adapter.d.ts.map