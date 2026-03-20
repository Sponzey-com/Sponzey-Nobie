import type { Bot } from "grammy";
interface ActiveChat {
    chatId: number;
    userId: number;
    threadId?: number | undefined;
}
export declare const activeChats: Map<string, ActiveChat>;
export declare function setActiveChatForSession(sessionId: string, chatId: number, userId: number, threadId?: number | undefined): void;
export declare function clearActiveChatForSession(sessionId: string): void;
export declare function registerApprovalHandler(bot: Bot): void;
export {};
//# sourceMappingURL=approval-handler.d.ts.map