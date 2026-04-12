import type { AgentContextMode } from "../agent/index.js";
import type { TaskExecutionSemantics, TaskIntentEnvelope, TaskStructuredRequest } from "../agent/intake.js";
import type { AIProvider } from "../ai/index.js";
import { resolveRunRoute } from "./routing.js";
import type { RunChunkDeliveryHandler } from "./delivery.js";
import type { RootRun, TaskProfile } from "./types.js";
import type { WorkerRuntimeTarget } from "./worker-runtime.js";
interface QueueLoggingDependencies {
    logInfo: (message: string, payload?: Record<string, unknown>) => void;
    logWarn: (message: string) => void;
    logError: (message: string, payload?: Record<string, unknown>) => void;
}
interface DelayedRunDependencies extends QueueLoggingDependencies {
    startRootRun: (params: {
        message: string;
        sessionId: string;
        requestGroupId?: string | undefined;
        originRunId?: string | undefined;
        originRequestGroupId?: string | undefined;
        model: string | undefined;
        providerId?: string | undefined;
        provider?: AIProvider | undefined;
        targetId?: string | undefined;
        targetLabel?: string | undefined;
        workerRuntime?: WorkerRuntimeTarget | undefined;
        workDir?: string | undefined;
        source: "webui" | "cli" | "telegram" | "slack";
        skipIntake: true;
        toolsEnabled?: boolean | undefined;
        contextMode?: AgentContextMode | undefined;
        taskProfile?: TaskProfile | undefined;
        originalRequest?: string | undefined;
        executionSemantics?: TaskExecutionSemantics | undefined;
        structuredRequest?: TaskStructuredRequest | undefined;
        intentEnvelope?: TaskIntentEnvelope | undefined;
        immediateCompletionText?: string | undefined;
        onChunk?: RunChunkDeliveryHandler;
    }) => {
        finished: Promise<RootRun | undefined>;
    };
    now?: () => number;
    resolveRoute?: typeof resolveRunRoute;
    setTimer?: typeof setTimeout;
}
export declare function scheduleDelayedRootRun(params: {
    runAtMs: number;
    message: string;
    sessionId: string;
    originRunId?: string;
    originRequestGroupId?: string;
    model: string | undefined;
    originalRequest?: string;
    executionSemantics?: TaskExecutionSemantics;
    structuredRequest?: TaskStructuredRequest;
    intentEnvelope?: TaskIntentEnvelope;
    workDir?: string;
    source: "webui" | "cli" | "telegram" | "slack";
    onChunk: RunChunkDeliveryHandler | undefined;
    immediateCompletionText?: string;
    preferredTarget?: string;
    taskProfile?: TaskProfile;
    toolsEnabled?: boolean;
    contextMode?: AgentContextMode;
}, dependencies: DelayedRunDependencies): void;
export {};
//# sourceMappingURL=run-queueing.d.ts.map