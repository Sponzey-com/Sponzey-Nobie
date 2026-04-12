import type { AIProvider } from "../ai/index.js";
import type { DeliveryOutcome } from "./delivery.js";
import type { LoopDirective } from "./loop-directive.js";
import type { LoopEntryPassResult } from "./loop-entry-pass.js";
import type { PostExecutionPassResult } from "./post-execution-pass.js";
import type { RecoveryEntryPassResult } from "./recovery-entry-pass.js";
import type { ReviewOutcomePassResult } from "./review-outcome-pass.js";
import type { WorkerRuntimeTarget } from "./worker-runtime.js";
export interface LoopEntryApplicationState {
    pendingLoopDirective: LoopDirective | null;
    intakeProcessed: boolean;
}
export type LoopEntryApplicationResult = {
    kind: "break";
} | {
    kind: "retry";
    nextMessage: string;
    state: LoopEntryApplicationState;
} | {
    kind: "continue";
    state: LoopEntryApplicationState;
};
export declare function applyLoopEntryPassResult(result: LoopEntryPassResult): LoopEntryApplicationResult;
export interface RecoveryEntryApplicationState {
    currentMessage: string;
    currentModel: string | undefined;
    currentProviderId: string | undefined;
    currentProvider: AIProvider | undefined;
    currentTargetId: string | undefined;
    currentTargetLabel: string | undefined;
    activeWorkerRuntime: WorkerRuntimeTarget | undefined;
}
export type RecoveryEntryApplicationResult = {
    kind: "break";
} | {
    kind: "continue";
} | {
    kind: "retry";
    state: RecoveryEntryApplicationState;
};
export declare function applyRecoveryEntryPassResult(params: {
    result: RecoveryEntryPassResult;
    currentMessage: string;
}): RecoveryEntryApplicationResult;
export interface PostExecutionApplicationState {
    currentMessage: string;
    filesystemMutationRecoveryAttempted: boolean;
    activeWorkerRuntime: WorkerRuntimeTarget | undefined;
}
export type PostExecutionApplicationResult = {
    kind: "break";
} | {
    kind: "retry";
    state: PostExecutionApplicationState;
} | {
    kind: "continue";
    state: PostExecutionApplicationState;
    preview: string;
    deliveryOutcome: DeliveryOutcome;
};
export declare function applyPostExecutionPassResult(params: {
    result: PostExecutionPassResult;
    currentMessage: string;
    filesystemMutationRecoveryAttempted: boolean;
    activeWorkerRuntime: WorkerRuntimeTarget | undefined;
    seenCommandFailureRecoveryKeys: Set<string>;
    seenExecutionRecoveryKeys: Set<string>;
    seenDeliveryRecoveryKeys: Set<string>;
}): PostExecutionApplicationResult;
export interface ReviewCycleApplicationState {
    currentMessage: string;
    truncatedOutputRecoveryAttempted: boolean;
    activeWorkerRuntime: WorkerRuntimeTarget | undefined;
    currentProvider: AIProvider | undefined;
}
export type ReviewCycleApplicationResult = {
    kind: "break";
} | {
    kind: "retry";
    state: ReviewCycleApplicationState;
};
export declare function applyReviewCyclePassResult(params: {
    result: ReviewOutcomePassResult;
    currentMessage: string;
    truncatedOutputRecoveryAttempted: boolean;
    activeWorkerRuntime: WorkerRuntimeTarget | undefined;
    currentProvider: AIProvider | undefined;
    seenFollowupPrompts: Set<string>;
}): ReviewCycleApplicationResult;
//# sourceMappingURL=loop-pass-application.d.ts.map