import { insertMessage } from "../db/index.js";
import { logAssistantReply, type DeliveryOutcome, type RunChunkDeliveryHandler, type SuccessfulFileDelivery } from "./delivery.js";
import { runDeliveryPass } from "./delivery-pass.js";
import { decideExecutionPostPassRecovery, type ExecutionRecoveryPayload } from "./execution-postpass.js";
import { applyExecutionPostPassDecision } from "./execution-postpass-application.js";
import { decideFilesystemPostPassRecovery, type FilesystemVerificationResult } from "./filesystem-postpass.js";
import { applyFilesystemPostPassDecision } from "./filesystem-postpass-application.js";
import { runReviewEntryPass } from "./review-entry-pass.js";
import { type RecoveryBudgetUsage } from "./recovery-budget.js";
import type { FailedCommandTool, SuccessfulToolEvidence } from "./recovery.js";
import type { RecoveryRetryApplicationDependencies } from "./retry-application.js";
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js";
export type PostExecutionPassResult = {
    kind: "break";
} | {
    kind: "retry";
    nextMessage: string;
    clearWorkerRuntime: boolean;
    markMutationRecoveryAttempted?: true;
    seenCommandFailureRecoveryKey?: string;
    seenExecutionRecoveryKey?: string;
    seenDeliveryRecoveryKey?: string;
} | {
    kind: "continue";
    preview: string;
    deliveryOutcome: DeliveryOutcome;
};
interface PostExecutionPassDependencies extends RecoveryRetryApplicationDependencies {
    getFinalizationDependencies: () => FinalizationDependencies;
    insertMessage: typeof insertMessage;
    writeReplyLog: typeof logAssistantReply;
    createId: () => string;
    now: () => number;
    runVerificationSubtask: () => Promise<FilesystemVerificationResult>;
}
interface PostExecutionPassModuleDependencies {
    decideExecutionPostPassRecovery: typeof decideExecutionPostPassRecovery;
    applyExecutionPostPassDecision: typeof applyExecutionPostPassDecision;
    runDeliveryPass: typeof runDeliveryPass;
    decideFilesystemPostPassRecovery: typeof decideFilesystemPostPassRecovery;
    applyFilesystemPostPassDecision: typeof applyFilesystemPostPassDecision;
    runReviewEntryPass: typeof runReviewEntryPass;
}
export declare function runPostExecutionPass(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    preview: string;
    originalRequest: string;
    verificationRequest: string;
    wantsDirectArtifactDelivery: boolean;
    requiresFilesystemMutation: boolean;
    activeWorkerRuntime: boolean;
    workerSessionId?: string;
    successfulFileDeliveries: SuccessfulFileDelivery[];
    successfulTools: SuccessfulToolEvidence[];
    sawRealFilesystemMutation: boolean;
    filesystemMutationRecoveryAttempted: boolean;
    mutationPaths: string[];
    failedCommandTools: FailedCommandTool[];
    commandFailureSeen: boolean;
    commandRecoveredWithinSamePass: boolean;
    executionRecovery: ExecutionRecoveryPayload | null;
    seenCommandFailureRecoveryKeys: Set<string>;
    seenExecutionRecoveryKeys: Set<string>;
    seenDeliveryRecoveryKeys: Set<string>;
    recoveryBudgetUsage: RecoveryBudgetUsage;
    usedTurns: number;
    maxDelegationTurns: number;
}, dependencies: PostExecutionPassDependencies, moduleDependencies?: PostExecutionPassModuleDependencies): Promise<PostExecutionPassResult>;
export {};
//# sourceMappingURL=post-execution-pass.d.ts.map