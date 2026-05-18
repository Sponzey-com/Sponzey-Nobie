import type { ChannelSource } from "../channels/contracts.js";
import { type RunChunkDeliveryHandler, emitAssistantTextDelivery } from "./delivery.js";
import type { RunStatus, RunStepStatus } from "./types.js";
export type FinalizationSource = ChannelSource;
export type FinalValidationMode = "general" | "current_fact";
export type FinalValidationScope = "parent_finalizer";
export type FinalValidationValueConfidence = "verified" | "candidate" | "unverified" | "conflict";
export interface FinalValidationRequiredValue {
    valueId: string;
    label: string;
    required: boolean;
}
export interface FinalValidationObservedValue {
    valueId: string;
    label?: string;
    value?: string;
    unit?: string;
    confidence: FinalValidationValueConfidence;
    sourceId?: string;
    sourceLabel?: string;
    sourceUrl?: string;
    sourceDomain?: string;
    sourceTimestamp?: string | null;
    fetchTimestamp?: string | null;
    basisTime?: string | null;
    conflicts?: string[];
}
export interface FinalValidationMissingValue {
    valueId: string;
    label: string;
    reasonCode: string;
}
export interface FinalValidationSourceRef {
    sourceId: string;
    sourceLabel?: string;
    sourceUrl?: string;
    sourceDomain?: string;
    sourceTimestamp?: string | null;
    fetchTimestamp?: string | null;
    reliability?: string;
    role?: string;
    status?: string;
}
export interface FinalValidationConflict {
    valueId?: string;
    summary: string;
    sourceIds?: string[];
    selectionBasis?: string;
}
export interface FinalValidationInput {
    mode: FinalValidationMode;
    validationScope?: FinalValidationScope;
    requiredValues?: FinalValidationRequiredValue[];
    observedValues?: FinalValidationObservedValue[];
    missingValues?: FinalValidationMissingValue[];
    sourceList?: FinalValidationSourceRef[];
    sourceTimestamps?: string[];
    conflicts?: FinalValidationConflict[];
    reasonCodes?: string[];
    basisTime?: string | null;
    recoveryAvailable?: boolean;
    safeAlternativesExhausted?: boolean;
}
export type FinalValidationStatus = "ready" | "needs_recovery" | "limited_failure_allowed";
export interface FinalValidationTrace {
    mode: FinalValidationMode;
    validationScope: FinalValidationScope;
    requiredValues: FinalValidationRequiredValue[];
    observedValues: FinalValidationObservedValue[];
    missingValues: FinalValidationMissingValue[];
    sourceList: FinalValidationSourceRef[];
    sourceTimestamps: string[];
    conflicts: FinalValidationConflict[];
    reasonCodes: string[];
    basisTime?: string | null;
    recoveryAvailable: boolean;
    safeAlternativesExhausted: boolean;
}
export interface FinalValidationDecision {
    status: FinalValidationStatus;
    finalDeliveryAllowed: boolean;
    reasonCodes: string[];
    summary: string;
    trace: FinalValidationTrace;
}
export interface FinalizationOutcome {
    status: "completed" | "blocked_by_final_validation";
    finalValidation?: FinalValidationDecision;
}
export interface AwaitingUserParams {
    preview: string;
    summary: string;
    reason?: string;
    rawMessage?: string;
    userMessage?: string;
    remainingItems?: string[];
}
export interface FinalizationDependencies {
    appendRunEvent: (runId: string, message: string) => void;
    setRunStepStatus: (runId: string, step: string, status: RunStepStatus, summary: string) => unknown;
    updateRunStatus: (runId: string, status: RunStatus, summary: string, active: boolean) => unknown;
    rememberRunSuccess: (params: {
        runId: string;
        sessionId: string;
        source: FinalizationSource;
        text: string;
        summary: string;
    }) => void;
    rememberRunFailure: (params: {
        runId: string;
        sessionId: string;
        source: FinalizationSource;
        summary: string;
        detail?: string;
        title?: string;
    }) => void;
    rememberRunAwaitingUser?: (params: {
        runId: string;
        sessionId: string;
        source: FinalizationSource;
        summary: string;
        reason?: string;
        userMessage?: string;
        remainingItems?: string[];
    }) => void;
    onDeliveryError?: (message: string) => void;
    deliveryDependencies?: NonNullable<Parameters<typeof emitAssistantTextDelivery>[0]["dependencies"]>;
}
export declare function validateAndFinalize(input: FinalValidationInput): FinalValidationDecision;
export declare class ValidateAndFinalize {
    decide(input: FinalValidationInput): FinalValidationDecision;
}
export declare function markRunCompleted(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    text: string;
    summary: string;
    executingSummary?: string;
    reviewingSummary?: string;
    finalizingSummary?: string;
    completedSummary?: string;
    eventLabel?: string;
    dependencies: FinalizationDependencies;
}): void;
export declare function completeRunWithAssistantMessage(params: {
    runId: string;
    sessionId: string;
    text: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    suppressFinalDelivery?: boolean;
    suppressFinalDeliveryReasonCode?: string;
    finalValidation?: FinalValidationInput;
    dependencies: FinalizationDependencies;
}): Promise<FinalizationOutcome>;
export declare function emitStandaloneAssistantMessage(params: {
    runId: string;
    sessionId: string;
    text: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    dependencies: Pick<FinalizationDependencies, "appendRunEvent" | "onDeliveryError" | "deliveryDependencies">;
}): Promise<void>;
export declare function moveRunToAwaitingUser(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    awaitingUser: AwaitingUserParams;
    dependencies: FinalizationDependencies;
}): Promise<void>;
export declare function moveRunToCancelledAfterStop(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    cancellation: AwaitingUserParams;
    dependencies: FinalizationDependencies;
}): Promise<void>;
export declare function buildAwaitingUserMessage(params: AwaitingUserParams): string;
//# sourceMappingURL=finalization.d.ts.map