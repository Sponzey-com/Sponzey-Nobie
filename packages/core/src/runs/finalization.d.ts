import { type RunChunkDeliveryHandler, emitAssistantTextDelivery } from "./delivery.js";
import type { RunStatus, RunStepStatus } from "./types.js";
export type FinalizationSource = "webui" | "cli" | "telegram" | "slack";
export interface AwaitingUserParams {
    preview: string;
    summary: string;
    reason?: string;
    rawMessage?: string;
    userMessage?: string;
    remainingItems?: string[];
}
export interface FinalizationDependencies {
    appendRunEvent: (runId: string, message: string) => void;
    setRunStepStatus: (runId: string, step: string, status: RunStepStatus, summary: string) => unknown;
    updateRunStatus: (runId: string, status: RunStatus, summary: string, active: boolean) => unknown;
    rememberRunSuccess: (params: {
        runId: string;
        sessionId: string;
        source: FinalizationSource;
        text: string;
        summary: string;
    }) => void;
    rememberRunFailure: (params: {
        runId: string;
        sessionId: string;
        source: FinalizationSource;
        summary: string;
        detail?: string;
        title?: string;
    }) => void;
    onDeliveryError?: (message: string) => void;
    deliveryDependencies?: NonNullable<Parameters<typeof emitAssistantTextDelivery>[0]["dependencies"]>;
}
export declare function markRunCompleted(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    text: string;
    summary: string;
    executingSummary?: string;
    reviewingSummary?: string;
    finalizingSummary?: string;
    completedSummary?: string;
    eventLabel?: string;
    dependencies: FinalizationDependencies;
}): void;
export declare function completeRunWithAssistantMessage(params: {
    runId: string;
    sessionId: string;
    text: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    dependencies: FinalizationDependencies;
}): Promise<void>;
export declare function emitStandaloneAssistantMessage(params: {
    runId: string;
    sessionId: string;
    text: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    dependencies: Pick<FinalizationDependencies, "appendRunEvent" | "onDeliveryError" | "deliveryDependencies">;
}): Promise<void>;
export declare function moveRunToAwaitingUser(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    awaitingUser: AwaitingUserParams;
    dependencies: FinalizationDependencies;
}): Promise<void>;
export declare function moveRunToCancelledAfterStop(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    cancellation: AwaitingUserParams;
    dependencies: FinalizationDependencies;
}): Promise<void>;
export declare function buildAwaitingUserMessage(params: AwaitingUserParams): string;
//# sourceMappingURL=finalization.d.ts.map