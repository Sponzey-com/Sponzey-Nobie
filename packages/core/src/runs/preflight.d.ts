import type { AIProvider } from "../ai/index.js";
import type { TaskExecutionSemantics } from "../agent/intake.js";
import type { RunChunkDeliveryHandler } from "./delivery.js";
import type { FinalizationSource } from "./finalization.js";
import type { WorkerRuntimeTarget } from "./worker-runtime.js";
export interface StartPreflightFailure {
    code: "ai_connection_unavailable" | "ai_model_unavailable" | "channel_unavailable" | "yeonjang_unavailable";
    summary: string;
    userMessage: string;
    eventLabel: string;
}
export interface StartPreflightInput {
    source: FinalizationSource;
    message: string;
    model?: string | undefined;
    providerId?: string | undefined;
    provider?: AIProvider | undefined;
    onChunk?: RunChunkDeliveryHandler;
    immediateCompletionText?: string | undefined;
    toolsEnabled?: boolean | undefined;
    executionSemantics?: TaskExecutionSemantics | undefined;
    targetId?: string | undefined;
    workerRuntime?: WorkerRuntimeTarget | undefined;
}
export declare function resolveStartPreflightFailure(input: StartPreflightInput): StartPreflightFailure | null;
//# sourceMappingURL=preflight.d.ts.map