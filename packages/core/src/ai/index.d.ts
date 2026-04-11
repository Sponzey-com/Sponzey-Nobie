import type { AIProvider } from "./types.js";
export declare function resetAIProviderCache(): void;
export declare function getProvider(providerId?: string): AIProvider;
/**
 * 설정에 저장된 AI 연결만 기준으로 공급자를 자동 감지한다.
 */
export declare function detectAvailableProvider(): string;
export declare function getDefaultModel(): string;
/** Infer the provider ID from a model name, falling back to the auto-detected provider. */
export declare function inferProviderId(model: string): string;
export declare function shouldForceReasoningMode(providerId: string, model: string): boolean;
export type { AIProvider, AIChunk, Message, ToolDefinition, ChatParams } from "./types.js";
//# sourceMappingURL=index.d.ts.map
