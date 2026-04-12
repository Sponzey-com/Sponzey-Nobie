import { type RecoveryBudgetUsage } from "./recovery-budget.js";
import type { RecoveryRetryApplicationState } from "./retry-application.js";
export interface FilesystemVerificationResult {
    ok: boolean;
    summary: string;
    reason?: string;
    remainingItems?: string[];
}
export type FilesystemPostPassDecision = {
    kind: "none";
} | {
    kind: "initial_retry";
    eventLabel: string;
    summary: string;
    nextMessage: string;
    markAttempted: true;
} | {
    kind: "retry";
    state: RecoveryRetryApplicationState;
} | {
    kind: "stop";
    summary: string;
    reason?: string;
    remainingItems?: string[];
} | {
    kind: "verified";
    summary: string;
    eventLabel: string;
    nextPreview: string;
};
export declare function decideFilesystemPostPassRecovery(params: {
    requiresFilesystemMutation: boolean;
    deliverySatisfied: boolean;
    sawRealFilesystemMutation: boolean;
    filesystemMutationRecoveryAttempted: boolean;
    originalRequest: string;
    verificationRequest: string;
    preview: string;
    mutationPaths: string[];
    recoveryBudgetUsage: RecoveryBudgetUsage;
    usedTurns: number;
    maxDelegationTurns: number;
    runVerificationSubtask: () => Promise<FilesystemVerificationResult>;
}): Promise<FilesystemPostPassDecision>;
//# sourceMappingURL=filesystem-postpass.d.ts.map