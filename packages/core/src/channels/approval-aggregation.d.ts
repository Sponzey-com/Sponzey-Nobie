import type { ApprovalDecision, ApprovalKind, ApprovalResolutionReason } from "../events/index.js";
export interface ApprovalAggregateItem {
    approvalId?: string;
    runId: string;
    parentRunId?: string;
    subSessionId?: string;
    agentId?: string;
    teamId?: string;
    toolName: string;
    kind: ApprovalKind;
    riskSummary?: string;
    guidance?: string;
    paramsPreview: string;
    resolve: (decision: ApprovalDecision, reason?: ApprovalResolutionReason) => void;
}
export interface ApprovalAggregateContext {
    runId: string;
    requesterId: string | number;
    items: ApprovalAggregateItem[];
    openedAt: number;
    lastUpdatedAt: number;
}
export declare function appendApprovalAggregateItem(context: ApprovalAggregateContext | undefined, item: ApprovalAggregateItem, requesterId: string | number, observedAt?: number): {
    context: ApprovalAggregateContext;
    appended: boolean;
    aggregationLatencyMs: number | null;
};
export declare function buildApprovalAggregateText(params: {
    context: ApprovalAggregateContext;
    channel: "slack" | "telegram";
}): string;
export declare function resolveApprovalAggregate(context: ApprovalAggregateContext, decision: ApprovalDecision, reason?: ApprovalResolutionReason): ApprovalAggregateItem[];
//# sourceMappingURL=approval-aggregation.d.ts.map