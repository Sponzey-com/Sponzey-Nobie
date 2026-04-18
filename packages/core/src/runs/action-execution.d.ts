import type { TaskExecutionSemantics, TaskIntakeActionItem, TaskIntakeResult, TaskIntentEnvelope, TaskStructuredRequest } from "../agent/intake.js";
import { type ScheduleExecutionDriver } from "../scheduler/system-cron.js";
import type { AgentContextMode } from "../agent/index.js";
import type { RunChunkDeliveryHandler } from "./delivery.js";
import type { TaskProfile } from "./types.js";
export interface ScheduleActionExecutionResult {
    ok: boolean;
    message: string;
    detail: string;
    successCount: number;
    failureCount: number;
    receipts: ScheduleActionReceipt[];
}
export type ScheduleActionReceipt = {
    kind: "schedule_create_one_time";
    title: string;
    task: string;
    runAtMs: number;
    scheduleText: string;
    source: "webui" | "cli" | "telegram" | "slack";
    destination: string;
    taskProfile: TaskProfile;
    directDelivery: boolean;
    preferredTarget: string;
    immediateCompletionText?: string;
} | {
    kind: "schedule_create_recurring";
    scheduleId: string;
    title: string;
    task: string;
    cron: string;
    scheduleText: string;
    timezone?: string;
    source: "webui" | "cli" | "telegram" | "slack";
    targetSessionId?: string;
    originRunId: string;
    originRequestGroupId: string;
    driver: ScheduleExecutionDriver;
    driverReason?: string;
} | {
    kind: "schedule_cancel";
    cancelledScheduleIds: string[];
    cancelledNames: string[];
};
export interface ScheduleDelayedRunRequest {
    runAtMs: number;
    message: string;
    sessionId: string;
    originRunId?: string;
    originRequestGroupId?: string;
    model: string | undefined;
    originalRequest?: string;
    executionSemantics?: TaskExecutionSemantics;
    structuredRequest?: TaskStructuredRequest;
    intentEnvelope?: TaskIntentEnvelope;
    workDir?: string;
    source: "webui" | "cli" | "telegram" | "slack";
    onChunk: RunChunkDeliveryHandler | undefined;
    immediateCompletionText?: string;
    preferredTarget?: string;
    taskProfile?: TaskProfile;
    toolsEnabled?: boolean;
    contextMode?: AgentContextMode;
}
export interface ScheduleActionExecutionParams {
    runId: string;
    message: string;
    originalRequest: string;
    sessionId: string;
    requestGroupId: string;
    model: string | undefined;
    workDir?: string | undefined;
    source: "webui" | "cli" | "telegram" | "slack";
    onChunk: RunChunkDeliveryHandler | undefined;
}
export interface ScheduleActionDependencies {
    scheduleDelayedRun: (params: ScheduleDelayedRunRequest) => void;
    createRecurringSchedule: (params: {
        title: string;
        task: string;
        cron: string;
        timezone?: string;
        source: "webui" | "cli" | "telegram" | "slack";
        sessionId: string;
        originRunId: string;
        originRequestGroupId: string;
        model: string | undefined;
    }) => {
        scheduleId: string;
        targetSessionId?: string;
        driver: ScheduleExecutionDriver;
        reason?: string | undefined;
        duplicate?: {
            scheduleId: string;
            title: string;
            decisionSource: "contract_key";
        };
    };
    cancelSchedules: (scheduleIds: string[]) => string[];
}
export declare function createDefaultScheduleActionDependencies(overrides: Pick<ScheduleActionDependencies, "scheduleDelayedRun">): ScheduleActionDependencies;
export declare function inferDelegatedTaskProfile(params: {
    intake: TaskIntakeResult;
    action: TaskIntakeActionItem;
}): string;
export declare function buildFollowupPrompt(params: {
    originalMessage: string;
    intake: TaskIntakeResult;
    action: TaskIntakeActionItem;
    taskProfile: string;
}): string;
export declare function executeScheduleActions(actions: TaskIntakeActionItem[], intake: TaskIntakeResult, params: ScheduleActionExecutionParams, dependencies: ScheduleActionDependencies): ScheduleActionExecutionResult;
//# sourceMappingURL=action-execution.d.ts.map