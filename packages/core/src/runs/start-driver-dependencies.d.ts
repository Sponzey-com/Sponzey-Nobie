import type { AgentContextMode } from "../agent/index.js";
import type { TaskExecutionSemantics, TaskIntentEnvelope, TaskStructuredRequest } from "../agent/intake.js";
import type { AIProvider } from "../ai/index.js";
import type { SyntheticApprovalRuntimeDependencies } from "./approval.js";
import { type RunChunkDeliveryHandler } from "./delivery.js";
import type { RootRunDriverDependencies } from "./root-run-driver.js";
import type { FinalizationDependencies, FinalizationSource } from "./finalization.js";
import type { ActiveQueueCancellationMode } from "./entry-semantics.js";
import type { RootRun, TaskProfile } from "./types.js";
import type { WorkerRuntimeTarget } from "./worker-runtime.js";
export declare function buildStartRootRunDriverDependencies(params: {
    runId: string;
    sessionId: string;
    requestGroupId: string;
    source: FinalizationSource;
    onChunk: RunChunkDeliveryHandler | undefined;
    message: string;
    model: string | undefined;
    workDir: string;
    reuseConversationContext: boolean;
    activeQueueCancellationMode: ActiveQueueCancellationMode | null;
    startNestedRootRun: (params: {
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
        source: FinalizationSource;
        skipIntake?: boolean | undefined;
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
    syntheticApprovalScopes: Set<string>;
    logInfo: (message: string, payload?: Record<string, unknown>) => void;
    logWarn: (message: string) => void;
    logError: (message: string, payload?: Record<string, unknown>) => void;
}): {
    finalizationDependencies: FinalizationDependencies;
    syntheticApprovalRuntimeDependencies: SyntheticApprovalRuntimeDependencies;
    driverDependencies: RootRunDriverDependencies;
};
//# sourceMappingURL=start-driver-dependencies.d.ts.map