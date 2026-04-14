export declare function resolveSessionKey(chatId: number, threadId?: number | undefined): string;
export declare function parseTelegramSessionKey(sessionKey: string): {
    chatId: number;
    threadId?: number;
} | null;
export declare function getOrCreateTelegramSession(sessionKey: string): string;
export declare function newSession(sessionKey: string): string;
//# sourceMappingURL=session.d.ts.map