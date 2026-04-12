import type { AuthProfile, ChatParams, LLMChunk, LLMProvider } from "../types.js";
export declare class GeminiProvider implements LLMProvider {
    private profile;
    private baseUrl?;
    readonly id = "gemini";
    readonly supportedModels: string[];
    constructor(profile: AuthProfile, baseUrl?: string | undefined);
    maxContextTokens(model: string): number;
    chat(params: ChatParams): AsyncGenerator<LLMChunk>;
}
//# sourceMappingURL=gemini.d.ts.map