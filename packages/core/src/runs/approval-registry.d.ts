import type { ApprovalDecision, ApprovalKind, ApprovalResolutionReason } from "../events/index.js";
import type { RiskLevel } from "../tools/types.js";
export type ApprovalRegistryStatus = "requested" | "approved_once" | "approved_run" | "denied" | "expired" | "superseded" | "consumed";
export interface ApprovalRegistryRow {
    id: string;
    run_id: string;
    request_group_id: string | null;
    channel: string;
    channel_message_id: string | null;
    tool_name: string;
    risk_level: string;
    kind: ApprovalKind;
    status: ApprovalRegistryStatus;
    params_hash: string;
    params_preview_json: string | null;
    requested_at: number;
    expires_at: number | null;
    consumed_at: number | null;
    decision_at: number | null;
    decision_by: string | null;
    decision_source: string | null;
    superseded_by: string | null;
    metadata_json: string | null;
    created_at: number;
    updated_at: number;
}
export interface CreateApprovalRegistryRequestInput {
    id?: string;
    runId: string;
    requestGroupId?: string | null;
    channel: string;
    toolName: string;
    riskLevel: RiskLevel | string;
    kind: ApprovalKind;
    params: unknown;
    expiresAt?: number | null;
    channelMessageId?: string | null;
    metadata?: Record<string, unknown>;
    now?: number;
    supersedePending?: boolean;
}
export interface ApprovalRegistryDecisionResult {
    accepted: boolean;
    status: ApprovalRegistryStatus | "missing";
    decision?: ApprovalDecision;
    reason?: ApprovalResolutionReason | "late" | "already_consumed" | "superseded";
    row?: ApprovalRegistryRow;
}
export declare function stableStringify(value: unknown): string;
export declare function hashApprovalParams(params: unknown): string;
export declare function createApprovalRegistryRequest(input: CreateApprovalRegistryRequestInput): ApprovalRegistryRow;
export declare function getApprovalRegistryRow(id: string): ApprovalRegistryRow | undefined;
export declare function getLatestApprovalForRun(runId: string): ApprovalRegistryRow | undefined;
export declare function getActiveApprovalForRun(runId: string): ApprovalRegistryRow | undefined;
export declare function findLatestApprovalByChannelMessage(params: {
    channel: string;
    channelMessageId: string;
}): ApprovalRegistryRow | undefined;
export declare function attachApprovalChannelMessage(approvalId: string, channelMessageId: string, now?: number): boolean;
export declare function expireApprovalRegistryRequest(approvalId: string, now?: number): ApprovalRegistryDecisionResult;
export declare function resolveApprovalRegistryDecision(params: {
    approvalId: string;
    decision: ApprovalDecision;
    decisionBy?: string | null;
    decisionSource: string;
    now?: number;
}): ApprovalRegistryDecisionResult;
export declare function consumeApprovalRegistryDecision(approvalId: string, now?: number): ApprovalRegistryDecisionResult;
export declare function describeLateApproval(row: ApprovalRegistryRow | undefined): string;
//# sourceMappingURL=approval-registry.d.ts.map