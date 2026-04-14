import type { RunChunkDeliveryHandler } from "./delivery.js";
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js";
import { runExternalRecoveryPass } from "./external-recovery-pass.js";
import type { ExternalRecoveryKind, ExternalRecoveryPayload, ExternalRecoveryState } from "./external-recovery.js";
import type { TaskProfile } from "./types.js";
export type ExternalRecoverySequenceResult = {
    kind: "none";
} | {
    kind: "stop";
} | {
    kind: "retry";
    nextState: ExternalRecoveryState;
    nextMessage: string;
};
interface ExternalRecoverySequenceDependencies {
    appendRunEvent: (runId: string, message: string) => void;
}
interface ExternalRecoverySequenceModuleDependencies {
    runExternalRecoveryPass: typeof runExternalRecoveryPass;
}
export declare function runExternalRecoverySequence(params: {
    recoveries: Array<{
        kind: ExternalRecoveryKind;
        payload?: ExternalRecoveryPayload | null;
    }>;
    aborted: boolean;
    taskProfile: TaskProfile;
    current: ExternalRecoveryState;
    seenKeys: Set<string>;
    originalRequest: string;
    previousResult: string;
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    preview: string;
    finalizationDependencies: FinalizationDependencies;
}, dependencies: ExternalRecoverySequenceDependencies, moduleDependencies?: ExternalRecoverySequenceModuleDependencies): Promise<ExternalRecoverySequenceResult>;
export {};
//# sourceMappingURL=external-recovery-sequence.d.ts.map