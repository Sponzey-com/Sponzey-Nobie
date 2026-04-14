import OpenAI from "openai";
import type { AIChunk, AIProvider, ChatParams, AuthProfile, Message } from "../types.js";
import { type OpenAICodexOAuthConfig } from "../../auth/openai-codex-oauth.js";
export declare function resolveOpenAIChatMaxTokens(input: {
    contextLimit: number;
    messages: OpenAI.ChatCompletionMessageParam[];
    tools?: OpenAI.ChatCompletionTool[];
    maxTokens?: number;
}): number;
export declare function buildCodexOAuthFallbackPrompt(messages: Message[]): string;
export declare function shouldRetryCodexOAuthWithSimplePayload(input: {
    status: number;
    detail: string;
    hasTools: boolean;
    hasMaxOutputTokens: boolean;
    messageCount: number;
    hasStructuredConversation: boolean;
}): boolean;
export declare class OpenAIProvider implements AIProvider {
    private profile;
    private baseUrl?;
    private oauthConfig?;
    readonly id = "openai";
    readonly supportedModels: string[];
    constructor(profile: AuthProfile, baseUrl?: string | undefined, oauthConfig?: OpenAICodexOAuthConfig | undefined);
    maxContextTokens(model: string): number;
    private chatWithCodexOAuth;
    chat(params: ChatParams): AsyncGenerator<AIChunk>;
}
//# sourceMappingURL=openai.d.ts.map