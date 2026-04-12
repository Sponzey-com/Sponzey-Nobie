import type { RunChunkDeliveryHandler } from "./delivery.js";
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js";
import type { ExternalRecoveryPlan } from "./external-recovery.js";
import { applyTerminalApplication } from "./terminal-application.js";
export type AppliedExternalRecoveryPlan = {
    kind: "stop";
} | {
    kind: "retry";
    nextState: ExternalRecoveryPlan["nextState"];
    nextMessage: string;
};
interface ExternalRecoveryApplicationDependencies {
    appendRunEvent: (runId: string, message: string) => void;
}
interface ExternalRecoveryApplicationModuleDependencies {
    applyTerminalApplication: typeof applyTerminalApplication;
}
export declare function applyExternalRecoveryPlan(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    preview: string;
    plan: ExternalRecoveryPlan;
    seenKeys: Set<string>;
    finalizationDependencies: FinalizationDependencies;
}, dependencies: ExternalRecoveryApplicationDependencies, moduleDependencies?: ExternalRecoveryApplicationModuleDependencies): Promise<AppliedExternalRecoveryPlan>;
export {};
//# sourceMappingURL=external-recovery-application.d.ts.map