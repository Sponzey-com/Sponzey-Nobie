import { type TaskExecutionSemantics, type TaskIntentEnvelope, type TaskStructuredRequest } from "../agent/intake.js";
import { type RecoveryBudgetUsage } from "./recovery-budget.js";
export interface ResolvedExecutionProfile {
    originalRequest: string;
    structuredRequest: TaskStructuredRequest;
    intentEnvelope: TaskIntentEnvelope;
    executionSemantics: TaskExecutionSemantics;
    requiresFilesystemMutation: boolean;
    requiresPrivilegedToolExecution: boolean;
    wantsDirectArtifactDelivery: boolean;
    approvalRequired: boolean;
    approvalTool: string;
}
export interface ExecutionLoopRuntimeState {
    executionProfile: ResolvedExecutionProfile;
    originalUserRequest: string;
    priorAssistantMessages: string[];
    seenFollowupPrompts: Set<string>;
    seenCommandFailureRecoveryKeys: Set<string>;
    seenExecutionRecoveryKeys: Set<string>;
    seenDeliveryRecoveryKeys: Set<string>;
    seenAiRecoveryKeys: Set<string>;
    recoveryBudgetUsage: RecoveryBudgetUsage;
    requiresFilesystemMutation: boolean;
    requiresPrivilegedToolExecution: boolean;
    pendingToolParams: Map<string, unknown>;
    filesystemMutationPaths: Set<string>;
}
export declare function buildResolvedExecutionProfile(params: {
    message: string;
    originalRequest?: string;
    executionSemantics?: TaskExecutionSemantics;
    structuredRequest?: TaskStructuredRequest;
    intentEnvelope?: TaskIntentEnvelope;
}): ResolvedExecutionProfile;
export declare function createExecutionLoopRuntimeState(params: {
    message: string;
    originalRequest?: string;
    executionSemantics?: TaskExecutionSemantics;
    structuredRequest?: TaskStructuredRequest;
    intentEnvelope?: TaskIntentEnvelope;
}): ExecutionLoopRuntimeState;
//# sourceMappingURL=execution-profile.d.ts.map