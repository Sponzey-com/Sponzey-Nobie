import type { DbScheduleRun, TaskContinuitySnapshot } from "../db/index.js";
import type { RootRun, RunStatus } from "./types.js";
export type StartupRecoveryStatus = "awaiting_approval" | "awaiting_user" | "pending_delivery" | "interrupted" | "delivered" | "stale";
export interface StartupRecoveryClassification {
    status: StartupRecoveryStatus;
    summary: string;
    pendingApprovals?: string[];
    pendingDelivery?: string[];
    nextRunStatus?: RunStatus;
    safeToAutoExecute: boolean;
    safeToAutoDeliver: boolean;
    requiresUserConfirmation: boolean;
    duplicateRisk: boolean;
}
export interface StartupRecoveryRunSummary {
    runId: string;
    lineageRootRunId: string;
    previousStatus: RunStatus;
    recoveryStatus: StartupRecoveryStatus;
    nextRunStatus?: RunStatus;
    summary: string;
    pendingApprovals: string[];
    pendingDelivery: string[];
    duplicateRisk: boolean;
}
export interface StartupRecoveryScheduleSummary {
    scheduleId: string;
    scheduleRunId: string;
    startedAt: number;
    recoveryStatus: "interrupted";
    summary: string;
}
export interface StartupRecoverySummary {
    createdAt: number;
    totalActiveRuns: number;
    recoveredRunCount: number;
    interruptedRunCount: number;
    awaitingApprovalCount: number;
    pendingDeliveryCount: number;
    deliveredCount: number;
    staleCount: number;
    interruptedScheduleRunCount: number;
    runs: StartupRecoveryRunSummary[];
    schedules: StartupRecoveryScheduleSummary[];
    userFacingSummary: string;
}
export declare function classifyStartupRecovery(run: RootRun, continuity?: TaskContinuitySnapshot): StartupRecoveryClassification;
export declare function summarizeInterruptedScheduleRun(row: DbScheduleRun): StartupRecoveryScheduleSummary;
export declare function buildStartupRecoverySummary(input: {
    runs: StartupRecoveryRunSummary[];
    schedules: StartupRecoveryScheduleSummary[];
    createdAt?: number;
}): StartupRecoverySummary;
export declare function setLastStartupRecoverySummary(summary: StartupRecoverySummary): void;
export declare function getLastStartupRecoverySummary(): StartupRecoverySummary;
//# sourceMappingURL=startup-recovery.d.ts.map