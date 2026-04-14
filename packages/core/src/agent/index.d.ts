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
    details?: unknown;
} | {
    type: "execution_recovery";
    toolNames: string[];
    summary: string;
    reason: string;
} | {
    type: "ai_recovery";
    summary: string;
    reason: string;
    message: string;
} | {
    type: "done";
    totalTokens: number;
} | {
    type: "error";
    message: string;
};
export type AgentContextMode = "full" | "isolated" | "request_group" | "handoff";
export interface RunAgentParams {
    userMessage: string;
    memorySearchQuery?: string | undefined;
    sessionId?: string | undefined;
    requestGroupId?: string | undefined;
    runId?: string | undefined;
    scheduleId?: string | undefined;
    includeScheduleMemory?: boolean | undefined;
    model?: string | undefined;
    providerId?: string | undefined;
    provider?: AIProvider | undefined;
    systemPrompt?: string | undefined;
    workDir?: string | undefined;
    source?: "webui" | "cli" | "telegram" | "slack" | undefined;
    signal?: AbortSignal | undefined;
    toolsEnabled?: boolean | undefined;
    contextMode?: AgentContextMode | undefined;
}
export declare function runAgent(params: RunAgentParams): AsyncGenerator<AgentChunk>;
//# sourceMappingURL=index.d.ts.map