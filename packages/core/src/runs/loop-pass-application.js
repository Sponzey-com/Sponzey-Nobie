export function applyLoopEntryPassResult(result) {
    if (result.kind === "break") {
        return { kind: "break" };
    }
    if (result.kind === "retry") {
        return {
            kind: "retry",
            nextMessage: result.nextMessage,
            state: {
                pendingLoopDirective: null,
                intakeProcessed: false,
            },
        };
    }
    if (result.kind === "set_directive") {
        return {
            kind: "continue",
            state: {
                pendingLoopDirective: result.directive,
                intakeProcessed: result.intakeProcessed,
            },
        };
    }
    return {
        kind: "continue",
        state: {
            pendingLoopDirective: null,
            intakeProcessed: result.intakeProcessed,
        },
    };
}
export function applyRecoveryEntryPassResult(params) {
    if (params.result.kind === "break") {
        return { kind: "break" };
    }
    if (params.result.kind === "continue") {
        return { kind: "continue" };
    }
    return {
        kind: "retry",
        state: {
            currentMessage: params.result.nextMessage,
            currentModel: params.result.nextState.model,
            currentProviderId: params.result.nextState.providerId,
            currentProvider: params.result.nextState.provider,
            currentTargetId: params.result.nextState.targetId,
            currentTargetLabel: params.result.nextState.targetLabel,
            activeWorkerRuntime: params.result.nextState.workerRuntime,
        },
    };
}
export function applyPostExecutionPassResult(params) {
    if (params.result.kind === "break") {
        return { kind: "break" };
    }
    if (params.result.kind === "retry") {
        if (params.result.seenCommandFailureRecoveryKey) {
            params.seenCommandFailureRecoveryKeys.add(params.result.seenCommandFailureRecoveryKey);
        }
        if (params.result.seenExecutionRecoveryKey) {
            params.seenExecutionRecoveryKeys.add(params.result.seenExecutionRecoveryKey);
        }
        if (params.result.seenDeliveryRecoveryKey) {
            params.seenDeliveryRecoveryKeys.add(params.result.seenDeliveryRecoveryKey);
        }
        return {
            kind: "retry",
            state: {
                currentMessage: params.result.nextMessage,
                filesystemMutationRecoveryAttempted: params.filesystemMutationRecoveryAttempted
                    || Boolean(params.result.markMutationRecoveryAttempted),
                activeWorkerRuntime: params.result.clearWorkerRuntime ? undefined : params.activeWorkerRuntime,
            },
        };
    }
    return {
        kind: "continue",
        state: {
            currentMessage: params.currentMessage,
            filesystemMutationRecoveryAttempted: params.filesystemMutationRecoveryAttempted,
            activeWorkerRuntime: params.activeWorkerRuntime,
        },
        preview: params.result.preview,
        deliveryOutcome: params.result.deliveryOutcome,
    };
}
export function applyReviewCyclePassResult(params) {
    if (params.result.kind === "break") {
        return { kind: "break" };
    }
    if (params.result.normalizedFollowupPrompt) {
        params.seenFollowupPrompts.add(params.result.normalizedFollowupPrompt);
    }
    return {
        kind: "retry",
        state: {
            currentMessage: params.result.nextMessage,
            truncatedOutputRecoveryAttempted: params.truncatedOutputRecoveryAttempted
                || Boolean(params.result.markTruncatedOutputRecoveryAttempted),
            activeWorkerRuntime: params.result.clearWorkerRuntime ? undefined : params.activeWorkerRuntime,
            currentProvider: params.result.clearProvider ? undefined : params.currentProvider,
        },
    };
}
//# sourceMappingURL=loop-pass-application.js.map