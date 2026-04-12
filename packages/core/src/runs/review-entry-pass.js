import crypto from "node:crypto";
import { insertMessage } from "../db/index.js";
import { logAssistantReply } from "./delivery.js";
import { markRunCompleted } from "./finalization.js";
import { prepareRunForReview } from "./review-transition.js";
import { applyRecoveryRetryState, } from "./retry-application.js";
import { applyTerminalApplication } from "./terminal-application.js";
const defaultDependencies = {
    insertMessage,
    writeReplyLog: logAssistantReply,
    createId: () => crypto.randomUUID(),
    now: () => Date.now(),
};
export async function runReviewEntryPass(params, dependencies) {
    const mergedDependencies = { ...defaultDependencies, ...dependencies };
    prepareRunForReview({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        preview: params.preview,
        ...(params.workerSessionId ? { workerSessionId: params.workerSessionId } : {}),
        persistRuntimePreview: params.persistRuntimePreview,
        dependencies: {
            appendRunEvent: mergedDependencies.appendRunEvent,
            setRunStepStatus: mergedDependencies.setRunStepStatus,
            insertMessage: mergedDependencies.insertMessage,
            writeReplyLog: mergedDependencies.writeReplyLog,
            createId: mergedDependencies.createId,
            now: mergedDependencies.now,
        },
    });
    if (params.directDeliveryApplication.kind === "complete") {
        markRunCompleted({
            runId: params.runId,
            sessionId: params.sessionId,
            source: params.source,
            text: params.directDeliveryApplication.finalText,
            summary: params.directDeliveryApplication.summary,
            reviewingSummary: params.directDeliveryApplication.summary,
            finalizingSummary: "전달 결과를 저장했습니다.",
            completedSummary: params.directDeliveryApplication.finalText,
            eventLabel: params.directDeliveryApplication.eventLabel,
            dependencies: dependencies.getFinalizationDependencies(),
        });
        return { kind: "break" };
    }
    if (params.directDeliveryApplication.kind === "stop") {
        await applyTerminalApplication({
            runId: params.runId,
            sessionId: params.sessionId,
            source: params.source,
            onChunk: params.onChunk,
            application: {
                kind: "stop",
                preview: params.preview,
                summary: params.directDeliveryApplication.summary,
                reason: params.directDeliveryApplication.reason,
                remainingItems: params.directDeliveryApplication.remainingItems,
            },
            dependencies: dependencies.getFinalizationDependencies(),
        });
        return { kind: "break" };
    }
    if (params.directDeliveryApplication.kind === "retry") {
        const continuation = applyRecoveryRetryState({
            runId: params.runId,
            sessionId: params.sessionId,
            source: params.source,
            recoveryBudgetUsage: params.recoveryBudgetUsage,
            state: {
                summary: params.directDeliveryApplication.summary,
                budgetKind: "delivery",
                maxDelegationTurns: params.maxDelegationTurns,
                eventLabel: params.directDeliveryApplication.eventLabel,
                nextMessage: params.directDeliveryApplication.nextMessage,
                reviewStepStatus: params.directDeliveryApplication.reviewStepStatus,
                executingStepSummary: params.directDeliveryApplication.executingStepSummary,
                updateRunStatusSummary: params.directDeliveryApplication.updateRunStatusSummary,
                clearWorkerRuntime: params.directDeliveryApplication.clearWorkerRuntime,
                alternatives: params.directDeliveryApplication.alternatives,
                failureTitle: params.directDeliveryApplication.title,
                failureDetail: params.directDeliveryApplication.detail,
            },
        }, {
            rememberRunFailure: mergedDependencies.rememberRunFailure,
            incrementDelegationTurnCount: mergedDependencies.incrementDelegationTurnCount,
            appendRunEvent: mergedDependencies.appendRunEvent,
            updateRunSummary: mergedDependencies.updateRunSummary,
            setRunStepStatus: mergedDependencies.setRunStepStatus,
            updateRunStatus: mergedDependencies.updateRunStatus,
        });
        return {
            kind: "retry",
            nextMessage: continuation.nextMessage,
            clearWorkerRuntime: continuation.clearWorkerRuntime,
        };
    }
    return { kind: "continue" };
}
//# sourceMappingURL=review-entry-pass.js.map