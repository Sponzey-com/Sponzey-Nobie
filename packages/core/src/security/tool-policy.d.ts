import type { RiskLevel, ToolContext } from "../tools/types.js";
import { type TrustTag } from "./trust-boundary.js";
export type ToolPolicyDecision = "allow" | "deny";
export interface ToolPolicyDecisionRecord {
    id: string;
    runId?: string;
    requestGroupId?: string;
    sessionId?: string;
    channel?: string;
    toolName: string;
    riskLevel: RiskLevel;
    sourceTrust: TrustTag;
    approvalId?: string;
    permissionScope: string;
    paramsHash: string;
    decision: ToolPolicyDecision;
    reasonCode: string;
    userMessage?: string;
    diagnostic?: Record<string, unknown>;
    createdAt: number;
}
export interface EvaluateToolPolicyInput {
    toolName: string;
    riskLevel: RiskLevel;
    params: Record<string, unknown>;
    ctx: ToolContext;
    approvalId?: string;
    approvalDecision?: "allow_once" | "allow_run";
}
export declare function evaluateAndRecordToolPolicy(input: EvaluateToolPolicyInput): ToolPolicyDecisionRecord;
export declare function evaluateToolPolicy(input: EvaluateToolPolicyInput): ToolPolicyDecisionRecord;
export declare function recordToolPolicyDecision(record: ToolPolicyDecisionRecord): void;
export declare function sanitizePolicyDenialForUser(record: ToolPolicyDecisionRecord): string;
//# sourceMappingURL=tool-policy.d.ts.map