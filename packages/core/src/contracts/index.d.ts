export declare const CONTRACT_SCHEMA_VERSION: 1;
export type ContractSchemaVersion = typeof CONTRACT_SCHEMA_VERSION;
export type ContractLocaleHint = "ko" | "en" | "mixed" | "unknown";
export type ContractSource = "webui" | "telegram" | "slack" | "cli" | "scheduler" | "system";
export type IntentType = "schedule_request" | "execute_now" | "cancel" | "update" | "question" | "impossible" | "clarification";
export type ActionType = "create_schedule" | "update_schedule" | "cancel_schedule" | "run_tool" | "send_message" | "answer" | "ask_user" | "none";
export type ToolTargetKind = "schedule" | "run" | "artifact" | "extension" | "display" | "camera" | "file" | "unknown";
export type DeliveryMode = "reply" | "direct_artifact" | "channel_message" | "none";
export type DeliveryChannel = "current_session" | "telegram" | "slack" | "webui" | "local" | "agent" | "none";
export type ScheduleKind = "one_time" | "recurring";
export type ScheduleMissedPolicy = "skip" | "catch_up_once" | "next_only";
export type SchedulePayloadKind = "literal_message" | "agent_task" | "tool_task" | "artifact_delivery";
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | {
    [key: string]: JsonValue | undefined;
};
export type JsonObject = {
    [key: string]: JsonValue | undefined;
};
export interface ContractAttachment {
    id?: string;
    fileName?: string;
    mimeType?: string;
    artifactId?: string;
}
export interface IngressEnvelope {
    schemaVersion: ContractSchemaVersion;
    ingressId: string;
    source: ContractSource;
    channelEventId: string;
    sessionId: string;
    threadId?: string | null;
    userId?: string | null;
    receivedAt: number;
    rawText?: string;
    attachments?: ContractAttachment[];
    localeHint?: ContractLocaleHint;
}
export interface ToolTargetContract {
    schemaVersion: ContractSchemaVersion;
    kind: ToolTargetKind;
    id?: string | null;
    selector?: JsonObject | null;
    displayName?: string;
    rawText?: string;
}
export interface DeliveryContract {
    schemaVersion: ContractSchemaVersion;
    mode: DeliveryMode;
    channel: DeliveryChannel;
    sessionId?: string | null;
    threadId?: string | null;
    artifactId?: string | null;
    explicitResend?: boolean;
    displayName?: string;
    rawText?: string;
}
export interface IntentContract {
    schemaVersion: ContractSchemaVersion;
    intentType: IntentType;
    actionType: ActionType;
    target: ToolTargetContract;
    delivery: DeliveryContract;
    constraints: string[];
    requiresApproval: boolean;
    impossibility?: {
        reasonCode: string;
        message: string;
    } | null;
    displayName?: string;
    rawText?: string;
    summary?: string;
}
export interface ScheduleTimeContract {
    runAt?: string | null;
    cron?: string | null;
    timezone: string;
    missedPolicy: ScheduleMissedPolicy;
}
export interface SchedulePayloadContract {
    kind: SchedulePayloadKind;
    literalText?: string | null;
    toolName?: string | null;
    toolParams?: JsonObject | null;
    taskContract?: IntentContract | null;
    artifactId?: string | null;
}
export interface ScheduleContract {
    schemaVersion: ContractSchemaVersion;
    kind: ScheduleKind;
    time: ScheduleTimeContract;
    payload: SchedulePayloadContract;
    delivery: DeliveryContract;
    source?: {
        originRunId?: string;
        originRequestGroupId?: string;
        createdBy?: string;
    };
    displayName?: string;
    rawText?: string;
    summary?: string;
}
export type ContractValidationErrorCode = "contract_validation_failed" | "unsupported_contract_version" | "unknown_contract_action";
export interface ContractValidationIssue {
    path: string;
    code: ContractValidationErrorCode;
    message: string;
}
export type ContractValidationResult<T> = {
    ok: true;
    value: T;
    issues: [];
} | {
    ok: false;
    issues: ContractValidationIssue[];
};
export declare const CANONICAL_JSON_POLICY: {
    readonly keyOrder: "Object keys are sorted lexicographically at every depth.";
    readonly arrayOrder: "Array order is preserved because order can be semantically meaningful.";
    readonly undefinedPolicy: "undefined values are omitted.";
    readonly nullPolicy: "null values are omitted in identity/hash projections.";
    readonly emptyStringPolicy: "empty strings are omitted in identity/hash projections.";
    readonly emptyArrayPolicy: "empty arrays are omitted in identity/hash projections.";
};
interface CanonicalizeOptions {
    omitKeys?: ReadonlySet<string>;
    dropNulls?: boolean;
    dropEmptyStrings?: boolean;
    dropEmptyArrays?: boolean;
}
export declare function validateToolTargetContract(value: unknown): ContractValidationResult<ToolTargetContract>;
export declare function validateDeliveryContract(value: unknown): ContractValidationResult<DeliveryContract>;
export declare function validateIntentContract(value: unknown): ContractValidationResult<IntentContract>;
export declare function validateScheduleContract(value: unknown): ContractValidationResult<ScheduleContract>;
export declare function toCanonicalJson(value: unknown, options?: CanonicalizeOptions): string;
export declare function stableContractHash(value: unknown, namespace?: string): string;
export declare function buildSchedulePayloadProjection(payload: SchedulePayloadContract): JsonObject;
export declare function buildToolTargetProjection(target: ToolTargetContract): JsonObject;
export declare function buildDeliveryProjection(delivery: DeliveryContract): JsonObject;
export declare function buildScheduleIdentityProjection(contract: ScheduleContract): JsonObject;
export declare function buildPayloadHash(payload: SchedulePayloadContract): string;
export declare function buildDeliveryKey(delivery: DeliveryContract): string;
export declare function buildScheduleIdentityKey(contract: ScheduleContract): string;
export declare function buildDeliveryDedupeKey(params: {
    scheduleId: string;
    dueAt: string | number;
    delivery: DeliveryContract;
    payloadHash: string;
}): string;
export declare function formatContractValidationFailureForUser(issues: ContractValidationIssue[]): string;
export {};
//# sourceMappingURL=index.d.ts.map