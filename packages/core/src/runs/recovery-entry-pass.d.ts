import type { RunChunkDeliveryHandler } from "./delivery.js";
import { runExternalRecoverySequence } from "./external-recovery-sequence.js";
import { enqueueRunRecovery } from "./recovery-queue.js";
import type { ExternalRecoveryPayload, ExternalRecoveryState } from "./external-recovery.js";
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js";
import type { TaskProfile } from "./types.js";
import { applyTerminalApplication } from "./terminal-application.js";
export type RecoveryEntryPassResult = {
    kind: "break";
} | {
    kind: "continue";
} | {
    kind: "retry";
    nextState: ExternalRecoveryState;
    nextMessage: string;
};
interface RecoveryEntryPassDependencies {
    appendRunEvent: (runId: string, message: string) => void;
}
interface RecoveryEntryPassModuleDependencies {
    applyTerminalApplication: typeof applyTerminalApplication;
    runExternalRecoverySequence: typeof runExternalRecoverySequence;
    enqueueRunRecovery: typeof enqueueRunRecovery;
}
export declare function runRecoveryEntryPass(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    preview: string;
    executionRecoveryLimitStop: {
        summary: string;
        reason: string;
        rawMessage?: string;
        remainingItems: string[];
    } | null;
    aiRecoveryLimitStop: {
        summary: string;
        reason: string;
        rawMessage?: string;
        remainingItems: string[];
    } | null;
    recoveries: Array<{
        kind: "ai" | "worker_runtime";
        payload?: ExternalRecoveryPayload | null;
    }>;
    aborted: boolean;
    failed: boolean;
    taskProfile: TaskProfile;
    current: ExternalRecoveryState;
    seenKeys: Set<string>;
    originalRequest: string;
    previousResult: string;
    finalizationDependencies: FinalizationDependencies;
}, dependencies: RecoveryEntryPassDependencies, moduleDependencies?: RecoveryEntryPassModuleDependencies): Promise<RecoveryEntryPassResult>;
export {};
//# sourceMappingURL=recovery-entry-pass.d.ts.map