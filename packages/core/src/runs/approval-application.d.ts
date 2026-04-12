import type { ApprovalDecision } from "../events/index.js";
import type { SyntheticApprovalRequest } from "./approval.js";
import { type AppliedRunningContinuation, type RunningContinuationDependencies } from "./running-application.js";
export type SyntheticApprovalContinuation = {
    kind: "stop";
} | {
    kind: "continue";
    eventLabel: string;
    reviewSummary: string;
    executingSummary: string;
    continuationPrompt: string;
    grantMode: "reuse_scope" | "run" | "single";
    clearWorkerRuntime: true;
    clearProvider: true;
};
export declare function decideSyntheticApprovalContinuation(params: {
    request: SyntheticApprovalRequest;
    decision?: ApprovalDecision;
    alreadyApproved: boolean;
}): SyntheticApprovalContinuation;
export type AppliedSyntheticApprovalContinuation = {
    kind: "stop";
} | ({
    kind: "continue";
} & AppliedRunningContinuation);
interface SyntheticApprovalApplicationDependencies extends RunningContinuationDependencies {
    rememberRunApprovalScope: (runId: string) => void;
    grantRunApprovalScope: (runId: string) => void;
    grantRunSingleApproval: (runId: string) => void;
}
export declare function applySyntheticApprovalContinuation(params: {
    runId: string;
    continuation: SyntheticApprovalContinuation;
    aborted: boolean;
}, dependencies: SyntheticApprovalApplicationDependencies): AppliedSyntheticApprovalContinuation;
export {};
//# sourceMappingURL=approval-application.d.ts.map