import { type AIProvider } from "../ai/index.js";
export type CompletionReviewStatus = "complete" | "followup" | "ask_user";
export interface CompletionReviewResult {
    status: CompletionReviewStatus;
    summary: string;
    reason: string;
    followupPrompt?: string;
    userMessage?: string;
    remainingItems: string[];
}
export declare function reviewTaskCompletion(params: {
    originalRequest: string;
    latestAssistantMessage: string;
    priorAssistantMessages?: string[];
    model?: string;
    providerId?: string;
    provider?: AIProvider;
    workDir?: string;
}): Promise<CompletionReviewResult | null>;
export declare function buildCompletionReviewSystemPrompt(): string;
export declare function parseCompletionReviewResult(raw: string): CompletionReviewResult | null;
//# sourceMappingURL=completion-review.d.ts.map