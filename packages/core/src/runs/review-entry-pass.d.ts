import { insertMessage } from "../db/index.js";
import { logAssistantReply, type RunChunkDeliveryHandler } from "./delivery.js";
import { type FinalizationDependencies, type FinalizationSource } from "./finalization.js";
import { type RecoveryRetryApplicationDependencies } from "./retry-application.js";
import type { DirectArtifactDeliveryApplication } from "./delivery-application.js";
import type { RecoveryBudgetUsage } from "./recovery-budget.js";
interface ReviewEntryPassDependencies extends RecoveryRetryApplicationDependencies {
    getFinalizationDependencies: () => FinalizationDependencies;
    insertMessage: typeof insertMessage;
    writeReplyLog: typeof logAssistantReply;
    createId: () => string;
    now: () => number;
}
export type ReviewEntryPassResult = {
    kind: "continue";
} | {
    kind: "break";
} | {
    kind: "retry";
    nextMessage: string;
    clearWorkerRuntime: boolean;
};
export declare function runReviewEntryPass(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    preview: string;
    workerSessionId?: string;
    persistRuntimePreview: boolean;
    directDeliveryApplication: DirectArtifactDeliveryApplication;
    recoveryBudgetUsage: RecoveryBudgetUsage;
    maxDelegationTurns: number;
}, dependencies: ReviewEntryPassDependencies): Promise<ReviewEntryPassResult>;
export {};
//# sourceMappingURL=review-entry-pass.d.ts.map