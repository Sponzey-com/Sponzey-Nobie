import type { EnterpriseTimestamp } from "../contracts/enterprise-topology.js";
import { type ExecutorProfile } from "./executor-profile.js";
import type { ExecutorConnectionDraft, ExecutorDraft, ExecutorInferenceEvidence, ExecutorRuntimeMode } from "./executor-graph.js";
import { type NodeTaskAnalysis, type NodeTaskAnalysisSource } from "./executor-task-analysis.js";
export declare const EXECUTOR_UNDERSTANDING_VERSION: "executor-understanding:v1";
export declare const EXECUTOR_UNDERSTANDING_DRAFT_VERSION: "executor-understanding:draft";
export interface ExecutorInferenceInput {
    name: string;
    description: string;
    executorProfile?: ExecutorProfile;
}
export interface ExecutorInferenceKeywordHit {
    keyword: string;
    hint: "crm" | "approval" | "review" | "external" | "exception" | "report" | "research" | "tool";
}
export interface ExecutorInferenceResult {
    runtimeMode: ExecutorRuntimeMode;
    executorProfile: ExecutorProfile;
    toolHints: string[];
    outputHints: string[];
    successCriteria: string[];
    capabilityHints: string[];
    summaryKo: string;
    summaryEn: string;
    confidence: number;
    keywordHits: ExecutorInferenceKeywordHit[];
    requiresClarification: boolean;
    readyForAutoRun: boolean;
}
export interface CreateExecutorDraftFromInferenceOptions extends ExecutorInferenceInput {
    id?: string;
    sourceNodeId?: string;
    now?: EnterpriseTimestamp;
    userConfirmed?: boolean;
}
export interface InferExecutorTaskAnalysisOptions {
    executor: ExecutorDraft;
    incomingConnections?: ExecutorConnectionDraft[];
    outgoingConnections?: ExecutorConnectionDraft[];
    now?: EnterpriseTimestamp;
    source?: NodeTaskAnalysisSource;
}
export declare function inferExecutorFromDescription(input: ExecutorInferenceInput): ExecutorInferenceResult;
export declare function createExecutorDraftFromInference(options: CreateExecutorDraftFromInferenceOptions): ExecutorDraft;
export declare function inferExecutorTaskAnalysis(options: InferExecutorTaskAnalysisOptions): NodeTaskAnalysis;
export declare function confirmExecutorUnderstanding(executor: ExecutorDraft, version?: "executor-understanding:v1"): ExecutorDraft;
export declare function buildExecutorInferenceEvidence(input: {
    executorId: string;
    sourceNodeId?: string;
    name: string;
    description: string;
    inference: ExecutorInferenceResult;
    confirmed?: boolean;
    now?: EnterpriseTimestamp;
}): ExecutorInferenceEvidence;
//# sourceMappingURL=executor-inference.d.ts.map