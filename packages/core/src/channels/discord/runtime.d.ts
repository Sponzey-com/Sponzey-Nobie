export interface DiscordRuntimeStatus {
    isRunning: boolean;
    lastStartedAt: number | null;
    lastStoppedAt: number | null;
    lastError: string | null;
    lastErrorAt: number | null;
}
export declare function setDiscordRuntimeRunning(running: boolean): void;
export declare function setDiscordRuntimeError(message: string | null): void;
export declare function getDiscordRuntimeError(): string | null;
export declare function getDiscordRuntimeStatus(): DiscordRuntimeStatus;
export declare function stopDiscordRuntime(): void;
//# sourceMappingURL=runtime.d.ts.map