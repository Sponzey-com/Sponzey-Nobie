import { InputFile } from "grammy";
import { type ChannelTarget, type DeliveryReceipt } from "../contracts.js";
export interface TelegramMessageDeliveryApi {
    sendMessage: (chatId: number, text: string, other?: Record<string, unknown>) => Promise<{
        message_id: number;
    }>;
    sendDocument: (chatId: number, document: InputFile, other?: Record<string, unknown>) => Promise<{
        message_id: number;
    }>;
}
export interface TelegramDeliveryTarget {
    chatId: number;
    threadId?: number;
}
export interface TelegramDeliveryReceiptParams {
    target: TelegramDeliveryTarget;
    idempotencyKey: string;
    messageId?: number | string;
    providerResponse?: unknown;
    timestamp?: number | undefined;
}
export interface TelegramTextPartsDeliveryResult {
    messageIds: number[];
    receipts: DeliveryReceipt[];
}
export interface TelegramFileDeliveryResult {
    messageId: number;
    receipt: DeliveryReceipt;
}
export declare function sendTelegramTextParts(params: {
    api: TelegramMessageDeliveryApi;
    target: TelegramDeliveryTarget;
    text: string;
}): Promise<number[]>;
export declare function sendTelegramTextPartsWithReceipts(params: {
    api: TelegramMessageDeliveryApi;
    target: TelegramDeliveryTarget;
    text: string;
    idempotencyKeyPrefix: string;
    timestamp?: number;
}): Promise<TelegramTextPartsDeliveryResult>;
export declare function sendTelegramPlainMessage(params: {
    api: TelegramMessageDeliveryApi;
    target: TelegramDeliveryTarget;
    text: string;
}): Promise<number>;
export declare function sendTelegramFile(params: {
    api: TelegramMessageDeliveryApi;
    target: TelegramDeliveryTarget;
    filePath: string;
    caption?: string;
}): Promise<number>;
export declare function sendTelegramFileWithReceipt(params: {
    api: TelegramMessageDeliveryApi;
    target: TelegramDeliveryTarget;
    filePath: string;
    idempotencyKey: string;
    caption?: string;
    timestamp?: number;
}): Promise<TelegramFileDeliveryResult>;
export declare function buildTelegramSentDeliveryReceipt(params: TelegramDeliveryReceiptParams): DeliveryReceipt;
export declare function buildTelegramFailedDeliveryReceipt(params: {
    target: TelegramDeliveryTarget;
    idempotencyKey: string;
    error: unknown;
    timestamp?: number;
}): DeliveryReceipt;
export declare function telegramTargetToChannelTarget(target: TelegramDeliveryTarget): ChannelTarget;
//# sourceMappingURL=message-delivery.d.ts.map