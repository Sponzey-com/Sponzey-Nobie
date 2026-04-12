import type { CompletionReviewResult } from "../agent/completion-review.js";
import { reviewTaskCompletion } from "../agent/completion-review.js";
import type { AIProvider } from "../ai/index.js";
import type { SuccessfulFileDelivery } from "./delivery.js";
import { type SyntheticApprovalRequest } from "./approval.js";
import type { SuccessfulToolEvidence } from "./recovery.js";
export interface ReviewPassResult {
    review: CompletionReviewResult | null;
    syntheticApproval: SyntheticApprovalRequest | null;
}
export interface ReviewPassDependencies {
    reviewTaskCompletion: typeof reviewTaskCompletion;
    onReviewError?: (message: string) => void;
}
export declare function runReviewPass(params: {
    executionProfile: {
        approvalRequired: boolean;
        approvalTool: string;
    };
    originalRequest: string;
    preview: string;
    priorAssistantMessages: string[];
    model?: string;
    providerId?: string;
    provider?: AIProvider;
    workDir?: string;
    usesWorkerRuntime: boolean;
    requiresPrivilegedToolExecution: boolean;
    successfulTools: SuccessfulToolEvidence[];
    successfulFileDeliveries: SuccessfulFileDelivery[];
    sawRealFilesystemMutation: boolean;
}, dependencies: ReviewPassDependencies): Promise<ReviewPassResult>;
export declare const defaultReviewPassDependencies: ReviewPassDependencies;
//# sourceMappingURL=review-pass.d.ts.map