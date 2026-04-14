import type { LLMChunk, LLMProvider, ChatParams, AuthProfile } from "../types.js";
export declare class AnthropicProvider implements LLMProvider {
    private profile;
    readonly id = "anthropic";
    readonly supportedModels: string[];
    constructor(profile: AuthProfile);
    maxContextTokens(model: string): number;
    chat(params: ChatParams): AsyncGenerator<LLMChunk>;
}
//# sourceMappingURL=anthropic.d.ts.map