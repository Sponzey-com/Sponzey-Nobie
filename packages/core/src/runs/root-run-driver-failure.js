import { deliverChunk } from "./delivery.js";
import { applyFatalFailure } from "./failure-application.js";
const defaultModuleDependencies = {
    applyFatalFailure,
    deliverChunk,
};
export async function applyRootRunDriverFailure(params, dependencies, moduleDependencies = defaultModuleDependencies) {
    moduleDependencies.applyFatalFailure({
        runId: params.runId,
        sessionId: params.sessionId,
        source: params.source,
        message: params.message,
        aborted: params.aborted,
        summary: "예상하지 못한 실행 오류가 발생했습니다.",
        title: "unexpected_error",
    }, {
        appendRunEvent: dependencies.appendRunEvent,
        setRunStepStatus: dependencies.setRunStepStatus,
        updateRunStatus: dependencies.updateRunStatus,
        rememberRunFailure: dependencies.rememberRunFailure,
        markAbortedRunCancelledIfActive: dependencies.markAbortedRunCancelledIfActive,
    });
    await moduleDependencies.deliverChunk({
        onChunk: params.onChunk,
        chunk: { type: "error", message: params.message },
        runId: params.runId,
        onError: dependencies.onDeliveryError ?? (() => { }),
    });
}
//# sourceMappingURL=root-run-driver-failure.js.map