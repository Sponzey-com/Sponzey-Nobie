import type { AIProvider } from "../ai/index.js";
import { buildScheduleRegistrationCancelledEvent, buildScheduleRegistrationCreatedEvent } from "../scheduler/lifecycle.js";
import { analyzeTaskIntake, type TaskExecutionSemantics, type TaskIntentEnvelope, type TaskStructuredRequest } from "../agent/intake.js";
import type { AgentContextMode } from "../agent/index.js";
import { resolveRunRoute } from "./routing.js";
import { buildFollowupPrompt, createDefaultScheduleActionDependencies, executeScheduleActions, inferDelegatedTaskProfile, type ScheduleDelayedRunRequest } from "./action-execution.js";
import type { RunChunkDeliveryHandler } from "./delivery.js";
import type { LoopDirective } from "./loop-directive.js";
import type { TaskProfile } from "./types.js";
import type { WorkerRuntimeTarget } from "./worker-runtime.js";
export interface DelegatedRunStartParams {
    message: string;
    sessionId: string;
    taskProfile: TaskProfile;
    requestGroupId: string;
    parentRunId?: string | undefined;
    runScope?: "root" | "child" | "analysis" | undefined;
    handoffSummary?: string | undefined;
    originalRequest: string;
    executionSemantics: TaskExecutionSemantics;
    structuredRequest: TaskStructuredRequest;
    intentEnvelope: TaskIntentEnvelope;
    model?: string | undefined;
    providerId?: string | undefined;
    provider?: AIProvider | undefined;
    workerRuntime?: WorkerRuntimeTarget | undefined;
    targetId?: string | undefined;
    targetLabel?: string | undefined;
    workDir: string;
    source: "webui" | "cli" | "telegram" | "slack";
    skipIntake?: boolean | undefined;
    toolsEnabled?: boolean | undefined;
    contextMode?: AgentContextMode | undefined;
    onChunk?: RunChunkDeliveryHandler;
}
interface IntakeBridgePassDependencies {
    appendRunEvent: (runId: string, message: string) => void;
    updateRunSummary: (runId: string, summary: string) => void;
    incrementDelegationTurnCount: (runId: string, summary: string) => void;
    emitScheduleCreated: (payload: ReturnType<typeof buildScheduleRegistrationCreatedEvent>) => void;
    emitScheduleCancelled: (payload: ReturnType<typeof buildScheduleRegistrationCancelledEvent>) => void;
    scheduleDelayedRun: (params: ScheduleDelayedRunRequest) => void;
    startDelegatedRun: (params: DelegatedRunStartParams) => void;
    normalizeTaskProfile: (taskProfile: string | undefined) => TaskProfile;
    logInfo: (message: string, payload: Record<string, unknown>) => void;
}
interface IntakeBridgePassModuleDependencies {
    analyzeTaskIntake: typeof analyzeTaskIntake;
    resolveRunRoute: typeof resolveRunRoute;
    executeScheduleActions: typeof executeScheduleActions;
    createDefaultScheduleActionDependencies: typeof createDefaultScheduleActionDependencies;
    inferDelegatedTaskProfile: typeof inferDelegatedTaskProfile;
    buildFollowupPrompt: typeof buildFollowupPrompt;
}
export declare function runIntakeBridgePass(params: {
    message: string;
    originalRequest: string;
    sessionId: string;
    requestGroupId: string;
    model: string | undefined;
    workDir: string;
    source: "webui" | "cli" | "telegram" | "slack";
    runId: string;
    onChunk: RunChunkDeliveryHandler | undefined;
    reuseConversationContext: boolean;
}, dependencies: IntakeBridgePassDependencies, moduleDependencies?: IntakeBridgePassModuleDependencies): Promise<LoopDirective | null>;
export {};
//# sourceMappingURL=intake-bridge-pass.d.ts.map