import type { RunChunkDeliveryHandler } from "../../runs/delivery.js";
export interface SlackChunkResponder {
    sendToolStatus(toolName: string): Promise<string>;
    updateToolStatus(messageId: string, toolName: string, success: boolean): Promise<void>;
    sendFile(filePath: string, caption?: string): Promise<string>;
    sendFinalResponse(text: string): Promise<string[]>;
    sendError(message: string): Promise<string>;
}
export interface SlackChunkDeliveryContext {
    responder: SlackChunkResponder;
    sessionId: string;
    channelId: string;
    threadTs: string;
    getRunId: () => string | undefined;
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