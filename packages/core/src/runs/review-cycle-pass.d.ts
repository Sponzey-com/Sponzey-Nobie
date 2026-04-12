import type { AIProvider } from "../ai/index.js";
import { getRootRun } from "./store.js";
import { runReviewPass } from "./review-pass.js";
import { runReviewOutcomePass, type ReviewOutcomePassResult } from "./review-outcome-pass.js";
import type { RunChunkDeliveryHandler, DeliveryOutcome, SuccessfulFileDelivery } from "./delivery.js";
import type { SuccessfulToolEvidence } from "./recovery.js";
import type { TaskExecutionSemantics } from "../agent/intake.js";
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js";
import type { RecoveryBudgetUsage } from "./recovery-budget.js";
import type { SyntheticApprovalRuntimeDependencies } from "./approval.js";
import { decideReviewGate } from "./review-gate.js";
interface ReviewCyclePassDependencies {
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
    onReviewError?: (message: string) => void;
}
interface ReviewCyclePassModuleDependencies {
    decideReviewGate: typeof decideReviewGate;
    runReviewPass: typeof runReviewPass;
    runReviewOutcomePass: typeof runReviewOutcomePass;
    getRootRun: typeof getRootRun;
}
export declare function runReviewCyclePass(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    signal: AbortSignal;
    preview: string;
    priorAssistantMessages: string[];
    executionSemantics: TaskExecutionSemantics;
    requiresFilesystemMutation: boolean;
    originalRequest: string;
    model?: string;
    providerId?: string;
    provider?: AIProvider;
    workDir?: string;
    usesWorkerRuntime: boolean;
    workerRuntimeKind?: string;
    requiresPrivilegedToolExecution: boolean;
    successfulTools: SuccessfulToolEvidence[];
    successfulFileDeliveries: SuccessfulFileDelivery[];
    sawRealFilesystemMutation: boolean;
    deliveryOutcome: DeliveryOutcome;
    truncatedOutputRecoveryAttempted: boolean;
    recoveryBudgetUsage: RecoveryBudgetUsage;
    seenFollowupPrompts: Set<string>;
    syntheticApprovalAlreadyApproved: boolean;
    syntheticApprovalRuntimeDependencies: SyntheticApprovalRuntimeDependencies;
    finalizationDependencies: FinalizationDependencies;
    approvalRequired: boolean;
    approvalTool: string;
    defaultMaxDelegationTurns: number;
}, dependencies: ReviewCyclePassDependencies, moduleDependencies?: ReviewCyclePassModuleDependencies): Promise<ReviewOutcomePassResult>;
export {};
//# sourceMappingURL=review-cycle-pass.d.ts.map