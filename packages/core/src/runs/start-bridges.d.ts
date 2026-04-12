import { applyLoopDirective } from "./loop-directive-application.js";
import type { LoopDirective } from "./loop-directive.js";
import type { RunChunkDeliveryHandler } from "./delivery.js";
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js";
import type { buildScheduleRegistrationCancelledEvent, buildScheduleRegistrationCreatedEvent } from "../scheduler/lifecycle.js";
import { runIntakeBridgePass, type DelegatedRunStartParams } from "./intake-bridge-pass.js";
import type { ScheduleDelayedRunRequest } from "./action-execution.js";
import type { TaskProfile } from "./types.js";
interface StartBridgeModuleDependencies {
    applyLoopDirective: typeof applyLoopDirective;
    runIntakeBridgePass: typeof runIntakeBridgePass;
}
export declare function buildStartFinalizationDependencies(params: {
    appendRunEvent: FinalizationDependencies["appendRunEvent"];
    setRunStepStatus: FinalizationDependencies["setRunStepStatus"];
    updateRunStatus: FinalizationDependencies["updateRunStatus"];
    rememberRunSuccess: FinalizationDependencies["rememberRunSuccess"];
    rememberRunFailure: FinalizationDependencies["rememberRunFailure"];
    onDeliveryError?: FinalizationDependencies["onDeliveryError"];
}): FinalizationDependencies;
export declare function executeStartLoopDirective(params: {
    runId: string;
    sessionId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    directive: LoopDirective;
    finalizationDependencies: FinalizationDependencies;
}, moduleDependencies?: StartBridgeModuleDependencies): Promise<"break">;
export declare function runStartIntakeBridge(params: {
    message: string;
    originalRequest: string;
    sessionId: string;
    requestGroupId: string;
    model: string | undefined;
    workDir: string;
    source: FinalizationSource;
    runId: string;
    onChunk: RunChunkDeliveryHandler | undefined;
    reuseConversationContext: boolean;
    scheduleDelayedRun: (params: ScheduleDelayedRunRequest) => void;
    startDelegatedRun: (params: DelegatedRunStartParams) => void;
}, dependencies: {
    appendRunEvent: (runId: string, message: string) => void;
    updateRunSummary: (runId: string, summary: string) => void;
    incrementDelegationTurnCount: (runId: string, summary: string) => void;
    emitScheduleCreated: (payload: ReturnType<typeof buildScheduleRegistrationCreatedEvent>) => void;
    emitScheduleCancelled: (payload: ReturnType<typeof buildScheduleRegistrationCancelledEvent>) => void;
    normalizeTaskProfile: (taskProfile: string | undefined) => TaskProfile;
    logInfo: (message: string, payload: Record<string, unknown>) => void;
}, moduleDependencies?: StartBridgeModuleDependencies): Promise<LoopDirective | null>;
export {};
//# sourceMappingURL=start-bridges.d.ts.map