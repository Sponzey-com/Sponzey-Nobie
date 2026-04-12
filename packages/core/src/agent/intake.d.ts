import type { IntakeNormalizedRequest } from "./request-normalizer.js";
export type TaskApprovalToolName = "screen_capture" | "yeonjang_camera_capture" | "mouse_click" | "keyboard_type" | "file_write" | "app_launch" | "external_action";
export interface TaskExecutionSemantics {
    filesystemEffect: "none" | "mutate";
    privilegedOperation: "none" | "required";
    artifactDelivery: "none" | "direct";
    approvalRequired: boolean;
    approvalTool: TaskApprovalToolName;
}
export type TaskStructuredRequestLanguage = "ko" | "en" | "mixed" | "unknown";
export interface TaskStructuredRequest {
    source_language: TaskStructuredRequestLanguage;
    normalized_english: string;
    target: string;
    to: string;
    context: string[];
    complete_condition: string[];
}
interface StructuredRequestEnvironment {
    destination: string;
    contextLines: string[];
}
export interface TaskIntakeIntent {
    category: "direct_answer" | "task_intake" | "schedule_request" | "clarification" | "reject";
    summary: string;
    confidence: number;
}
export interface TaskIntakeUserMessage {
    mode: "direct_answer" | "accepted_receipt" | "failed_receipt" | "clarification_receipt";
    text: string;
}
export interface TaskIntakeActionItem {
    id: string;
    type: "reply" | "run_task" | "delegate_agent" | "create_schedule" | "update_schedule" | "cancel_schedule" | "ask_user" | "log_only";
    title: string;
    priority: "low" | "normal" | "high" | "urgent";
    reason: string;
    payload: Record<string, unknown>;
}
export interface TaskSchedulingSpec {
    detected: boolean;
    kind: "one_time" | "recurring" | "none";
    status: "accepted" | "failed" | "needs_clarification" | "not_applicable";
    schedule_text: string;
    cron?: string;
    run_at?: string;
    failure_reason?: string;
}
export interface TaskExecutionPlan {
    requires_run: boolean;
    requires_delegation: boolean;
    suggested_target: string;
    max_delegation_turns: number;
    needs_tools: boolean;
    needs_web: boolean;
    execution_semantics: TaskExecutionSemantics;
}
export interface TaskIntentEnvelope {
    intent_type: TaskIntakeIntent["category"];
    source_language: TaskStructuredRequestLanguage;
    normalized_english: string;
    target: string;
    destination: string;
    context: string[];
    complete_condition: string[];
    schedule_spec: TaskSchedulingSpec;
    execution_semantics: TaskExecutionSemantics;
    delivery_mode: TaskExecutionSemantics["artifactDelivery"];
    requires_approval: boolean;
    approval_tool: TaskApprovalToolName;
    preferred_target: string;
    needs_tools: boolean;
    needs_web: boolean;
}
export interface TaskIntakeResult {
    intent: TaskIntakeIntent;
    user_message: TaskIntakeUserMessage;
    action_items: TaskIntakeActionItem[];
    structured_request: TaskStructuredRequest;
    intent_envelope: TaskIntentEnvelope;
    scheduling: TaskSchedulingSpec;
    execution: TaskExecutionPlan;
    notes: string[];
}
export declare function defaultTaskExecutionSemantics(): TaskExecutionSemantics;
export declare function defaultTaskStructuredRequest(): TaskStructuredRequest;
export declare function parseTaskExecutionSemantics(value: unknown): TaskExecutionSemantics;
export declare function promotePromissoryDirectAnswer(result: TaskIntakeResult, latestUserMessage: string): TaskIntakeResult;
export declare function analyzeTaskIntake(params: {
    userMessage: string;
    sessionId?: string;
    requestGroupId?: string;
    model?: string;
    workDir?: string;
    source?: "webui" | "cli" | "telegram" | "slack";
}): Promise<TaskIntakeResult | null>;
export declare function detectRelativeScheduleRequest(userMessage: string, now?: number, maxDelegationTurns?: number, environment?: StructuredRequestEnvironment, originalUserMessage?: string, normalized?: IntakeNormalizedRequest): TaskIntakeResult | null;
export {};
//# sourceMappingURL=intake.d.ts.map