import { applyLoopDirective } from "./loop-directive-application.js";
import { runIntakeBridgePass, } from "./intake-bridge-pass.js";
const defaultModuleDependencies = {
    applyLoopDirective,
    runIntakeBridgePass,
};
export function buildStartFinalizationDependencies(params) {
    return {
        appendRunEvent: params.appendRunEvent,
        setRunStepStatus: params.setRunStepStatus,
        updateRunStatus: params.updateRunStatus,
        rememberRunSuccess: params.rememberRunSuccess,
        rememberRunFailure: params.rememberRunFailure,
        ...(params.onDeliveryError ? { onDeliveryError: params.onDeliveryError } : {}),
    };
}
export async function executeStartLoopDirective(params, moduleDependencies = defaultModuleDependencies) {
    return moduleDependencies.applyLoopDirective(params);
}
export async function runStartIntakeBridge(params, dependencies, moduleDependencies = defaultModuleDependencies) {
    return moduleDependencies.runIntakeBridgePass(params, {
        appendRunEvent: dependencies.appendRunEvent,
        updateRunSummary: dependencies.updateRunSummary,
        incrementDelegationTurnCount: dependencies.incrementDelegationTurnCount,
        emitScheduleCreated: dependencies.emitScheduleCreated,
        emitScheduleCancelled: dependencies.emitScheduleCancelled,
        scheduleDelayedRun: params.scheduleDelayedRun,
        startDelegatedRun: params.startDelegatedRun,
        normalizeTaskProfile: dependencies.normalizeTaskProfile,
        logInfo: dependencies.logInfo,
    });
}
//# sourceMappingURL=start-bridges.js.map