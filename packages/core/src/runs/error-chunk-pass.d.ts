import type { AgentChunk } from "../agent/index.js";
import { deliverTrackedChunk, type RunChunkDeliveryHandler, type SuccessfulFileDelivery, type SuccessfulTextDelivery } from "./delivery.js";
import { applyExternalRecoveryAttempt, type ExternalRecoveryAttemptDependencies } from "./external-retry-application.js";
import { applyFatalFailure } from "./failure-application.js";
import type { FinalizationSource } from "./finalization.js";
import type { RecoveryBudgetUsage } from "./recovery-budget.js";
import { describeWorkerRuntimeErrorReason } from "./recovery.js";
import type { WorkerRuntimeTarget } from "./worker-runtime.js";
type ErrorChunk = Extract<AgentChunk, {
    type: "error";
}>;
export interface ErrorChunkPassResult {
    failed: boolean;
    limitStop?: {
        summary: string;
        reason: string;
        rawMessage?: string;
        remainingItems: string[];
    };
    workerRuntimeRecovery?: {
        summary: string;
        reason: string;
        message: string;
    };
}
interface ErrorChunkPassDependencies extends ExternalRecoveryAttemptDependencies {
    markAbortedRunCancelledIfActive: (runId: string) => void;
}
interface ErrorChunkPassModuleDependencies {
    applyExternalRecoveryAttempt: typeof applyExternalRecoveryAttempt;
    applyFatalFailure: typeof applyFatalFailure;
    deliverTrackedChunk: typeof deliverTrackedChunk;
    describeWorkerRuntimeErrorReason: typeof describeWorkerRuntimeErrorReason;
}
export declare function applyErrorChunkPass(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler;
    onDeliveryError?: (message: string) => void;
    chunk: ErrorChunk;
    aborted: boolean;
    executionRecoveryLimitStop: {
        summary: string;
        reason: string;
        remainingItems: string[];
    } | null;
    activeWorkerRuntime: WorkerRuntimeTarget | undefined;
    workerSessionId?: string;
    recoveryBudgetUsage: RecoveryBudgetUsage;
    usedTurns: number;
    maxDelegationTurns: number;
    successfulFileDeliveries: SuccessfulFileDelivery[];
    successfulTextDeliveries: SuccessfulTextDelivery[];
}, dependencies: ErrorChunkPassDependencies, moduleDependencies?: ErrorChunkPassModuleDependencies): Promise<ErrorChunkPassResult>;
export {};
//# sourceMappingURL=error-chunk-pass.d.ts.map