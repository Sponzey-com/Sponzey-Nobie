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
export interface TaskIntakeResult {
    intent: TaskIntakeIntent;
    user_message: TaskIntakeUserMessage;
    action_items: TaskIntakeActionItem[];
    scheduling: {
        detected: boolean;
        kind: "one_time" | "recurring" | "none";
        status: "accepted" | "failed" | "needs_clarification" | "not_applicable";
        schedule_text: string;
        cron?: string;
        run_at?: string;
        failure_reason?: string;
    };
    execution: {
        requires_run: boolean;
        requires_delegation: boolean;
        suggested_target: string;
        max_delegation_turns: number;
        needs_tools: boolean;
        needs_web: boolean;
    };
    notes: string[];
}
export declare function analyzeTaskIntake(params: {
    userMessage: string;
    sessionId?: string;
    requestGroupId?: string;
    model?: string;
    workDir?: string;
}): Promise<TaskIntakeResult | null>;
export declare function detectRelativeScheduleRequest(userMessage: string, now?: number, maxDelegationTurns?: number): TaskIntakeResult | null;
//# sourceMappingURL=intake.d.ts.map