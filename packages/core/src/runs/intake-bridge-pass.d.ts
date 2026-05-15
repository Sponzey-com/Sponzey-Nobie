import { type AIProvider, type ProviderAuditTrace } from "../ai/index.js";
import type { ChannelSource } from "../channels/contracts.js";
import { buildScheduleRegistrationCancelledEvent, buildScheduleRegistrationCreatedEvent } from "../scheduler/lifecycle.js";
import { analyzeTaskIntake, type TaskExecutionSemantics, type TaskIntentEnvelope, type TaskStructuredRequest } from "../agent/intake.js";
import { reviewTaskCompletion } from "../agent/completion-review.js";
import type { AgentContextMode } from "../agent/index.js";
import { resolveRunRoute } from "./routing.js";
import { buildFollowupPrompt, createDefaultScheduleActionDependencies, executeScheduleActions, inferDelegatedTaskProfile, type ScheduleDelayedRunRequest } from "./action-execution.js";
import type { RunChunkDeliveryHandler } from "./delivery.js";
import type { LoopDirective } from "./loop-directive.js";
import type { TaskProfile } from "./types.js";
import type { WorkerRuntimeTarget } from "./worker-runtime.js";
import type { AgentExecutionDecision, AgentExecutionDecisionTraceSnapshot } from "../orchestration/execution-decision-contract.js";
import { buildExecutionGraphSnapshot } from "../orchestration/execution-graph-snapshot.js";
import { runAgentExecutionHarness } from "../orchestration/execution-harness.js";
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
    providerTrace?: ProviderAuditTrace | undefined;
    workerRuntime?: WorkerRuntimeTarget | undefined;
    targetId?: string | undefined;
    targetLabel?: string | undefined;
    agentExecutionDecision?: AgentExecutionDecision | undefined;
    agentExecutionDecisionTrace?: AgentExecutionDecisionTraceSnapshot | undefined;
    workDir: string;
    source: ChannelSource;
    skipIntake?: boolean | undefined;
    toolsEnabled?: boolean | undefined;
    contextMode?: AgentContextMode | undefined;
    onChunk?: RunChunkDeliveryHandler;
}
export interface DelegatedRunStartResult {
    runId?: string | undefined;
    finished?: Promise<{
        status?: string;
        summary?: string;
    } | undefined>;
}
interface IntakeBridgePassDependencies {
    appendRunEvent: (runId: string, message: string) => void;
    updateRunSummary: (runId: string, summary: string) => void;
    incrementDelegationTurnCount: (runId: string, summary: string) => void;
    emitScheduleCreated: (payload: ReturnType<typeof buildScheduleRegistrationCreatedEvent>) => void;
    emitScheduleCancelled: (payload: ReturnType<typeof buildScheduleRegistrationCancelledEvent>) => void;
    scheduleDelayedRun: (params: ScheduleDelayedRunRequest) => void;
    startDelegatedRun: (params: DelegatedRunStartParams) => void | DelegatedRunStartResult | Promise<void | DelegatedRunStartResult>;
    normalizeTaskProfile: (taskProfile: string | undefined) => TaskProfile;
    logInfo: (message: string, payload: Record<string, unknown>) => void;
    recordExecutionDecisionTrace?: (params: {
        runId: string;
        agentExecutionDecision: AgentExecutionDecision;
        executionDecisionTrace: AgentExecutionDecisionTraceSnapshot;
    }) => void;
}
interface IntakeBridgePassModuleDependencies {
    analyzeTaskIntake: typeof analyzeTaskIntake;
    resolveRunRoute: typeof resolveRunRoute;
    executeScheduleActions: typeof executeScheduleActions;
    createDefaultScheduleActionDependencies: typeof createDefaultScheduleActionDependencies;
    inferDelegatedTaskProfile: typeof inferDelegatedTaskProfile;
    buildFollowupPrompt: typeof buildFollowupPrompt;
    buildExecutionGraphSnapshot?: typeof buildExecutionGraphSnapshot;
    runAgentExecutionHarness?: typeof runAgentExecutionHarness;
    reviewTaskCompletion?: typeof reviewTaskCompletion;
}
export declare function runIntakeBridgePass(params: {
    message: string;
    originalRequest: string;
    sessionId: string;
    requestGroupId: string;
    model: string | undefined;
    providerId?: string | undefined;
    provider?: AIProvider | undefined;
    workDir: string;
    source: ChannelSource;
    runId: string;
    onChunk: RunChunkDeliveryHandler | undefined;
    reuseConversationContext: boolean;
}, dependencies: IntakeBridgePassDependencies, moduleDependencies?: IntakeBridgePassModuleDependencies): Promise<LoopDirective | null>;
export {};
//# sourceMappingURL=intake-bridge-pass.d.ts.map