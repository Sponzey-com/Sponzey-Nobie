import type { SlackConfig } from "../../config/types.js";
export declare class SlackChannel {
    private config;
    private socket;
    private runningRuns;
    private sessionIds;
    private seenInboundEvents;
    constructor(config: SlackConfig);
    start(): Promise<void>;
    stop(): void;
    private addSessionRun;
    private removeSessionRun;
    private isAllowedUser;
    private isAllowedChannel;
    private markInboundEventSeen;
    private recordOutgoingMessageRef;
    private handleSocketMessage;
    private handleBlockActions;
}
//# sourceMappingURL=bot.d.ts.map