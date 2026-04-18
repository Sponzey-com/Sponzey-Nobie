import type { SourceFreshnessPolicy, WebRetrievalMethod, WebRetrievalPolicyDecision } from "./web-retrieval-policy.js";
export type RetrievalSourceMethod = WebRetrievalMethod | "known_source_adapter" | "ai_assisted_planner";
export type RetrievalSessionStatus = "created" | "discovering_sources" | "fetching_sources" | "extracting_candidates" | "verifying_candidates" | "planning_next_attempt" | "answer_ready" | "limited_complete" | "blocked" | "delivered";
export type RetrievalAttemptStatus = "planned" | "started" | "succeeded" | "failed" | "skipped";
export type RetrievalTargetKind = "unknown" | "finance_index" | "weather_current" | "general_latest" | "general_web";
export interface RetrievalTargetContract {
    targetId: string;
    kind: RetrievalTargetKind;
    rawQuery?: string | null;
    canonicalName?: string | null;
    symbols?: string[];
    market?: string | null;
    locationName?: string | null;
    locale?: string | null;
}
export interface RetrievalAttempt {
    id: string;
    method: RetrievalSourceMethod;
    status: RetrievalAttemptStatus;
    dedupeKey: string;
    toolName?: string | null;
    sourceUrl?: string | null;
    sourceDomain?: string | null;
    errorKind?: string | null;
    stopReason?: string | null;
    startedAt: string;
    finishedAt?: string | null;
    detail?: Record<string, unknown>;
}
export interface RetrievalBudget {
    softBudgetMs: number;
    hardBudgetMs: number;
    searchQueryVariants: number;
    distinctSourceDomains: number;
    directFetchAttempts: number;
    browserSearchAttempts: number;
    aiPlannerCalls: number;
}
export interface RetrievalSession {
    id: string;
    runId?: string | null;
    requestGroupId?: string | null;
    sessionKey?: string | null;
    targetContract: RetrievalTargetContract;
    freshnessPolicy: SourceFreshnessPolicy;
    status: RetrievalSessionStatus;
    budget: RetrievalBudget;
    createdAt: string;
    updatedAt: string;
    attempts: RetrievalAttempt[];
    controlEventIds: string[];
    plannerAvailable: boolean;
    plannerUnavailableReason?: string | null;
    stopReason?: string | null;
}
export interface RetrievalSessionControllerInput {
    id?: string;
    runId?: string | null;
    requestGroupId?: string | null;
    sessionKey?: string | null;
    targetContract: RetrievalTargetContract;
    freshnessPolicy: SourceFreshnessPolicy;
    budget?: Partial<RetrievalBudget>;
    plannerAvailable?: boolean;
    plannerUnavailableReason?: string | null;
    now?: Date;
    recordControlEvents?: boolean;
}
export interface RecordRetrievalAttemptInput {
    method: RetrievalSourceMethod;
    status?: RetrievalAttemptStatus;
    dedupeKey?: string;
    toolName?: string | null;
    sourceUrl?: string | null;
    sourceDomain?: string | null;
    errorKind?: string | null;
    stopReason?: string | null;
    detail?: Record<string, unknown>;
    now?: Date;
}
export interface LimitedCompletionReadiness {
    ok: boolean;
    reasons: string[];
    nextMethods: RetrievalSourceMethod[];
}
export interface RetrievalSessionDirective {
    session: RetrievalSession;
    nextMethods: RetrievalSourceMethod[];
    limitedCompletion: LimitedCompletionReadiness;
    directive: string;
}
export declare function createRetrievalTargetContract(input: {
    kind?: RetrievalTargetKind;
    rawQuery?: string | null;
    canonicalName?: string | null;
    symbols?: string[];
    market?: string | null;
    locationName?: string | null;
    locale?: string | null;
}): RetrievalTargetContract;
export declare function buildRetrievalDedupeKey(input: {
    method: RetrievalSourceMethod;
    freshnessPolicy: SourceFreshnessPolicy;
    query?: string | null;
    sourceUrl?: string | null;
    sourceDomain?: string | null;
    params?: Record<string, unknown> | null;
}): string;
export declare function defaultRetrievalBudget(input?: Partial<RetrievalBudget>): RetrievalBudget;
export declare function defaultSourceLadder(_target: RetrievalTargetContract, freshnessPolicy: SourceFreshnessPolicy): RetrievalSourceMethod[];
export declare class RetrievalSessionController {
    private session;
    private readonly recordControlEvents;
    constructor(input: RetrievalSessionControllerInput);
    snapshot(): RetrievalSession;
    canAttempt(dedupeKey: string): boolean;
    transition(status: RetrievalSessionStatus, reason: string, detail?: Record<string, unknown>, now?: Date): RetrievalSession;
    recordAttempt(input: RecordRetrievalAttemptInput): RetrievalAttempt;
    nextMethods(): RetrievalSourceMethod[];
    limitedCompletionReadiness(): LimitedCompletionReadiness;
    isRecoverable(): boolean;
    private recordEvent;
}
export declare function createRetrievalSessionController(input: RetrievalSessionControllerInput): RetrievalSessionController;
export declare function getNextRetrievalMethods(session: RetrievalSession): RetrievalSourceMethod[];
export declare function evaluateLimitedCompletionReadiness(session: RetrievalSession): LimitedCompletionReadiness;
export declare function isRetrievalSessionRecoverable(session: RetrievalSession): boolean;
export declare function buildRetrievalSessionDirective(input: {
    policy: WebRetrievalPolicyDecision;
    targetContract: RetrievalTargetContract;
    method?: RetrievalSourceMethod;
    sourceUrl?: string | null;
    sourceDomain?: string | null;
    runId?: string | null;
    requestGroupId?: string | null;
    sessionKey?: string | null;
    plannerAvailable?: boolean;
}): RetrievalSessionDirective;
export declare function createGenericTargetFromPolicy(input: {
    policy: WebRetrievalPolicyDecision;
    query?: string | null;
    url?: string | null;
    locale?: string | null;
}): RetrievalTargetContract;
//# sourceMappingURL=web-retrieval-session.d.ts.map