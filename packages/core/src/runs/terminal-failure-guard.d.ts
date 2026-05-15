import { type FailureReasonNormalizationResult, type TerminalFailureReason } from "./execution-policy.js";
export type TerminalFailureGuardDecision = {
    ok: true;
    terminalReason: TerminalFailureReason;
} | {
    ok: false;
    recoverySignal: Extract<FailureReasonNormalizationResult, {
        kind: "recovery_signal";
    }>;
};
export declare function guardTerminalFailure(input: {
    reason: string;
    explicitUserLimit?: boolean;
}): TerminalFailureGuardDecision;
export declare function assertTerminalFailureAllowed(input: {
    reason: string;
    explicitUserLimit?: boolean;
}): TerminalFailureReason;
//# sourceMappingURL=terminal-failure-guard.d.ts.map