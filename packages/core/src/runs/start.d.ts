import type { AgentChunk, AgentContextMode } from "../agent/index.js";
import type { LLMProvider } from "../llm/index.js";
import type { RootRun, TaskProfile } from "./types.js";
import type { WorkerRuntimeTarget } from "./worker-runtime.js";
export interface StartRootRunParams {
    message: string;
    sessionId: string | undefined;
    requestGroupId?: string | undefined;
    model: string | undefined;
    providerId?: string | undefined;
    provider?: LLMProvider | undefined;
    targetId?: string | undefined;
    targetLabel?: string | undefined;
    workerRuntime?: WorkerRuntimeTarget | undefined;
    workDir?: string | undefined;
    source: "webui" | "cli" | "telegram";
    skipIntake?: boolean | undefined;
    toolsEnabled?: boolean | undefined;
    contextMode?: AgentContextMode | undefined;
    taskProfile?: TaskProfile | undefined;
    onChunk?: ((chunk: AgentChunk) => Promise<void> | void) | undefined;
}
export interface StartedRootRun {
    runId: string;
    sessionId: string;
    status: "started";
    finished: Promise<RootRun | undefined>;
}
export declare function startRootRun(params: StartRootRunParams): StartedRootRun;
//# sourceMappingURL=start.d.ts.map