import { type AIProvider } from "../ai/index.js";
export type AgentChunk = {
    type: "text";
    delta: string;
} | {
    type: "tool_start";
    toolName: string;
    params: unknown;
} | {
    type: "tool_end";
    toolName: string;
    success: boolean;
    output: string;
} | {
    type: "done";
    totalTokens: number;
} | {
    type: "error";
    message: string;
};
export type AgentContextMode = "full" | "isolated" | "request_group";
export interface RunAgentParams {
    userMessage: string;
    sessionId?: string | undefined;
    requestGroupId?: string | undefined;
    runId?: string | undefined;
    model?: string | undefined;
    providerId?: string | undefined;
    provider?: AIProvider | undefined;
    systemPrompt?: string | undefined;
    workDir?: string | undefined;
    source?: "webui" | "cli" | "telegram" | undefined;
    signal?: AbortSignal | undefined;
    toolsEnabled?: boolean | undefined;
    contextMode?: AgentContextMode | undefined;
}
export declare function runAgent(params: RunAgentParams): AsyncGenerator<AgentChunk>;
//# sourceMappingURL=index.d.ts.map