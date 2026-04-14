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
    private pollingTask;
    constructor(config: TelegramConfig);
    getSessionKey(chatId: number, threadId?: number | undefined): string;
    newSession(sessionKey: string): void;
    abortSession(sessionKey: string): boolean;
    getRunningCount(): number;
    getSessionStatus(sessionKey: string): SessionStatus;
    private addSessionRun;
    private removeSessionRun;
    private recordOutgoingMessageRef;
    private _registerHandlers;
    start(): Promise<void>;
    stop(): void;
    sendTextToSession(sessionId: string, text: string): Promise<number[]>;
}
//# sourceMappingURL=bot.d.ts.map