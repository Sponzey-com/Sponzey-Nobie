import type { TelegramConfig } from "../../config/types.js";
export interface SessionStatus {
    sessionId: string | undefined;
    runId: string | undefined;
    running: boolean;
}
export declare class TelegramChannel {
    private config;
    private bot;
    private runningRuns;
    private sessionIds;
    private fileHandler;
    constructor(config: TelegramConfig);
    getSessionKey(chatId: number, threadId?: number | undefined): string;
    newSession(sessionKey: string): void;
    abortSession(sessionKey: string): boolean;
    getRunningCount(): number;
    getSessionStatus(sessionKey: string): SessionStatus;
    private _registerHandlers;
    start(): Promise<void>;
    stop(): void;
}
//# sourceMappingURL=bot.d.ts.map