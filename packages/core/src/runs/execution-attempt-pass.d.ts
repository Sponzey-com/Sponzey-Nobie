import { createExecutionChunkStream } from "./execution-runtime.js";
import { applyExecutionChunkPass } from "./execution-chunk-pass.js";
import { applyErrorChunkPass } from "./error-chunk-pass.js";
import { deliverTrackedChunk, type RunChunkDeliveryHandler, type SuccessfulFileDelivery, type SuccessfulTextDelivery } from "./delivery.js";
import { getRootRun } from "./store.js";
import type { AgentContextMode } from "../agent/index.js";
import type { AIProvider } from "../ai/index.js";
import type { WorkerRuntimeTarget } from "./worker-runtime.js";
import type { FailedCommandTool, SuccessfulToolEvidence } from "./recovery.js";
import type { RecoveryBudgetUsage } from "./recovery-budget.js";
import type { FinalizationSource } from "./finalization.js";
import type { ExecutionRecoveryPayload } from "./execution-postpass.js";
import type { RecoveryRetryApplicationDependencies } from "./retry-application.js";
import type { ExternalRecoveryAttemptDependencies } from "./external-retry-application.js";
export interface ExecutionAttemptPassResult {
    preview: string;
    failed: boolean;
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
    aiRecovery: {
        summary: string;
        reason: string;
        message: string;
    } | null;
    workerRuntimeRecovery: {
        summary: string;
        reason: string;
        message: string;
    } | null;
    executionRecovery: ExecutionRecoveryPayload | null;
    sawRealFilesystemMutation: boolean;
    commandFailureSeen: boolean;
    commandRecoveredWithinSamePass: boolean;
}
interface ExecutionAttemptPassDependencies extends RecoveryRetryApplicationDependencies, ExternalRecoveryAttemptDependencies {
    markAbortedRunCancelledIfActive: (runId: string) => void;
}
interface ExecutionAttemptPassModuleDependencies {
    createExecutionChunkStream: typeof createExecutionChunkStream;
    applyExecutionChunkPass: typeof applyExecutionChunkPass;
    applyErrorChunkPass: typeof applyErrorChunkPass;
    deliverTrackedChunk: typeof deliverTrackedChunk;
    getRootRun: typeof getRootRun;
}
export declare function runExecutionAttemptPass(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    onDeliveryError?: (message: string) => void;
    currentMessage: string;
    memorySearchQuery: string;
    model?: string;
    providerId?: string;
    provider?: AIProvider;
    workDir: string;
    signal: AbortSignal;
    toolsEnabled?: boolean;
    isRootRequest: boolean;
    requestGroupId: string;
    contextMode: AgentContextMode;
    preview: string;
    activeWorkerRuntime?: WorkerRuntimeTarget;
    workerSessionId?: string;
    pendingToolParams: Map<string, unknown>;
    successfulTools: SuccessfulToolEvidence[];
    filesystemMutationPaths: Set<string>;
    failedCommandTools: FailedCommandTool[];
    successfulFileDeliveries: SuccessfulFileDelivery[];
    successfulTextDeliveries: SuccessfulTextDelivery[];
    commandFailureSeen: boolean;
    recoveryBudgetUsage: RecoveryBudgetUsage;
    executionRecoveryLimitStop: {
        summary: string;
        reason: string;
        remainingItems: string[];
    } | null;
    stopAfterDirectArtifactDeliverySuccess: boolean;
    abortExecutionStream: () => void;
}, dependencies: ExecutionAttemptPassDependencies, moduleDependencies?: ExecutionAttemptPassModuleDependencies): Promise<ExecutionAttemptPassResult>;
export {};
//# sourceMappingURL=execution-attempt-pass.d.ts.map