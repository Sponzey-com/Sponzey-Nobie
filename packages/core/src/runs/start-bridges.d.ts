import { applyLoopDirective } from "./loop-directive-application.js";
import type { LoopDirective } from "./loop-directive.js";
import type { RunChunkDeliveryHandler } from "./delivery.js";
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js";
import type { buildScheduleRegistrationCancelledEvent, buildScheduleRegistrationCreatedEvent } from "../scheduler/lifecycle.js";
import { runIntakeBridgePass, type DelegatedRunStartParams, type DelegatedRunStartResult } from "./intake-bridge-pass.js";
import type { ScheduleDelayedRunRequest } from "./action-execution.js";
import type { TaskProfile } from "./types.js";
import type { AgentExecutionDecision, AgentExecutionDecisionTraceSnapshot } from "../orchestration/execution-decision-contract.js";
import type { AIProvider } from "../ai/index.js";
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
    suppressFinalDelivery?: boolean;
    suppressFinalDeliveryReasonCode?: string;
}, moduleDependencies?: StartBridgeModuleDependencies): Promise<"break">;
export declare function runStartIntakeBridge(params: {
    message: string;
    originalRequest: string;
    sessionId: string;
    requestGroupId: string;
    model: string | undefined;
    providerId?: string | undefined;
    provider?: AIProvider | undefined;
    workDir: string;
    source: FinalizationSource;
    runId: string;
    onChunk: RunChunkDeliveryHandler | undefined;
    reuseConversationContext: boolean;
    scheduleDelayedRun: (params: ScheduleDelayedRunRequest) => void;
    startDelegatedRun: (params: DelegatedRunStartParams) => void | DelegatedRunStartResult | Promise<void | DelegatedRunStartResult>;
}, dependencies: {
    appendRunEvent: (runId: string, message: string) => void;
    updateRunSummary: (runId: string, summary: string) => void;
    incrementDelegationTurnCount: (runId: string, summary: string) => void;
    emitScheduleCreated: (payload: ReturnType<typeof buildScheduleRegistrationCreatedEvent>) => void;
    emitScheduleCancelled: (payload: ReturnType<typeof buildScheduleRegistrationCancelledEvent>) => void;
    normalizeTaskProfile: (taskProfile: string | undefined) => TaskProfile;
    logInfo: (message: string, payload: Record<string, unknown>) => void;
    recordExecutionDecisionTrace?: (params: {
        runId: string;
        agentExecutionDecision: AgentExecutionDecision;
        executionDecisionTrace: AgentExecutionDecisionTraceSnapshot;
    }) => void;
}, moduleDependencies?: StartBridgeModuleDependencies): Promise<LoopDirective | null>;
export {};
//# sourceMappingURL=start-bridges.d.ts.map