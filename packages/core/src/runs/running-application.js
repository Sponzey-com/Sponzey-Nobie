export function applyRunningContinuationState(params, dependencies) {
    for (const eventLabel of params.state.eventLabels ?? []) {
        const normalized = eventLabel.trim();
        if (!normalized)
            continue;
        dependencies.appendRunEvent(params.runId, normalized);
    }
    if (params.state.updateRunSummary) {
        dependencies.updateRunSummary(params.runId, params.state.updateRunSummary);
    }
    dependencies.setRunStepStatus(params.runId, "reviewing", params.state.reviewStepStatus, params.state.reviewSummary);
    dependencies.setRunStepStatus(params.runId, "executing", "running", params.state.executingSummary);
    if (params.state.updateRunStatusSummary) {
        dependencies.updateRunStatus(params.runId, "running", params.state.updateRunStatusSummary, true);
    }
    return {
        nextMessage: params.state.nextMessage,
        clearWorkerRuntime: Boolean(params.state.clearWorkerRuntime),
        clearProvider: Boolean(params.state.clearProvider),
    };
}
//# sourceMappingURL=running-application.js.map