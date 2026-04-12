import { runExecutionCyclePass, type ExecutionCycleState } from "./execution-cycle-pass.js";
import type { LoopDirective } from "./loop-directive.js";
import { runLoopEntryPass } from "./loop-entry-pass.js";
import type { RootLoopDependencies, RootLoopParams } from "./root-loop.js";
export interface RootLoopEntryPassLaunch {
    params: Parameters<typeof runLoopEntryPass>[0];
    dependencies: Parameters<typeof runLoopEntryPass>[1];
}
export interface RootExecutionCyclePassLaunch {
    params: Parameters<typeof runExecutionCyclePass>[0];
    dependencies: Parameters<typeof runExecutionCyclePass>[1];
}
export declare function prepareRootLoopEntryPassLaunch(params: {
    runId: string;
    sessionId: string;
    source: RootLoopParams["source"];
    onChunk: RootLoopParams["onChunk"];
    pendingLoopDirective: LoopDirective | null;
    intakeProcessed: boolean;
    currentMessage: string;
    recoveryBudgetUsage: RootLoopParams["recoveryBudgetUsage"];
}, dependencies: RootLoopDependencies): RootLoopEntryPassLaunch;
export declare function prepareRootExecutionCyclePassLaunch(params: {
    runId: string;
    sessionId: string;
    requestGroupId: string;
    source: RootLoopParams["source"];
    onChunk: RootLoopParams["onChunk"];
    signal: AbortSignal;
    abortExecutionStream: () => void;
    state: ExecutionCycleState;
    executionSemantics: RootLoopParams["executionSemantics"];
    originalRequest: string;
    structuredRequest?: RootLoopParams["structuredRequest"];
    requestMessage: string;
    workDir: string;
    toolsEnabled?: boolean;
    workerSessionId?: string;
    isRootRequest: boolean;
    contextMode: RootLoopParams["contextMode"];
    taskProfile: RootLoopParams["taskProfile"];
    wantsDirectArtifactDelivery: boolean;
    requiresFilesystemMutation: boolean;
    requiresPrivilegedToolExecution: boolean;
    pendingToolParams: RootLoopParams["pendingToolParams"];
    filesystemMutationPaths: RootLoopParams["filesystemMutationPaths"];
    seenFollowupPrompts: RootLoopParams["seenFollowupPrompts"];
    seenCommandFailureRecoveryKeys: RootLoopParams["seenCommandFailureRecoveryKeys"];
    seenExecutionRecoveryKeys: RootLoopParams["seenExecutionRecoveryKeys"];
    seenDeliveryRecoveryKeys: RootLoopParams["seenDeliveryRecoveryKeys"];
    seenAiRecoveryKeys: RootLoopParams["seenAiRecoveryKeys"];
    recoveryBudgetUsage: RootLoopParams["recoveryBudgetUsage"];
    priorAssistantMessages: RootLoopParams["priorAssistantMessages"];
    syntheticApprovalRuntimeDependencies: RootLoopParams["syntheticApprovalRuntimeDependencies"];
    defaultMaxDelegationTurns: number;
}, dependencies: RootLoopDependencies): RootExecutionCyclePassLaunch;
//# sourceMappingURL=root-loop-pass-launch.d.ts.map