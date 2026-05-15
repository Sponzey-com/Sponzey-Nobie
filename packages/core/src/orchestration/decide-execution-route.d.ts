import type { AIProvider, ProviderAuditTrace } from "../ai/index.js";
import { type BuildAgentExecutionContextFromGraphInput } from "./execution-context-builder.js";
import type { AgentExecutionContext, AgentExecutionDecision, AgentExecutionDecisionTraceSnapshot } from "./execution-decision-contract.js";
import { type BuildExecutionGraphSnapshotInput, type ExecutionGraphSnapshot } from "./execution-graph-snapshot.js";
import { runAgentExecutionHarness, type AgentExecutionHarnessResult, type AgentExecutionModelCaller } from "./execution-harness.js";
export declare const DECIDE_EXECUTION_ROUTE_KINDS: readonly ["delegate_to_child", "self_solve", "ask_user", "boundary_failure", "explicit_provider_target"];
export type DecideExecutionRouteKind = (typeof DECIDE_EXECUTION_ROUTE_KINDS)[number];
export interface DecideExecutionResolvedTarget {
    targetId?: string;
    targetLabel?: string;
    providerId?: string;
    model?: string;
    provider?: AIProvider;
    providerTrace?: ProviderAuditTrace;
    workerRuntime?: unknown;
    reason: string;
}
export interface ResolveExplicitProviderTargetInput {
    preferredTarget?: string | undefined;
    taskProfile?: string | undefined;
    fallbackModel?: string | undefined;
}
export interface DecideExecutionRouteInput {
    originalRequest: string;
    delegatedTitle: string;
    delegatedTaskProfile: string;
    sessionId: string;
    source: string;
    preferredTarget?: string | undefined;
    fallbackModel?: string | undefined;
    currentExecutorId?: string | undefined;
    buildExecutionGraphSnapshot?: ((input?: BuildExecutionGraphSnapshotInput) => ExecutionGraphSnapshot) | undefined;
    buildExecutionContext?: ((input: BuildAgentExecutionContextFromGraphInput) => AgentExecutionContext) | undefined;
    runAgentExecutionHarness?: typeof runAgentExecutionHarness | undefined;
    callModel?: AgentExecutionModelCaller | undefined;
    resolveExplicitProviderTarget?: ((input: ResolveExplicitProviderTargetInput) => DecideExecutionResolvedTarget | undefined) | undefined;
}
export type DecideExecutionRouteResult = {
    kind: "explicit_provider_target";
    route: DecideExecutionResolvedTarget;
} | {
    kind: "delegate_to_child";
    route: DecideExecutionResolvedTarget;
    agentExecutionDecision: AgentExecutionDecision;
    decisionResult: AgentExecutionHarnessResult;
    executionGraph: ExecutionGraphSnapshot;
    executionContext: AgentExecutionContext;
} | {
    kind: "self_solve" | "ask_user" | "boundary_failure";
    agentExecutionDecision: AgentExecutionDecision;
    decisionResult: AgentExecutionHarnessResult;
    executionGraph: ExecutionGraphSnapshot;
    executionContext: AgentExecutionContext;
};
export declare function normalizeExplicitExecutionTarget(value: string | undefined): string | undefined;
export declare function isExplicitProviderExecutionTarget(value: string | undefined): boolean;
export declare function decideExecutionRoute(input: DecideExecutionRouteInput): Promise<DecideExecutionRouteResult>;
export declare function executionDecisionTraceForResult(result: DecideExecutionRouteResult): AgentExecutionDecisionTraceSnapshot | undefined;
//# sourceMappingURL=decide-execution-route.d.ts.map