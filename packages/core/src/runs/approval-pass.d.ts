import type { SyntheticApprovalRequest, SyntheticApprovalRuntimeDependencies } from "./approval.js";
import { type SyntheticApprovalContinuation } from "./approval-application.js";
export declare function runSyntheticApprovalPass(params: {
    request: SyntheticApprovalRequest;
    runId: string;
    sessionId: string;
    signal: AbortSignal;
    alreadyApproved: boolean;
    sourceLabel: string;
    originalRequest: string;
    latestAssistantMessage: string;
    runtimeDependencies: SyntheticApprovalRuntimeDependencies;
}): Promise<SyntheticApprovalContinuation>;
//# sourceMappingURL=approval-pass.d.ts.map