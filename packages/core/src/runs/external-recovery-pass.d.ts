import type { RunChunkDeliveryHandler } from "./delivery.js";
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js";
import { applyExternalRecoveryPlan } from "./external-recovery-application.js";
import { planExternalRecovery, type ExternalRecoveryKind, type ExternalRecoveryPayload, type ExternalRecoveryState } from "./external-recovery.js";
import type { TaskProfile } from "./types.js";
export type ExternalRecoveryPassResult = {
    kind: "none";
} | {
    kind: "stop";
} | {
    kind: "retry";
    nextState: ExternalRecoveryState;
    nextMessage: string;
};
interface ExternalRecoveryPassDependencies {
    appendRunEvent: (runId: string, message: string) => void;
}
interface ExternalRecoveryPassModuleDependencies {
    planExternalRecovery: typeof planExternalRecovery;
    applyExternalRecoveryPlan: typeof applyExternalRecoveryPlan;
}
export declare function runExternalRecoveryPass(params: {
    kind: ExternalRecoveryKind;
    payload?: ExternalRecoveryPayload | null;
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
}, dependencies: ExternalRecoveryPassDependencies, moduleDependencies?: ExternalRecoveryPassModuleDependencies): Promise<ExternalRecoveryPassResult>;
export {};
//# sourceMappingURL=external-recovery-pass.d.ts.map