import type { Bot } from "grammy";
export declare class TelegramResponder {
    private bot;
    private chatId;
    private threadId?;
    constructor(bot: Bot, chatId: number, threadId?: number | undefined);
    sendToolStatus(toolName: string): Promise<number>;
    updateToolStatus(messageId: number, toolName: string, success: boolean): Promise<void>;
    sendFinalResponse(text: string): Promise<void>;
    sendError(message: string): Promise<void>;
    sendFile(filePath: string, caption?: string | undefined): Promise<void>;
}
//# sourceMappingURL=responder.d.ts.map