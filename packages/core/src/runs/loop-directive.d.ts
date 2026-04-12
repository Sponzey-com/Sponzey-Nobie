export type LoopDirective = {
    kind: "complete";
    text: string;
    eventLabel?: string;
} | {
    kind: "complete_silent";
    summary: string;
    eventLabel?: string;
} | {
    kind: "retry_intake";
    summary: string;
    reason: string;
    message: string;
    remainingItems?: string[];
    eventLabel?: string;
} | {
    kind: "awaiting_user";
    preview: string;
    summary: string;
    reason?: string;
    userMessage?: string;
    remainingItems?: string[];
    eventLabel?: string;
};
//# sourceMappingURL=loop-directive.d.ts.map