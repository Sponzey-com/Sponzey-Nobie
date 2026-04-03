import type { AIChunk, AIProvider, ChatParams, AuthProfile } from "../types.js";
export declare class AnthropicProvider implements AIProvider {
    private profile;
    readonly id = "anthropic";
    readonly supportedModels: string[];
    constructor(profile: AuthProfile);
    maxContextTokens(model: string): number;
    chat(params: ChatParams): AsyncGenerator<AIChunk>;
}
//# sourceMappingURL=anthropic.d.ts.map