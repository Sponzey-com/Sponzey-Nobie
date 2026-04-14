import type { AgentTool } from "../types.js";
interface TelegramSendFileParams {
    filePath: string;
    caption?: string | undefined;
}
export declare const telegramSendFileTool: AgentTool<TelegramSendFileParams>;
export {};
//# sourceMappingURL=telegram-send.d.ts.map