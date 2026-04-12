import { deliverTrackedChunk, } from "./delivery.js";
import { applyExternalRecoveryAttempt, } from "./external-retry-application.js";
import { applyFatalFailure, } from "./failure-application.js";
import { describeWorkerRuntimeErrorReason } from "./recovery.js";
const defaultModuleDependencies = {
    applyExternalRecoveryAttempt,
    applyFatalFailure,
    deliverTrackedChunk,
    describeWorkerRuntimeErrorReason,
};
export async function applyErrorChunkPass(params, dependencies, moduleDependencies = defaultModuleDependencies) {
    if (params.executionRecoveryLimitStop) {
        dependencies.appendRunEvent(params.runId, "실행 복구 한도에 도달해 자동 진행을 중단합니다.");
        await moduleDependencies.deliverTrackedChunk({
            onChunk: params.onChunk,
            chunk: params.chunk,
            runId: params.runId,
            ...(params.onDeliveryError ? { onError: params.onDeliveryError } : {}),
            successfulFileDeliveries: params.successfulFileDeliveries,
            successfulTextDeliveries: params.successfulTextDeliveries,
            appendEvent: dependencies.appendRunEvent,
        });
        return { failed: false };
    }
    if (params.activeWorkerRuntime && !params.aborted) {
        const summary = `${params.activeWorkerRuntime.label} 오류를 분석하고 다른 경로로 재시도합니다.`;
        const reason = moduleDependencies.describeWorkerRuntimeErrorReason(params.chunk.message);
        const workerRuntimeRecoveryAttempt = moduleDependencies.applyExternalRecoveryAttempt({
            kind: "worker_runtime",
            runId: params.runId,
            sessionId: params.sessionId,
            source: params.source,
            recoveryBudgetUsage: params.recoveryBudgetUsage,
            usedTurns: params.usedTurns,
            maxDelegationTurns: params.maxDelegationTurns,
            failureTitle: "worker_runtime_recovery",
            payload: {
                summary,
                reason,
                message: params.chunk.message,
            },
            limitRemainingItems: ["작업 세션 실패 원인을 더 분석해야 하지만 자동 재시도 한도에 도달했습니다."],
        }, dependencies);
        await moduleDependencies.deliverTrackedChunk({
            onChunk: params.onChunk,
            chunk: params.chunk,
            runId: params.runId,
            ...(params.onDeliveryError ? { onError: params.onDeliveryError } : {}),
            successfulFileDeliveries: params.successfulFileDeliveries,
            successfulTextDeliveries: params.successfulTextDeliveries,
            appendEvent: dependencies.appendRunEvent,
        });
        return applyWorkerRuntimeRecoveryAttempt(workerRuntimeRecoveryAttempt);
    }
    const failureState = moduleDependencies.applyFatalFailure({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        message: params.chunk.message,
        aborted: params.aborted,
        summary: "실행 중 오류로 요청이 중단되었습니다.",
        title: "run_error",
        ...(params.activeWorkerRuntime && params.workerSessionId
            ? { extraEvents: [`${params.workerSessionId} 실행 실패`] }
            : {}),
        appendMessageEventOnAbort: true,
        appendExtraEventsOnAbort: true,
    }, dependencies);
    await moduleDependencies.deliverTrackedChunk({
        onChunk: params.onChunk,
        chunk: params.chunk,
        runId: params.runId,
        ...(params.onDeliveryError ? { onError: params.onDeliveryError } : {}),
        successfulFileDeliveries: params.successfulFileDeliveries,
        successfulTextDeliveries: params.successfulTextDeliveries,
        appendEvent: dependencies.appendRunEvent,
    });
    return { failed: failureState === "failed" };
}
function applyWorkerRuntimeRecoveryAttempt(attempt) {
    if (attempt.kind === "stop") {
        return {
            failed: false,
            limitStop: attempt.stop,
        };
    }
    return {
        failed: false,
        workerRuntimeRecovery: attempt.payload,
    };
}
//# sourceMappingURL=error-chunk-pass.js.map