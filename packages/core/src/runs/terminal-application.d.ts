import type { RunChunkDeliveryHandler } from "./delivery.js";
import { moveRunToAwaitingUser, moveRunToCancelledAfterStop, type AwaitingUserParams, type FinalizationDependencies, type FinalizationSource } from "./finalization.js";
export type TerminalApplication = ({
    kind: "awaiting_user";
} & AwaitingUserParams) | ({
    kind: "stop";
} & AwaitingUserParams);
interface TerminalApplicationDependencies {
    moveRunToAwaitingUser: typeof moveRunToAwaitingUser;
    moveRunToCancelledAfterStop: typeof moveRunToCancelledAfterStop;
}
export declare function applyTerminalApplication(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    application: TerminalApplication;
    dependencies: FinalizationDependencies;
}, dependencies?: TerminalApplicationDependencies): Promise<"awaiting_user" | "cancelled">;
export {};
//# sourceMappingURL=terminal-application.d.ts.map