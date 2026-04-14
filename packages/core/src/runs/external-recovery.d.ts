import type { AIProvider } from "../ai/index.js";
import type { TaskProfile } from "./types.js";
import type { WorkerRuntimeTarget } from "./worker-runtime.js";
export type ExternalRecoveryKind = "ai" | "worker_runtime";
export interface ExternalRecoveryPayload {
    summary: string;
    reason: string;
    message: string;
}
export interface ExternalRecoveryState {
    model: string | undefined;
    providerId: string | undefined;
    provider: AIProvider | undefined;
    targetId: string | undefined;
    targetLabel: string | undefined;
    workerRuntime: WorkerRuntimeTarget | undefined;
}
export interface ExternalRecoveryPlan {
    recoveryKey: string;
    eventLabel: string;
    routeChanged: boolean;
    routeEventLabel?: string;
    nextState: ExternalRecoveryState;
    nextMessage: string;
    duplicateStop?: {
        summary: string;
        reason: string;
        rawMessage?: string;
        remainingItems: string[];
    };
}
export declare function planExternalRecovery(params: {
    kind: ExternalRecoveryKind;
    taskProfile: TaskProfile;
    current: ExternalRecoveryState;
    payload: ExternalRecoveryPayload;
    seenKeys: Set<string>;
    originalRequest: string;
    previousResult: string;
}): ExternalRecoveryPlan;
//# sourceMappingURL=external-recovery.d.ts.map