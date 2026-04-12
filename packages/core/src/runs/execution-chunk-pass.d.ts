import type { AgentChunk } from "../agent/index.js";
import { applyToolEndChunk, applyToolStartChunk, type ToolChunkApplicationDependencies } from "./tool-chunk-application.js";
import { applyExecutionRecoveryAttempt, type ExecutionRecoveryAttemptDependencies, type ExecutionRecoveryPayload } from "./execution-retry-application.js";
import { applyExternalRecoveryAttempt, type ExternalRecoveryAttemptDependencies } from "./external-retry-application.js";
import type { FinalizationSource } from "./finalization.js";
import type { RecoveryBudgetUsage } from "./recovery-budget.js";
import type { FailedCommandTool, SuccessfulToolEvidence } from "./recovery.js";
type ChunkPassChunk = Exclude<AgentChunk, {
    type: "error";
} | {
    type: "done";
}>;
export interface ExecutionChunkPassResult {
    handled: boolean;
    preview?: string;
    executionRecovery?: ExecutionRecoveryPayload;
    executionRecoveryLimitStop?: {
        summary: string;
        reason: string;
        rawMessage?: string;
        remainingItems: string[];
    };
    aiRecovery?: {
        summary: string;
        reason: string;
        message: string;
    };
    aiRecoveryLimitStop?: {
        summary: string;
        reason: string;
        rawMessage?: string;
        remainingItems: string[];
    };
    sawRealFilesystemMutation?: boolean;
    commandFailureSeen?: boolean;
    commandRecoveredWithinSamePass?: boolean;
    abortExecutionStream?: boolean;
}
type ExecutionChunkPassDependencies = ToolChunkApplicationDependencies & ExecutionRecoveryAttemptDependencies & ExternalRecoveryAttemptDependencies;
interface ExecutionChunkPassModuleDependencies {
    applyToolStartChunk: typeof applyToolStartChunk;
    applyToolEndChunk: typeof applyToolEndChunk;
    applyExecutionRecoveryAttempt: typeof applyExecutionRecoveryAttempt;
    applyExternalRecoveryAttempt: typeof applyExternalRecoveryAttempt;
}
export declare function applyExecutionChunkPass(params: {
    chunk: ChunkPassChunk;
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    preview: string;
    workDir: string;
    pendingToolParams: Map<string, unknown>;
    successfulTools: SuccessfulToolEvidence[];
    filesystemMutationPaths: Set<string>;
    failedCommandTools: FailedCommandTool[];
    commandFailureSeen: boolean;
    recoveryBudgetUsage: RecoveryBudgetUsage;
    usedTurns: number;
    maxDelegationTurns: number;
}, dependencies: ExecutionChunkPassDependencies, moduleDependencies?: ExecutionChunkPassModuleDependencies): ExecutionChunkPassResult;
export {};
//# sourceMappingURL=execution-chunk-pass.d.ts.map