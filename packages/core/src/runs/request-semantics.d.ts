export declare function shouldReuseConversationContext(message: string): boolean;
export declare function detectActiveQueueCancellationMode(message: string): "latest" | "all" | null;
export declare function buildActiveQueueCancellationMessage(params: {
    originalMessage: string;
    mode: "latest" | "all";
    cancelledTitles: string[];
    remainingCount: number;
    hadTargets: boolean;
}): string;
export declare function extractVerificationSourceRequest(value: string): string;
//# sourceMappingURL=request-semantics.d.ts.map