import { applyLoopEntryPassResult } from "./loop-pass-application.js";
import { runLoopEntryPass } from "./loop-entry-pass.js";
import type { LoopDirective } from "./loop-directive.js";
import { prepareRootExecutionCyclePassLaunch, prepareRootLoopEntryPassLaunch } from "./root-loop-pass-launch.js";
import { runExecutionCyclePass, type ExecutionCycleState } from "./execution-cycle-pass.js";
import type { RunChunkDeliveryHandler } from "./delivery.js";
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js";
import type { RecoveryBudgetUsage } from "./recovery-budget.js";
import type { TaskProfile } from "./types.js";
import type { AgentContextMode } from "../agent/index.js";
import type { TaskExecutionSemantics, TaskStructuredRequest } from "../agent/intake.js";
import type { SyntheticApprovalRuntimeDependencies } from "./approval.js";
export interface RootLoopTurnDependencies {
    appendRunEvent: (runId: string, message: string) => void;
    updateRunSummary: (runId: string, summary: string) => void;
    setRunStepStatus: (runId: string, step: string, status: "pending" | "running" | "completed" | "failed" | "cancelled", summary: string) => void;
    updateRunStatus: (runId: string, status: "queued" | "running" | "awaiting_approval" | "awaiting_user" | "completed" | "failed" | "cancelled" | "interrupted", summary: string, active: boolean) => void;
    rememberRunFailure: (params: {
        runId: string;
        sessionId: string;
        source: FinalizationSource;
        summary: string;
        detail?: string;
        title?: string;
    }) => void;
    incrementDelegationTurnCount: (runId: string, summary: string) => void;
    markAbortedRunCancelledIfActive: (runId: string) => void;
    getDelegationTurnState: () => {
        usedTurns: number;
        maxTurns: number;
    };
    getFinalizationDependencies: () => FinalizationDependencies;
    insertMessage: typeof import("../db/index.js").insertMessage;
    writeReplyLog: typeof import("./delivery.js").logAssistantReply;
    createId: () => string;
    now: () => number;
    runVerificationSubtask: () => Promise<{
        ok: boolean;
        summary: string;
        reason?: string;
        remainingItems?: string[];
    }>;
    rememberRunApprovalScope: (runId: string) => void;
    grantRunApprovalScope: (runId: string) => void;
    grantRunSingleApproval: (runId: string) => void;
    onDeliveryError?: (message: string) => void;
    onReviewError?: (message: string) => void;
    executeLoopDirective: (directive: LoopDirective) => Promise<"break">;
    tryHandleActiveQueueCancellation: () => Promise<LoopDirective | null>;
    tryHandleIntakeBridge: (currentMessage: string) => Promise<LoopDirective | null>;
    getSyntheticApprovalAlreadyApproved: () => boolean;
}
interface RootLoopTurnModuleDependencies {
    prepareRootLoopEntryPassLaunch: typeof prepareRootLoopEntryPassLaunch;
    runLoopEntryPass: typeof runLoopEntryPass;
    applyLoopEntryPassResult: typeof applyLoopEntryPassResult;
    prepareRootExecutionCyclePassLaunch: typeof prepareRootExecutionCyclePassLaunch;
    runExecutionCyclePass: typeof runExecutionCyclePass;
}
export interface RootLoopTurnParams {
    runId: string;
    sessionId: string;
    requestGroupId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    signal: AbortSignal;
    abortExecutionStream: () => void;
    pendingLoopDirective: LoopDirective | null;
    intakeProcessed: boolean;
    state: ExecutionCycleState;
    recoveryBudgetUsage: RecoveryBudgetUsage;
    executionSemantics: TaskExecutionSemantics;
    originalRequest: string;
    structuredRequest?: TaskStructuredRequest;
    requestMessage: string;
    workDir: string;
    toolsEnabled?: boolean;
    isRootRequest: boolean;
    contextMode: AgentContextMode;
    taskProfile: TaskProfile;
    workerSessionId?: string;
    wantsDirectArtifactDelivery: boolean;
    requiresFilesystemMutation: boolean;
    requiresPrivilegedToolExecution: boolean;
    pendingToolParams: Map<string, unknown>;
    filesystemMutationPaths: Set<string>;
    seenFollowupPrompts: Set<string>;
    seenCommandFailureRecoveryKeys: Set<string>;
    seenExecutionRecoveryKeys: Set<string>;
    seenDeliveryRecoveryKeys: Set<string>;
    seenAiRecoveryKeys: Set<string>;
    priorAssistantMessages: string[];
    syntheticApprovalRuntimeDependencies: SyntheticApprovalRuntimeDependencies;
    defaultMaxDelegationTurns: number;
}
export type RootLoopTurnResult = {
    kind: "break";
} | {
    kind: "continue";
    pendingLoopDirective: LoopDirective | null;
    intakeProcessed: boolean;
    state: ExecutionCycleState;
};
export declare function runRootLoopTurn(params: RootLoopTurnParams, dependencies: RootLoopTurnDependencies, moduleDependencies?: RootLoopTurnModuleDependencies): Promise<RootLoopTurnResult>;
export {};
//# sourceMappingURL=root-loop-turn.d.ts.map