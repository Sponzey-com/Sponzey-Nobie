import type { AssistantTextDeliveryOutcome, DeliverySource } from "./delivery.js";
export interface FailedCommandTool {
    toolName: string;
    output: string;
    params?: unknown;
}
export interface SuccessfulToolEvidence {
    toolName: string;
    output: string;
}
export type RecoveryAlternativeKind = "other_tool" | "other_extension" | "other_channel" | "other_schedule" | "same_channel_retry";
export interface RecoveryAlternative {
    kind: RecoveryAlternativeKind;
    label: string;
}
interface RecoveryCandidateBase {
    key: string;
    summary: string;
    reason: string;
    alternatives: RecoveryAlternative[];
}
export interface DeliveryRecoveryCandidate extends RecoveryCandidateBase {
    remainingItems: string[];
}
export interface CommandFailureRecoveryCandidate extends RecoveryCandidateBase {
}
export interface GenericExecutionRecoveryCandidate extends RecoveryCandidateBase {
}
export interface RecoveryKeyParts {
    action: string;
    error: string;
    toolName?: string | undefined;
    targetId?: string | undefined;
    channel?: DeliverySource | string | undefined;
}
export declare function buildRecoveryKey(parts: RecoveryKeyParts): string;
export declare function isCommandFailureRecoveryTool(toolName: string): boolean;
export declare function describeCommandFailureReason(output: string): string;
export declare function selectCommandFailureRecovery(params: {
    failedTools: FailedCommandTool[];
    commandFailureSeen: boolean;
    commandRecoveredWithinSamePass: boolean;
    seenKeys: Set<string>;
}): CommandFailureRecoveryCandidate | null;
export declare function selectGenericExecutionRecovery(params: {
    executionRecovery: {
        summary: string;
        reason: string;
        toolNames: string[];
    };
    seenKeys: Set<string>;
}): GenericExecutionRecoveryCandidate | null;
export declare function describeRecoveryAlternatives(alternatives: RecoveryAlternative[]): string | null;
export declare function buildDirectArtifactDeliveryRecoveryPrompt(params: {
    originalRequest: string;
    previousResult: string;
    successfulTools: SuccessfulToolEvidence[];
    successfulFileDeliveries: Array<{
        channel: string;
        filePath: string;
    }>;
    alternatives?: RecoveryAlternative[];
}): string;
export declare function selectDirectArtifactDeliveryRecovery(params: {
    source: DeliverySource;
    successfulFileDeliveries: Array<{
        channel: string;
        filePath: string;
    }>;
    seenKeys: Set<string>;
}): DeliveryRecoveryCandidate | null;
export declare function describeAssistantTextDeliveryFailure(params: {
    source: DeliverySource;
    outcome: AssistantTextDeliveryOutcome;
}): string;
export declare function buildCommandFailureRecoveryPrompt(params: {
    originalRequest: string;
    previousResult: string;
    summary: string;
    reason: string;
    failedTools: FailedCommandTool[];
    alternatives?: RecoveryAlternative[];
}): string;
export declare function buildExecutionRecoveryPrompt(params: {
    originalRequest: string;
    previousResult: string;
    summary: string;
    reason: string;
    toolNames: string[];
    alternatives?: RecoveryAlternative[];
}): string;
export declare function summarizeRawErrorForUser(message: string | undefined): string;
export declare function summarizeRawErrorActionHintForUser(message: string | undefined): string;
export declare function buildAiErrorRecoveryPrompt(params: {
    originalRequest: string;
    previousResult: string;
    summary: string;
    reason: string;
    message: string;
    failedRoute?: string | undefined;
    avoidTargets?: string[] | undefined;
    nextRouteHint?: string | undefined;
}): string;
export declare function describeWorkerRuntimeErrorReason(message: string): string;
export declare function buildWorkerRuntimeErrorRecoveryPrompt(params: {
    originalRequest: string;
    previousResult: string;
    summary: string;
    reason: string;
    message: string;
    failedRoute?: string | undefined;
    avoidTargets?: string[] | undefined;
    nextRouteHint?: string | undefined;
}): string;
export declare function buildAiRecoveryAvoidTargets(targetId: string | undefined, workerRuntimeKind: string | undefined): string[];
export declare function buildAiRecoveryKey(params: {
    targetId: string | undefined;
    workerRuntimeKind: string | undefined;
    providerId: string | undefined;
    model: string | undefined;
    reason: string;
    message: string;
}): string;
export declare function buildWorkerRuntimeRecoveryKey(params: {
    targetId: string | undefined;
    workerRuntimeKind: string | undefined;
    providerId: string | undefined;
    model: string | undefined;
    reason: string;
    message: string;
}): string;
export declare function hasMeaningfulRouteChange(params: {
    currentTargetId: string | undefined;
    currentModel: string | undefined;
    currentProviderId: string | undefined;
    currentWorkerRuntimeKind: string | undefined;
    nextTargetId: string | undefined;
    nextModel: string | undefined;
    nextProviderId: string | undefined;
    nextWorkerRuntimeKind: string | undefined;
}): boolean;
export declare function buildFilesystemMutationFollowupPrompt(params: {
    originalRequest: string;
    previousResult: string;
}): string;
export declare function buildFilesystemVerificationRecoveryPrompt(params: {
    originalRequest: string;
    previousResult: string;
    verificationSummary: string;
    verificationReason?: string;
    missingItems?: string[];
    mutationPaths?: string[];
}): string;
export declare function buildEmptyResultRecoveryPrompt(params: {
    originalRequest: string;
    previousResult: string;
    successfulTools: SuccessfulToolEvidence[];
    sawRealFilesystemMutation: boolean;
}): string;
export declare function shouldRetryTruncatedOutput(params: {
    review: {
        status: string;
        summary?: string;
        reason?: string;
        userMessage?: string;
        remainingItems?: string[];
    };
    preview: string;
    requiresFilesystemMutation: boolean;
}): boolean;
export declare function buildTruncatedOutputRecoveryPrompt(params: {
    originalRequest: string;
    previousResult: string;
    summary?: string;
    reason?: string;
    remainingItems?: string[];
}): string;
export {};
//# sourceMappingURL=recovery.d.ts.map