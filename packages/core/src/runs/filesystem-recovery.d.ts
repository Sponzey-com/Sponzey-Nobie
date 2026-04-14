export type MissingFilesystemMutationRecoveryDecision = {
    kind: "initial_retry";
    eventLabel: string;
    summary: string;
    nextMessage: string;
} | {
    kind: "retry";
    summary: string;
    detail: string;
    nextMessage: string;
} | {
    kind: "stop";
    summary: string;
    reason: string;
    remainingItems: string[];
};
export declare function decideMissingFilesystemMutationRecovery(params: {
    attempted: boolean;
    canRetry: boolean;
    originalRequestForRetryPrompt: string;
    verificationRequest: string;
    previousResult: string;
    mutationPaths: string[];
}): MissingFilesystemMutationRecoveryDecision;
export type FilesystemVerificationRecoveryDecision = {
    kind: "verified";
    summary: string;
} | {
    kind: "retry";
    summary: string;
    detail: string;
    nextMessage: string;
} | {
    kind: "stop";
    summary: string;
    reason?: string;
    remainingItems?: string[];
};
export declare function decideFilesystemVerificationRecovery(params: {
    verification: {
        ok: boolean;
        summary: string;
        reason?: string;
        remainingItems?: string[];
    };
    canRetry: boolean;
    originalRequest: string;
    previousResult: string;
    mutationPaths: string[];
}): FilesystemVerificationRecoveryDecision;
//# sourceMappingURL=filesystem-recovery.d.ts.map