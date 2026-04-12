import { type SetupDraft } from "../control-plane/index.js";
import { type AIProvider } from "../ai/index.js";
import type { WorkerRuntimeTarget } from "./worker-runtime.js";
export interface RouteActionInput {
    preferredTarget?: string | undefined;
    taskProfile?: string | undefined;
    fallbackModel?: string | undefined;
    avoidTargets?: string[] | undefined;
}
export interface ResolvedRunRoute {
    targetId?: string;
    targetLabel?: string;
    providerId?: string;
    model?: string;
    provider?: AIProvider;
    workerRuntime?: WorkerRuntimeTarget;
    reason: string;
}
export interface RouteResolutionOptions {
}
export declare function resolveRunRoute(input: RouteActionInput): ResolvedRunRoute;
export declare function resolveRunRouteFromDraft(draft: SetupDraft, input: RouteActionInput, options?: RouteResolutionOptions): ResolvedRunRoute;
//# sourceMappingURL=routing.d.ts.map