import { type AgentExecutionContext, type AgentExecutionContextRequest, type AgentExecutionExecutorProfile, type AgentExecutionPermissionPolicy, type AgentExecutionRequester, type AgentExecutionRiskPolicy, type AgentExecutionToolBinding } from "./execution-decision-contract.js";
import { type ExecutionGraphSnapshot } from "./execution-graph-snapshot.js";
import { type ExecutorProfilePromptProjection } from "./prompt-bundle.js";
export interface BuildAgentExecutionContextFromGraphInput {
    graph: ExecutionGraphSnapshot;
    request: AgentExecutionContextRequest;
    requester?: AgentExecutionRequester;
    availableTools?: AgentExecutionToolBinding[];
    permissionPolicy?: AgentExecutionPermissionPolicy;
    riskPolicy?: AgentExecutionRiskPolicy;
    currentExecutor?: AgentExecutionExecutorProfile;
    directExecutionRequested?: boolean;
    explicitTargetExecutorId?: string;
    explicitProviderTargetId?: string;
}
export declare function buildAgentExecutionContextFromGraphSnapshot(input: BuildAgentExecutionContextFromGraphInput): AgentExecutionContext;
export declare function buildExecutorProfilePromptProjectionFromGraphSnapshot(graph: ExecutionGraphSnapshot): ExecutorProfilePromptProjection;
//# sourceMappingURL=execution-context-builder.d.ts.map