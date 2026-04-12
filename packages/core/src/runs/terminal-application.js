import { moveRunToAwaitingUser, moveRunToCancelledAfterStop, } from "./finalization.js";
import { decideTerminalApplicationOutcome } from "./terminal-outcome-policy.js";
const defaultTerminalApplicationDependencies = {
    moveRunToAwaitingUser,
    moveRunToCancelledAfterStop,
};
export async function applyTerminalApplication(params, dependencies = defaultTerminalApplicationDependencies) {
    const terminalOutcome = decideTerminalApplicationOutcome({
        applicationKind: params.application.kind,
    });
    if (terminalOutcome === "awaiting_user") {
        await dependencies.moveRunToAwaitingUser({
            runId: params.runId,
            sessionId: params.sessionId,
            source: params.source,
            onChunk: params.onChunk,
            awaitingUser: {
                preview: params.application.preview,
                summary: params.application.summary,
                ...(params.application.reason ? { reason: params.application.reason } : {}),
                ...(params.application.rawMessage ? { rawMessage: params.application.rawMessage } : {}),
                ...(params.application.userMessage ? { userMessage: params.application.userMessage } : {}),
                ...(params.application.remainingItems ? { remainingItems: params.application.remainingItems } : {}),
            },
            dependencies: params.dependencies,
        });
        return "awaiting_user";
    }
    await dependencies.moveRunToCancelledAfterStop({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        onChunk: params.onChunk,
        cancellation: {
            preview: params.application.preview,
            summary: params.application.summary,
            ...(params.application.reason ? { reason: params.application.reason } : {}),
            ...(params.application.rawMessage ? { rawMessage: params.application.rawMessage } : {}),
            ...(params.application.userMessage ? { userMessage: params.application.userMessage } : {}),
            ...(params.application.remainingItems ? { remainingItems: params.application.remainingItems } : {}),
        },
        dependencies: params.dependencies,
    });
    return "cancelled";
}
//# sourceMappingURL=terminal-application.js.map