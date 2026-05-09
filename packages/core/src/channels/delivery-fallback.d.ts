import type { ChannelCapabilities, DeliveryReceipt, OutboundMessage } from "./contracts.js";
export type ChannelDeliveryCapability = "supportsThreads" | "supportsReplies" | "supportsEdits" | "supportsDeletes" | "supportsReactions" | "supportsButtons" | "supportsModals" | "supportsFiles" | "supportsImages" | "supportsTypingIndicator";
export type ChannelDeliveryFallbackAction = "send_as_is" | "split_text" | "summarize_then_link" | "download_link" | "native_file" | "unsupported_capability";
export type ChannelArtifactFallbackMode = "none" | "native_file" | "download_link" | "inline_preview" | "local_path_markdown";
export type ChannelDeliveryFallbackSeverity = "info" | "warning" | "error";
export interface ChannelDeliveryFallbackIssue {
    code: string;
    severity: ChannelDeliveryFallbackSeverity;
    message: string;
    capability?: ChannelDeliveryCapability | string;
}
export interface ChannelDeliveryFallbackPlan {
    action: ChannelDeliveryFallbackAction;
    textParts: string[];
    notices: string[];
    issues: ChannelDeliveryFallbackIssue[];
    artifactMode: ChannelArtifactFallbackMode;
    requiresExplicitApproval: boolean;
    unsupportedCapabilities: Array<ChannelDeliveryCapability | string>;
}
export interface ResolveChannelDeliveryFallbackPlanInput {
    capabilities: ChannelCapabilities;
    message: Pick<OutboundMessage, "text" | "attachments" | "actions" | "threadPolicy" | "chunkPolicy" | "deliveryMode" | "redactionPolicy">;
    requestedCapabilities?: Array<ChannelDeliveryCapability | string>;
    artifactSensitivity?: "public" | "internal" | "sensitive";
    inlinePreviewSupported?: boolean;
}
export declare function resolveChannelDeliveryFallbackPlan(input: ResolveChannelDeliveryFallbackPlanInput): ChannelDeliveryFallbackPlan;
export declare function splitTextForChannel(text: string, maxLength: number): string[];
export declare function describeUnsupportedCapability(capability: ChannelDeliveryCapability | string | undefined): string;
export declare function buildCapabilityFallbackNotice(receipt: Pick<DeliveryReceipt, "status" | "capability" | "errorMessage" | "errorCode">): {
    title: string;
    message: string;
    severity: ChannelDeliveryFallbackSeverity;
} | undefined;
//# sourceMappingURL=delivery-fallback.d.ts.map