import { runAgent } from "../agent/index.js";
import type { AgentChunk, AgentContextMode } from "../agent/index.js";
import type { AIProvider } from "../ai/index.js";
export interface ExecutionChunkStreamParams {
    userMessage: string;
    memorySearchQuery: string;
    sessionId: string;
    runId: string;
    model?: string | undefined;
    providerId?: string | undefined;
    provider?: AIProvider | undefined;
    workDir: string;
    source: "webui" | "cli" | "telegram" | "slack";
    signal: AbortSignal;
    toolsEnabled?: boolean | undefined;
    isRootRequest: boolean;
    requestGroupId: string;
    contextMode: AgentContextMode;
}
export interface ExecutionRuntimeDependencies {
    runAgent: typeof runAgent;
}
export declare function createExecutionChunkStream(params: ExecutionChunkStreamParams, dependencies?: ExecutionRuntimeDependencies): AsyncGenerator<AgentChunk>;
//# sourceMappingURL=execution-runtime.d.ts.map