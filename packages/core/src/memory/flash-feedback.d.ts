export interface ActiveFlashFeedback {
    id: string;
    content: string;
    severity: "low" | "normal" | "high";
    expiresAt: number;
    createdAt: number;
}
export declare function recordFlashFeedback(input: {
    sessionId: string;
    content: string;
    runId?: string;
    requestGroupId?: string;
    severity?: "low" | "normal" | "high";
    ttlMs?: number;
    metadata?: Record<string, unknown>;
}): string | null;
export declare function getActiveFlashFeedback(input: {
    sessionId: string;
    nowMs?: number;
    limit?: number;
}): ActiveFlashFeedback[];
export declare function buildFlashFeedbackContext(input: {
    sessionId: string;
    nowMs?: number;
    limit?: number;
    maxChars?: number;
}): string;
//# sourceMappingURL=flash-feedback.d.ts.map