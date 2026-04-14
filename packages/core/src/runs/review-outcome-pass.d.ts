import type { CompletionReviewResult } from "../agent/completion-review.js";
import type { TaskExecutionSemantics } from "../agent/intake.js";
import type { DeliveryOutcome, RunChunkDeliveryHandler } from "./delivery.js";
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js";
import type { RecoveryBudgetUsage } from "./recovery-budget.js";
import type { SuccessfulToolEvidence } from "./recovery.js";
import { type SyntheticApprovalRequest, type SyntheticApprovalRuntimeDependencies } from "./approval.js";
import { applySyntheticApprovalContinuation } from "./approval-application.js";
import { runSyntheticApprovalPass } from "./approval-pass.js";
import { applyCompletionApplicationPass } from "./completion-application-pass.js";
import { runCompletionPass } from "./completion-pass.js";
export type ReviewOutcomePassResult = {
    kind: "break";
} | {
    kind: "retry";
    nextMessage: string;
    clearWorkerRuntime: boolean;
    clearProvider?: boolean;
    normalizedFollowupPrompt?: string;
    markTruncatedOutputRecoveryAttempted?: boolean;
};
interface ReviewOutcomePassDependencies {
    rememberRunApprovalScope: (runId: string) => void;
    grantRunApprovalScope: (runId: string) => void;
    grantRunSingleApproval: (runId: string) => void;
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
}
interface ReviewOutcomePassModuleDependencies {
    runSyntheticApprovalPass: typeof runSyntheticApprovalPass;
    applySyntheticApprovalContinuation: typeof applySyntheticApprovalContinuation;
    runCompletionPass: typeof runCompletionPass;
    applyCompletionApplicationPass: typeof applyCompletionApplicationPass;
}
export declare function runReviewOutcomePass(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    signal: AbortSignal;
    preview: string;
    review: CompletionReviewResult | null;
    syntheticApproval: SyntheticApprovalRequest | null;
    executionSemantics: TaskExecutionSemantics;
    deliveryOutcome: DeliveryOutcome;
    successfulTools: SuccessfulToolEvidence[];
    sawRealFilesystemMutation: boolean;
    requiresFilesystemMutation: boolean;
    truncatedOutputRecoveryAttempted: boolean;
    originalRequest: string;
    recoveryBudgetUsage: RecoveryBudgetUsage;
    delegationTurnCount?: number;
    maxDelegationTurns?: number;
    defaultMaxDelegationTurns: number;
    followupPromptSeen: boolean;
    syntheticApprovalAlreadyApproved: boolean;
    syntheticApprovalSourceLabel: string;
    syntheticApprovalRuntimeDependencies: SyntheticApprovalRuntimeDependencies;
    finalizationDependencies: FinalizationDependencies;
}, dependencies: ReviewOutcomePassDependencies, moduleDependencies?: ReviewOutcomePassModuleDependencies): Promise<ReviewOutcomePassResult>;
export {};
//# sourceMappingURL=review-outcome-pass.d.ts.map