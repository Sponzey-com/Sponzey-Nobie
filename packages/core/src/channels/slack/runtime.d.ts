import type { SlackChannel } from "./bot.js";
export interface SlackRuntimeStatus {
    isRunning: boolean;
    lastStartedAt: number | null;
    lastStoppedAt: number | null;
    lastError: string | null;
    lastErrorAt: number | null;
}
export declare function setActiveSlackChannel(channel: SlackChannel | null): void;
export declare function getActiveSlackChannel(): SlackChannel | null;
export declare function setSlackRuntimeError(message: string | null): void;
export declare function getSlackRuntimeError(): string | null;
export declare function getSlackRuntimeStatus(): SlackRuntimeStatus;
export declare function stopActiveSlackChannel(): void;
//# sourceMappingURL=runtime.d.ts.map