import { type ChannelTarget, type DeliveryReceipt } from "../contracts.js";
export interface SlackDeliveryTarget {
    channelId: string;
    threadTs?: string;
}
export interface SlackDeliveryReceiptParams {
    target: SlackDeliveryTarget;
    idempotencyKey: string;
    messageId?: number | string;
    fileId?: string;
    providerResponse?: unknown;
    timestamp?: number | undefined;
}
export interface SlackTextPartsDeliveryResult {
    messageIds: string[];
    receipts: DeliveryReceipt[];
}
export interface SlackFileDeliveryResult {
    messageId: string;
    receipt: DeliveryReceipt;
    fileId?: string;
    permalink?: string;
}
export declare class SlackRateLimitError extends Error {
    readonly retryAfterMs: number;
    readonly method?: string;
    constructor(input: {
        retryAfterMs: number;
        method?: string;
        message?: string;
    });
}
export declare function splitSlackText(text: string, maxLength?: number): string[];
export declare function parseSlackRetryAfterMs(headers: Headers | Record<string, string | number | undefined>): number | undefined;
export declare function buildSlackSentDeliveryReceipt(params: SlackDeliveryReceiptParams): DeliveryReceipt;
export declare function buildSlackFailedDeliveryReceipt(params: {
    target: SlackDeliveryTarget;
    idempotencyKey: string;
    error: unknown;
    timestamp?: number;
}): DeliveryReceipt;
export declare function slackTargetToChannelTarget(target: SlackDeliveryTarget): ChannelTarget;
//# sourceMappingURL=message-delivery.d.ts.map