export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | {
    [key: string]: JsonValue;
};
export type BuiltInChannelProvider = "telegram" | "slack" | "discord" | "google_chat" | "imessage" | "kakaotalk";
export type ChannelProvider = BuiltInChannelProvider | (string & {});
export type InternalChannelSurface = "webui" | "cli";
export type ChannelSurface = InternalChannelSurface | "external_provider";
export type KnownChannelSource = InternalChannelSurface | BuiltInChannelProvider;
export type ChannelSource = KnownChannelSource | (string & {});
export type KnownChannelProvider = BuiltInChannelProvider;
export type ChannelProviderId = ChannelSource;
export type ChannelId = string;
export type ChannelConnectionId = string;
export type ChannelRiskLevel = "low" | "medium" | "high" | "experimental";
export type ChannelConnectionKind = "internal" | "bot_api" | "socket" | "webhook" | "local_bridge" | "manual_bridge";
export type RawPayloadStorage = "none" | "redacted_inline" | "external_ref";
export type RawPayloadRedactionState = "not_stored" | "redacted" | "externalized";
export interface RawPayloadRef {
    storage: RawPayloadStorage;
    redactionState: RawPayloadRedactionState;
    provider: ChannelProviderId;
    createdAt: number;
    ref?: string;
    preview?: JsonValue;
}
export interface ChannelIdentity {
    id: string;
    displayName?: string;
    username?: string;
    email?: string;
    isBot?: boolean;
    providerType?: "user" | "bot" | "system" | "service_account" | "unknown";
}
export interface ChannelRoom {
    id: string;
    displayName?: string;
    type?: "direct" | "group" | "channel" | "topic" | "space" | "unknown";
}
export interface ChannelWorkspace {
    id: string;
    displayName?: string;
}
export interface ChannelAccessPolicySnapshot {
    decision: "allowed" | "blocked";
    reasonCode: string;
    principalKeys: {
        user: string[];
        room: string[];
    };
    matchedPrincipals: string[];
    requireAllowedPrincipal: boolean;
    allowUnlisted: boolean;
    summary: string;
}
export interface ChannelAttachment {
    id?: string;
    name?: string;
    mimeType?: string;
    sizeBytes?: number;
    kind: "file" | "image" | "audio" | "video" | "link" | "unknown";
    url?: string;
    localPath?: string;
    contentRef?: string;
    altText?: string;
}
export interface ChannelMention {
    id: string;
    displayName?: string;
    kind: "user" | "room" | "channel" | "agent" | "unknown";
}
export interface ChannelContinuationContext {
    taskId?: string;
    runId?: string;
    requestGroupId?: string;
    parentMessageId?: string;
    parentDeliveryId?: string;
    source?: "reply" | "thread" | "quote" | "manual" | "latest_context";
}
export interface InboundEnvelope {
    channelId: ChannelId;
    provider: ChannelProviderId;
    connectionId: ChannelConnectionId;
    messageId: string;
    threadId?: string;
    replyToMessageId?: string;
    sender: ChannelIdentity;
    room?: ChannelRoom;
    workspace?: ChannelWorkspace;
    text: string;
    attachments: ChannelAttachment[];
    mentions: ChannelMention[];
    timestamp: number;
    rawPayloadRef: RawPayloadRef;
    continuationContext?: ChannelContinuationContext;
    accessPolicy?: ChannelAccessPolicySnapshot;
    dedupeKey: string;
}
export type OutboundDeliveryMode = "receipt" | "progress" | "final" | "diagnostic" | "approval_request" | "artifact" | "text";
export type OutboundPriority = "low" | "normal" | "high";
export type OutboundThreadPolicyMode = "none" | "provider_default" | "new_thread" | "reuse_thread" | "reply_to_message";
export type OutboundChunkMode = "none" | "provider_default" | "split" | "summarize_then_link";
export type OutboundRedactionPolicy = "default" | "strict" | "diagnostic_only";
export interface ChannelTarget {
    roomId?: string;
    userId?: string;
    threadId?: string;
    messageId?: string;
    topicId?: string;
}
export interface OutboundThreadPolicy {
    mode: OutboundThreadPolicyMode;
    threadId?: string;
    replyToMessageId?: string;
}
export interface OutboundChunkPolicy {
    mode: OutboundChunkMode;
    maxLength?: number;
    preserveCodeBlocks?: boolean;
}
export type ChannelActionKind = "approval" | "cancel" | "retry" | "choose_option" | "provide_input" | "open_url";
export interface ChannelAction {
    id: string;
    kind: ChannelActionKind;
    label: string;
    value?: string;
    riskLevel?: ChannelRiskLevel;
}
export interface ChannelBlock {
    id?: string;
    kind: "section" | "context" | "actions" | "divider" | "input" | "custom";
    text?: string;
    fields?: Record<string, string>;
    actions?: ChannelAction[];
    data?: JsonValue;
}
export interface OutboundMessage {
    channelId: ChannelId;
    provider: ChannelProviderId;
    connectionId: ChannelConnectionId;
    target: ChannelTarget;
    deliveryMode: OutboundDeliveryMode;
    text?: string;
    blocks?: ChannelBlock[];
    attachments?: ChannelAttachment[];
    actions?: ChannelAction[];
    threadPolicy: OutboundThreadPolicy;
    chunkPolicy: OutboundChunkPolicy;
    priority: OutboundPriority;
    idempotencyKey: string;
    redactionPolicy: OutboundRedactionPolicy;
}
export type DeliveryReceiptStatus = "accepted" | "sent" | "delivered" | "failed" | "partial" | "rate_limited" | "blocked_by_policy" | "unsupported_capability";
export interface DeliveryReceiptPart {
    status: DeliveryReceiptStatus;
    messageId?: string;
    attachmentId?: string;
    errorCode?: string;
    errorMessage?: string;
}
export interface DeliveryReceipt {
    channelId: ChannelId;
    provider: ChannelProviderId;
    connectionId: ChannelConnectionId;
    target: ChannelTarget;
    status: DeliveryReceiptStatus;
    timestamp: number;
    idempotencyKey: string;
    messageId?: string;
    threadId?: string;
    providerResponseRef?: RawPayloadRef;
    parts?: DeliveryReceiptPart[];
    capability?: keyof ChannelCapabilities | string;
    retryAfterMs?: number;
    errorCode?: string;
    errorMessage?: string;
}
export type InteractionKind = "approval" | "cancel" | "retry" | "choose_option" | "provide_input";
export type ApprovalInteractionDecision = "allow_once" | "allow_run" | "deny";
export interface InteractionEnvelope {
    channelId: ChannelId;
    provider: ChannelProviderId;
    connectionId: ChannelConnectionId;
    interactionId: string;
    kind: InteractionKind;
    sender: ChannelIdentity;
    timestamp: number;
    rawPayloadRef: RawPayloadRef;
    messageId?: string;
    threadId?: string;
    room?: ChannelRoom;
    workspace?: ChannelWorkspace;
    actionId?: string;
    value?: string;
    text?: string;
    approvalDecision?: ApprovalInteractionDecision;
    correlationId?: string;
}
export interface ChannelRateLimitPolicy {
    strategy: "provider_default" | "fixed_window" | "token_bucket" | "manual";
    messagesPerMinute?: number;
    burst?: number;
    retryAfterHintMs?: number;
}
export interface ChannelDeliveryStateCapabilities {
    supportsAccepted: boolean;
    supportsSent: boolean;
    supportsDelivered: boolean;
    supportsReadReceipt: boolean;
}
export interface ChannelCapabilities {
    provider: ChannelProviderId;
    connectionKind: ChannelConnectionKind;
    supportsThreads: boolean;
    supportsReplies: boolean;
    supportsEdits: boolean;
    supportsDeletes: boolean;
    supportsReactions: boolean;
    supportsButtons: boolean;
    supportsModals: boolean;
    supportsFiles: boolean;
    supportsImages: boolean;
    supportsTypingIndicator: boolean;
    maxMessageLength: number;
    maxAttachmentSizeBytes?: number;
    rateLimitPolicy: ChannelRateLimitPolicy;
    requiresWebhook: boolean;
    requiresLocalBridge: boolean;
    requiresUserSession: boolean;
    manualConfirmationRequired?: boolean;
    riskLevel: ChannelRiskLevel;
    deliveryStates: ChannelDeliveryStateCapabilities;
}
export type ChannelHealthStatus = "healthy" | "degraded" | "stopped" | "failed";
export interface ChannelHealthCheck {
    status: ChannelHealthStatus;
    checkedAt: number;
    message?: string;
    detail?: JsonValue;
}
export interface ChannelTypingIndicator {
    target: ChannelTarget;
    active: boolean;
    reason?: "processing" | "uploading" | "waiting_for_approval" | "idle";
}
export interface ChannelUploadOptions {
    idempotencyKey: string;
    threadPolicy?: OutboundThreadPolicy;
    redactionPolicy?: OutboundRedactionPolicy;
}
export interface ChannelAdapter {
    readonly channelId: ChannelId;
    readonly provider: ChannelProviderId;
    readonly connectionId: ChannelConnectionId;
    start(): Promise<void>;
    stop(): Promise<void>;
    healthCheck(): Promise<ChannelHealthCheck>;
    getCapabilities(): ChannelCapabilities;
    normalizeInbound(rawPayload: unknown): Promise<InboundEnvelope[]>;
    sendMessage(message: OutboundMessage): Promise<DeliveryReceipt>;
    normalizeInteraction?(rawPayload: unknown): Promise<InteractionEnvelope[]>;
    sendTypingIndicator?(indicator: ChannelTypingIndicator): Promise<DeliveryReceipt>;
    uploadAttachment?(target: ChannelTarget, attachment: ChannelAttachment, options: ChannelUploadOptions): Promise<DeliveryReceipt>;
    handleInteraction?(interaction: InteractionEnvelope): Promise<DeliveryReceipt | void>;
}
export interface ResolveDeliveryReceiptStatusInput {
    accepted?: boolean;
    sent?: boolean;
    delivered?: boolean;
    failed?: boolean;
    partial?: boolean;
    rateLimited?: boolean;
    blockedByPolicy?: boolean;
    unsupportedCapability?: boolean;
    providerSupportsDelivered?: boolean;
}
export declare function defineChannelAdapter<T extends ChannelAdapter>(adapter: T): T;
export declare function defineChannelCapabilities<T extends ChannelCapabilities>(capabilities: T): T;
export declare function isInternalChannelSurface(source: string): source is InternalChannelSurface;
export declare function isBuiltInChannelProvider(source: string): source is BuiltInChannelProvider;
export declare function isExternalChannelProvider(source: string): source is ChannelProvider;
export declare function resolveChannelSurface(source: string): ChannelSurface;
export declare function normalizeChannelSource(source: string | null | undefined, fallback?: ChannelSource): ChannelSource;
export declare function resolveDeliveryReceiptStatus(input: ResolveDeliveryReceiptStatusInput): DeliveryReceiptStatus;
export declare function isPositiveDeliveryReceipt(receipt: DeliveryReceipt): boolean;
export declare function buildUnsupportedCapabilityReceipt(params: {
    channelId: ChannelId;
    provider: ChannelProviderId;
    connectionId: ChannelConnectionId;
    target: ChannelTarget;
    capability: keyof ChannelCapabilities | string;
    idempotencyKey: string;
    timestamp?: number;
}): DeliveryReceipt;
export declare function createRawPayloadRef(input: {
    provider: ChannelProviderId;
    ref?: string;
    payload?: unknown;
    createdAt?: number;
}): RawPayloadRef;
export declare function sanitizeChannelContractValue(value: unknown, options?: {
    maxDepth?: number;
    maxArrayItems?: number;
    maxObjectKeys?: number;
    maxStringLength?: number;
}): JsonValue;
//# sourceMappingURL=contracts.d.ts.map