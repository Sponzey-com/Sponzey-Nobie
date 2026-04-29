import { type RunChunkDeliveryHandler } from "../../runs/delivery.js";
import { type MessageLedgerDeliveryKind } from "../../runs/message-ledger.js";
import { type TelegramFileDeliveryResult, type TelegramTextPartsDeliveryResult } from "./message-delivery.js";
export interface TelegramChunkResponder {
    sendToolStatus(toolName: string): Promise<number>;
    updateToolStatus(messageId: number, toolName: string, success: boolean): Promise<void>;
    clearToolStatus?(messageId: number): Promise<void>;
    sendFile(filePath: string, caption?: string | undefined): Promise<number>;
    sendFileWithReceipt?(filePath: string, idempotencyKey: string, caption?: string | undefined): Promise<TelegramFileDeliveryResult>;
    sendFinalResponse(text: string): Promise<number[]>;
    sendFinalResponseWithReceipts?(text: string, idempotencyKeyPrefix: string): Promise<TelegramTextPartsDeliveryResult>;
    sendError(message: string): Promise<number>;
}
export interface TelegramChunkDeliveryContext {
    responder: TelegramChunkResponder;
    sessionId: string;
    chatId: number;
    threadId?: number;
    getRunId: () => string | undefined;
    deliveryKind?: MessageLedgerDeliveryKind;
    parentRunId?: string;
    subSessionId?: string;
    agentId?: string;
    maxTextChunks?: number;
    recordOutgoingMessageRef: (params: {
        sessionId: string;
        runId: string;
        chatId: number;
        threadId?: number;
        messageId: number;
        role: "assistant" | "tool";
    }) => void;
    logError: (message: string) => void;
}
export declare function buildTelegramTooManyChunksFallbackText(input: {
    text: string;
    estimatedChunks: number;
    maxChunks: number;
}): string;
export declare function createTelegramChunkDeliveryHandler(context: TelegramChunkDeliveryContext): RunChunkDeliveryHandler;
//# sourceMappingURL=chunk-delivery.d.ts.map