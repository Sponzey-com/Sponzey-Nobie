export function decideDirectArtifactDeliveryApplication(decision) {
    if (decision.kind === "none") {
        return { kind: "none" };
    }
    if (decision.kind === "complete") {
        return {
            kind: "complete",
            summary: decision.deliverySummary,
            finalText: decision.finalText,
            eventLabel: decision.eventLabel,
        };
    }
    if (decision.kind === "stop") {
        return {
            kind: "stop",
            summary: decision.summary,
            reason: decision.reason,
            remainingItems: decision.remainingItems,
        };
    }
    return {
        kind: "retry",
        recoveryKey: decision.recoveryKey,
        summary: decision.summary,
        detail: decision.reason,
        title: "direct_artifact_delivery_recovery",
        eventLabel: decision.eventLabel,
        alternatives: decision.alternatives,
        nextMessage: decision.nextMessage,
        reviewStepStatus: "running",
        executingStepSummary: decision.summary,
        updateRunStatusSummary: decision.summary,
        clearWorkerRuntime: true,
    };
}
//# sourceMappingURL=delivery-application.js.map