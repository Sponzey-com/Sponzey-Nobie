export interface TextContent {
    type: "text";
    text: string;
}
export interface ToolUseContent {
    type: "tool_use";
    id: string;
    name: string;
    input: unknown;
}
export interface ToolResultContent {
    type: "tool_result";
    tool_use_id: string;
    content: string;
    is_error?: boolean;
}
export type MessageContent = TextContent | ToolUseContent | ToolResultContent;
export interface Message {
    role: "user" | "assistant";
    content: string | MessageContent[];
}
export interface ToolDefinition {
    name: string;
    description: string;
    input_schema: {
        type: "object";
        properties: Record<string, unknown>;
        required?: string[];
    };
}
export type AIChunk = {
    type: "text_delta";
    delta: string;
} | {
    type: "tool_use";
    id: string;
    name: string;
    input: unknown;
} | {
    type: "message_stop";
    usage: {
        input_tokens: number;
        output_tokens: number;
    };
};
export interface ChatParams {
    model: string;
    messages: Message[];
    system?: string;
    tools?: ToolDefinition[];
    maxTokens?: number;
    signal?: AbortSignal;
}
export interface AIProvider {
    id: string;
    supportedModels: string[];
    chat(params: ChatParams): AsyncGenerator<AIChunk>;
    maxContextTokens(model: string): number;
}
export interface AuthProfile {
    apiKeys: string[];
    currentKeyIndex: number;
    cooldowns: Map<string, number>;
}
export declare function nextApiKey(profile: AuthProfile): string | null;
export declare function markKeyFailure(profile: AuthProfile, key: string, cooldownMs?: number): void;
//# sourceMappingURL=types.d.ts.map