import type { AgentPromptBundle, CommandRequest, ErrorReport, FeedbackRequest, ParallelSubSessionGroup, ProgressEvent, ResourceLockContract, ResultReport, SubSessionContract, SubSessionStatus } from "../contracts/sub-agent-orchestration.js";
import { type MessageLedgerEventInput } from "../runs/message-ledger.js";
import { type SubAgentResultReview } from "../agent/sub-agent-result-review.js";
import { type SubSessionProgressAggregator } from "./sub-session-progress-aggregation.js";
export interface SubSessionRuntimeAgentSnapshot {
    agentId: string;
    displayName: string;
    nickname?: string;
}
export interface RunSubSessionInput {
    command: CommandRequest;
    agent: SubSessionRuntimeAgentSnapshot;
    parentSessionId: string;
    promptBundle: AgentPromptBundle;
    timeoutMs?: number;
    parentAbortSignal?: AbortSignal;
}
export interface SubSessionExecutionControls {
    signal: AbortSignal;
    emitProgress: (summary: string, status?: SubSessionStatus) => Promise<ProgressEvent>;
}
export type SubSessionExecutionHandler = (input: RunSubSessionInput, controls: SubSessionExecutionControls) => Promise<ResultReport> | ResultReport;
export interface SubSessionRunOutcome {
    subSession: SubSessionContract;
    status: SubSessionStatus;
    replayed: boolean;
    resultReport?: ResultReport;
    errorReport?: ErrorReport;
    review?: SubAgentResultReview;
    feedbackRequest?: FeedbackRequest;
}
export interface SubSessionRuntimeDependencies {
    now?: () => number;
    idProvider?: () => string;
    loadSubSessionByIdempotencyKey?: (idempotencyKey: string) => Promise<SubSessionContract | undefined> | SubSessionContract | undefined;
    persistSubSession?: (subSession: SubSessionContract) => Promise<boolean> | boolean;
    updateSubSession?: (subSession: SubSessionContract) => Promise<void> | void;
    appendParentEvent?: (parentRunId: string, label: string) => Promise<void> | void;
    isParentCancelled?: (parentRunId: string) => Promise<boolean> | boolean;
    deliverResultToUser?: (result: ResultReport) => Promise<void> | void;
    progressAggregator?: SubSessionProgressAggregator;
    recordLedgerEvent?: (input: MessageLedgerEventInput) => string | null;
    reviewResultReport?: (params: {
        input: RunSubSessionInput;
        resultReport: ResultReport;
        subSession: SubSessionContract;
    }) => Promise<SubAgentResultReview> | SubAgentResultReview;
}
export interface SubSessionWorkItem {
    taskId: string;
    subSessionId: string;
    resourceLocks?: ResourceLockContract[];
    dependencies?: string[];
    run: () => Promise<SubSessionRunOutcome> | SubSessionRunOutcome;
}
export interface SubSessionExecutionWave {
    waveIndex: number;
    items: SubSessionWorkItem[];
    reasonCodes: string[];
    waitReasonCodesByTask?: Record<string, string[]>;
}
export interface ParallelSubSessionGroupRunResult {
    groupId: string;
    status: "completed" | "failed" | "blocked";
    waves: Array<{
        waveIndex: number;
        taskIds: string[];
        subSessionIds: string[];
        reasonCodes: string[];
    }>;
    outcomes: SubSessionRunOutcome[];
    skipped: Array<{
        taskId: string;
        subSessionId: string;
        reasonCode: string;
    }>;
}
export interface ParallelSubSessionGroupRunOptions {
    now?: () => number;
    runId?: string;
    sessionId?: string;
    requestGroupId?: string;
    source?: string;
    appendParentEvent?: (parentRunId: string, label: string) => Promise<void> | void;
}
export interface SubSessionRecoveryDecision {
    subSessionId: string;
    previousStatus: SubSessionStatus;
    nextStatus: SubSessionStatus;
    action: "unchanged" | "mark_failed";
    reasonCode: string;
}
export interface SubSessionRecoveryResult {
    decisions: SubSessionRecoveryDecision[];
    updatedSubSessions: SubSessionContract[];
}
export declare function buildSubSessionContract(input: RunSubSessionInput): SubSessionContract;
export declare class ResourceLockManager {
    private readonly holders;
    canAcquire(locks: ResourceLockContract[]): {
        ok: boolean;
        conflicts: ResourceLockContract[];
    };
    acquire(holderId: string, locks: ResourceLockContract[]): {
        ok: boolean;
        conflicts: ResourceLockContract[];
    };
    release(holderId: string): void;
    private lockKey;
}
export declare function planSubSessionExecutionWaves(items: SubSessionWorkItem[], group?: Pick<ParallelSubSessionGroup, "dependencyEdges" | "concurrencyLimit">): SubSessionExecutionWave[];
export declare class SubSessionRunner {
    private readonly now;
    private readonly idProvider;
    private readonly dependencies;
    private readonly customReviewResultReport;
    private readonly progressAggregator;
    private readonly recordLedgerEvent;
    private readonly activeControllers;
    private readonly firstProgressRecorded;
    constructor(dependencies?: SubSessionRuntimeDependencies);
    runSubSession(input: RunSubSessionInput, handler: SubSessionExecutionHandler): Promise<SubSessionRunOutcome>;
    cancelParentRun(parentRunId: string): number;
    private cancelBeforeStart;
    private markCancelled;
    private recordSubSessionProgress;
    private flushProgressBatch;
    private publishProgressBatch;
    private recordSubSessionLifecycleEvent;
    private changeStatus;
    private reviewResultReport;
    private runWithTimeout;
}
export declare function runParallelSubSessionGroup(group: Pick<ParallelSubSessionGroup, "groupId" | "dependencyEdges" | "concurrencyLimit">, items: SubSessionWorkItem[], options?: ParallelSubSessionGroupRunOptions): Promise<ParallelSubSessionGroupRunResult>;
export declare function classifySubSessionRecovery(subSession: SubSessionContract): SubSessionRecoveryDecision;
export declare function recoverInterruptedSubSessions(input: {
    subSessions: SubSessionContract[];
    updateSubSession: (subSession: SubSessionContract) => Promise<void> | void;
    appendParentEvent?: (parentRunId: string, label: string) => Promise<void> | void;
    now?: () => number;
}): Promise<SubSessionRecoveryResult>;
export declare function createSubSessionRunner(dependencies?: SubSessionRuntimeDependencies): SubSessionRunner;
export declare function createTextResultReport(input: {
    command: CommandRequest;
    idProvider?: () => string;
    status?: ResultReport["status"];
    text?: string;
    risksOrGaps?: string[];
}): ResultReport;
//# sourceMappingURL=sub-session-runner.d.ts.map