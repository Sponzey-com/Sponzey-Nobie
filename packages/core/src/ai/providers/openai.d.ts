import OpenAI from "openai";
import type { AIChunk, AIProvider, ChatParams, AuthProfile } from "../types.js";
export declare function resolveOpenAIChatMaxTokens(input: {
    contextLimit: number;
    messages: OpenAI.ChatCompletionMessageParam[];
    tools?: OpenAI.ChatCompletionTool[];
    maxTokens?: number;
}): number;
export declare class OpenAIProvider implements AIProvider {
    private profile;
    private baseUrl?;
    readonly id = "openai";
    readonly supportedModels: string[];
    constructor(profile: AuthProfile, baseUrl?: string | undefined);
    maxContextTokens(model: string): number;
    chat(params: ChatParams): AsyncGenerator<AIChunk>;
}
//# sourceMappingURL=openai.d.ts.map