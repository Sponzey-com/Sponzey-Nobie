import type { SlackConfig } from "../../config/types.js";
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
    sendError(message: string): Promise<string>;
    sendReceipt(text: string): Promise<string>;
    sendApprovalRequest(runId: string, text: string): Promise<string>;
    sendFile(filePath: string, caption?: string): Promise<string>;
}
//# sourceMappingURL=responder.d.ts.map
