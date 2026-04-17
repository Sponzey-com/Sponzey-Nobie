import { type AIProvider } from "../ai/index.js";
import { type ActiveRunContractProjection } from "./active-run-projection.js";
import { type IntentContract } from "../contracts/index.js";
export type RequestContinuationDecisionKind = "same_run" | "new_run" | "clarify" | "cancel_target" | "update_target";
export interface RequestContinuationDecision {
    kind: RequestContinuationDecisionKind;
    requestGroupId?: string;
    runId?: string;
    approvalId?: string;
    decisionSource: "explicit_id" | "contract_ai" | "contract_exact" | "safe_fallback";
    reason: string;
}
interface ParsedRequestContinuationDecision {
    decision: RequestContinuationDecisionKind;
    request_group_id?: string;
    run_id?: string;
    approval_id?: string;
    reason?: string;
}
export declare function compareRequestContinuationWithAI(params: {
    incomingContract: IntentContract;
    sessionId?: string;
    candidates: ActiveRunContractProjection[];
    model?: string;
    providerId?: string;
    provider?: AIProvider;
    timeoutMs?: number;
}): Promise<RequestContinuationDecision>;
export declare function buildRequestContinuationSystemPrompt(): string;
export declare function parseRequestContinuationDecision(raw: string): ParsedRequestContinuationDecision | null;
export {};
//# sourceMappingURL=entry-comparison.d.ts.map