import type { SlackConfig } from "../../config/types.js";
import { type SlackFileDeliveryResult, type SlackTextPartsDeliveryResult } from "./message-delivery.js";
export interface SlackApiEnvelope<T = Record<string, unknown>> {
    ok: boolean;
    error?: string;
    ts?: string;
    channel?: string;
    thread_ts?: string;
    permalink?: string;
    upload_url?: string;
    file_id?: string;
    response_metadata?: {
        messages?: string[];
    };
    team?: {
        name?: string;
    };
    [key: string]: unknown;
}
export declare class SlackResponder {
    private config;
    private channelId;
    private threadTs;
    constructor(config: SlackConfig, channelId: string, threadTs: string);
    private api;
    sendToolStatus(toolName: string): Promise<string>;
    updateToolStatus(messageId: string, toolName: string, success: boolean): Promise<void>;
    clearToolStatus(messageId: string): Promise<void>;
    sendFinalResponse(text: string): Promise<string[]>;
    sendFinalResponseWithReceipts(text: string, idempotencyKeyPrefix: string): Promise<SlackTextPartsDeliveryResult>;
    sendError(message: string): Promise<string>;
    sendReceipt(text: string): Promise<string>;
    sendApprovalRequest(runId: string, text: string): Promise<string>;
    sendFile(filePath: string, caption?: string): Promise<string>;
    sendFileWithReceipt(filePath: string, idempotencyKey: string, caption?: string): Promise<SlackFileDeliveryResult>;
}
//# sourceMappingURL=responder.d.ts.map