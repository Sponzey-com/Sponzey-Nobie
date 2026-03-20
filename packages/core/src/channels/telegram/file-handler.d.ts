import type { Bot } from "grammy";
export declare class FileHandler {
    private bot;
    constructor(bot: Bot);
    downloadFile(fileId: string, sessionId: string, filename: string): Promise<string>;
}
//# sourceMappingURL=file-handler.d.ts.map