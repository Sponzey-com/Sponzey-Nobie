import type { AuthProfile, ChatParams, AIChunk, AIProvider } from "../types.js";
export declare class GeminiProvider implements AIProvider {
    private profile;
    private baseUrl?;
    readonly id = "gemini";
    readonly supportedModels: string[];
    constructor(profile: AuthProfile, baseUrl?: string | undefined);
    maxContextTokens(model: string): number;
    chat(params: ChatParams): AsyncGenerator<AIChunk>;
}
//# sourceMappingURL=gemini.d.ts.map