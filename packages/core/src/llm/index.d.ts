import type { LLMProvider } from "./types.js";
export declare function getProvider(providerId?: string): LLMProvider;
/**
 * 사용 가능한 API 키를 기준으로 공급자를 자동 감지한다.
 * 우선순위: config 명시 → ANTHROPIC_API_KEY → OPENAI_API_KEY
 */
export declare function detectAvailableProvider(): string;
export declare function getDefaultModel(): string;
/** Infer the provider ID from a model name, falling back to the auto-detected provider. */
export declare function inferProviderId(model: string): string;
export declare function shouldForceReasoningMode(providerId: string, model: string): boolean;
export type { LLMProvider, LLMChunk, Message, ToolDefinition, ChatParams } from "./types.js";
//# sourceMappingURL=index.d.ts.map