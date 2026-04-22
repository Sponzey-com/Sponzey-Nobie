import { type DbMessageLedgerEvent, type DbMessageLedgerStatus } from "../db/index.js";
import type { RunStatus } from "./types.js";
export type MessageLedgerEventKind = "ingress_received" | "fast_receipt_sent" | "approval_requested" | "approval_received" | "tool_started" | "tool_done" | "tool_failed" | "tool_skipped" | "progress_message_sent" | "final_answer_generated" | "final_answer_delivered" | "final_answer_suppressed" | "text_delivered" | "text_delivery_failed" | "text_delivery_suppressed" | "artifact_delivered" | "artifact_delivery_failed" | "approval_aggregated" | "sub_session_created" | "sub_session_progress_summarized" | "sub_session_completed" | "sub_session_failed" | "sub_session_result_suppressed" | "data_exchange_recorded" | "capability_delegation_recorded" | "feedback_retry_recorded" | "learning_history_recorded" | "history_restore_recorded" | "agent_config_changed" | "team_config_changed" | "agent_config_exported" | "team_config_exported" | "agent_config_imported" | "team_config_imported" | "recovery_stop_generated" | "delivery_finalized";
export type MessageLedgerDeliveryKind = "progress" | "final" | "artifact" | "approval" | "diagnostic";
export interface MessageLedgerEventInput {
    runId?: string | null;
    parentRunId?: string | null;
    requestGroupId?: string | null;
    subSessionId?: string | null;
    agentId?: string | null;
    teamId?: string | null;
    sessionKey?: string | null;
    threadKey?: string | null;
    channel?: string | null;
    eventKind: MessageLedgerEventKind;
    deliveryKey?: string | null;
    idempotencyKey?: string | null;
    deliveryKind?: MessageLedgerDeliveryKind | null;
    status: DbMessageLedgerStatus;
    summary: string;
    detail?: Record<string, unknown>;
    createdAt?: number;
}
export interface DeliveryFinalizerResult {
    shouldProtectDeliveredAnswer: boolean;
    outcome: "unchanged" | "success" | "partial_success";
    runStatus?: RunStatus;
    summary?: string;
}
export declare function recordMessageLedgerEvent(input: MessageLedgerEventInput): string | null;
export declare function findMessageLedgerEventByIdempotencyKey(idempotencyKey: string | null | undefined): DbMessageLedgerEvent | undefined;
export declare function stableStringify(value: unknown): string;
export declare function hashLedgerValue(value: unknown): string;
export declare function buildTextDeliveryKey(channel: string | null | undefined, target: string | null | undefined, text: string): string;
export declare function buildArtifactDeliveryKey(channel: string | null | undefined, target: string | null | undefined, artifactPath: string): string;
export declare function isDedupeTargetTool(toolName: string): boolean;
export declare function getAllowRepeatReason(params: Record<string, unknown>): string | undefined;
export declare function buildToolCallIdempotencyKey(input: {
    runId?: string | null;
    requestGroupId?: string | null;
    toolName: string;
    params: Record<string, unknown>;
}): string;
export declare function findDuplicateToolCall(input: {
    runId?: string | null;
    requestGroupId?: string | null;
    toolName: string;
    params: Record<string, unknown>;
}): DbMessageLedgerEvent | undefined;
export declare function messageLedgerEventSucceeded(event: DbMessageLedgerEvent | null | undefined): boolean;
export declare function finalizeDeliveryForRun(params: {
    runId: string;
    requestedStatus: RunStatus;
    requestedSummary?: string;
}): DeliveryFinalizerResult;
//# sourceMappingURL=message-ledger.d.ts.map