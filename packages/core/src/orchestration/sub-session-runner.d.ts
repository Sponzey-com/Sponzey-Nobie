import { type SubAgentResultReview, type SubAgentResultReviewIssue } from "../agent/sub-agent-result-review.js";
import { type AgentPromptBundle, type CommandRequest, type ErrorReport, type FeedbackRequest, type ModelExecutionSnapshot, type OrchestrationPlan, type ParallelSubSessionGroup, type ProgressEvent, type ResourceLockContract, type ResultReport, type ResultReportImpossibleReason, type SubSessionContract, type SubSessionStatus } from "../contracts/sub-agent-orchestration.js";
import { type MessageLedgerEventInput } from "../runs/message-ledger.js";
import { type ModelAvailabilityDoctorSnapshot, type ModelExecutionAuditSummary, type ProviderModelCapability } from "./model-execution-policy.js";
import { type SubSessionProgressAggregator } from "./sub-session-progress-aggregation.js";
export interface SubSessionRuntimeAgentSnapshot {
    agentId: string;
    displayName: string;
    nickname?: string;
}
export interface SubSessionParentAgentSnapshot {
    agentId: string;
    displayName?: string;
    nickname?: string;
}
export interface RunSubSessionInput {
    command: CommandRequest;
    agent: SubSessionRuntimeAgentSnapshot;
    parentAgent?: SubSessionParentAgentSnapshot;
    parentSessionId: string;
    promptBundle: AgentPromptBundle;
    timeoutMs?: number;
    parentAbortSignal?: AbortSignal;
    providerModelMatrix?: ProviderModelCapability[];
    modelAvailabilityDoctor?: ModelAvailabilityDoctorSnapshot | ModelAvailabilityDoctorSnapshot[];
    modelExecutionPolicy?: ModelExecutionSnapshot;
}
export interface SubSessionExecutionControls {
    signal: AbortSignal;
    modelExecution: ModelExecutionSnapshot;
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
    integrationSuppressed?: boolean;
    suppressionReasonCode?: string;
    modelExecution?: ModelExecutionAuditSummary;
}
export interface SubSessionReviewRuntimeEventInput {
    parentRunId: string;
    subSessionId: string;
    resultReportId: string;
    status: SubAgentResultReview["status"];
    verdict: SubAgentResultReview["verdict"];
    parentIntegrationStatus: SubAgentResultReview["parentIntegrationStatus"];
    accepted: boolean;
    issues: SubAgentResultReviewIssue[];
    normalizedFailureKey?: string;
    risksOrGaps: string[];
    impossibleReason?: ResultReportImpossibleReason;
}
export interface SubSessionRuntimeDependencies {
    now?: () => number;
    idProvider?: () => string;
    loadSubSessionByIdempotencyKey?: (idempotencyKey: string) => Promise<SubSessionContract | undefined> | SubSessionContract | undefined;
    persistSubSession?: (subSession: SubSessionContract) => Promise<boolean> | boolean;
    updateSubSession?: (subSession: SubSessionContract) => Promise<void> | void;
    appendParentEvent?: (parentRunId: string, label: string) => Promise<void> | void;
    isParentCancelled?: (parentRunId: string) => Promise<boolean> | boolean;
    isParentFinalized?: (parentRunId: string) => Promise<boolean> | boolean;
    deliverResultToUser?: (result: ResultReport) => Promise<void> | void;
    progressAggregator?: SubSessionProgressAggregator;
    recordLedgerEvent?: (input: MessageLedgerEventInput) => string | null;
    recordReviewEvent?: (input: SubSessionReviewRuntimeEventInput) => string | null;
    reviewResultReport?: (params: {
        input: RunSubSessionInput;
        resultReport: ResultReport;
        subSession: SubSessionContract;
    }) => Promise<SubAgentResultReview> | SubAgentResultReview;
}
export interface SubSessionWorkItem {
    taskId: string;
    subSessionId: string;
    agentId?: string;
    toolNames?: string[];
    mcpServerIds?: string[];
    estimatedCost?: number;
    estimatedDurationMs?: number;
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
    budget?: ParallelSubSessionBudgetDecision;
}
export interface SubSessionConcurrencyLimits {
    agentConcurrencyLimits?: Record<string, number>;
    toolConcurrencyLimits?: Record<string, number>;
    mcpServerConcurrencyLimits?: Record<string, number>;
    defaultAgentConcurrencyLimit?: number;
    defaultToolConcurrencyLimit?: number;
    defaultMcpServerConcurrencyLimit?: number;
}
export interface SubSessionExecutionPlanningOptions extends SubSessionConcurrencyLimits {
}
export interface ParallelSubSessionBudget {
    maxChildren?: number;
    maxEstimatedCost?: number;
    maxEstimatedDurationMs?: number;
}
export interface ParallelSubSessionBudgetDecision {
    status: "ok" | "shrunk" | "blocked";
    reasonCodes: string[];
    selectedTaskIds: string[];
    skipped: Array<{
        taskId: string;
        subSessionId: string;
        reasonCode: string;
    }>;
    totals: {
        childCount: number;
        estimatedCost: number;
        estimatedDurationMs: number;
    };
}
export interface ParallelSubSessionGroupRunOptions {
    now?: () => number;
    runId?: string;
    sessionId?: string;
    requestGroupId?: string;
    source?: string;
    appendParentEvent?: (parentRunId: string, label: string) => Promise<void> | void;
    parentAbortSignal?: AbortSignal;
    isParentCancelled?: (parentRunId: string) => Promise<boolean> | boolean;
    resourceLockWaitTimeoutMs?: number;
    budget?: ParallelSubSessionBudget;
    concurrency?: SubSessionConcurrencyLimits;
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
export interface SubSessionCascadeStopResult {
    parentRunId: string;
    affectedSubSessionIds: string[];
    reasonCode: "parent_run_cancelled";
}
export declare const SUB_SESSION_STATUS_TRANSITIONS: Readonly<Record<SubSessionStatus, readonly SubSessionStatus[]>>;
export declare class InvalidSubSessionStatusTransitionError extends Error {
    readonly from: SubSessionStatus;
    readonly to: SubSessionStatus;
    readonly subSessionId?: string;
    constructor(input: {
        from: SubSessionStatus;
        to: SubSessionStatus;
        subSessionId?: string;
    });
}
export declare function canTransitionSubSessionStatus(from: SubSessionStatus, to: SubSessionStatus): boolean;
export declare function transitionSubSessionStatus(subSession: SubSessionContract, status: SubSessionStatus, now: number): SubSessionContract;
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
export declare function planSubSessionExecutionWaves(items: SubSessionWorkItem[], group?: Pick<ParallelSubSessionGroup, "dependencyEdges" | "concurrencyLimit">, options?: SubSessionExecutionPlanningOptions): SubSessionExecutionWave[];
export declare function planOrchestrationExecutionWaves(plan: Pick<OrchestrationPlan, "dependencyEdges" | "parallelGroups">, items: SubSessionWorkItem[], options?: SubSessionExecutionPlanningOptions): SubSessionExecutionWave[];
export declare function applyParallelSubSessionBudget(items: SubSessionWorkItem[], budget?: ParallelSubSessionBudget): {
    items: SubSessionWorkItem[];
    decision: ParallelSubSessionBudgetDecision;
};
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
    cascadeStopParentRun(parentRunId: string): Promise<SubSessionCascadeStopResult>;
    private abortActiveChildren;
    private cancelBeforeStart;
    private markCancelled;
    private recordSubSessionProgress;
    private flushProgressBatch;
    private publishProgressBatch;
    private recordSubSessionLifecycleEvent;
    private changeStatus;
    private reviewResultReport;
    private executeWithModelPolicy;
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
export declare function createDryRunSubSessionHandler(input?: {
    text?: string;
    status?: ResultReport["status"];
    progressSummaries?: string[];
    risksOrGaps?: string[];
    impossibleReason?: ResultReportImpossibleReason;
}): SubSessionExecutionHandler;
export declare function loadSubSessionByIdempotencyKey(idempotencyKey: string): SubSessionContract | undefined;
export declare function createTextResultReport(input: {
    command: CommandRequest;
    idProvider?: () => string;
    status?: ResultReport["status"];
    text?: string;
    risksOrGaps?: string[];
    impossibleReason?: ResultReportImpossibleReason;
}): ResultReport;
//# sourceMappingURL=sub-session-runner.d.ts.map