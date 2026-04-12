import type { AIConnectionConfig } from "../config/types.js";
import type { AIProvider } from "./types.js";
export declare function resetAIProviderCache(): void;
export declare function getActiveAIConnection(config?: import("../config/types.js").NobieConfig): AIConnectionConfig;
export declare function detectAvailableProvider(): string;
export declare function getDefaultModel(): string;
export declare function inferProviderId(_model: string): string;
export declare function getProvider(providerId?: string): AIProvider;
export declare function shouldForceReasoningMode(providerId: string, model: string): boolean;
export type { AIProvider, AIChunk, Message, ToolDefinition, ChatParams } from "./types.js";
//# sourceMappingURL=index.d.ts.map