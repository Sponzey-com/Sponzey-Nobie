import type { OrchestrationMode, OrchestrationPlan, SubSessionContract } from "../contracts/sub-agent-orchestration.js";
export type RunStatus = "queued" | "running" | "awaiting_approval" | "awaiting_user" | "completed" | "failed" | "cancelled" | "interrupted";
export type RunStepStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type RunContextMode = "full" | "isolated" | "request_group" | "handoff";
export type RunScope = "root" | "child" | "analysis";
export type TaskProfile = "general_chat" | "planning" | "coding" | "review" | "research" | "private_local" | "summarization" | "operations";
export interface RootRun {
    id: string;
    sessionId: string;
    requestGroupId: string;
    lineageRootRunId: string;
    runScope: RunScope;
    parentRunId?: string;
    handoffSummary?: string;
    title: string;
    prompt: string;
    source: "webui" | "cli" | "telegram" | "slack";
    status: RunStatus;
    taskProfile: TaskProfile;
    targetId?: string;
    targetLabel?: string;
    workerRuntimeKind?: string;
    workerSessionId?: string;
    contextMode: RunContextMode;
    promptSourceSnapshot?: Record<string, unknown>;
    orchestrationMode?: OrchestrationMode;
    orchestrationPlanSnapshot?: OrchestrationPlan;
    subSessionIds?: string[];
    subSessionsSnapshot?: SubSessionContract[];
    agentDisplayName?: string;
    agentNickname?: string;
    runtimeManifestId?: string;
    delegationTurnCount: number;
    maxDelegationTurns: number;
    currentStepKey: string;
    currentStepIndex: number;
    totalSteps: number;
    summary: string;
    canCancel: boolean;
    createdAt: number;
    updatedAt: number;
    steps: RunStep[];
    recentEvents: RunEvent[];
}
export interface RunStep {
    key: string;
    title: string;
    index: number;
    status: RunStepStatus;
    startedAt?: number;
    finishedAt?: number;
    summary: string;
}
export interface RunEvent {
    id: string;
    at: number;
    label: string;
}
export interface RunProgressSnapshot {
    runId: string;
    status: RunStatus;
    currentStep: RunStep;
    totalSteps: number;
    targetId?: string;
    targetLabel?: string;
    workerSessionId?: string;
    contextMode: RunContextMode;
    orchestrationMode?: OrchestrationMode;
    subSessionIds?: string[];
    summary: string;
    recentEvents: RunEvent[];
    canCancel: boolean;
}
export declare const DEFAULT_RUN_STEPS: Array<{
    key: string;
    title: string;
}>;
//# sourceMappingURL=types.d.ts.map