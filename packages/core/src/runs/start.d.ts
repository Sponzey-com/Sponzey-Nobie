import type { AgentContextMode } from "../agent/index.js";
import { type TaskExecutionSemantics, type TaskIntentEnvelope, type TaskStructuredRequest } from "../agent/intake.js";
import type { AIProvider, ProviderAuditTrace } from "../ai/index.js";
import type { RunChunkDeliveryHandler } from "./delivery.js";
import type { RootRun, TaskProfile } from "./types.js";
import type { InboundMessageRecord } from "./request-isolation.js";
import type { WorkerRuntimeTarget } from "./worker-runtime.js";
import type { OrchestrationPlannerIntent } from "../orchestration/planner.js";
export interface StartRootRunParams {
    runId?: string | undefined;
    targetRunId?: string | undefined;
    message: string;
    sessionId: string | undefined;
    requestGroupId?: string | undefined;
    parentRunId?: string | undefined;
    originRunId?: string | undefined;
    originRequestGroupId?: string | undefined;
    forceRequestGroupReuse?: boolean | undefined;
    model: string | undefined;
    providerId?: string | undefined;
    provider?: AIProvider | undefined;
    providerTrace?: ProviderAuditTrace | undefined;
    targetId?: string | undefined;
    targetLabel?: string | undefined;
    workerRuntime?: WorkerRuntimeTarget | undefined;
    orchestrationPlannerIntent?: OrchestrationPlannerIntent | undefined;
    workDir?: string | undefined;
    source: "webui" | "cli" | "telegram" | "slack";
    skipIntake?: boolean | undefined;
    toolsEnabled?: boolean | undefined;
    contextMode?: AgentContextMode | undefined;
    taskProfile?: TaskProfile | undefined;
    runScope?: "root" | "child" | "analysis" | undefined;
    handoffSummary?: string | undefined;
    originalRequest?: string | undefined;
    executionSemantics?: TaskExecutionSemantics | undefined;
    structuredRequest?: TaskStructuredRequest | undefined;
    intentEnvelope?: TaskIntentEnvelope | undefined;
    immediateCompletionText?: string | undefined;
    onChunk?: RunChunkDeliveryHandler;
    inboundMessage?: InboundMessageRecord | undefined;
}
export interface StartedRootRun {
    runId: string;
    sessionId: string;
    status: "started";
    finished: Promise<RootRun | undefined>;
}
export declare function startRootRun(params: StartRootRunParams): StartedRootRun;
//# sourceMappingURL=start.d.ts.map