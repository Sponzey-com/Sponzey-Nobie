import type { AgentContextMode } from "../agent/index.js";
import type { TaskExecutionSemantics } from "../agent/intake.js";
import { insertMessage } from "../db/index.js";
import type { AIProvider } from "../ai/index.js";
import { applyPostExecutionPassResult, applyRecoveryEntryPassResult, applyReviewCyclePassResult } from "./loop-pass-application.js";
import { runExecutionAttemptPass } from "./execution-attempt-pass.js";
import { runRecoveryEntryPass } from "./recovery-entry-pass.js";
import { runPostExecutionPass } from "./post-execution-pass.js";
import { runReviewCyclePass } from "./review-cycle-pass.js";
import { logAssistantReply, type RunChunkDeliveryHandler } from "./delivery.js";
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js";
import type { RecoveryBudgetUsage } from "./recovery-budget.js";
import type { SuccessfulToolEvidence } from "./recovery.js";
import type { TaskProfile } from "./types.js";
import type { WorkerRuntimeTarget } from "./worker-runtime.js";
import type { SyntheticApprovalRuntimeDependencies } from "./approval.js";
type RecoveryLimitStop = {
    summary: string;
    reason: string;
    remainingItems: string[];
} | null;
export interface ExecutionCycleState {
    currentMessage: string;
    currentModel: string | undefined;
    currentProviderId: string | undefined;
    currentProvider: AIProvider | undefined;
    currentTargetId: string | undefined;
    currentTargetLabel: string | undefined;
    activeWorkerRuntime: WorkerRuntimeTarget | undefined;
    executionRecoveryLimitStop: RecoveryLimitStop;
    aiRecoveryLimitStop: RecoveryLimitStop;
    sawRealFilesystemMutation: boolean;
    filesystemMutationRecoveryAttempted: boolean;
    truncatedOutputRecoveryAttempted: boolean;
}
export type ExecutionCyclePassResult = {
    kind: "break";
} | {
    kind: "retry";
    state: ExecutionCycleState;
};
interface ExecutionCyclePassDependencies {
    rememberRunFailure: (params: {
        runId: string;
        sessionId: string;
        source: FinalizationSource;
        summary: string;
        detail?: string;
        title?: string;
    }) => void;
    incrementDelegationTurnCount: (runId: string, summary: string) => void;
    appendRunEvent: (runId: string, message: string) => void;
    updateRunSummary: (runId: string, summary: string) => void;
    setRunStepStatus: (runId: string, step: string, status: "pending" | "running" | "completed" | "failed" | "cancelled", summary: string) => void;
    updateRunStatus: (runId: string, status: "queued" | "running" | "awaiting_approval" | "awaiting_user" | "completed" | "failed" | "cancelled" | "interrupted", summary: string, active: boolean) => void;
    markAbortedRunCancelledIfActive: (runId: string) => void;
    getDelegationTurnState: () => {
        usedTurns: number;
        maxTurns: number;
    };
    getFinalizationDependencies: () => FinalizationDependencies;
    insertMessage: typeof insertMessage;
    writeReplyLog: typeof logAssistantReply;
    createId: () => string;
    now: () => number;
    runVerificationSubtask: () => Promise<{
        ok: boolean;
        summary: string;
        reason?: string;
        remainingItems?: string[];
    }>;
    rememberRunApprovalScope: (runId: string) => void;
    grantRunApprovalScope: (runId: string) => void;
    grantRunSingleApproval: (runId: string) => void;
    onReviewError?: (message: string) => void;
}
interface ExecutionCyclePassModuleDependencies {
    runExecutionAttemptPass: typeof runExecutionAttemptPass;
    runRecoveryEntryPass: typeof runRecoveryEntryPass;
    runPostExecutionPass: typeof runPostExecutionPass;
    runReviewCyclePass: typeof runReviewCyclePass;
    applyRecoveryEntryPassResult: typeof applyRecoveryEntryPassResult;
    applyPostExecutionPassResult: typeof applyPostExecutionPassResult;
    applyReviewCyclePassResult: typeof applyReviewCyclePassResult;
}
export declare function runExecutionCyclePass(params: {
    runId: string;
    sessionId: string;
    requestGroupId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    signal: AbortSignal;
    state: ExecutionCycleState;
    executionSemantics: TaskExecutionSemantics;
    originalRequest: string;
    memorySearchQuery: string;
    verificationRequest: string;
    workDir: string;
    toolsEnabled?: boolean;
    onDeliveryError?: (message: string) => void;
    abortExecutionStream: () => void;
    isRootRequest: boolean;
    contextMode: AgentContextMode;
    taskProfile: TaskProfile;
    workerSessionId?: string;
    wantsDirectArtifactDelivery: boolean;
    requiresFilesystemMutation: boolean;
    requiresPrivilegedToolExecution: boolean;
    pendingToolParams: Map<string, unknown>;
    filesystemMutationPaths: Set<string>;
    successfulTools: SuccessfulToolEvidence[];
    seenFollowupPrompts: Set<string>;
    seenCommandFailureRecoveryKeys: Set<string>;
    seenExecutionRecoveryKeys: Set<string>;
    seenDeliveryRecoveryKeys: Set<string>;
    seenAiRecoveryKeys: Set<string>;
    recoveryBudgetUsage: RecoveryBudgetUsage;
    priorAssistantMessages: string[];
    syntheticApprovalAlreadyApproved: boolean;
    syntheticApprovalRuntimeDependencies: SyntheticApprovalRuntimeDependencies;
    defaultMaxDelegationTurns: number;
}, dependencies: ExecutionCyclePassDependencies, moduleDependencies?: ExecutionCyclePassModuleDependencies): Promise<ExecutionCyclePassResult>;
export {};
//# sourceMappingURL=execution-cycle-pass.d.ts.map