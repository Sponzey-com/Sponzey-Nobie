import { type RunChunkDeliveryHandler } from "../../runs/delivery.js";
import { type MessageLedgerDeliveryKind } from "../../runs/message-ledger.js";
import { type SlackFileDeliveryResult, type SlackTextPartsDeliveryResult } from "./message-delivery.js";
export interface SlackChunkResponder {
    sendToolStatus(toolName: string): Promise<string>;
    updateToolStatus(messageId: string, toolName: string, success: boolean): Promise<void>;
    clearToolStatus?(messageId: string): Promise<void>;
    sendFile(filePath: string, caption?: string): Promise<string>;
    sendFileWithReceipt?(filePath: string, idempotencyKey: string, caption?: string): Promise<SlackFileDeliveryResult>;
    sendFinalResponse(text: string): Promise<string[]>;
    sendFinalResponseWithReceipts?(text: string, idempotencyKeyPrefix: string): Promise<SlackTextPartsDeliveryResult>;
    sendError(message: string): Promise<string>;
}
export interface SlackChunkDeliveryContext {
    responder: SlackChunkResponder;
    sessionId: string;
    channelId: string;
    threadTs: string;
    getRunId: () => string | undefined;
    deliveryKind?: MessageLedgerDeliveryKind;
    parentRunId?: string;
    subSessionId?: string;
    agentId?: string;
    recordOutgoingMessageRef: (params: {
        sessionId: string;
        runId: string;
        channelId: string;
        threadTs: string;
        messageId: string;
        role: "assistant" | "tool";
    }) => void;
    logError: (message: string) => void;
}
export declare function createSlackChunkDeliveryHandler(context: SlackChunkDeliveryContext): RunChunkDeliveryHandler;
//# sourceMappingURL=chunk-delivery.d.ts.map