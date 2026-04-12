import type { ApprovalDecision, ApprovalResolutionReason } from "../events/index.js";
import type { SuccessfulFileDelivery } from "./delivery.js";
import type { SuccessfulToolEvidence } from "./recovery.js";
export interface SyntheticApprovalRequest {
    toolName: string;
    summary: string;
    guidance?: string;
    continuationPrompt: string;
}
export interface SyntheticApprovalRuntimeRequest {
    runId: string;
    sessionId: string;
    toolName: string;
    summary: string;
    guidance?: string;
    params: Record<string, unknown>;
    signal: AbortSignal;
}
export interface SyntheticApprovalRuntimeDependencies {
    timeoutSec: number;
    fallback: Extract<ApprovalDecision, "allow_once" | "deny">;
    appendRunEvent: (runId: string, label: string) => void;
    setRunStepStatus: (runId: string, stepKey: string, status: "running" | "completed" | "cancelled", summary: string) => void;
    updateRunStatus: (runId: string, status: "awaiting_approval" | "running", summary: string, canCancel: boolean) => void;
    cancelRun: (runId: string, denial: {
        eventLabel: string;
        stepSummary: string;
        runSummary: string;
    }) => void;
    emitApprovalResolved: (payload: {
        runId: string;
        decision: ApprovalDecision;
        toolName: string;
        reason?: ApprovalResolutionReason;
    }) => void;
    emitApprovalRequest: (payload: {
        runId: string;
        toolName: string;
        params: unknown;
        kind?: "approval" | "screen_confirmation";
        guidance?: string;
        resolve: (decision: ApprovalDecision, reason?: ApprovalResolutionReason) => void;
    }) => void;
    onRequested?: (payload: {
        runId: string;
        sessionId: string;
        toolName: string;
    }) => void;
}
export declare function detectSyntheticApprovalRequest(params: {
    executionProfile: {
        approvalRequired: boolean;
        approvalTool: string;
    };
    originalRequest: string;
    preview: string;
    review: {
        status?: string;
        summary?: string;
        userMessage?: string;
    } | null;
    usesWorkerRuntime: boolean;
    requiresPrivilegedToolExecution: boolean;
    successfulTools: SuccessfulToolEvidence[];
    successfulFileDeliveries: SuccessfulFileDelivery[];
    sawRealFilesystemMutation: boolean;
}): SyntheticApprovalRequest | null;
export declare function describeSyntheticApprovalDenial(toolName: string, reason: "user" | "timeout" | "system" | "abort"): {
    eventLabel: string;
    stepSummary: string;
    runSummary: string;
};
export declare function requestSyntheticApproval(params: SyntheticApprovalRuntimeRequest, dependencies: SyntheticApprovalRuntimeDependencies): Promise<ApprovalDecision>;
//# sourceMappingURL=approval.d.ts.map