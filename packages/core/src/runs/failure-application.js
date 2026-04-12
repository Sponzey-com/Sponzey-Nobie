import { decideFatalFailureTerminalOutcome } from "./terminal-outcome-policy.js";
export function applyFatalFailure(params, dependencies) {
    const terminalOutcome = decideFatalFailureTerminalOutcome({ aborted: params.aborted });
    const shouldAppendMessageEvent = !params.aborted || params.appendMessageEventOnAbort === true;
    const shouldAppendExtraEvents = !params.aborted || params.appendExtraEventsOnAbort === true;
    if (shouldAppendMessageEvent) {
        dependencies.appendRunEvent(params.runId, params.message);
    }
    if (shouldAppendExtraEvents) {
        for (const event of params.extraEvents ?? []) {
            dependencies.appendRunEvent(params.runId, event);
        }
    }
    if (terminalOutcome === "cancelled") {
        dependencies.markAbortedRunCancelledIfActive(params.runId);
        return "cancelled";
    }
    dependencies.setRunStepStatus(params.runId, "executing", "failed", params.message);
    dependencies.updateRunStatus(params.runId, "failed", params.message, false);
    dependencies.rememberRunFailure({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        summary: params.summary,
        detail: params.message,
        title: params.title,
    });
    return "failed";
}
//# sourceMappingURL=failure-application.js.map