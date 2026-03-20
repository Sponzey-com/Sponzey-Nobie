import { type SetupDraft } from "../control-plane/index.js";
import { type LLMProvider } from "../llm/index.js";
import { type WorkerAvailabilityOverrides, type WorkerRuntimeTarget } from "./worker-runtime.js";
export interface RouteActionInput {
    preferredTarget?: string | undefined;
    taskProfile?: string | undefined;
    fallbackModel?: string | undefined;
}
export interface ResolvedRunRoute {
    targetId?: string;
    targetLabel?: string;
    providerId?: string;
    model?: string;
    provider?: LLMProvider;
    workerRuntime?: WorkerRuntimeTarget;
    reason: string;
}
export interface RouteResolutionOptions {
    workerAvailability?: WorkerAvailabilityOverrides;
}
export declare function resolveRunRoute(input: RouteActionInput): ResolvedRunRoute;
export declare function resolveRunRouteFromDraft(draft: SetupDraft, input: RouteActionInput, options?: RouteResolutionOptions): ResolvedRunRoute;
//# sourceMappingURL=routing.d.ts.map