export type TaskIntakeIntentCategory = "direct_answer" | "task_intake" | "schedule_request" | "clarification" | "reject";
export type TaskIntakeMessageMode = "direct_answer" | "accepted_receipt" | "failed_receipt" | "clarification_receipt";
export type TaskIntakeActionType = "reply" | "run_task" | "delegate_agent" | "create_schedule" | "update_schedule" | "cancel_schedule" | "ask_user" | "log_only";
export type TaskIntakePriority = "low" | "normal" | "high" | "urgent";
export type TaskIntakeTaskProfile = "general_chat" | "planning" | "coding" | "review" | "research" | "private_local" | "summarization" | "operations";
export interface TaskIntakePromptOptions {
    maxDelegationTurns?: number;
}
export declare function buildTaskIntakeSystemPrompt(options?: TaskIntakePromptOptions): string;
//# sourceMappingURL=intake-prompt.d.ts.map