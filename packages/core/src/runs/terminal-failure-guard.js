import { normalizeFailureReason, } from "./execution-policy.js";
export function guardTerminalFailure(input) {
    const normalized = normalizeFailureReason(input);
    if (normalized.kind === "terminal") {
        return {
            ok: true,
            terminalReason: normalized.reason,
        };
    }
    return {
        ok: false,
        recoverySignal: normalized,
    };
}
export function assertTerminalFailureAllowed(input) {
    const decision = guardTerminalFailure(input);
    if (decision.ok)
        return decision.terminalReason;
    throw new Error(`terminal failure rejected: ${decision.recoverySignal.originalReason} -> ${decision.recoverySignal.reason}`);
}
//# sourceMappingURL=terminal-failure-guard.js.map