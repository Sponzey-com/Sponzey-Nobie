import { type ScheduleContract } from "../contracts/index.js";
import { type DbSchedule } from "../db/index.js";
import { runAgent } from "../agent/index.js";
import type { ToolContext, ToolResult } from "../tools/types.js";
export interface ScheduledExecutionResult {
    success: boolean;
    summary: string | null;
    error: string | null;
    executionSuccess?: boolean | null;
    deliverySuccess?: boolean | null;
    deliveryDedupeKey?: string | null;
    deliveryError?: string | null;
}
export type ScheduleContractExecutionResult = {
    handled: false;
} | {
    handled: true;
    result: ScheduledExecutionResult;
};
export interface ScheduleContractExecutorDependencies {
    runAgentImpl?: typeof runAgent;
    dispatchTool?: (name: string, params: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
    deliverTelegramText?: (sessionId: string, text: string) => Promise<unknown>;
    deliverSlackText?: (sessionId: string, text: string) => Promise<unknown>;
    deliverSlackFile?: (sessionId: string, filePath: string, caption?: string) => Promise<unknown>;
    logInfo?: (message: string, payload?: Record<string, unknown>) => void;
    logWarn?: (message: string) => void;
    logError?: (message: string, payload?: Record<string, unknown>) => void;
}
interface ExecuteScheduleContractInput {
    schedule: DbSchedule;
    scheduleRunId: string;
    trigger: string;
    startedAt: number;
    dependencies?: ScheduleContractExecutorDependencies;
}
export declare function resolveScheduleDueAt(params: {
    trigger: string;
    scheduleRunId: string;
    startedAt: number;
}): string;
export declare function buildScheduledAgentExecutionBrief(params: {
    schedule: DbSchedule;
    contract: ScheduleContract;
    dueAt: string;
}): string;
export declare function executeScheduleContract(input: ExecuteScheduleContractInput): Promise<ScheduleContractExecutionResult>;
export {};
//# sourceMappingURL=contract-executor.d.ts.map