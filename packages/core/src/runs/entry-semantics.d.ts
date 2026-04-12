export type ActiveQueueCancellationMode = "latest" | "all";
export interface RequestEntrySemantics {
    reuse_conversation_context: boolean;
    active_queue_cancellation_mode: ActiveQueueCancellationMode | null;
}
export declare function analyzeRequestEntrySemantics(message: string): RequestEntrySemantics;
export declare function buildActiveQueueCancellationMessage(params: {
    originalMessage: string;
    mode: ActiveQueueCancellationMode;
    cancelledTitles: string[];
    remainingCount: number;
    hadTargets: boolean;
}): string;
//# sourceMappingURL=entry-semantics.d.ts.map