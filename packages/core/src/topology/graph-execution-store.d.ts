import type Database from "better-sqlite3";
import { type RecoveryStrategyAttempt, type RecoveryStrategyKey } from "../runs/recovery-strategy-ledger.js";
import type { GraphExecutionPlan } from "./graph-execution-plan.js";
import { type GraphExecutionEvent, type GraphExecutionOutcome } from "./graph-execution-runner.js";
export interface GraphExecutionPlanRecord {
    graphExecutionPlanId: string;
    topologyId: string;
    workspaceId: string;
    status: GraphExecutionOutcome["status"] | "planned";
    plan: GraphExecutionPlan;
    outcome: GraphExecutionOutcome | null;
    createdAt: number;
    updatedAt: number;
}
export interface GraphExecutionEventRecord {
    eventId: string;
    graphExecutionPlanId: string;
    eventType: string;
    executorId?: string;
    edgeId?: string;
    status?: string;
    terminalReason?: string;
    recoveryReason?: string;
    cancellationReason?: string;
    event: GraphExecutionEvent;
    at: number;
    sequence: number;
}
export interface RecoveryStrategyLedgerRecord {
    attemptId: string;
    graphExecutionPlanId: string;
    scopeId: string;
    strategyFingerprint: string;
    reason: string;
    accepted: boolean;
    attempt: RecoveryStrategyAttempt;
    createdAt: number;
}
export declare function persistGraphExecutionPlan(input: {
    db?: Database.Database;
    plan: GraphExecutionPlan;
    outcome?: GraphExecutionOutcome;
    now?: number;
}): GraphExecutionPlanRecord;
export declare function persistGraphExecutionEvents(input: {
    db?: Database.Database;
    graphExecutionPlanId: string;
    events: GraphExecutionEvent[];
}): GraphExecutionEventRecord[];
export declare function persistRecoveryStrategyAttempt(input: {
    db?: Database.Database;
    graphExecutionPlanId: string;
    scopeId: string;
    key: RecoveryStrategyKey;
    reason: string;
    accepted?: boolean;
    now?: number;
}): RecoveryStrategyLedgerRecord;
export declare function getGraphExecutionPlan(graphExecutionPlanId: string, options?: {
    db?: Database.Database;
}): GraphExecutionPlanRecord | null;
export declare function listGraphExecutionEvents(graphExecutionPlanId: string, options?: {
    db?: Database.Database;
    limit?: number;
}): GraphExecutionEventRecord[];
//# sourceMappingURL=graph-execution-store.d.ts.map