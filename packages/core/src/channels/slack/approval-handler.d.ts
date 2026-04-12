export interface SlackApprovalMessenger {
    sendApprovalRequest(params: {
        channelId: string;
        threadTs: string;
        runId: string;
        text: string;
    }): Promise<void>;
}
export declare function setActiveSlackConversationForSession(sessionId: string, channelId: string, userId: string, threadTs: string): void;
export declare function clearActiveSlackConversationForSession(sessionId: string): void;
export declare function registerSlackApprovalHandler(messenger: SlackApprovalMessenger): void;
export declare function handleSlackApprovalMessage(params: {
    channelId: string;
    threadTs: string;
    userId: string;
    text: string;
    reply: (text: string) => Promise<void>;
}): Promise<boolean>;
export declare function handleSlackApprovalAction(params: {
    runId: string;
    decision: "allow_once" | "allow_run" | "deny";
    channelId: string;
    threadTs: string;
    userId: string;
    reply: (text: string) => Promise<void>;
}): Promise<boolean>;
//# sourceMappingURL=approval-handler.d.ts.map