import { type AIProvider } from "../ai/index.js";
import type { RootRun } from "./types.js";
export type RequestContinuationDecisionKind = "new" | "reuse" | "clarify";
export interface RequestContinuationDecision {
    kind: RequestContinuationDecisionKind;
    requestGroupId?: string;
    reason: string;
}
interface ParsedRequestContinuationDecision {
    decision: RequestContinuationDecisionKind;
    request_group_id?: string;
    reason?: string;
}
export declare function compareRequestContinuationWithAI(params: {
    message: string;
    sessionId?: string;
    candidates: RootRun[];
    model?: string;
    providerId?: string;
    provider?: AIProvider;
}): Promise<RequestContinuationDecision>;
export declare function buildRequestContinuationSystemPrompt(): string;
export declare function parseRequestContinuationDecision(raw: string): ParsedRequestContinuationDecision | null;
export {};
//# sourceMappingURL=entry-comparison.d.ts.map