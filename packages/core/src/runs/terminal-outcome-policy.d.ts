import type { CompletionStageState } from "./completion-state.js";
export declare function decideCompletionTerminalOutcome(params: {
    state: CompletionStageState;
}): {
    kind: "complete";
} | {
    kind: "stop";
    summary: string;
    reason: string;
    remainingItems: string[];
};
export declare function decideFatalFailureTerminalOutcome(params: {
    aborted: boolean;
}): "failed" | "cancelled";
export declare function decideTerminalApplicationOutcome(params: {
    applicationKind: "awaiting_user" | "stop";
}): "awaiting_user" | "cancelled";
//# sourceMappingURL=terminal-outcome-policy.d.ts.map